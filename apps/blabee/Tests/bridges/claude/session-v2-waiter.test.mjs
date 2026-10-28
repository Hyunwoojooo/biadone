import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';
import { runAutoConnectHook } from '../../../bridges/claude/src/auto-connect-hook.mjs';
import { SESSION_V2_AUTHORITY_KEYS, SessionV2ClientError, validateSessionV2Payload, validateSessionV2Result } from '../../../bridges/claude/src/session-v2-client.mjs';
import { runSessionV2Hook } from '../../../bridges/claude/src/session-v2-hook.mjs';
import { normalizeSessionV2Hook } from '../../../bridges/claude/src/session-v2-lifecycle.mjs';
import { createSessionV2HookWaiter, sessionV2SelectionNotice, writeSessionV2HookOutput } from '../../../bridges/claude/src/session-v2-waiter.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await turn(); }
  assert.fail('fixture did not reach the expected state');
};
function values() {
  const observation = { event: 'Stop', native_session_id: randomUUID(), cwd: '/private/tmp',
    prompt_id: randomUUID(), background_task_ids: [] };
  const waiter = { generation: randomUUID(), prompt_id: observation.prompt_id,
    boundary_id: randomUUID(), expires_at_nanoseconds: '300000000000' };
  const event = { kind: 'selection', selection_id: randomUUID(), delivery_token: 'd'.repeat(64),
    delivery_sequence: '9007199254740993', expires_at_nanoseconds: waiter.expires_at_nanoseconds };
  return { observation, waiter, event };
}
function fixture({ poll, emitSelection, wait, maxWaitMs = 600_000 } = {}) {
  const f = values(); const calls = []; const notices = []; const delays = [];
  const controller = new AbortController(); let elapsed = 0; let active = 0; let maximum = 0;
  const runtime = createSessionV2HookWaiter({ ...f, signal: controller.signal, maxWaitMs,
    now: () => elapsed, wallNow: () => elapsed,
    wait: wait ?? (async milliseconds => { delays.push(milliseconds); elapsed += milliseconds; }),
    emitSelection: emitSelection ?? (async text => { notices.push(text); }),
    client: { async request(command) {
      calls.push(command); active++; maximum = Math.max(maximum, active);
      try {
        if (command.operation === 'hook.cancel') return { cancelled: true };
        return poll ? await poll({ command, controller, event: f.event, advance: value => { elapsed += value; } })
          : { status: 'delivered', event: f.event };
      } finally { active--; }
    } },
  });
  return { ...f, runtime, calls, notices, delays, controller, maximum: () => maximum };
}

test('canonical selection notice matches the shared UTF-8 fixture including its terminal LF', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/product-hook/selection-notice.json', import.meta.url), 'utf8'));
  assert.equal(fixture.schema_version, 'blabee.claude-hook-notice-fixture.v1');
  const actual = sessionV2SelectionNotice(fixture.selection_event);
  assert.deepEqual(Buffer.from(actual, 'utf8'), Buffer.from(fixture.stderr_text, 'utf8'));
  assert.equal(createHash('sha256').update(actual, 'utf8').digest('hex'), fixture.stderr_sha256);
  assert.ok(actual.endsWith('\n') && !actual.endsWith('\n\n'));
  assert.doesNotMatch(actual, /<task-notification>|<system-reminder>|<channel|command "Stop"/);
});

test('observed native wrapper golden hashes as one unchanged real UserPromptSubmit input', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/product-hook/selection-notice.json', import.meta.url), 'utf8'));
  assert.equal(fixture.native_prompt_fixture_kind, 'synthetic_product_notice_in_observed_claude_2.1.282_wrapper');
  const f = values(); const promptID = randomUUID();
  const prompt = fixture.native_prompt_text;
  assert.equal(createHash('sha256').update(prompt, 'utf8').digest('hex'), fixture.native_prompt_sha256);
  assert.ok(prompt.includes(fixture.stderr_text));
  assert.ok(prompt.endsWith('\n\n</system-reminder>') && !prompt.endsWith('\n'));
  assert.deepEqual(normalizeSessionV2Hook({ hook_event_name: 'UserPromptSubmit',
    session_id: f.observation.native_session_id, cwd: f.observation.cwd, prompt_id: promptID, prompt }), {
    event: 'UserPromptSubmit', native_session_id: f.observation.native_session_id, cwd: f.observation.cwd,
    prompt_id: promptID, prompt_sha256: fixture.native_prompt_sha256,
  });
  for (const changed of [`${prompt}\n`, prompt.replace('command "Stop"', 'command "Other"'),
    `extra input\n${prompt}`, prompt.replaceAll('\n', '\r\n')]) {
    const result = normalizeSessionV2Hook({ hook_event_name: 'UserPromptSubmit',
      session_id: f.observation.native_session_id, cwd: f.observation.cwd, prompt_id: promptID, prompt: changed });
    assert.notEqual(result.prompt_sha256, fixture.native_prompt_sha256);
    assert.equal(result.prompt_id, promptID);
  }
});

test('native UserPromptSubmit identity and full prompt digest stay unchanged for notice-like input', () => {
  const f = values();
  const notice = sessionV2SelectionNotice(f.event);
  const promptID = randomUUID();
  const hashes = new Set();
  for (const prompt of [notice, notice.trimEnd(), `untrusted prefix\n${notice}`, `${notice}extra instruction`, notice.replaceAll('\n', '\r\n')]) {
    const normalized = normalizeSessionV2Hook({ hook_event_name: 'UserPromptSubmit',
      session_id: f.observation.native_session_id, cwd: f.observation.cwd, prompt_id: promptID, prompt });
    assert.deepEqual(normalized, { event: 'UserPromptSubmit', native_session_id: f.observation.native_session_id,
      cwd: f.observation.cwd, prompt_id: promptID, prompt_sha256: createHash('sha256').update(prompt, 'utf8').digest('hex') });
    hashes.add(normalized.prompt_sha256);
    assert.equal(JSON.stringify(normalized).includes(f.event.delivery_token), false);
  }
  assert.equal(hashes.size, 5);
});

test('waiter polls serially every 500ms with its original binding and emits one reference', async () => {
  let polls = 0;
  const f = fixture({ poll: ({ event }) => ++polls === 1 ? { status: 'waiting', event: null } : { status: 'delivered', event } });
  const original = structuredClone(f.observation); const generation = f.waiter.generation;
  f.observation.prompt_id = randomUUID(); f.waiter.generation = randomUUID();
  assert.equal(await f.runtime.run(), true);
  await f.runtime.dispose();
  assert.deepEqual(f.delays, [500, 500]);
  assert.deepEqual(f.calls, Array.from({ length: 2 }, () => ({ operation: 'hook.poll', native_session_id: original.native_session_id,
    cwd: original.cwd, prompt_id: original.prompt_id, waiter_generation: generation })));
  assert.equal(f.maximum(), 1); assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], new RegExp(f.event.selection_id));
  assert.match(f.notices[0], new RegExp(f.event.delivery_token));
  assert.doesNotMatch(f.notices[0], /channel|generation|boundary|prompt_id|expires|authority/i);
  await assert.rejects(f.runtime.run(), { code: 'session_v2_client_closed' });
  assert.equal(f.notices.length, 1);
});

test('cancellation drains the active poll before cancelling exactly the same generation and drops its late event', async () => {
  const gate = deferred();
  const f = fixture({ poll: async ({ event }) => { await gate.promise; return { status: 'delivered', event }; } });
  const running = f.runtime.run();
  const rejected = assert.rejects(running, { code: 'session_v2_client_closed' });
  await until(() => f.calls.length === 1);
  f.controller.abort('PRIVATE REASON');
  await turn();
  assert.equal(f.calls.length, 1);
  gate.resolve(); await rejected; await f.runtime.dispose();
  assert.deepEqual(f.calls.map(value => value.operation), ['hook.poll', 'hook.cancel']);
  assert.deepEqual(f.calls[1], { ...f.calls[0], operation: 'hook.cancel' });
  assert.equal(f.maximum(), 1); assert.deepEqual(f.notices, []);
  await f.runtime.cancel(); assert.equal(f.calls.length, 2);
});

test('pre-aborted waiter cancels once without polling or output', async () => {
  const f = fixture(); f.controller.abort();
  await assert.rejects(f.runtime.run(), { code: 'session_v2_client_closed' });
  await f.runtime.dispose();
  assert.deepEqual(f.calls.map(value => value.operation), ['hook.cancel']);
  assert.deepEqual(f.notices, []);
});

test('server closure ends waiting without delivery, claim, completion or a redundant cancel', async () => {
  const f = fixture({ poll: () => ({ status: 'closed', event: null }) });
  assert.equal(await f.runtime.run(), false); await f.runtime.dispose();
  assert.deepEqual(f.calls.map(value => value.operation), ['hook.poll']);
  assert.deepEqual(f.notices, []);
});

test('a local elapsed or sleep-inclusive wall deadline suppresses a late delivered result', async () => {
  const f = fixture({ maxWaitMs: 1000, poll: ({ event, advance }) => {
    advance(600); return { status: 'delivered', event };
  } });
  await assert.rejects(f.runtime.run(), { code: 'session_v2_waiter_expired' }); await f.runtime.dispose();
  assert.deepEqual(f.calls.map(value => value.operation), ['hook.poll', 'hook.cancel']);
  assert.deepEqual(f.notices, []);
});

test('a failed or partially completed output is terminal and never replays the selected reference', async () => {
  let writes = 0;
  const f = fixture({ emitSelection: async () => { writes++; throw new Error('PRIVATE PIPE FAILURE'); } });
  await assert.rejects(f.runtime.run(), /PRIVATE PIPE FAILURE/); await f.runtime.dispose();
  await assert.rejects(f.runtime.run(), { code: 'session_v2_client_closed' });
  assert.equal(writes, 1);
  assert.deepEqual(f.calls.map(value => value.operation), ['hook.poll', 'hook.cancel']);
});

test('invalid delivery shapes and an extended expiry fail closed without a notice', async () => {
  for (const mutate of [event => ({ ...event, kind: 'readiness_probe' }), event => ({ ...event, channel_source: 'legacy' }),
    event => ({ ...event, delivery_sequence: '0' }), event => ({ ...event, expires_at_nanoseconds: '300000000001' })]) {
    const f = fixture({ poll: ({ event }) => ({ status: 'delivered', event: mutate(event) }) });
    await assert.rejects(f.runtime.run(), { code: 'session_v2_invalid_response' }); await f.runtime.dispose();
    assert.deepEqual(f.notices, []);
    assert.deepEqual(f.calls.map(value => value.operation), ['hook.poll', 'hook.cancel']);
  }
});

test('waiter DTOs require closed UUIDs, exact fields, idle Stop and matching prompt/boundary', () => {
  const f = values();
  const payload = { native_session_id: f.observation.native_session_id, cwd: f.observation.cwd,
    prompt_id: f.observation.prompt_id, waiter_generation: f.waiter.generation };
  for (const operation of ['hook.poll', 'hook.cancel']) {
    validateSessionV2Payload(operation, payload);
    for (const change of [{ bridge_id: randomUUID() }, { waiter_generation: 'old' }, { cwd: '/private/tmp/..' },
      { native_session_id: f.observation.native_session_id.toUpperCase() }, { prompt_id: 'not-native' }]) {
      assert.throws(() => validateSessionV2Payload(operation, { ...payload, ...change }), { code: 'session_v2_invalid_response' });
    }
  }
  const result = { observed: true, observation_status: 'accepted', boundary_id: f.waiter.boundary_id, waiter: f.waiter };
  validateSessionV2Result('hook', result, f.observation);
  for (const observation of [{ ...f.observation, event: 'UserPromptSubmit' }, { ...f.observation, prompt_id: randomUUID() },
    { ...f.observation, background_task_ids: ['unknown-task'] }, { ...f.observation, background_task_ids: undefined }]) {
    assert.throws(() => validateSessionV2Result('hook', result, observation), { code: 'session_v2_invalid_response' });
  }
  for (const change of [{ waiter: { ...f.waiter, boundary_id: randomUUID() } }, { waiter: undefined },
    { waiter: { ...f.waiter, generation: 'invalid' } }, { observation_status: 'invalidated' }]) {
    assert.throws(() => validateSessionV2Result('hook', { ...result, ...change }, f.observation), { code: 'session_v2_invalid_response' });
  }
  for (const result of [{ status: 'waiting', event: f.event }, { status: 'delivered', event: null }, { status: 'closed', event: f.event }]) {
    assert.throws(() => validateSessionV2Result('hook.poll', result, payload), { code: 'session_v2_invalid_response' });
  }
});

test('bounded output handles pipe errors, abort and late drain without a second write', async () => {
  for (const mode of ['abort', 'timeout', 'error']) {
    const controller = new AbortController(); let writes = 0; let callback;
    const stream = new Writable({ write(_chunk, _encoding, done) { writes++; callback = done; } });
    const output = writeSessionV2HookOutput(stream, 'one notice', { signal: controller.signal, timeoutMs: mode === 'timeout' ? 10 : 1000 });
    const rejected = assert.rejects(output, { code: 'session_v2_hook_output_unknown' });
    if (mode === 'abort') controller.abort();
    if (mode === 'error') callback(new Error('PRIVATE PIPE ERROR'));
    await rejected;
    if (mode !== 'error') callback();
    await turn();
    assert.equal(writes, 1); stream.destroy();
  }
});

test('late Hook output EPIPE after timeout or abort cannot crash or replay its consumed generation', async t => {
  const waiterURL = new URL('../../../bridges/claude/src/session-v2-waiter.mjs', import.meta.url).href;
  // A real Writable emits errors asynchronously after destroy/write callbacks.
  // Run in a separate process so an unhandled late error fails this regression
  // without interrupting unrelated tests. Do not catch uncaughtException.
  const source = `import assert from 'node:assert/strict';
    import {randomUUID} from 'node:crypto';
    import {getEventListeners} from 'node:events';
    import {Writable} from 'node:stream';
    import {createSessionV2HookWaiter,writeSessionV2HookOutput} from ${JSON.stringify(waiterURL)};
    const turn=()=>new Promise(resolve=>setImmediate(resolve));
    const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await turn()}throw new Error('fixture timed out')};
    const report=[];
    for(const mode of ['timeout','abort'])for(const lateCallback of ['before-error','after-error']){
      const controller=new AbortController();let writes=0,writeDone;
      const output=new Writable({write(_chunk,_encoding,done){writes++;writeDone=done}});
      const observation={event:'Stop',native_session_id:randomUUID(),cwd:'/private/tmp',
        prompt_id:randomUUID(),background_task_ids:[]};
      const waiter={generation:randomUUID(),prompt_id:observation.prompt_id,boundary_id:randomUUID(),
        expires_at_nanoseconds:'300000000000'};
      const event={kind:'selection',selection_id:randomUUID(),delivery_token:'d'.repeat(64),
        delivery_sequence:'1',expires_at_nanoseconds:waiter.expires_at_nanoseconds};
      const calls=[];
      const runtime=createSessionV2HookWaiter({observation,waiter,signal:controller.signal,
        wait:async()=>{},client:{request:async command=>{
          calls.push(command);return command.operation==='hook.cancel'?{cancelled:true}:{status:'delivered',event}
        }},emitSelection:(text,options)=>writeSessionV2HookOutput(output,text,
          {...options,timeoutMs:mode==='timeout'?10:1000})});
      const running=runtime.run();
      const rejected=assert.rejects(running,{code:mode==='abort'?'session_v2_client_closed':'session_v2_hook_output_unknown'});
      await until(()=>writeDone);
      if(mode==='abort')controller.abort('PRIVATE REASON');
      await rejected;await runtime.dispose();
      assert.deepEqual(calls.map(value=>value.operation),['hook.poll','hook.cancel']);
      assert.deepEqual(calls[1],{...calls[0],operation:'hook.cancel'});
      assert.equal(getEventListeners(controller.signal,'abort').length,0);
      if(lateCallback==='before-error'){writeDone();await turn()}
      output.destroy(Object.assign(new Error('PRIVATE LATE PIPE ERROR'),{code:'EPIPE'}));
      await turn();
      if(lateCallback==='after-error'){writeDone();await turn()}
      assert.equal(output.closed,true);
      assert.equal(output.listenerCount('error'),0);assert.equal(output.listenerCount('close'),0);
      assert.equal(writes,1);await runtime.cancel();assert.equal(calls.length,2);
      await assert.rejects(runtime.run(),{code:'session_v2_client_closed'});
      report.push(mode+'/'+lateCallback);
    }
    for(const callback of ['error','success']){
      let writes=0,writeDone;
      const output=new Writable({write(_chunk,_encoding,done){writes++;writeDone=done}});
      const writing=writeSessionV2HookOutput(output,'one notice');
      const rejected=assert.rejects(writing,{code:'session_v2_hook_output_unknown'});
      const pipeError=Object.assign(new Error('PRIVATE CLOSE RACE'),{code:'EPIPE'});
      // closed becomes true before Node emits the pending error/close events.
      output.destroy(pipeError);assert.equal(output.closed,true);
      writeDone(callback==='error'?pipeError:undefined);
      await rejected;await turn();
      assert.equal(writes,1);assert.equal(output.listenerCount('error'),0);assert.equal(output.listenerCount('close'),0);
      report.push('destroy/callback-'+callback);
    }
    for(const closure of ['observed','pending']){
      let writes=0;
      const output=new Writable({write(_chunk,_encoding,done){writes++;done()}});
      output.destroy(closure==='pending'?Object.assign(new Error('PRIVATE PRE-CLOSED PIPE'),{code:'EPIPE'}):undefined);
      if(closure==='observed')await turn();
      assert.equal(output.closed,true);
      await assert.rejects(writeSessionV2HookOutput(output,'no notice'),{code:'session_v2_hook_output_unknown'});
      await turn();
      assert.equal(writes,0);assert.equal(output.listenerCount('error'),0);assert.equal(output.listenerCount('close'),0);
      report.push('closed/'+closure);
    }
    console.log(JSON.stringify(report));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value.toString(); });
  child.stderr.on('data', value => { stderr += value.toString(); });
  const exit = new Promise(resolveExit => child.once('close', (code, signal) => resolveExit({ code, signal })));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let timer;
  try {
    const status = await Promise.race([exit, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('late Hook output fixture did not exit')), 5000);
    })]);
    assert.deepEqual(status, { code: 0, signal: null }, stderr);
  } finally { clearTimeout(timer); }
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), ['timeout/before-error', 'timeout/after-error', 'abort/before-error', 'abort/after-error',
    'destroy/callback-error', 'destroy/callback-success', 'closed/observed', 'closed/pending']);
});

async function runnerFixture(t) {
  const cwd = await realpath(await mkdtemp('/private/tmp/blabee-hook-waiter-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const f = values(); f.observation.cwd = cwd;
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, key === 'native_session_id'
    ? f.observation.native_session_id : randomUUID()]));
  const P = 'BLABEE_CLAUDE_SESSION_V2_';
  const env = { [P + 'SOCKET']: join(cwd, 'unused.sock'), [P + 'CWD']: cwd, [P + 'CHANNEL_SOURCE']: 'blabee-claude',
    [P + 'RUNTIME_IDENTITY']: `sha256:${'1'.repeat(64)}`, [P + 'HOOK_TOKEN']: 'a'.repeat(64),
    ...Object.fromEntries(Object.entries(authority).map(([key, value]) => [P + key.toUpperCase(), value])) };
  return { ...f, env, native: { hook_event_name: 'Stop', session_id: authority.native_session_id, cwd,
    prompt_id: f.observation.prompt_id, background_tasks: [], session_crons: [], stop_hook_active: true } };
}

for (const [name, runner] of [['enrolled', runSessionV2Hook], ['auto-connect', runAutoConnectHook]]) {
  for (const mode of ['delivery', 'abort-on-stop', 'abort-on-poll', 'transport-unknown', 'output-failure', 'SIGINT', 'SIGTERM']) {
    test(`${name} Hook ${mode}: same generation, bounded polling, exit 2 only after one selection notice`, async t => {
      const f = await runnerFixture(t); const controller = new AbortController();
      const calls = []; let stdout = '', stderr = '', closes = 0, clock = 0, clients = 0, selectionWrites = 0;
      const listeners = ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name));
      const code = await runner({ args: [], env: f.env, signal: controller.signal,
        input: Readable.from([JSON.stringify(f.native)]), output: { write: text => { stdout += text; } },
        errorOutput: { write: text => {
          if (text.includes(f.event.selection_id)) {
            selectionWrites++;
            if (mode === 'output-failure') throw new Error('PRIVATE PIPE ERROR');
          }
          stderr += text;
        } },
        waiterOptions: { now: () => clock, wallNow: () => clock, wait: async ms => { assert.equal(ms, 500); clock += ms; } },
        createBootstrapClient: async () => ({ grant: async () => ({ status: 'ready', environment: f.env }), close: async () => {} }),
        createClient: async () => { const instance = ++clients; return { async request(command) {
          calls.push(command);
          if (command.operation === 'hook') {
            if (mode === 'abort-on-stop') controller.abort();
            return { observed: true, observation_status: 'accepted', boundary_id: f.waiter.boundary_id, waiter: f.waiter };
          }
          if (command.operation === 'hook.cancel') { assert.equal(instance, 2); return { cancelled: true }; }
          assert.equal(command.operation, 'hook.poll');
          if (mode === 'abort-on-poll') controller.abort();
          if (mode === 'transport-unknown') throw new SessionV2ClientError('session_v2_response_unknown');
          if (['SIGINT', 'SIGTERM'].includes(mode)) process.emit(mode);
          return { status: 'delivered', event: f.event };
        }, close: async () => { closes++; } }; },
      });
      assert.equal(stdout, ''); assert.equal(closes, mode === 'delivery' ? 1 : 2);
      assert.deepEqual(['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name)), listeners);
      if (mode === 'delivery') {
        assert.equal(code, 2); assert.equal(stderr.split(f.event.selection_id).length - 1, 1);
        assert.equal(stderr.split(f.event.delivery_token).length - 1, 1);
        assert.deepEqual(calls.map(value => value.operation), ['hook', 'hook.poll']);
      } else {
        assert.equal(code, mode === 'output-failure' ? 1 : 0); assert.equal(stderr.includes(f.event.selection_id), false);
        assert.equal(stderr.includes(f.event.delivery_token), false);
        assert.deepEqual(calls.at(-1), { operation: 'hook.cancel', native_session_id: f.observation.native_session_id,
          cwd: f.observation.cwd, prompt_id: f.observation.prompt_id, waiter_generation: f.waiter.generation });
        assert.equal(calls.filter(value => value.operation === 'hook.cancel').length, 1);
      }
      assert.equal(selectionWrites, ['delivery', 'output-failure'].includes(mode) ? 1 : 0);
      assert.doesNotMatch(stderr, /a{64}|generation|<channel|UserPromptSubmit/);
    });
  }
  test(`${name} Hook aborts an unfinished stdin read and removes its signal handlers`, async () => {
    const input = new PassThrough(); const controller = new AbortController(); let calls = 0;
    const run = runner({ args: [], input, signal: controller.signal, env: {}, output: { write() {} }, errorOutput: { write() {} },
      createClient: () => { calls++; }, createBootstrapClient: () => { calls++; } });
    controller.abort();
    assert.equal(await run, 0); assert.equal(calls, 0);
  });
  test(`${name} Hook cancellation during client cleanup still retires a delivered generation without reprinting`, async t => {
    const f = await runnerFixture(t); const controller = new AbortController(); const calls = [];
    let stderr = '', clients = 0, clock = 0;
    const code = await runner({ args: [], env: f.env, signal: controller.signal,
      input: Readable.from([JSON.stringify(f.native)]), output: { write() { assert.fail('no stdout'); } },
      errorOutput: { write: text => { stderr += text; } },
      waiterOptions: { now: () => clock, wallNow: () => clock, wait: async ms => { clock += ms; } },
      createBootstrapClient: async () => ({ grant: async () => ({ status: 'ready', environment: f.env }), close: async () => {} }),
      createClient: async () => {
        const instance = ++clients;
        return { async request(command) {
          calls.push(command);
          if (command.operation === 'hook') return { observed: true, observation_status: 'accepted',
            boundary_id: f.waiter.boundary_id, waiter: f.waiter };
          if (command.operation === 'hook.poll') return { status: 'delivered', event: f.event };
          assert.equal(instance, 2); assert.equal(command.operation, 'hook.cancel'); return { cancelled: true };
        }, async close() { if (instance === 1) controller.abort(); } };
      },
    });
    assert.equal(code, 0);
    assert.equal(stderr.split(f.event.selection_id).length - 1, 1);
    assert.deepEqual(calls.map(value => value.operation), ['hook', 'hook.poll', 'hook.cancel']);
    assert.equal(calls[2].waiter_generation, f.waiter.generation);
  });
}
