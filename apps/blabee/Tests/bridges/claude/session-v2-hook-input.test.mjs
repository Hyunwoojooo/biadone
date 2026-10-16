import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { runAutoConnectHook } from '../../../bridges/claude/src/auto-connect-hook.mjs';
import { SESSION_V2_AUTHORITY_KEYS } from '../../../bridges/claude/src/session-v2-client.mjs';
import { readSessionV2HookInput, runSessionV2Hook } from '../../../bridges/claude/src/session-v2-hook.mjs';

const FRAME_BYTES = 1024 * 1024;
const PROMPT_BYTES = 128 * 1024;
const PREFIX = 'BLABEE_CLAUDE_SESSION_V2_';

async function fixture(t, runner) {
  const cwd = await realpath(await mkdtemp('/private/tmp/blabee-hook-input-'));
  t.after(() => rm(cwd, { force: true, recursive: true }));
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
  const env = {
    [PREFIX + 'SOCKET']: join(cwd, 'unused.sock'),
    [PREFIX + 'RUNTIME_IDENTITY']: `sha256:${'1'.repeat(64)}`,
    [PREFIX + 'CWD']: cwd,
    [PREFIX + 'CHANNEL_SOURCE']: 'blabee-claude',
    [PREFIX + 'HOOK_TOKEN']: 'a'.repeat(64),
    ...Object.fromEntries(Object.entries(authority).map(([key, value]) => [PREFIX + key.toUpperCase(), value])),
  };
  const base = { cwd, session_id: authority.native_session_id, prompt_id: randomUUID() };
  const calls = [], admissions = [], closures = [];
  const boundary = randomUUID();
  const createClient = async configuration => {
    admissions.push('hook');
    assert.equal(configuration.role, 'hook');
    assert.deepEqual(configuration.authority, authority);
    return {
      async request(command) {
        calls.push(command);
        return { observed: true, waiter: null, observation_status: command.event === 'ObservationUnavailable' ? 'invalidated' : 'accepted',
          boundary_id: command.event === 'UserPromptSubmit' ? boundary : null };
      },
      async close() { closures.push('hook'); },
    };
  };
  const createBootstrapClient = async configuration => {
    admissions.push('bootstrap');
    assert.equal(configuration.nativeSessionID, authority.native_session_id);
    assert.equal(configuration.cwd, cwd);
    return {
      async start() { assert.fail('no enrollment expected for prompt/Stop fixtures'); },
      async grant() { return { status: 'ready', environment: env }; },
      async close() { closures.push('bootstrap'); },
    };
  };
  const run = async bytes => {
    let stdout = '', stderr = '';
    const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    // Split inside text/escape sequences, as native stdin need not align with JSON fields.
    const chunks = Array.from({ length: Math.ceil(value.length / 8191) }, (_, index) => value.subarray(index * 8191, (index + 1) * 8191));
    const status = await runner({ args: [], env, input: Readable.from(chunks), createClient, createBootstrapClient,
      output: { write: text => { stdout += text; } }, errorOutput: { write: text => { stderr += text; } } });
    return { status, stdout, stderr };
  };
  return { base, calls, admissions, closures, boundary, run };
}

for (const [name, runner] of [['enrolled', runSessionV2Hook], ['auto-connect', runAutoConnectHook]]) {
  test(`${name}: maximum decoded prompts survive JSON overhead and escaping, with only the exact digest sent`, async t => {
    const f = await fixture(t, runner);
    for (const prompt of ['x'.repeat(PROMPT_BYTES), '\0'.repeat(PROMPT_BYTES), '가'.repeat(43690) + 'xy']) {
      assert.equal(Buffer.byteLength(prompt), PROMPT_BYTES);
      const bytes = JSON.stringify({ ...f.base, hook_event_name: 'UserPromptSubmit', prompt });
      assert.ok(Buffer.byteLength(bytes) > PROMPT_BYTES && Buffer.byteLength(bytes) < FRAME_BYTES);
      const result = await f.run(bytes);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.match(result.stdout, new RegExp(`boundary_id=${f.boundary}`));
      assert.deepEqual(f.calls.at(-1), { operation: 'hook', native_session_id: f.base.session_id, cwd: f.base.cwd,
        event: 'UserPromptSubmit', prompt_id: f.base.prompt_id,
        prompt_sha256: createHash('sha256').update(prompt, 'utf8').digest('hex') });
      assert.ok(Buffer.byteLength(JSON.stringify(f.calls.at(-1))) < 1024);
    }
    assert.equal(f.calls.length, 3);
    assert.equal(f.closures.length, f.admissions.length);
  });

  test(`${name}: long assistant text does not drop Stop or invent an empty background registry`, async t => {
    const f = await fixture(t, runner);
    const privateText = 'PRIVATE RESPONSE '.repeat(9000);
    for (const registries of [{}, { background_tasks: [], session_crons: [] }]) {
      const result = await f.run(JSON.stringify({ ...f.base, hook_event_name: 'Stop',
        last_assistant_message: privateText, ...registries }));
      assert.deepEqual(result, { status: 0, stdout: '', stderr: '' });
      assert.deepEqual(f.calls.at(-1), { operation: 'hook', native_session_id: f.base.session_id, cwd: f.base.cwd,
        event: 'Stop', prompt_id: f.base.prompt_id,
        ...(Object.hasOwn(registries, 'background_tasks') ? { background_task_ids: [] } : {}) });
    }
    const result = await f.run(JSON.stringify({ ...f.base, hook_event_name: 'StopFailure', error: 'overloaded',
      last_assistant_message: privateText, error_details: privateText }));
    assert.deepEqual(result, { status: 0, stdout: '', stderr: '' });
    assert.deepEqual(f.calls.at(-1), { operation: 'hook', native_session_id: f.base.session_id, cwd: f.base.cwd,
      event: 'StopFailure', prompt_id: f.base.prompt_id, failure_code: 'api_error' });
    assert.doesNotMatch(JSON.stringify(f.calls), /PRIVATE RESPONSE/);
    assert.equal(f.calls.length, 3);
    assert.equal(f.closures.length, f.admissions.length);
  });

  test(`${name}: oversized decoded prompt still invalidates observation instead of acquiring a boundary`, async t => {
    const f = await fixture(t, runner);
    const result = await f.run(JSON.stringify({ ...f.base, hook_event_name: 'UserPromptSubmit', prompt: 'x'.repeat(PROMPT_BYTES + 1) }));
    assert.deepEqual(result, { status: 0, stdout: '', stderr: '' });
    assert.deepEqual(f.calls, [{ operation: 'hook', native_session_id: f.base.session_id, cwd: f.base.cwd,
      event: 'ObservationUnavailable', reason: 'invalid_prompt_text' }]);
  });

  test(`${name}: full Hook JSON remains bounded at one MiB before any admission`, async t => {
    const f = await fixture(t, runner);
    const hook = { ...f.base, hook_event_name: 'Stop', last_assistant_message: '' };
    hook.last_assistant_message = 'x'.repeat(FRAME_BYTES - Buffer.byteLength(JSON.stringify(hook)));
    const atLimit = JSON.stringify(hook);
    assert.equal(Buffer.byteLength(atLimit), FRAME_BYTES);
    assert.deepEqual(await f.run(atLimit), { status: 0, stdout: '', stderr: '' });
    const count = f.admissions.length;
    hook.last_assistant_message += 'x';
    const result = await f.run(JSON.stringify(hook));
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /hook_input_too_large/);
    assert.equal(f.admissions.length, count);
    assert.equal(f.calls.length, 1);
  });

  test(`${name}: strict parsing still rejects a duplicate identity after a large unused field`, async t => {
    const f = await fixture(t, runner);
    const json = JSON.stringify({ ...f.base, hook_event_name: 'Stop', last_assistant_message: 'PRIVATE RESPONSE '.repeat(9000) });
    const result = await f.run(json.slice(0, -1) + `,"session_id":"${randomUUID()}"}`);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /invalid_hook_json/);
    assert.doesNotMatch(result.stderr, /PRIVATE RESPONSE/);
    assert.equal(f.admissions.length, 0);
    assert.equal(f.calls.length, 0);
  });
}

test('Hook stdin timeout still closes the bounded read without needing EOF', async t => {
  const input = new PassThrough();
  t.after(() => input.destroy());
  const reading = readSessionV2HookInput(input, { timeoutMs: 20 });
  input.write('{"prompt":"');
  await assert.rejects(reading, { code: 'hook_input_timeout' });
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(input.listenerCount('end'), 0);
});

for (const name of ['enrolled', 'auto-connect']) {
  for (const failure of ['arguments', 'oversize', 'parse', 'timeout']) {
    test(`${name}: abort after ${failure} rejection cannot destroy inactive stdin while a diagnostic is pending`, async t => {
      const hookURL = new URL('../../../bridges/claude/src/session-v2-hook.mjs', import.meta.url).href;
      const autoURL = new URL('../../../bridges/claude/src/auto-connect-hook.mjs', import.meta.url).href;
      const source = `import assert from 'node:assert/strict';
        import {getEventListeners} from 'node:events';
        import {PassThrough,Writable} from 'node:stream';
        import {runSessionV2Hook} from ${JSON.stringify(hookURL)};
        import {runAutoConnectHook} from ${JSON.stringify(autoURL)};
        const name=${JSON.stringify(name)},failure=${JSON.stringify(failure)};
        const runner=name==='enrolled'?runSessionV2Hook:runAutoConnectHook;
        const controller=new AbortController(),input=new PassThrough();
        let diagnosticDone,diagnosticWrites=0,admissions=0,stdoutWrites=0;
        const errorOutput=new Writable({write(_chunk,_encoding,done){diagnosticWrites++;diagnosticDone=done}});
        const signals=['SIGINT','SIGTERM'].map(value=>process.listenerCount(value));
        const run=runner({args:failure==='arguments'?['--unknown']:[],env:{},input,
          signal:controller.signal,errorOutput,output:{write(){stdoutWrites++}},
          createClient:async()=>{admissions++},createBootstrapClient:async()=>{admissions++}});
        if(failure==='oversize')input.write(Buffer.alloc(1024*1024+1));
        if(failure==='parse')input.end('{invalid JSON');
        const limit=Date.now()+4000;
        while(!diagnosticDone){assert.ok(Date.now()<limit,'diagnostic did not start');
          await new Promise(resolve=>setTimeout(resolve,5))}
        assert.equal(input.listenerCount('data'),0);assert.equal(input.listenerCount('error'),0);
        // There is deliberately no error observer on input. The old runner
        // destroys this completed/nonexistent read with an error and crashes.
        controller.abort('PRIVATE REASON');
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(input.destroyed,failure==='parse');
        const code=await run;
        assert.equal(code,1);assert.equal(diagnosticWrites,1);assert.equal(admissions,0);assert.equal(stdoutWrites,0);
        assert.equal(getEventListeners(controller.signal,'abort').length,0);
        assert.deepEqual(['SIGINT','SIGTERM'].map(value=>process.listenerCount(value)),signals);
        // The bounded diagnostic may finish after runner cleanup. Its late
        // callback still cannot authorize output, admission or another write.
        diagnosticDone();errorOutput.destroy();input.destroy();
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(errorOutput.listenerCount('error'),0);assert.equal(errorOutput.listenerCount('close'),0);
        console.log(JSON.stringify({name,failure,code,diagnosticWrites,admissions}));`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', value => { stdout += value.toString(); });
      child.stderr.on('data', value => { stderr += value.toString(); });
      const exit = new Promise(resolveExit => child.once('close', (code, signal) => resolveExit({ code, signal })));
      t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
      let timer;
      try {
        const status = await Promise.race([exit, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('inactive Hook stdin fixture did not exit')), 6000);
        })]);
        assert.deepEqual(status, { code: 0, signal: null }, stderr);
      } finally { clearTimeout(timer); }
      assert.equal(stderr, '');
      assert.deepEqual(JSON.parse(stdout), { name, failure, code: 1, diagnosticWrites: 1, admissions: 0 });
    });
  }
}
