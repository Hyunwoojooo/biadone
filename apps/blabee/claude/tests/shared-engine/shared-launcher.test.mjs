import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from '../../src/shared/identity.mjs';
import { cleanSharedEnvironment, createSharedHostArguments, createSharedLaunchConfiguration, launchSharedClaude,
  parseSharedArguments, startSharedRuntime } from '../../src/bridge/shared-launcher.mjs';

test('launcher settings preserve literal paths but never serialize issued capabilities', () => {
  const bridge = 'ab'.repeat(32);
  const host = { sessionID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    mcpEnvironment: { BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN: bridge, BLABEE_CLAUDE_SHARED_SCOPE_ID: 'scope' } };
  const config = createSharedLaunchConfiguration(host, { node: '/node path/node', root: '/tmp/a $(literal)' });
  const encoded = JSON.stringify(config);
  assert.equal(encoded.includes(bridge), false);
  const server = config.mcp.mcpServers['blabee-claude'];
  assert.deepEqual(server.args, ['/tmp/a $(literal)/src/bridge/product-mcp.mjs']);
  assert.equal(server.env.BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN, '${BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN}');
  for (const name of ['HOOK', 'SELECTOR', 'CONTROL']) assert.equal(server.env[`BLABEE_CLAUDE_SHARED_${name}_TOKEN`], '');
  assert.equal(config.settings.permissions, undefined);
  assert.equal(config.settings.hooks.SessionStart[0].hooks[0].type, 'command');
  assert.equal(config.settings.hooks.SessionEnd[0].hooks[0].timeout, 5);
});

test('launcher excludes inherited authorities and rejects enrollment or permission overrides', async () => {
  const inherited = { HOME: '/home', PATH: '/bin', BLABEE_SOCKET: '/wrong',
    BLABEE_MANAGED_CODEX_AUTH_TOKEN: 'unrelated', BLABEE_CLAUDE_SHARED_SELECTOR_TOKEN: 'secret',
    MCP_PROTOCOL_NEGOTIATION: 'auto' };
  assert.deepEqual(cleanSharedEnvironment(inherited), { HOME: '/home', PATH: '/bin', MCP_PROTOCOL_NEGOTIATION: 'legacy' });
  assert.equal(inherited.MCP_PROTOCOL_NEGOTIATION, 'auto');
  for (const flag of ['--resume', '--session-id=other', '--settings=x', '--mcp-config=x', '--bare',
    '--dangerously-skip-permissions', '--permission-mode', '--print', '--background', '--worktree']) {
    assert.throws(() => parseSharedArguments(['--coordinator-bin', '/x', '--', flag]),
      { code: 'shared_launcher_override_forbidden' });
    await assert.rejects(launchSharedClaude({ extra: [flag] }), { code: 'shared_launcher_override_forbidden' });
  }
  assert.deepEqual(parseSharedArguments(['--coordinator-bin', '/x', '--', '--model', 'sonnet']).extra,
    ['--model', 'sonnet']);
});

test('launcher Pet flag is opt-in, valueless, unique, and never a Claude passthrough', async () => {
  const base = ['--coordinator-bin', '/coordinator'];
  assert.equal(parseSharedArguments(base).pet, false);
  assert.equal(parseSharedArguments([...base, '--pet']).pet, true);
  assert.equal(parseSharedArguments(['--pet', ...base]).pet, true);
  assert.deepEqual(parseSharedArguments([...base, '--pet', '--', '--model', 'sonnet']).extra,
    ['--model', 'sonnet']);
  for (const args of [['--pet', '--pet'], ['--pet=true'], ['--pet=false'], ['--pet', 'true'],
    ['--pet', 'false'], ['--cwd', '--pet']]) {
    assert.throws(() => parseSharedArguments([...base, ...args]), { code: 'shared_launcher_arguments' });
  }
  assert.throws(() => parseSharedArguments([...base, '--', '--pet']),
    { code: 'shared_launcher_override_forbidden' });
  for (const pet of ['true', 'false', 1, 0, null]) {
    await assert.rejects(launchSharedClaude({ pet }), { code: 'shared_launcher_arguments' });
    await assert.rejects(startSharedRuntime({ pet }), { code: 'shared_grant_invalid' });
  }
});

test('launcher host argv forwards Pet only as an explicit native-host opt-in', () => {
  const input = { runtime: '/private/runtime', contractsDirectory: '/product/Contracts/v1' };
  const expected = ['claude-session-host', '--runtime', input.runtime, '--contracts', input.contractsDirectory,
    '--grant-fd', '3', '--owner-fd', '4'];
  assert.deepEqual(createSharedHostArguments(input), expected);
  assert.deepEqual(createSharedHostArguments({ ...input, pet: false }), expected);
  assert.deepEqual(createSharedHostArguments({ ...input, pet: true }), [...expected, '--pet']);
  assert.deepEqual(createSharedHostArguments({ ...input, fixture: true }),
    ['claude-session-host-test', ...expected.slice(1)]);
  assert.deepEqual(createSharedHostArguments({ ...input, fixture: true, pet: true }),
    ['claude-session-host-test', ...expected.slice(1), '--pet']);
});

async function fixture(t) {
  const binary = process.env.BLABEE_CLAUDE_NATIVE_COORDINATOR;
  assert.ok(binary, 'run via npm run test:native-session');
  const root = await realpath(await mkdtemp(join(PROJECT_ROOT, 'build/nl-')));
  const cwd = join(root, 'project');
  const runtime = join(root, 'runtime');
  await mkdir(cwd, { mode: 0o700 });
  await mkdir(runtime, { mode: 0o700 });
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return { root, cwd, runtime, coordinatorBinary: binary,
    contractsDirectory: join(PROJECT_ROOT, '../Contracts/v1') };
}

async function fakeClaude(root, { linger = false } = {}) {
  const binary = join(root, 'claude-fixture.cjs');
  const script = `#!${process.execPath}\n` + String.raw`
const fs = require('node:fs');
if (process.argv[2] === '--version') { console.log('2.1.276 (Claude Code fixture)'); process.exit(0); }
const args = process.argv.slice(2);
const mcp = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
const report = { args, keys: Object.keys(process.env).filter(key => key.startsWith('BLABEE_')),
  negotiation: process.env.MCP_PROTOCOL_NEGOTIATION,
  mcpHasIssuedToken: JSON.stringify(mcp).includes(process.env.BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN),
  settingsPermissions: JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8')).permissions ?? null };
fs.writeFileSync('child-audit.json', JSON.stringify(report));
` + (linger ? String.raw`
let interrupts = 0;
process.on('SIGINT', () => fs.writeFileSync('interrupt-count.txt', String(++interrupts)));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
` : '');
  await writeFile(binary, script, { mode: 0o700 });
  return binary;
}

test('actual common host grants a fresh child only Hook/MCP authority and closes after child exit', async t => {
  const f = await fixture(t);
  const claudeBinary = await fakeClaude(f.root);
  let host;
  const code = await launchSharedClaude({ ...f, claudeBinary, extra: [] }, {
    fixture: true, onRuntime: value => { host = value; },
  });
  assert.equal(code, 0);
  const audit = JSON.parse(await readFile(join(f.cwd, 'child-audit.json'), 'utf8'));
  assert.ok(audit.args.includes('--strict-mcp-config'));
  assert.ok(audit.args.includes('--dangerously-load-development-channels'));
  assert.equal(audit.negotiation, 'legacy');
  assert.equal(audit.mcpHasIssuedToken, false);
  assert.equal(audit.settingsPermissions, null);
  assert.ok(audit.keys.includes('BLABEE_CLAUDE_SHARED_HOOK_TOKEN'));
  assert.ok(audit.keys.includes('BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN'));
  assert.equal(audit.keys.some(key => /SELECTOR|CONTROL|UI_TOKEN/.test(key)), false);
  await assert.rejects(host.selectorClient.request({ operation: 'snapshot' }));
  await assert.rejects(startSharedRuntime({ ...f, fixture: true }), { code: 'shared_host_unavailable' });
});

test('failure before Claude spawn revokes and closes the owned common host', async t => {
  const f = await fixture(t);
  const claudeBinary = await fakeClaude(f.root);
  let host;
  await assert.rejects(launchSharedClaude({ ...f, claudeBinary, extra: [] }, {
    fixture: true, onRuntime: value => { host = value; throw new Error('injected pre-spawn failure'); },
  }), /injected pre-spawn failure/);
  assert.ok(host);
  await assert.rejects(host.selectorClient.request({ operation: 'snapshot' }));
  await assert.rejects(readFile(join(f.cwd, 'child-audit.json')), { code: 'ENOENT' });
  await assert.rejects(startSharedRuntime({ ...f, fixture: true }), { code: 'shared_host_unavailable' });
});

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitUntil(predicate, description, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  assert.fail(description);
}

function acceptsConnections(socketPath) {
  return new Promise(resolve => {
    const socket = net.createConnection(socketPath);
    let finished = false;
    const finish = accepted => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(300, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function ownerProcess(t, f, mode, claudeBinary) {
  const moduleURL = pathToFileURL(join(PROJECT_ROOT, 'src/bridge/shared-launcher.mjs')).href;
  const driver = join(f.root, 'owner.mjs');
  const options = { cwd: f.cwd, runtime: f.runtime, coordinatorBinary: f.coordinatorBinary,
    contractsDirectory: f.contractsDirectory, claudeBinary, extra: [] };
  const code = `import {startSharedRuntime, launchSharedClaude} from ${JSON.stringify(moduleURL)};\n`
    + `const options = ${JSON.stringify(options)};\n`
    + (mode === 'owner' ? `
await startSharedRuntime({ ...options, fixture: true });
console.log('OWNER_READY');
setInterval(() => {}, 1000);
` : `
process.exitCode = await launchSharedClaude(options, { fixture: true,
  onRuntime: async () => { console.log('OWNER_READY'); ${mode === 'startup' ? 'await new Promise(() => {});' : ''} }
});
`);
  await writeFile(driver, code, { mode: 0o600 });
  const child = spawn(process.execPath, [driver], {
    cwd: f.cwd, detached: true, env: cleanSharedEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let done;
  child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-4096); });
  child.stderr.resume();
  const closed = new Promise(resolve => {
    child.once('error', () => { done = { code: 1 }; resolve(done); });
    child.once('close', (code, signal) => { done = { code, signal }; resolve(done); });
  });
  t.after(async () => {
    if (!done) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
    }
    await closed;
    await waitUntil(async () => !(await acceptsConnections(join(f.runtime, 'native.sock'))),
      'owned host should close after test cleanup');
  });
  await waitUntil(() => stdout.includes('OWNER_READY'), 'owner did not become ready');
  return { child, closed, get done() { return done; } };
}

test('owner SIGKILL closes the actual common host through its lifetime pipe', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const owner = await ownerProcess(t, f, 'owner');
  assert.equal(await acceptsConnections(join(f.runtime, 'native.sock')), true);
  owner.child.kill('SIGKILL');
  await owner.closed;
  await waitUntil(async () => !(await acceptsConnections(join(f.runtime, 'native.sock'))),
    'host survived owner death');
  await assert.rejects(startSharedRuntime({ ...f, fixture: true }), { code: 'shared_host_unavailable' });
});

test('SIGTERM during pre-spawn startup revokes the host without starting Claude', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const claudeBinary = await fakeClaude(f.root);
  const owner = await ownerProcess(t, f, 'startup', claudeBinary);
  owner.child.kill('SIGTERM');
  await waitUntil(() => owner.done, 'launcher did not finish cancelled startup');
  assert.equal((await owner.closed).code, 143);
  assert.equal(await acceptsConnections(join(f.runtime, 'native.sock')), false);
  await assert.rejects(readFile(join(f.cwd, 'child-audit.json')), { code: 'ENOENT' });
});

test('one group SIGINT reaches Claude once; SIGTERM revokes despite a stuck Claude child', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const claudeBinary = await fakeClaude(f.root, { linger: true });
  const owner = await ownerProcess(t, f, 'interactive', claudeBinary);
  await waitUntil(async () => {
    try { await readFile(join(f.cwd, 'child-audit.json')); return true; } catch { return false; }
  }, 'Claude fixture did not start');
  process.kill(-owner.child.pid, 'SIGINT');
  await waitUntil(async () => {
    try { return await readFile(join(f.cwd, 'interrupt-count.txt'), 'utf8') === '1'; } catch { return false; }
  }, 'Claude did not receive its single foreground interrupt');
  await delay(100);
  assert.equal(await readFile(join(f.cwd, 'interrupt-count.txt'), 'utf8'), '1');
  assert.equal(await acceptsConnections(join(f.runtime, 'native.sock')), true);
  owner.child.kill('SIGTERM');
  await waitUntil(async () => !(await acceptsConnections(join(f.runtime, 'native.sock'))),
    'host was not revoked while Claude ignored SIGTERM', 2000);
  await waitUntil(() => owner.done, 'launcher did not enforce the bounded Claude shutdown', 6000);
  assert.equal((await owner.closed).code, 143);
});
