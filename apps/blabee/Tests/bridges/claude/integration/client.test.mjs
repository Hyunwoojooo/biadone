import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILD_ROOT } from '../support/paths.mjs';
import { startSharedCore } from '../support/shared-core-client.mjs';

async function fixture(t, source, timeoutMs = 1000) {
  await mkdir(BUILD_ROOT, { recursive: true });
  const runtime = await realpath(await mkdtemp(join(BUILD_ROOT, 'shared-client-')));
  const script = join(runtime, 'host.mjs');
  await writeFile(script, source);
  const client = await startSharedCore({
    executable: await realpath(process.execPath), fixtureRuntime: runtime, timeoutMs,
    spawnProcess: (executable, _args, options) => spawn(executable, [script], options),
  });
  t.after(async () => { await client.close(); await rm(runtime, { recursive: true, force: true }); });
  return { ...client, fixtureRuntime: runtime };
}

const prelude = `import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin });
const respond = (request, result) => console.log(JSON.stringify({schema_version:'0.1', request_id:request.request_id, ok:true, result}));
`;

test('stdio correlates concurrent replies without modifying commands', async t => {
  const client = await fixture(t, prelude + `lines.on('line', line => {
    const request = JSON.parse(line);
    setTimeout(() => respond(request, {value:request.value}), request.value === 1 ? 30 : 0);
  });`);
  const results = await Promise.all([client.request({ operation: 'snapshot', value: 1 }), client.request({ operation: 'snapshot', value: 2 })]);
  assert.deepEqual(results, [{ value: 1 }, { value: 2 }]);
  await assert.rejects(client.request({ operation: 'snapshot', request_id: 'override' }), { code: 'invalid_shared_core_request' });
});

test('lost result fails closed and cannot replay or send the next action', async t => {
  const client = await fixture(t, prelude + `
    import { appendFileSync } from 'node:fs';
    lines.on('line', line => appendFileSync(new URL('./requests.txt', import.meta.url), line + '\\n'));
  `, 250);
  await assert.rejects(client.request({ operation: 'claim' }), { code: 'shared_core_response_unknown' });
  await assert.rejects(client.request({ operation: 'claim' }), { code: 'shared_core_response_unknown' });
  const requests = (await readFile(join(client.fixtureRuntime, 'requests.txt'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].operation, 'claim');
});

test('close settles pending work and reaps only its host even when EOF and SIGTERM are ignored', async t => {
  const client = await fixture(t, prelude + `
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
    lines.on('line', line => {
      const request = JSON.parse(line);
      if (request.operation === 'snapshot') respond(request, {ready:true});
    });
  `, 2000);
  assert.deepEqual(await client.request({ operation: 'snapshot' }), { ready: true });
  const pending = assert.rejects(client.request({ operation: 'claim' }), { code: 'shared_core_closed' });
  await Promise.all([pending, client.close()]);
  await assert.rejects(client.request({ operation: 'snapshot' }), { code: 'shared_core_closed' });
});

test('an unknown response identity poisons the connection', async t => {
  const client = await fixture(t, prelude + `lines.on('line', line => respond({...JSON.parse(line),request_id:'wrong'}, {}));`);
  await assert.rejects(client.request({ operation: 'snapshot' }), { code: 'invalid_shared_core_response' });
  await assert.rejects(client.request({ operation: 'snapshot' }), { code: 'invalid_shared_core_response' });
});

test('malformed or oversized output cannot become a successful operation', async t => {
  const client = await fixture(t, prelude + `lines.on('line', () => process.stdout.write('x'.repeat(131073)));`);
  await assert.rejects(client.request({ operation: 'snapshot' }), { code: 'invalid_shared_core_response' });
});

test('oversized input is rejected before sending and does not poison the client', async t => {
  const client = await fixture(t, prelude + `lines.on('line', line => respond(JSON.parse(line), {}));`);
  await assert.rejects(client.request({ operation: 'activate', text: 'x'.repeat(131073) }), { code: 'shared_core_request_too_large' });
  assert.deepEqual(await client.request({ operation: 'snapshot' }), {});
});

test('invalid UTF-8 cannot silently change an approved action in a response', async t => {
  const client = await fixture(t, prelude + `lines.on('line', line => {
    const request = JSON.parse(line);
    const prefix = JSON.stringify({schema_version:'0.1',request_id:request.request_id,ok:true,result:{text:'placeholder'}}).replace('placeholder', '');
    const split = prefix.indexOf('"text":"') + 8;
    process.stdout.write(Buffer.concat([Buffer.from(prefix.slice(0, split)), Buffer.from([0x80]), Buffer.from(prefix.slice(split) + '\\n')]));
  });`);
  await assert.rejects(client.request({ operation: 'snapshot' }), { code: 'invalid_shared_core_response' });
});

test('arbitrary host error text and stderr cannot leak through a tool error', async t => {
  const client = await fixture(t, prelude + `lines.on('line', line => {
    const request = JSON.parse(line);
    process.stderr.write('private diagnostic\\n');
    console.log(JSON.stringify({schema_version:'0.1',request_id:request.request_id,ok:false,error:{code:'a'.repeat(64)}}));
  });`);
  await assert.rejects(client.request({ operation: 'snapshot' }), error => error.code === 'shared_core_rejected' && !error.message.includes('aaaa'));
});
