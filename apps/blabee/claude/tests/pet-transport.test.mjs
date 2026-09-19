import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'build/pet-transport-check');
const binary = join(build, 'pet-transport-probe');
const token = 'test-only-ui-token-01234567890123456789';
const health = { product: 'blabee-claude', provider: 'claude', protocol: 'blabee-claude.v1', version: 1 };

before(async () => {
  await mkdir(build, { recursive: true });
  const compilation = spawnSync('swiftc', [
    '-swift-version', '6', '-module-cache-path', join(build, 'module-cache'),
    join(root, 'src/pet/Runtime.swift'), join(root, 'src/pet/Transport.swift'),
    join(root, 'tests/pet-transport.swift'), '-o', binary,
  ], { encoding: 'utf8', timeout: 120000 });
  assert.equal(compilation.status, 0, compilation.stderr || compilation.error?.message);
});

async function serverFixture(t, respond) {
  const runtime = await mkdtemp(join(root, 'build/pt-'));
  const socket = join(runtime, 'blabee-claude.sock');
  const connections = new Set();
  const received = [];
  const server = createServer(connection => {
    connections.add(connection);
    connection.on('error', () => {});
    connection.on('close', () => connections.delete(connection));
    let incoming = '';
    connection.on('data', bytes => {
      incoming += bytes;
      if (!incoming.includes('\n')) return;
      const message = JSON.parse(incoming.split('\n')[0]);
      received.push(message);
      respond(message, connection);
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(socket, resolveListen);
  });
  await chmod(socket, 0o600);
  t.after(async () => {
    for (const connection of connections) connection.destroy();
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(runtime, { recursive: true, force: true });
  });
  return { runtime, socket, received };
}

function probe(runtime, ...arguments_) {
  return execute(binary, [arguments_[0] ?? 'list', runtime, ...arguments_.slice(1)], {
    encoding: 'utf8', timeout: 7000,
    env: { ...process.env, BLABEE_CLAUDE_UI_TOKEN: token },
  });
}

function send(connection, result) { connection.end(JSON.stringify({ ok: true, result }) + '\n'); }

test('Native Pet transport verifies identity then reads fragmented authenticated session data', async t => {
  const fixture = await serverFixture(t, (request, connection) => {
    if (request.type === 'health') return send(connection, health);
    assert.equal(request.type, 'ui.list');
    const data = JSON.stringify({ ok: true, result: { sessions: [{
      session_id: 'session-1', cwd: '/project', phase: 'ready', prompt_id: 'prompt-1',
      boundary_id: 'boundary-1', connected: true, selection: null,
      packet: { packet_id: 'packet-1', revision: 3, summary: 'Ready', options: [{
        id: 'inspect', title: 'Inspect', description: 'Read only', task: 'Read README.md', done_when: 'Summary written',
      }] },
    }] } }) + '\n';
    connection.write(data.slice(0, 37));
    setTimeout(() => connection.end(data.slice(37)), 10);
  });
  const { stdout } = await probe(fixture.runtime);
  assert.equal(JSON.parse(stdout).sessions[0].task, 'Read README.md');
  assert.equal(JSON.parse(stdout).sessions[0].selection_enabled, false, 'legacy snapshots without receipt evidence remain disabled');
  assert.equal(fixture.received[0].auth, undefined);
  assert.equal(fixture.received[1].auth, token);
  assert.equal(fixture.received[1].provider, 'claude');
  assert.equal(fixture.received[1].protocol, 'blabee-claude.v1');
});

test('Native Pet enables choices only for a current ready session with confirmed channel receipt', async t => {
  const base = {
    session_id: 'verified', cwd: '/project', phase: 'ready', connected: true, continuation_ready: true,
    packet: { packet_id: 'packet-1', revision: 1, summary: 'Ready', options: [{
      id: 'inspect', title: 'Inspect', description: 'Read only', task: 'Read README.md', done_when: 'Summary written',
    }] },
  };
  const sessions = [
    base,
    { ...base, session_id: 'unchecked', continuation_ready: false },
    { ...base, session_id: 'offline', connected: false },
    { ...base, session_id: 'working', phase: 'working' },
    { ...base, session_id: 'without-proposal', packet: null },
    { ...base, session_id: 'ended', phase: 'ended' },
  ];
  const fixture = await serverFixture(t, (request, connection) => send(connection,
    request.type === 'health' ? health : { sessions }));
  const { stdout } = await probe(fixture.runtime);
  assert.deepEqual(JSON.parse(stdout).sessions.map(session => [session.session_id, session.selection_enabled]), [
    ['verified', true], ['unchecked', false], ['offline', false], ['working', false], ['without-proposal', false], ['ended', false],
  ]);
});

test('Native Pet sends exact selection identity and preserves coordinator rejection', async t => {
  const fixture = await serverFixture(t, (request, connection) => {
    if (request.type === 'health') return send(connection, health);
    assert.equal(request.type, 'ui.select');
    assert.deepEqual(request.payload, { session_id: 's1', packet_id: 'p1', revision: 7, option_id: 'o1' });
    connection.end(JSON.stringify({ ok: false, error: { code: 'stale_packet', message: 'This selection is stale.' } }) + '\n');
  });
  await assert.rejects(probe(fixture.runtime, 'select', 's1', 'p1', '7', 'o1'), error => {
    assert.match(error.stderr, /stale_packet: This selection is stale/);
    return true;
  });
});

test('Native Pet validates the receipt identity before tracking an accepted selection', async t => {
  const selectionID = '11111111-1111-4111-8111-111111111111';
  for (const receipt of [
    { selection_id: selectionID, status: 'selected' },
    { selection_id: 'not-an-id', status: 'selected' },
    { selection_id: selectionID, status: 'claimed' },
  ]) {
    const fixture = await serverFixture(t, (request, connection) => send(connection,
      request.type === 'health' ? health : receipt));
    if (receipt.selection_id === selectionID && receipt.status === 'selected') {
      const { stdout } = await probe(fixture.runtime, 'select', 'session-1', 'packet-1', '1', 'inspect');
      assert.equal(JSON.parse(stdout).selection_id, selectionID);
    } else {
      await assert.rejects(probe(fixture.runtime, 'select', 'session-1', 'packet-1', '1', 'inspect'), error => {
        assert.match(error.stderr, /valid selection receipt/);
        return true;
      });
    }
  }
});

test('Native Pet unlocks the same card after its exact selection was invalidated on bridge replacement', async t => {
  const base = {
    session_id: 'session-1', cwd: '/project', phase: 'ready', connected: true, continuation_ready: true,
    packet: { packet_id: 'packet-1', revision: 1, summary: 'Ready', options: [] },
    selection: { selection_id: 'choice-current', option_id: 'inspect', status: 'invalidated' },
  };
  const sessions = [
    base,
    { ...base, selection: null },
    { ...base, selection: { ...base.selection, status: 'delivered' } },
    { ...base, selection: { ...base.selection, status: 'claimed' } },
    { ...base, selection: { ...base.selection, selection_id: 'choice-older' } },
    { ...base, session_id: 'another-session' },
    { ...base, packet: { ...base.packet, packet_id: 'another-packet' } },
  ];
  const fixture = await serverFixture(t, (request, connection) => send(connection,
    request.type === 'health' ? health : { sessions }));
  const confirmed = JSON.parse((await probe(fixture.runtime, 'pending', 'session-1', 'packet-1', 'choice-current')).stdout).sessions;
  assert.deepEqual(confirmed.map(session => session.pending_blocked), [false, true, true, true, true, false, false]);
  assert.deepEqual(confirmed.map(session => session.pending_invalidated), [true, false, false, false, false, false, false]);
  const awaitingReceipt = JSON.parse((await probe(fixture.runtime, 'pending', 'session-1', 'packet-1', '')).stdout).sessions;
  assert.deepEqual(awaitingReceipt.map(session => session.pending_blocked), [true, true, true, true, true, false, false]);
  assert.ok(awaitingReceipt.every(session => session.pending_invalidated === false), 'an old invalidation cannot release an in-flight click');
});

test('Native Pet refuses a different product before exposing UI authentication', async t => {
  const fixture = await serverFixture(t, (_, connection) => send(connection, { ...health, product: 'blabee-codex' }));
  await assert.rejects(probe(fixture.runtime), error => {
    assert.match(error.stderr, /does not identify a compatible Blabee Claude/);
    return true;
  });
  assert.equal(fixture.received.length, 1);
  assert.equal(fixture.received[0].auth, undefined);
});

test('Native Pet refuses a publicly readable coordinator socket', async t => {
  const fixture = await serverFixture(t, (_, connection) => send(connection, health));
  await chmod(fixture.socket, 0o666);
  await assert.rejects(probe(fixture.runtime), error => {
    assert.match(error.stderr, /socket must be private/);
    return true;
  });
  assert.equal(fixture.received.length, 0);
});

test('Native Pet caps coordinator response size and redacts its token from errors', async t => {
  const oversize = await serverFixture(t, (_, connection) => connection.end('x'.repeat(128 * 1024 + 1)));
  await assert.rejects(probe(oversize.runtime), error => {
    assert.match(error.stderr, /exceeds 128 KiB/);
    return true;
  });
  const echo = await serverFixture(t, (_, connection) => {
    connection.end(JSON.stringify({ ok: false, error: { code: 'invalid', message: token } }) + '\n');
  });
  await assert.rejects(probe(echo.runtime), error => {
    assert.equal(error.stderr.includes(token), false);
    assert.match(error.stderr, /\[redacted\]/);
    return true;
  });
});

test('Native Pet bounds silent coordinator waits without a GUI thread', async t => {
  const fixture = await serverFixture(t, () => {});
  const start = performance.now();
  await assert.rejects(probe(fixture.runtime), error => {
    assert.match(error.stderr, /timed out/);
    return true;
  });
  assert.ok(performance.now() - start < 6500);
});
