// Test-only fake Claude. Uses real command Hook, stdio MCP and product UDS;
// it never invokes a model or changes user configuration.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const prefix = 'BLABEE_CLAUDE_SESSION_V2_';
const nativeID = process.env[`${prefix}NATIVE_SESSION_ID`];
const cwd = process.env[`${prefix}CWD`];
const settings = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const mcp = JSON.parse(readFileSync(process.argv[3], 'utf8')).mcpServers['blabee-claude'];
let phase = 'startup';
let child;
let childClosed;
let nextID = 0;
const replies = new Map();
const notifications = [];
let pendingText = '';
let wireFailed = false;
const waitFor = async read => {
  const deadline = Date.now() + 10_000;
  while (true) {
    const result = read();
    if (result !== undefined) return result;
    if (wireFailed || Date.now() >= deadline) throw new Error('fixture_timeout');
    await new Promise(resolveWait => setTimeout(resolveWait, 5));
  }
};
const send = value => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const request = async (method, params) => {
  const id = ++nextID;
  send({ id, method, params });
  const value = await waitFor(() => replies.get(id));
  replies.delete(id);
  assert.equal(value.error, undefined);
  return value.result;
};
const tool = async (name, arguments_ = {}) => {
  const result = await request('tools/call', { name, arguments: arguments_ });
  assert.notEqual(result.isError, true);
  const decoded = JSON.parse(result.content[0].text);
  assert.equal(decoded.ok, true);
  return decoded.result;
};
function hook(hook_event_name, extra = {}) {
  const configuration = settings.hooks[hook_event_name][0].hooks[0];
  assert.equal(configuration.type, 'command');
  const result = spawnSync(configuration.command, configuration.args, {
    env: process.env, input: JSON.stringify({ session_id: nativeID, cwd, hook_event_name, ...extra }),
    encoding: 'utf8', timeout: 8000, maxBuffer: 32 * 1024,
  });
  assert.equal(result.status, 0);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

try {
  for (const role of ['OWNER', 'SELECTOR', 'CONTROL']) assert.ok(!process.env[`${prefix}${role}_TOKEN`]);
  hook('SessionStart', { source: 'startup' });
  const initialPrompt = randomUUID();
  const initial = hook('UserPromptSubmit', { prompt_id: initialPrompt, prompt: 'Test the installed session bridge.' });
  const boundary = initial.hookSpecificOutput.additionalContext.match(/boundary_id=([a-f0-9-]{36})/)?.[1];
  assert.ok(boundary);
  phase = 'mcp_initialize';
  // Stdio MCP clients need not pass their entire parent environment. Expand
  // only the generated server env on top of non-Blabee defaults.
  const mcpEnvironment = Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'LANG', 'USER']
    .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(mcp.env)) {
    mcpEnvironment[name] = value.replace(/\$\{([^}]+)\}/g, (_, key) => {
      assert.equal(typeof process.env[key], 'string');
      return process.env[key];
    });
  }
  child = spawn(mcp.command, mcp.args, {
    env: mcpEnvironment, cwd, stdio: ['pipe', 'pipe', 'pipe'],
  });
  childClosed = new Promise(resolveClose => child.once('close', resolveClose));
  child.stderr.resume();
  child.once('error', () => { wireFailed = true; });
  child.stdout.on('data', chunk => {
    pendingText += chunk.toString('utf8');
    if (pendingText.length > 256 * 1024) { wireFailed = true; return; }
    let newline;
    while ((newline = pendingText.indexOf('\n')) >= 0) {
      try {
        const value = JSON.parse(pendingText.slice(0, newline));
        if (value.id !== undefined) replies.set(value.id, value);
        else notifications.push(value);
        if (notifications.length > 8) wireFailed = true;
      } catch { wireFailed = true; }
      pendingText = pendingText.slice(newline + 1);
    }
  });
  const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'cp05-automated-fixture', version: '1' } });
  assert.ok(initialized.capabilities.experimental['claude/channel']);
  send({ method: 'notifications/initialized' });
  const listed = await request('tools/list', {});
  assert.deepEqual(listed.tools.map(value => value.name), ['check_connection_v1', 'ack_readiness_probe_v1',
    'emit_decision_v1', 'claim_selection_v1', 'complete_selection_v1']);
  phase = 'readiness';
  const probe = await tool('check_connection_v1');
  const notification = await waitFor(() => notifications.find(value => value.method === 'notifications/claude/channel'
    && value.params?.meta?.probe_id === probe.probe_id));
  assert.equal(notification.params.meta.probe_id, probe.probe_id);
  const values = JSON.parse(notification.params.content.split('\n').at(-1));
  const promptID = randomUUID();
  const wrapper = `<channel source="blabee-claude" kind="readiness_probe" probe_id="${probe.probe_id}">\n${notification.params.content}\n</channel>`;
  const observed = hook('UserPromptSubmit', { prompt_id: promptID, prompt: wrapper });
  assert.ok(observed.hookSpecificOutput.additionalContext.includes(`boundary_id=${boundary}`));
  assert.equal((await tool('ack_readiness_probe_v1', values)).acknowledged, true);
  phase = 'proposal';
  const packet = await tool('emit_decision_v1', { boundary_id: boundary, proposal: {
    proposal_id: randomUUID(), task_goal: 'Exercise the installed product bridge.',
    outcome: { status: 'completed', summary: 'The fixture acknowledged its Channel.' }, reported_side_effects: [],
    options: ['a', 'b'].map(id => ({ id, title: `Read ${id}`, description: `Inspect ${id}`,
      task: `Read fixture ${id}`, constraints: ['Do not modify files.'], done_when: 'Report the observed value.' })),
  } });
  assert.equal(packet.revision, 1);
  assert.match(packet.packet_id, /^claude_packet_/);
  hook('Stop', { prompt_id: promptID, background_tasks: [], session_crons: [] });
  phase = 'compact';
  const compact = hook('SessionStart', { source: 'compact', prompt_id: promptID });
  const newBoundary = compact.hookSpecificOutput.additionalContext.match(/boundary_id=([a-f0-9-]{36})/)?.[1];
  assert.ok(newBoundary && newBoundary !== boundary);
  hook('StopFailure', { prompt_id: promptID, error: 'server_error' });
  phase = 'session_end';
  hook('SessionEnd');
  process.stdout.write(JSON.stringify({ ok: true, hookEvents: 5, tools: 5, channelAcknowledged: true,
    proposalSaved: true, compactRebound: true, sessionEnded: true, realModel: false }) + '\n');
} catch {
  process.stderr.write(`[cp05-fixture] failed:${phase}\n`);
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
