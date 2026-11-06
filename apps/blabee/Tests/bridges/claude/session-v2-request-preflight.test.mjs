import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

// Built-in I/O interception runs in a child, never in the shared test process.
// The production client and Hook run unchanged; no real service is contacted.
async function probe(configuration) {
  const assert = (await import('node:assert/strict')).default;
  const fs = (await import('node:fs')).default;
  const net = (await import('node:net')).default;
  const { EventEmitter, getEventListeners } = await import('node:events');
  const { syncBuiltinESMExports } = await import('node:module');
  const { randomUUID } = await import('node:crypto');
  const { Readable } = await import('node:stream');
  const { createSessionV2Client, SESSION_V2_AUTHORITY_KEYS } = await import(configuration.clientURL);
  const { runSessionV2Hook } = await import(configuration.hookURL);
  const original = { lstat: fs.promises.lstat, realpath: fs.promises.realpath, connect: net.createConnection };
  const root = await original.realpath(await fs.promises.mkdtemp('/private/tmp/blabee-request-preflight-'));
  const socketPath = `${root}/service.sock`;
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
  const config = { socketPath, authority, runtimeIdentity: `sha256:${'1'.repeat(64)}`, role: 'bridge',
    authToken: 'a'.repeat(64), channelSource: 'blabee-claude', timeoutMs: configuration.action === 'timeout' ? 30 : 1000 };
  let armed = false, gated = false, reached, release, rejectGate, sent, reply;
  let connections = 0, frames = 0, client, operation, output = '', errors = '';
  const entered = new Promise(resolve => { reached = resolve; });
  const gate = new Promise((resolve, reject) => { release = resolve; rejectGate = reject; });
  const submitted = new Promise(resolve => { sent = resolve; });
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  const within = async promise => {
    let timer;
    try {
      return await Promise.race([promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('local wait did not finish')), 600); })]);
    } finally { clearTimeout(timer); }
  };
  const inspect = async (stage, real) => {
    if (armed && !gated && stage === configuration.stage) {
      gated = true; reached(); await gate;
    }
    return real();
  };
  fs.promises.lstat = path => inspect(path === socketPath ? 'socket' : path === root ? 'directory' : 'other', () =>
    path === socketPath ? { uid: process.getuid(), mode: 0o600, isSocket: () => true, isSymbolicLink: () => false }
      : original.lstat(path));
  fs.promises.realpath = path => inspect(path === root ? 'canonical' : 'other', () => original.realpath(path));
  net.createConnection = () => {
    connections++;
    const socket = new EventEmitter();
    let destroyed = false;
    socket.destroy = () => {
      if (!destroyed) { destroyed = true; queueMicrotask(() => socket.emit('close')); }
    };
    socket.write = (frame, callback) => {
      frames++;
      const request = JSON.parse(frame);
      const { payload: ignored, ...envelope } = request.payload.envelope;
      reply = () => {
        socket.emit('data', Buffer.from(JSON.stringify({ request_id: request.request_id,
          runtime_identity: request.runtime_identity, ok: true,
          result: { ...envelope, kind: 'response', ok: true, result: { bridge_id: randomUUID() } } }) + '\n'));
        socket.emit('end');
      };
      callback?.(); sent();
    };
    queueMicrotask(() => { if (!destroyed) socket.emit('connect'); });
    return socket;
  };
  syncBuiltinESMExports();
  const controller = new AbortController();
  const sigtermListeners = process.listenerCount('SIGTERM');
  try {
    if (configuration.hookEvent) {
      const prefix = 'BLABEE_CLAUDE_SESSION_V2_';
      const env = { ...Object.fromEntries(Object.entries(authority).map(([key, value]) => [prefix + key.toUpperCase(), value])),
        [prefix + 'SOCKET']: socketPath, [prefix + 'RUNTIME_IDENTITY']: config.runtimeIdentity,
        [prefix + 'CWD']: root, [prefix + 'CHANNEL_SOURCE']: config.channelSource, [prefix + 'HOOK_TOKEN']: config.authToken };
      operation = runSessionV2Hook({ env, args: [], signal: controller.signal,
        createClient: async value => { client = await createSessionV2Client(value); armed = true; return client; },
        input: Readable.from([JSON.stringify({ hook_event_name: configuration.hookEvent,
          session_id: authority.native_session_id, cwd: root, prompt_id: randomUUID(), prompt: 'fixture' })]),
        output: { write(value) { output += value; } }, errorOutput: { write(value) { errors += value; } } });
    } else {
      client = await createSessionV2Client(config); armed = true;
      operation = client.request({ operation: 'bridge.open' }, { signal: controller.signal })
        .then(value => ({ value }), error => ({ code: error.code, message: error.message }));
    }
    await within(entered);
    // This never releases the blocked filesystem call until cancellation,
    // close, or the preflight deadline has finished the local request.
    if (configuration.action === 'abort') controller.abort(new Error('PRIVATE CANCEL REASON'));
    if (configuration.action === 'SIGTERM') process.kill(process.pid, 'SIGTERM');
    if (configuration.action === 'close') await within(Promise.all([client.close(), client.close()]));
    const result = await within(operation);
    const code = configuration.action === 'abort' ? 'session_v2_request_cancelled'
      : configuration.action === 'close' ? 'session_v2_client_closed' : 'session_v2_unavailable';
    if (configuration.hookEvent) {
      assert.equal(result, 0); assert.equal(output, '');
      assert.match(errors, /session_v2_client_closed/); assert.doesNotMatch(errors, /PRIVATE/);
      assert.equal(process.listenerCount('SIGTERM'), sigtermListeners);
    } else assert.deepEqual(result, { code, message: code });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal(connections, 0); assert.equal(frames, 0);

    // Reuse after abort or a local preflight timeout while the old filesystem
    // operation is STILL pending. Neither submitted anything, so the client
    // stays usable. The late result must not clear this successor's FIFO slot.
    let successor;
    if (!configuration.hookEvent && ['abort', 'timeout'].includes(configuration.action)) {
      successor = client.request({ operation: 'bridge.open' });
      await within(submitted);
      if (configuration.action === 'timeout') {
        // This client's response deadline is short; answer before it lapses.
        reply();
        assert.match((await within(successor)).bridge_id, /^[0-9a-f-]{36}$/);
      }
    } else if (!configuration.hookEvent) {
      await assert.rejects(client.request({ operation: 'bridge.open' }), { code });
    }
    if (configuration.late === 'reject') rejectGate(new Error('PRIVATE LATE FILESYSTEM ERROR'));
    else release();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    if (successor && configuration.action === 'abort') {
      await assert.rejects(client.request({ operation: 'bridge.open' }), { code: 'session_v2_client_busy' });
      reply();
      assert.match((await within(successor)).bridge_id, /^[0-9a-f-]{36}$/);
    }
    assert.equal(connections, successor ? 1 : 0); assert.equal(frames, successor ? 1 : 0);
    assert.deepEqual(unhandled, []);
  } finally {
    release(); await client?.close(); await operation;
    fs.promises.lstat = original.lstat; fs.promises.realpath = original.realpath; net.createConnection = original.connect;
    syncBuiltinESMExports(); process.off('unhandledRejection', onUnhandled);
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

async function runProbe(t, configuration) {
  const urls = { clientURL: new URL('../../../bridges/claude/src/session-v2-client.mjs', import.meta.url).href,
    hookURL: new URL('../../../bridges/claude/src/session-v2-hook.mjs', import.meta.url).href };
  const child = spawn(process.execPath, ['--input-type=module', '--eval',
    `await (${probe.toString()})(${JSON.stringify({ ...urls, ...configuration })});`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timer;
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  t.after(() => { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); });
  const result = await Promise.race([
    new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('request preflight probe did not exit')), 5000); }),
  ]);
  clearTimeout(timer);
  assert.equal(result.code, 0, `${stdout}\n${stderr}`); assert.equal(result.signal, null);
}

for (const stage of ['directory', 'socket', 'canonical']) {
  for (const action of ['abort', 'close', 'timeout']) for (const late of ['resolve', 'reject']) {
    test(`request ${stage}: ${action} finishes before late ${late}, with no abandoned transmission`, t =>
      runProbe(t, { stage, action, late }));
  }
}
for (const hookEvent of ['UserPromptSubmit', 'Stop']) {
  for (const action of ['abort', 'SIGTERM']) for (const late of ['resolve', 'reject']) {
    test(`real ${hookEvent} Hook ${action} finishes during request preflight before late ${late}`, t =>
      runProbe(t, { stage: 'socket', action, late, hookEvent }));
  }
}
