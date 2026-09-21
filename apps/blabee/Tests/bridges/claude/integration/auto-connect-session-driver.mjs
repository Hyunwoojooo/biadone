// Fake Claude protocol peer, invoked inside an owned real PTY. The production
// auto Hook, MCP SDK, bootstrap and session sockets are used without a model.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [settingsPath, mcpPath, source] = process.argv.slice(2);
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const mcp = JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers['blabee-claude'];
const nativeID = process.env.CLAUDE_CODE_SESSION_ID;
const cwd = process.env.BLABEE_CLAUDE_BOOTSTRAP_CWD;
let phase = 'initialize';
let child, childClosed;
let nextID = 0, pendingText = '', failed = false;
const replies = new Map(), notifications = [];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async read => {
  const deadline = Date.now() + 10_000;
  while (true) {
    const value = read();
    if (value !== undefined) return value;
    if (failed || Date.now() >= deadline) throw new Error('fixture_timeout');
    await delay(5);
  }
};
const send = value => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const request = async (method, params) => {
  const id = ++nextID;
  send({ id, method, params });
  const response = await waitFor(() => replies.get(id));
  replies.delete(id);
  assert.equal(response.error, undefined);
  return response.result;
};
const tool = async (name, args = {}) => {
  const response = await request('tools/call', { name, arguments: args });
  assert.notEqual(response.isError, true);
  const body = JSON.parse(response.content[0].text);
  assert.equal(body.ok, true);
  return body.result;
};
const hook = (event, extra = {}) => {
  const configuration = settings.hooks[event][0].hooks[0];
  assert.ok(configuration.args[0].endsWith('/auto-connect-hook.mjs'));
  assert.equal(configuration.args.length, 1);
  const result = spawnSync(configuration.command, configuration.args, { env: process.env, cwd,
    input: JSON.stringify({ hook_event_name: event, session_id: nativeID, cwd, ...extra }),
    encoding: 'utf8', timeout: 12_000, maxBuffer: 32 * 1024 });
  assert.equal(result.status, 0);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};

try {
  assert.match(nativeID, /^[a-f0-9-]{36}$/);
  assert.ok(!Object.keys(process.env).some(key => key.startsWith('BLABEE_CLAUDE_SESSION_V2_')));
  const environment = Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'LANG', 'USER']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  // Claude injects its current session dynamically, before applying the MCP
  // server env. That env must never override the selected conversation ID.
  environment.CLAUDE_CODE_SESSION_ID = nativeID;
  assert.equal(Object.hasOwn(mcp.env, 'CLAUDE_CODE_SESSION_ID'), false);
  for (const [key, value] of Object.entries(mcp.env)) {
    environment[key] = value.replace(/\$\{([^}]+)\}/g, (_, name) => {
      assert.equal(typeof process.env[name], 'string');
      return process.env[name];
    });
  }
  assert.equal(environment.BLABEE_CLAUDE_BOOTSTRAP_HOOK_TOKEN, '');
  assert.ok(mcp.args[0].endsWith('/auto-connect-mcp.mjs'));
  child = spawn(mcp.command, mcp.args, { env: environment, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  childClosed = new Promise(resolve => child.once('close', resolve));
  child.stderr.resume();
  child.once('error', () => { failed = true; });
  child.stdout.on('data', chunk => {
    pendingText += chunk.toString('utf8');
    if (pendingText.length > 256 * 1024) { failed = true; return; }
    let index;
    while ((index = pendingText.indexOf('\n')) >= 0) {
      try {
        const value = JSON.parse(pendingText.slice(0, index));
        if (value.id !== undefined) replies.set(value.id, value); else notifications.push(value);
        if (notifications.length > 8) failed = true;
      } catch { failed = true; }
      pendingText = pendingText.slice(index + 1);
    }
  });
  const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'blabee-auto-connect-fixture', version: '1' } });
  assert.ok(initialized.capabilities.experimental['claude/channel']);
  send({ method: 'notifications/initialized' });
  const listed = await request('tools/list', {});
  assert.equal(listed.tools.length, 5);
  const before = await request('tools/call', { name: 'check_connection_v1', arguments: {} });
  assert.equal(before.isError, true);
  assert.equal(JSON.parse(before.content[0].text).error.code, 'session_v2_bridge_not_registered');
  phase = 'picker';
  if (source === 'picker-cancel') {
    // Exceeds the previous eager handshake window without creating authority.
    await delay(6200);
    const pending = await request('tools/call', { name: 'check_connection_v1', arguments: {} });
    assert.equal(pending.isError, true);
    assert.equal(JSON.parse(pending.content[0].text).error.code, 'session_v2_bridge_not_registered');
    process.stdout.write(JSON.stringify({ source, mcpInitializedWhilePending: true,
      cancelledWithoutRegistration: true, realModel: false }) + '\n');
  } else {
    phase = 'start';
    const initial = hook('SessionStart', { source });
    assert.ok(initial.hookSpecificOutput.additionalContext.includes('boundary'));
    assert.ok(!/boundary_id=[a-f0-9-]{36}/.test(initial.hookSpecificOutput.additionalContext));
    const prompt = hook('UserPromptSubmit', { prompt_id: randomUUID(), prompt: 'Observe a newly authorized native session.' });
    const boundary = prompt.hookSpecificOutput.additionalContext.match(/boundary_id=([a-f0-9-]{36})/)?.[1];
    assert.ok(boundary);
    await delay(400);
    phase = 'readiness';
    const probe = await tool('check_connection_v1');
    const notification = await waitFor(() => notifications.find(value => value.method === 'notifications/claude/channel'
      && value.params?.meta?.probe_id === probe.probe_id));
    const values = JSON.parse(notification.params.content.split('\n').at(-1));
    const wrapper = `<channel source="blabee-claude" kind="readiness_probe" probe_id="${probe.probe_id}">\n${notification.params.content}\n</channel>`;
    const observed = hook('UserPromptSubmit', { prompt_id: randomUUID(), prompt: wrapper });
    assert.ok(observed.hookSpecificOutput.additionalContext.includes(`boundary_id=${boundary}`));
    assert.equal((await tool('ack_readiness_probe_v1', values)).acknowledged, true);
    phase = 'end';
    hook('SessionEnd');
    process.stdout.write(JSON.stringify({ source, mcpInitializedWhilePending: true,
      nativeIdentityPreserved: true, channelAcknowledged: true, freshBoundary: true, realModel: false }) + '\n');
  }
} catch {
  process.stderr.write(`[auto-connect-fixture] failed:${phase}\n`);
  process.exitCode = 1;
} finally {
  if (child) {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    timer.unref();
    await childClosed;
    clearTimeout(timer);
  }
}
