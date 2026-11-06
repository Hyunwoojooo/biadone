import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

// Builtin ESM export replacement and actual process signals stay in a child.
// Only the selected filesystem promise is delayed; no real filesystem call or
// service socket is left hanging by the fixture.
async function preflightProbe(configuration) {
  const assert = (await import('node:assert/strict')).default;
  const { randomUUID } = await import('node:crypto');
  const { EventEmitter, getEventListeners } = await import('node:events');
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const net = (await import('node:net')).default;
  const { join } = await import('node:path');
  const { Readable } = await import('node:stream');
  const { createAutoConnectClient, AUTO_CONNECT_SCHEMA } = await import(configuration.clientURL);
  const { runAutoConnectHook } = await import(configuration.autoURL);
  const { runSessionV2Hook } = await import(configuration.hookURL);
  const { SESSION_V2_AUTHORITY_KEYS } = await import(configuration.sessionURL);
  const B = 'BLABEE_CLAUDE_BOOTSTRAP_', P = 'BLABEE_CLAUDE_SESSION_V2_';
  const originalRealpath = fs.promises.realpath, originalLstat = fs.promises.lstat;
  const originalConnect = net.createConnection;
  const root = await originalRealpath(await fs.promises.mkdtemp('/private/tmp/blabee-preflight-'));
  const launch = join(root, 'launch'), cwd = join(root, 'native');
  const bootstrapDirectory = join(root, 'bootstrap'), sessionDirectory = join(root, 'session');
  for (const path of [launch, cwd, bootstrapDirectory, sessionDirectory]) await fs.promises.mkdir(path, { mode: 0o700 });
  const socketPath = join(bootstrapDirectory, 'bridge.sock'), grantedSocket = join(sessionDirectory, 'bridge.sock');
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
  const role = configuration.cancellation === 'close' || configuration.failure ? 'bridge' : 'hook';
  const environment = {
    ...Object.fromEntries(Object.entries(authority).map(([key, value]) => [P + key.toUpperCase(), value])),
    [P + 'SOCKET']: grantedSocket, [P + 'RUNTIME_IDENTITY']: `sha256:${'1'.repeat(64)}`,
    [P + 'CWD']: cwd, [P + 'CHANNEL_SOURCE']: 'blabee-claude',
    [P + (role === 'hook' ? 'HOOK_TOKEN' : 'BRIDGE_TOKEN')]: 'c'.repeat(64),
  };
  const bootstrapEnvironment = { [B + 'SOCKET']: socketPath, [B + 'CWD']: launch,
    [B + 'BRIDGE_TOKEN']: 'b'.repeat(64), CLAUDE_CODE_SESSION_ID: authority.native_session_id,
    ...(role === 'hook' ? { [B + 'HOOK_TOKEN']: 'a'.repeat(64) } : {}) };
  const stages = {
    context: ['realpath', cwd, 1],
    'launch-realpath': ['realpath', launch, 1], 'launch-lstat': ['lstat', launch, 1],
    'native-realpath': ['realpath', cwd, 1], 'native-lstat': ['lstat', cwd, 1],
    'socket-realpath': ['realpath', bootstrapDirectory, 1],
    'socket-parent-lstat': ['lstat', bootstrapDirectory, 1], 'socket-lstat': ['lstat', socketPath, 1],
    'exchange-lstat': ['lstat', socketPath, 2],
    'grant-context': ['realpath', cwd, 2], 'grant-socket-lstat': ['lstat', grantedSocket, 1],
  };
  const [method, gatedPath, occurrence] = stages[configuration.stage];
  const filesystemCalls = [], requests = [], sockets = new Set(), unhandled = [];
  let seen = 0, connections = 0, admissions = 0, sessionRequests = 0, stdout = '', stderr = '';
  let entered, release, rejectLate;
  const reached = new Promise(resolve => { entered = resolve; });
  const gate = new Promise((resolve, reject) => { release = resolve; rejectLate = reject; });
  const onUnhandled = error => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  const socketStat = { uid: process.getuid(), mode: 0o600, isSocket: () => true, isSymbolicLink: () => false };
  const inspect = (operation, path, actual) => {
    filesystemCalls.push({ operation, path });
    if (operation === method && path === gatedPath && ++seen === occurrence) {
      entered();
      return gate.then(actual);
    }
    return actual();
  };
  fs.promises.realpath = path => inspect('realpath', path, () => originalRealpath(path));
  fs.promises.lstat = path => inspect('lstat', path, () => [socketPath, grantedSocket].includes(path)
    ? Promise.resolve(socketStat) : originalLstat(path));
  // A deterministic transport spy exercises the real bootstrap parser without
  // opening a UDS or touching a running app, service, or enrolled session.
  net.createConnection = () => {
    connections++;
    const socket = new EventEmitter();
    sockets.add(socket);
    socket.destroy = () => {
      if (sockets.delete(socket)) setImmediate(() => socket.emit('close'));
    };
    socket.write = (frame, callback) => {
      const request = JSON.parse(frame);
      requests.push(request);
      callback?.();
      setImmediate(() => {
        if (!sockets.has(socket)) return;
        socket.emit('data', Buffer.from(JSON.stringify({ schema_version: AUTO_CONNECT_SCHEMA,
          request_id: request.request_id, ok: true, status: 'ready', environment }) + '\n'));
        socket.emit('end');
      });
      return true;
    };
    setImmediate(() => { if (sockets.has(socket)) socket.emit('connect'); });
    return socket;
  };
  syncBuiltinESMExports();
  const controller = new AbortController();
  if (configuration.preAborted) controller.abort('PRIVATE CANCEL REASON');
  const listeners = ['SIGINT', 'SIGTERM'].map(value => process.listenerCount(value));
  const within = async (promise, milliseconds = 250) => {
    let timer;
    try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
    finally { clearTimeout(timer); }
  };
  const turn = () => new Promise(resolve => setImmediate(resolve));
  let client;
  const action = async () => {
    if (configuration.cancellation === 'close' || configuration.failure) {
      client = await createAutoConnectClient({ role, env: bootstrapEnvironment, cwd, signal: controller.signal });
      return client.grant();
    }
    const runner = configuration.kind === 'enrolled' ? runSessionV2Hook : runAutoConnectHook;
    return runner({ args: [], env: configuration.kind === 'enrolled' ? environment : bootstrapEnvironment,
      signal: controller.signal, input: Readable.from([JSON.stringify({ hook_event_name: 'UserPromptSubmit',
        session_id: authority.native_session_id, cwd, prompt_id: randomUUID(), prompt: 'PRIVATE PROMPT' })]),
      output: { write: value => { stdout += value; } }, errorOutput: { write: value => { stderr += value; } },
      createClient: async () => {
        admissions++;
        return { request: async () => { sessionRequests++; throw new Error('forbidden late request'); }, close: async () => {} };
      } });
  };
  const run = action().then(value => ({ value }), error => ({ errorCode: error?.code }));
  try {
    let close;
    if (!configuration.preAborted) {
      assert.notEqual(await within(reached.then(() => true), 3000), false, 'filesystem gate was not reached');
      if (configuration.failure) rejectLate(new Error('PRIVATE FILESYSTEM ERROR'));
      else if (configuration.cancellation === 'close') close = client.close();
      else if (configuration.cancellation === 'SIGTERM') process.kill(process.pid, 'SIGTERM');
      else controller.abort('PRIVATE CANCEL REASON');
    }
    const result = await within(run);
    assert.notEqual(result, false, 'cancellation waited for the blocked filesystem promise');
    if (close) assert.notEqual(await within(close.then(() => true)), false, 'close waited for blocked preflight');
    if (configuration.failure) assert.deepEqual(result, { errorCode: 'auto_connect_invalid_configuration' });
    else if (configuration.cancellation === 'close') assert.deepEqual(result, { errorCode: 'auto_connect_closed' });
    else {
      assert.deepEqual(result, { value: 0 });
      assert.match(stderr, configuration.kind === 'enrolled' ? /session_v2_client_closed/ : /auto_connect_closed/);
    }
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.deepEqual(['SIGINT', 'SIGTERM'].map(value => process.listenerCount(value)), listeners);
    const callsAfterCancellation = filesystemCalls.length;
    if (configuration.late === 'reject') rejectLate(new Error('PRIVATE FILESYSTEM ERROR'));
    else release();
    await turn(); await turn(); await turn();
    assert.equal(filesystemCalls.length, callsAfterCancellation, 'late preflight started another filesystem validation');
    if (configuration.preAborted) assert.equal(filesystemCalls.length, 0);
    const expectedConnections = configuration.stage.startsWith('grant-') ? 1 : 0;
    assert.equal(connections, expectedConnections);
    assert.equal(requests.length, expectedConnections);
    assert.equal(admissions, 0); assert.equal(sessionRequests, 0); assert.equal(stdout, '');
    assert.equal(sockets.size, 0);
    assert.doesNotMatch(stderr, /PRIVATE|[abc]{64}|native_session_id|boundary_id=/);
    assert.deepEqual(unhandled, []);
  } finally {
    release();
    await within(run, 1000);
    await client?.close();
    for (const socket of sockets) socket.destroy();
    fs.promises.realpath = originalRealpath; fs.promises.lstat = originalLstat;
    net.createConnection = originalConnect;
    syncBuiltinESMExports();
    process.off('unhandledRejection', onUnhandled);
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

const urls = Object.fromEntries(Object.entries({ clientURL: 'auto-connect-client', autoURL: 'auto-connect-hook',
  hookURL: 'session-v2-hook', sessionURL: 'session-v2-client' }).map(([key, file]) =>
  [key, new URL(`../../../bridges/claude/src/${file}.mjs`, import.meta.url).href]));

async function probe(t, configuration) {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `await (${preflightProbe.toString()})(${JSON.stringify({ ...urls, ...configuration })});`],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timer;
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  try {
    const status = await Promise.race([
      new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('preflight fixture did not exit')), 6000); }),
    ]);
    assert.deepEqual(status, { code: 0, signal: null }, stderr);
    assert.equal(stdout, ''); assert.equal(stderr, '');
  } finally { clearTimeout(timer); }
}

for (const kind of ['enrolled', 'auto-connect']) {
  const stage = kind === 'enrolled' ? 'context' : 'launch-realpath';
  for (const cancellation of ['signal', 'SIGTERM']) for (const late of ['resolve', 'reject']) {
    test(`${kind}: ${cancellation} cancels initial realpath without waiting for its late ${late}`, t =>
      probe(t, { kind, stage, cancellation, late }));
  }
  test(`${kind}: an already aborted Hook performs no preflight or admission`, t =>
    probe(t, { kind, stage, cancellation: 'signal', preAborted: true }));
}

for (const stage of ['launch-lstat', 'native-realpath', 'native-lstat', 'socket-realpath', 'socket-parent-lstat',
  'socket-lstat', 'exchange-lstat', 'grant-context', 'grant-socket-lstat']) {
  test(`auto-connect: abort during ${stage} releases listeners and prevents late validation, IPC, and authority`, t =>
    probe(t, { kind: 'auto-connect', stage, cancellation: 'signal', late: stage.includes('lstat') ? 'reject' : 'resolve' }));
}

for (const stage of ['exchange-lstat', 'grant-context']) {
  test(`auto-connect: explicit close during ${stage} does not wait for filesystem validation`, t =>
    probe(t, { kind: 'auto-connect', stage, cancellation: 'close', late: 'reject' }));
}

test('auto-connect: an initial filesystem rejection removes its early abort listener', t =>
  probe(t, { kind: 'auto-connect', stage: 'launch-realpath', failure: true }));
