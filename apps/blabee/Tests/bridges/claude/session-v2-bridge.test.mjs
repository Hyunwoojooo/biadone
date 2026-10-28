import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { SESSION_V2_AUTHORITY_KEYS } from '../../../bridges/claude/src/session-v2-client.mjs';
import { sessionV2Context } from '../../../bridges/claude/src/session-v2-context.mjs';
import { handleSessionV2Hook, readSessionV2HookInput, runSessionV2Hook } from '../../../bridges/claude/src/session-v2-hook.mjs';
import { createSessionV2BridgeSession, createSessionV2RequestQueue, runSessionV2MCP } from '../../../bridges/claude/src/session-v2-mcp.mjs';
import { createSessionV2ToolHandler } from '../../../bridges/claude/src/session-v2-tools.mjs';
import { sessionV2SelectionNotice } from '../../../bridges/claude/src/session-v2-waiter.mjs';

const P = 'BLABEE_CLAUDE_SESSION_V2_';
const until = async predicate => {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
async function environment(t) {
  const cwd = await realpath(await mkdtemp('/private/tmp/blabee-v2b-'));
  t.after(() => rm(cwd, { force: true, recursive: true }));
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
  const env = { [P + 'SOCKET']: join(cwd, 'test.sock'), [P + 'RUNTIME_IDENTITY']: `sha256:${'1'.repeat(64)}`,
    [P + 'CWD']: cwd, [P + 'CHANNEL_SOURCE']: 'blabee-claude', [P + 'HOOK_TOKEN']: 'a'.repeat(64),
    [P + 'BRIDGE_TOKEN']: 'b'.repeat(64), ...Object.fromEntries(Object.entries(authority).map(([key, value]) => [P + key.toUpperCase(), value])) };
  const mcpEnv = { ...env, [P + 'HOOK_TOKEN']: '' };
  return { cwd, authority, env, mcpEnv };
}
const proposal = () => ({ proposal_id: randomUUID(), task_goal: 'actual task', outcome: { status: 'completed', summary: 'actual summary' },
  reported_side_effects: [], options: ['A', 'B'].map(id => ({ id, title: `option ${id}`, description: `description ${id}`,
    task: `task ${id}`, done_when: `done ${id}`, constraints: ['selected task only'] })) });
const valueOf = response => JSON.parse(response.content[0].text);
function pollResponse(request, event = null) {
  const { payload: _, ...common } = request;
  return { ...common, kind: 'response', ok: true, result: { event } };
}
const event = (kind = 'readiness_probe', source = 'blabee-claude') => ({ kind, channel_source: source,
  delivery_sequence: '9007199254740993', expires_at_nanoseconds: '18446744073709551615', ...(kind === 'readiness_probe'
    ? { probe_id: randomUUID(), nonce: 'c'.repeat(64) } : { selection_id: randomUUID(), delivery_token: 'd'.repeat(64) }) });

test('v2 role context requires all six enrolled identities and never inherits owner or selector authority', async t => {
  const f = await environment(t);
  assert.deepEqual((await sessionV2Context('hook', { env: f.env })).configuration.authority, f.authority);
  assert.equal((await sessionV2Context('bridge', { env: f.mcpEnv })).configuration.authToken, 'b'.repeat(64));
  await assert.rejects(sessionV2Context('bridge', { env: f.env }), { code: 'session_v2_unexpected_credential' });
  for (const key of ['OWNER_TOKEN', 'SELECTOR_TOKEN', 'CONTROL_TOKEN']) {
    await assert.rejects(sessionV2Context('hook', { env: { ...f.env, [P + key]: 'e'.repeat(64) } }), { code: 'session_v2_unexpected_credential' });
  }
  for (const key of SESSION_V2_AUTHORITY_KEYS) {
    await assert.rejects(sessionV2Context('hook', { env: { ...f.env, [P + key.toUpperCase()]: '' } }), { code: 'session_v2_invalid_authority' });
  }
  await assert.rejects(sessionV2Context('hook', { env: f.env, expectedSessionID: randomUUID() }), { code: 'session_v2_session_mismatch' });
  await assert.rejects(sessionV2Context('hook', { env: { ...f.env, [P + 'HOOK_TOKEN']: '', BLABEE_CLAUDE_SHARED_HOOK_TOKEN: 'a'.repeat(64) } }),
    { code: 'session_v2_missing_credential' });
  const alias = join(f.cwd, 'alias');
  await symlink(f.cwd, alias);
  await assert.rejects(sessionV2Context('hook', { env: { ...f.env, [P + 'CWD']: alias } }), { code: 'session_v2_invalid_cwd' });
});

test('v2 Hook sends real mismatched identity for revocation, retains raw digest, compact prompt absence and background unknown', async t => {
  const f = await environment(t);
  const calls = [];
  let closed = 0;
  const boundary = randomUUID();
  const createClient = async configuration => {
    assert.deepEqual(configuration.authority, f.authority);
    assert.equal(configuration.role, 'hook');
    return { request: async command => { calls.push(command); return { observed: true, waiter: null, boundary_id:
      command.event === 'UserPromptSubmit' ? boundary : null, observation_status: 'accepted' }; }, close: async () => { closed++; } };
  };
  const base = { cwd: f.cwd, session_id: f.authority.native_session_id };
  const promptID = randomUUID();
  const delivered = event();
  const prompt = `<channel source="blabee-claude" kind="readiness_probe" probe_id="${delivered.probe_id}">\n${JSON.stringify(delivered)}\n</channel>`;
  const result = await handleSessionV2Hook({ ...base, hook_event_name: 'UserPromptSubmit', prompt_id: promptID, prompt }, { env: f.env, createClient });
  assert.match(result.hookSpecificOutput.additionalContext, new RegExp(`boundary_id=${boundary}`));
  assert.equal(calls[0].prompt_sha256, createHash('sha256').update(prompt).digest('hex'));
  assert.equal(JSON.stringify(calls).includes(delivered.nonce), false);
  const changed = { cwd: '/private/tmp/other-project', session_id: randomUUID() };
  await handleSessionV2Hook({ ...changed, hook_event_name: 'SessionStart', source: 'startup' }, { env: f.env, createClient });
  assert.equal(calls[1].native_session_id, changed.session_id);
  assert.equal(calls[1].cwd, changed.cwd);
  await handleSessionV2Hook({ ...base, hook_event_name: 'SessionStart', source: 'compact' }, { env: f.env, createClient });
  assert.equal(Object.hasOwn(calls[2], 'prompt_id'), false);
  assert.equal(await handleSessionV2Hook({ ...base, hook_event_name: 'Stop', prompt_id: promptID }, { env: f.env, createClient }), null);
  assert.equal(Object.hasOwn(calls[3], 'background_task_ids'), false);
  await handleSessionV2Hook({ ...base, hook_event_name: 'Stop', prompt_id: promptID, background_tasks: [], session_crons: [] }, { env: f.env, createClient });
  assert.deepEqual(calls[4].background_task_ids, []);
  await handleSessionV2Hook({ ...base, hook_event_name: 'StopFailure', error: 'overloaded', error_details: 'PRIVATE ERROR' }, { env: f.env, createClient });
  assert.equal(calls[5].failure_code, 'api_error');
  assert.equal(JSON.stringify(calls).includes('PRIVATE ERROR'), false);
  await handleSessionV2Hook({ ...base, hook_event_name: 'SessionStart', source: 'resume' }, { env: f.env, createClient });
  assert.equal(calls[6].event, 'ObservationUnavailable');
  assert.equal(calls[6].reason, 'unsupported_source');
  await assert.rejects(handleSessionV2Hook({ ...base, hook_event_name: 'Stop', agent_id: 'subagent' }, { env: f.env, createClient }),
    { code: 'session_v2_hook_subagent' });
  assert.equal(closed, 7);
});

test('Hook input is bounded strict JSON and errors disclose no credential, prompt or failure text', async t => {
  for (const bytes of [Buffer.from('{"session_id":"one","session_id":"two"}'), Buffer.from([0x80])]) {
    await assert.rejects(readSessionV2HookInput(Readable.from([bytes])), { code: 'invalid_hook_json' });
  }
  await assert.rejects(readSessionV2HookInput(Readable.from(['x'.repeat(20)]), { maxBytes: 10 }), { code: 'hook_input_too_large' });
  const f = await environment(t);
  let stdout = ''; let stderr = '';
  const status = await runSessionV2Hook({ args: [], env: f.env, input: Readable.from([JSON.stringify({ session_id: f.authority.native_session_id,
    cwd: f.cwd, hook_event_name: 'SessionStart', source: 'startup' })]), output: { write: text => { stdout += text; } },
  errorOutput: { write: text => { stderr += text; } }, createClient: async () => { throw Object.assign(new Error('PRIVATE ERROR'), { code: 'a'.repeat(64) }); } });
  assert.equal(status, 1); assert.equal(stdout, ''); assert.doesNotMatch(stderr, /PRIVATE ERROR|a{64}/);
});

test('UserPromptSubmit context publishes only the server-validated boundary and preserves the real new prompt identity', async t => {
  const f = await environment(t); const boundary = randomUUID(); const newPrompt = randomUUID();
  const { channel_source, ...selection } = event('selection');
  const prompt = `arbitrary native input\n${sessionV2SelectionNotice(selection)}`;
  for (const accepted of [true, false]) {
    const commands = [];
    const result = await handleSessionV2Hook({ session_id: f.authority.native_session_id, cwd: f.cwd,
      hook_event_name: 'UserPromptSubmit', prompt_id: newPrompt, prompt }, {
      env: f.env, createClient: async () => ({ request: async command => {
        commands.push(command);
        return { observed: true, waiter: null, boundary_id: accepted ? boundary : null,
          observation_status: accepted ? 'accepted' : 'invalidated' };
      }, close: async () => {} }),
    });
    assert.deepEqual(commands, [{ operation: 'hook', native_session_id: f.authority.native_session_id,
      cwd: f.cwd, event: 'UserPromptSubmit', prompt_id: newPrompt,
      prompt_sha256: createHash('sha256').update(prompt, 'utf8').digest('hex') }]);
    const context = result.hookSpecificOutput.additionalContext;
    assert.equal(context.includes(`boundary_id=${boundary}`), accepted);
    assert.equal(context.includes(selection.delivery_token), false);
    assert.equal(context.includes(selection.selection_id), false);
  }
});

test('tools preserve v1 model names while wrapping/unwrapping v2 DTOs and retain original selection binding', async () => {
  const bridgeID = randomUUID();
  const calls = [];
  const action = proposal().options[0];
  const handler = createSessionV2ToolHandler({ getBridgeID: () => bridgeID, channelSource: 'blabee-claude', request: async command => {
    calls.push(command);
    if (command.operation === 'readiness.begin') return { probe_id: randomUUID(), nonce: 'c'.repeat(64), expires_at_nanoseconds: '18446744073709551615', status: 'pending' };
    if (command.operation === 'readiness.ack') return { acknowledged: true };
    if (command.operation === 'proposal.emit') return { packet_id: 'actual_packet', revision: 1 };
    if (command.operation === 'selection.claim') return { selection_id: command.selection_id, boundary_id: randomUUID(), prompt_id: randomUUID(),
      action: { schema_version: 'blabee.claude-action.v1', value: action } };
    return { selection_id: command.selection_id, recorded: true, reported_by: 'claude' };
  } });
  const check = valueOf(await handler('check_connection_v1', {}));
  assert.equal(check.result.status, 'pending');
  assert.equal(check.result.expires_at_nanoseconds, '18446744073709551615');
  assert.equal(check.result.nonce, 'c'.repeat(64));
  assert.equal(valueOf(await handler('ack_readiness_probe_v1', { probe_id: randomUUID(), nonce: 'd'.repeat(64) })).result.acknowledged, true);
  const actual = proposal();
  await handler('emit_decision_v1', { boundary_id: randomUUID(), proposal: actual });
  assert.deepEqual(calls[2].proposal, { schema_version: 'blabee.claude-proposal.v1', value: actual });
  const selectionID = randomUUID();
  const claim = valueOf(await handler('claim_selection_v1', { selection_id: selectionID, delivery_token: 'd'.repeat(64) }));
  assert.deepEqual(claim.result.action, action);
  assert.equal(claim.result.selection_id, selectionID);
  const complete = valueOf(await handler('complete_selection_v1', { selection_id: selectionID, outcome: 'completed', note: 'actual evidence' }));
  assert.equal(complete.result.selection_id, selectionID);
  const bad = createSessionV2ToolHandler({ getBridgeID: () => bridgeID, request: async () => ({ selection_id: randomUUID(), recorded: true, reported_by: 'claude' }) });
  assert.equal((await bad('complete_selection_v1', { selection_id: selectionID, outcome: 'completed', note: 'actual evidence' })).isError, true);
  assert.equal(calls.length, 5);
});

test('Hook notice contains only a selection reference and no authority, waiter, expiry or Channel wrapper', () => {
  const { channel_source, ...selection } = event('selection');
  const text = sessionV2SelectionNotice(selection);
  assert.match(text, /Blabee Stop Hook selection reference/);
  assert.deepEqual(JSON.parse(text.trim().split('\n')[1]), {
    selection_id: selection.selection_id, delivery_token: selection.delivery_token,
  });
  assert.doesNotMatch(text, /18446744073709551615|9007199254740993|authority|channel|generation|boundary|prompt_id/i);
  for (const bad of [event(), { ...selection, channel_source }, { ...selection, content: 'PRIVATE BODY' }]) {
    assert.throws(() => sessionV2SelectionNotice(bad), { code: 'session_v2_invalid_response' });
  }
});

test('32 ordinary requests plus one poll stay bounded and never overlap', async () => {
  const calls = []; const resolvers = [];
  const queue = createSessionV2RequestQueue({ request: value => new Promise(resolve => { calls.push(value.operation); resolvers.push(resolve); }),
    exchange: value => new Promise(resolve => { calls.push(value.operation); resolvers.push(resolve); }) });
  const pending = [queue.exchange({ operation: 'bridge.poll' }), queue.request({ operation: 'proposal.emit' })];
  for (let index = 2; index < 33; index++) pending.push(queue.request({ operation: 'readiness.begin' }));
  const settled = Promise.allSettled(pending);
  assert.equal(queue.snapshot().pending, 33);
  await assert.rejects(queue.request({ operation: 'selection.claim' }), { code: 'session_v2_queue_full' });
  await assert.rejects(queue.exchange({ operation: 'bridge.poll' }), { code: 'session_v2_queue_full' });
  await until(() => calls.length === 1);
  assert.deepEqual(calls, ['bridge.poll']);
  resolvers[0]({});
  await until(() => calls.length === 2);
  assert.deepEqual(calls, ['bridge.poll', 'proposal.emit']);
  queue.stop(); resolvers[1]({});
  await settled; await queue.drain();
  assert.equal(queue.snapshot().pending, 0);
  assert.equal(calls.length, 2);
});

test('an unexpected heartbeat event is terminal and never emitted or reopened', async t => {
  const f = await environment(t);
  const bridgeID = randomUUID(); const calls = []; const errors = []; let closed = 0; let notifications = 0;
  const session = createSessionV2BridgeSession({ authority: f.authority, channelSource: 'blabee-claude', pollIntervalMs: 20,
    client: { request: async value => { calls.push(value.operation); return { bridge_id: bridgeID }; },
      exchange: async request => { calls.push(request.operation); return pollResponse(request, event()); }, close: async () => { closed++; } },
    notify: async () => { notifications++; throw new Error('PRIVATE NOTIFICATION'); }, onError: code => errors.push(code) });
  await session.start();
  await until(() => session.snapshot().closed);
  assert.equal((await session.handler('check_connection_v1', {})).isError, true);
  await assert.rejects(session.start(), { code: 'session_v2_bridge_reopen_forbidden' });
  await session.close();
  assert.equal(notifications, 0); assert.equal(closed, 1);
  assert.deepEqual(calls, ['bridge.open', 'bridge.poll']);
  assert.deepEqual(errors, ['session_v2_channel_invalid_response']);
});

test('shutdown drains a pending heartbeat and discards its late event', async t => {
  const f = await environment(t);
  const bridgeID = randomUUID(); const calls = []; const errors = []; const retired = [];
  let resolvePoll; let clientClosed = 0;
  const session = createSessionV2BridgeSession({ authority: f.authority, channelSource: 'blabee-claude',
    client: { request: async value => { calls.push(value.operation); return { bridge_id: bridgeID }; },
      exchange: request => { calls.push(request.operation); return new Promise(resolve => { resolvePoll = () => resolve(pollResponse(request, event())); }); },
      close: async () => { clientClosed++; } },
    onError: code => errors.push(code), closeRegistration: async id => { retired.push(id); } });
  await session.start();
  await until(() => resolvePoll);
  const closing = session.close();
  resolvePoll();
  await closing;
  assert.equal(clientClosed, 1); assert.deepEqual(retired, [bridgeID]);
  assert.equal((await session.handler('check_connection_v1', {})).isError, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, ['bridge.open', 'bridge.poll']);
});

test('dedicated MCP subprocess exits on stdin EOF with its actual stdout pipe backpressured', async t => {
  const f = await environment(t);
  const moduleURL = new URL('../../../bridges/claude/src/session-v2-mcp.mjs', import.meta.url).href;
  const source = `import {runSessionV2MCP} from ${JSON.stringify(moduleURL)};
    import {randomUUID} from 'node:crypto';
    const bridgeID=randomUUID(); let filled=false;
    const runtime=await runSessionV2MCP({args:[],createClient:async()=>({
      request:async value=>{if(value.operation==='bridge.close'){process.send({retired:true});return {closed:true}};return {bridge_id:bridgeID}},
      exchange:async request=>{if(!filled){filled=true;process.stdout.write('x'.repeat(1024*1024));process.send({blocked:process.stdout.writableLength>0})}
        const {payload,...common}=request;return {...common,kind:'response',ok:true,result:{event:null}}},
      close:async()=>{}
    })});
    while(!runtime.server.getClientVersion()) await new Promise(resolve=>setTimeout(resolve,5));
    process.send({initialized:true});
    process.channel.unref();
    process.exit(await runtime.closed);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BLABEE_'))), ...f.mcpEnv },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  let blocked = false; let retired = false; let initialized = false; let stderr = '';
  child.on('message', value => { if (value.blocked) blocked = true; if (value.retired) retired = true; if (value.initialized) initialized = true; });
  child.stderr.on('data', value => { stderr += value.toString(); });
  const exit = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'backpressure-fixture', version: '1' },
  } }) + '\n');
  await until(() => initialized);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  // Deliberately never consume child.stdout. This exercises an actual full OS
  // pipe, not merely a notification stub with an unresolved Promise.
  await until(() => blocked);
  child.stdin.end();
  let timer;
  try {
    const status = await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('MCP stdout prevented exit')), 2000); })]);
    assert.deepEqual(status, { code: 0, signal: null });
  } finally { clearTimeout(timer); }
  assert.equal(retired, true);
  assert.equal(stderr, '');
});

test('SDK output errors during and after cleanup retire one bridge without replay or leaked listeners', async t => {
  const moduleURL = new URL('../../../bridges/claude/src/session-v2-mcp.mjs', import.meta.url).href;
  // A separate Node process must survive genuine Writable callback failures.
  // Do not catch uncaughtException: the old cleanup crashes before retirement.
  const source = `import assert from 'node:assert/strict';
    import {randomUUID} from 'node:crypto';
    import {PassThrough,Writable} from 'node:stream';
    import {runSessionV2MCP} from ${JSON.stringify(moduleURL)};
    const turn=()=>new Promise(resolve=>setImmediate(resolve));
    const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await turn()}throw new Error('fixture timed out')};
    const report=[];
    for(const mode of ['during-drain','after-cleanup','output-first']){
      const input=new PassThrough(); let writeDone,destroyDone,releasePoll,clientCloses=0;
      const output=new Writable({autoDestroy:false,
        write(_chunk,_encoding,done){writeDone=done},destroy(_error,done){destroyDone=done}});
      const pollGate=new Promise(resolve=>{releasePoll=resolve});
      const operations=[],diagnostics=[];
      const before=['SIGINT','SIGTERM'].map(name=>process.listenerCount(name));
      const bridgeID=randomUUID();
      const authority=Object.fromEntries(['scope_id','native_session_id','session_incarnation',
        'service_incarnation','owner_connection_id','authority_epoch'].map(key=>[key,randomUUID()]));
      const runtime=await runSessionV2MCP({args:[],env:{},input,output,errorOutput:{write:text=>diagnostics.push(text)},
        resolveContext:async()=>({configuration:{authority},channelSource:'blabee-claude'}),
        createClient:async()=>({request:async command=>{
          operations.push(command.operation);
          if(command.operation==='bridge.open')return {bridge_id:bridgeID};
          assert.equal(command.operation,'bridge.close');return {closed:true}
        },exchange:async request=>{
          operations.push(request.operation);await pollGate;
          const {payload,...common}=request;return {...common,kind:'response',ok:true,result:{event:null}}
        },close:async()=>{clientCloses++}})
      });
      input.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',
        capabilities:{},clientInfo:{name:'output-error-fixture',version:'1'}}})+'\\n');
      await until(()=>writeDone);
      input.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\\n');
      await until(()=>operations.includes('bridge.poll'));
      const pipeError=()=>Object.assign(new Error('PRIVATE PIPE ERROR'),{code:'EPIPE'});
      if(mode==='output-first')writeDone(pipeError());else input.end();
      await until(()=>runtime.session.snapshot().closed);
      if(mode==='during-drain')writeDone(pipeError());
      await turn();
      assert.deepEqual(operations,['bridge.open','bridge.poll']);
      // Repeated errors during the drain must not restart cleanup or diagnose
      // private error text. The first EPIPE above came from the write callback.
      output.emit('error',pipeError());
      releasePoll();
      assert.equal(await runtime.closed,0);
      assert.equal(await runtime.close(),0);
      assert.deepEqual(operations,['bridge.open','bridge.poll','bridge.close']);
      assert.equal(clientCloses,2);
      assert.equal(typeof destroyDone,'function');
      // Destruction can finish asynchronously after runtime.closed resolves.
      destroyDone(mode==='after-cleanup'?pipeError():undefined);
      await until(()=>output.closed && output.listenerCount('error')===0);
      assert.equal(output.listenerCount('close'),0);
      assert.equal(input.listenerCount('error'),0);
      assert.deepEqual(['SIGINT','SIGTERM'].map(name=>process.listenerCount(name)),before);
      assert.equal(diagnostics.length,mode==='output-first'?1:0);
      assert.doesNotMatch(diagnostics.join(''),/PRIVATE PIPE ERROR/);
      input.destroy();report.push(mode);
    }
    console.log(JSON.stringify(report));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value.toString(); });
  child.stderr.on('data', value => { stderr += value.toString(); });
  const exit = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let timer;
  try {
    const status = await Promise.race([exit, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('MCP output-error fixture did not exit')), 5000);
    })]);
    assert.deepEqual(status, { code: 0, signal: null }, stderr);
  } finally { clearTimeout(timer); }
  assert.deepEqual(JSON.parse(stdout), ['during-drain', 'after-cleanup', 'output-first']);
  assert.equal(stderr, '');
});

test('tools after initialization await the same open and pending startup calls are bounded', async t => {
  const f = await environment(t);
  const bridgeID = randomUUID(); const calls = [];
  let resolveOpen;
  const session = createSessionV2BridgeSession({ authority: f.authority, channelSource: 'blabee-claude',
    client: { request: async value => {
      calls.push(value.operation);
      if (value.operation === 'bridge.open') return new Promise(resolve => { resolveOpen = resolve; });
      return { probe_id: randomUUID(), nonce: 'c'.repeat(64), expires_at_nanoseconds: '9007199254740993', status: 'pending' };
    }, exchange: async request => pollResponse(request), close: async () => {} }, notify: async () => {} });
  const started = session.start();
  const results = Array.from({ length: 32 }, () => session.handler('check_connection_v1', {}));
  const overflow = valueOf(await session.handler('check_connection_v1', {}));
  assert.equal(overflow.error.code, 'session_v2_queue_full');
  assert.equal(session.snapshot().pendingTools, 32);
  await until(() => resolveOpen);
  assert.deepEqual(calls, ['bridge.open']);
  resolveOpen({ bridge_id: bridgeID });
  await started;
  const completed = await Promise.all(results);
  assert.ok(completed.some(value => valueOf(value).ok));
  assert.ok(completed.every(value => !valueOf(value).error || valueOf(value).error.code === 'session_v2_queue_full'));
  assert.equal(calls.filter(value => value === 'bridge.open').length, 1);
  await session.close();
  assert.equal(session.snapshot().pendingTools, 0);
});

test('shutdown during open waits for that response and closes only the admitted late registration', async t => {
  const f = await environment(t);
  const bridgeID = randomUUID(); const calls = []; const retired = [];
  let resolveOpen; let closed = false;
  const session = createSessionV2BridgeSession({ authority: f.authority, channelSource: 'blabee-claude',
    client: { request: value => { calls.push(value.operation); return new Promise(resolve => { resolveOpen = resolve; }); },
      exchange: async () => { throw new Error('must not poll'); }, close: async () => {} }, notify: async () => {},
    closeRegistration: async id => { retired.push(id); } });
  const started = session.start();
  await until(() => resolveOpen);
  const closing = session.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  resolveOpen({ bridge_id: bridgeID });
  await started; await closing;
  assert.deepEqual(calls, ['bridge.open']); assert.deepEqual(retired, [bridgeID]);
  assert.equal(session.snapshot().registered, false);
});

test('SDK initialize gates one bridge open, advertises v1 tools, serializes calls and explicitly closes registration', async t => {
  const f = await environment(t);
  const input = new PassThrough(); const output = new PassThrough();
  const messages = []; const calls = []; let buffer = ''; let stderr = '';
  let current = 0; let max = 0; let pendingEvent;
  const bridgeID = randomUUID();
  output.on('data', data => { buffer += data.toString(); let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) { messages.push(JSON.parse(buffer.slice(0, newline))); buffer = buffer.slice(newline + 1); } });
  const before = process.listenerCount('SIGTERM');
  const bridge = await runSessionV2MCP({ env: f.mcpEnv, args: [], input, output, pollIntervalMs: 20,
    errorOutput: { write: text => { stderr += text; } }, createClient: async configuration => {
      assert.equal(configuration.authToken, 'b'.repeat(64));
      const perform = async (value, envelope) => {
        current++; max = Math.max(max, current); calls.push(value.operation);
        await new Promise(resolve => setImmediate(resolve));
        try {
          if (value.operation === 'bridge.open') return { bridge_id: bridgeID };
          if (value.operation === 'bridge.close') return { closed: true };
          if (value.operation === 'bridge.poll') return pollResponse(envelope);
          if (value.operation === 'readiness.begin') { pendingEvent = event(); return { probe_id: pendingEvent.probe_id,
            nonce: pendingEvent.nonce, expires_at_nanoseconds: pendingEvent.expires_at_nanoseconds, status: 'pending' }; }
          if (value.operation === 'readiness.ack') return { acknowledged: true };
          throw new Error('unexpected operation');
        } finally { current--; }
      };
      return { request: value => perform(value), exchange: envelope => perform({ operation: envelope.operation, ...envelope.payload }, envelope), close: async () => {} };
    } });
  t.after(async () => { await bridge.close(); input.destroy(); output.destroy(); });
  const send = message => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const reply = async id => { await until(() => messages.some(value => value.id === id)); return messages.find(value => value.id === id); };
  send({ method: 'notifications/initialized' });
  send({ id: 9, method: 'tools/call', params: { name: 'check_connection_v1' } });
  assert.match((await reply(9)).result.content[0].text, /session_v2_bridge_not_registered/);
  assert.equal(calls.length, 0);
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } });
  assert.equal((await reply(1)).result.capabilities.experimental, undefined);
  send({ method: 'notifications/initialized' }); send({ method: 'notifications/initialized' });
  await until(() => bridge.session.snapshot().registered);
  send({ id: 2, method: 'tools/list', params: {} });
  assert.deepEqual((await reply(2)).result.tools.map(tool => tool.name),
    ['check_connection_v1', 'ack_readiness_probe_v1', 'emit_decision_v1', 'claim_selection_v1', 'complete_selection_v1']);
  send({ id: 3, method: 'tools/call', params: { name: 'check_connection_v1' } });
  const probe = valueOf((await reply(3)).result).result;
  assert.equal(probe.status, 'pending');
  assert.equal(probe.nonce, pendingEvent.nonce);
  assert.equal(messages.some(value => value.method === 'notifications/claude/channel'), false);
  assert.equal(calls.filter(value => value === 'bridge.open').length, 1);
  assert.equal(calls.includes('readiness.ack'), false);
  assert.equal(calls.includes('selection.claim'), false);
  send({ id: 4, method: 'tools/call', params: { name: 'ack_readiness_probe_v1', arguments: { probe_id: probe.probe_id, nonce: probe.nonce } } });
  assert.equal(valueOf((await reply(4)).result).result.acknowledged, true);
  assert.equal(calls.filter(value => value === 'readiness.ack').length, 1);
  assert.equal(max, 1);
  assert.doesNotMatch(stderr + JSON.stringify(messages), /a{64}|b{64}/);
  await bridge.close();
  assert.equal(calls.filter(value => value === 'bridge.close').length, 1);
  assert.equal(process.listenerCount('SIGTERM'), before);
});
