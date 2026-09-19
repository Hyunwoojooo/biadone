import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startCoordinator } from '../src/coordinator/service.mjs';
import { request } from '../src/shared/client.mjs';
import { PROJECT_ROOT } from '../src/shared/identity.mjs';

async function until(operation, predicate, timeout = 4000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await operation();
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (Date.now() < deadline);
  throw new Error('protocol fixture timed out');
}

async function runHook(binding, event, promptID, prompt) {
  const child = spawn(process.execPath, [join(PROJECT_ROOT, 'src/bridge/hook.mjs'), '--expected-session-id', binding.session_id], {
    cwd: PROJECT_ROOT, env: binding.env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '', errorOutput = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errorOutput += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code));
  });
  child.stdin.end(JSON.stringify({ hook_event_name: event, session_id: binding.session_id, cwd: PROJECT_ROOT,
    ...(promptID ? { prompt_id: promptID } : {}), ...(prompt !== undefined ? { prompt } : {}) }));
  assert.equal(await done, 0, errorOutput);
  assert.equal(errorOutput, '');
  return output ? JSON.parse(output) : null;
}

function toolResult(response) {
  return JSON.parse(response.content.find(content => content.type === 'text').text);
}

for (const completeAfterNewInput of [false, true]) test(completeAfterNewInput
  ? 'actual SDK completion after a new user Hook records the original result without changing the new card'
  : 'separate Hook processes and actual SDK stdio preserve a selection across its Channel prompt and complete it', { timeout: 15000 }, async t => {
  await mkdir(join(PROJECT_ROOT, 'build'), { recursive: true });
  const runtime = await mkdtemp(join(PROJECT_ROOT, 'build/rt-'));
  const uiToken = randomBytes(32).toString('hex');
  const service = await startCoordinator({ runtime, uiToken });
  const clients = [];
  t.after(async () => {
    for (const client of clients) await client.close();
    await service.close();
    await rm(runtime, { recursive: true, force: true });
  });
  const ui = (type, payload = {}) => request(type, payload, { runtime, auth: uiToken });
  async function session() {
    const session_id = randomUUID();
    const registration = await request('session.register', { session_id, cwd: PROJECT_ROOT }, { runtime });
    const env = { PATH: process.env.PATH, BLABEE_CLAUDE_SESSION_ID: session_id,
      BLABEE_CLAUDE_SESSION_TOKEN: registration.session_token, BLABEE_CLAUDE_RUNTIME: runtime };
    const binding = { session_id, env, prompt_id: randomUUID() };
    const initial = await runHook(binding, 'SessionStart');
    assert.match(initial.hookSpecificOutput.additionalContext, /boundary/);
    const context = await runHook(binding, 'UserPromptSubmit', binding.prompt_id);
    binding.boundary_id = context.hookSpecificOutput.additionalContext.match(/boundary_id=([0-9a-f-]+)/)[1];
    const client = new Client({ name: 'blabee-protocol-test', version: '1' }, { capabilities: {} });
    const events = [];
    client.fallbackNotificationHandler = notification => {
      if (notification.method === 'notifications/claude/channel') events.push(notification);
    };
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(PROJECT_ROOT, 'src/bridge/mcp.mjs')], env, stderr: 'pipe' });
    await client.connect(transport);
    clients.push(client);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['ack_readiness_probe', 'check_connection', 'claim_selection', 'complete_selection', 'emit_decision']);
    assert.deepEqual(client.getServerCapabilities().experimental, { 'claude/channel': {} });
    await until(() => ui('ui.list'), result => result.sessions.find(item => item.session_id === session_id)?.connected);
    const visible = (await ui('ui.list')).sessions.find(item => item.session_id === session_id);
    assert.equal(visible.continuation_ready, false, 'MCP initialization and heartbeat are not channel receipt');
    return { ...binding, client, events };
  }
  const first = await session();
  const second = await session();
  const options = [
    { id: 'verify', title: '격리 확인', description: '선택한 세션에서 완료 표식을 보고합니다.', task: 'Report BLABEE_CLAUDE_PROTOCOL_OK.', done_when: 'The isolated protocol fixture receives the marker.' },
    { id: 'pause', title: '대기', description: '추가 변경 없이 대기합니다.', task: 'Report paused without modifying files.', done_when: 'Paused is reported.' },
  ];
  const proposal = toolResult(await first.client.callTool({ name: 'emit_decision', arguments: {
    boundary_id: first.boundary_id, summary: 'Protocol test next choices', options,
  } }));
  assert.equal(proposal.ok, true);
  const click = { session_id: first.session_id, ...proposal.result, option_id: 'verify' };
  await assert.rejects(ui('ui.select', click), error => error.code === 'not_ready');
  await runHook(first, 'Stop', first.prompt_id);
  await assert.rejects(ui('ui.select', click), error => error.code === 'channel_unverified');
  const check = toolResult(await first.client.callTool({ name: 'check_connection', arguments: {} }));
  assert.equal(check.ok, true);
  assert.equal(check.result.status, 'awaiting_ack');
  assert.equal(check.result.nonce, undefined, 'the initiating tool cannot echo the channel nonce');
  await until(async () => first.events, events => events.some(event => event.params.meta.probe_id === check.result.probe_id));
  const probe = first.events.find(event => event.params.meta.probe_id === check.result.probe_id);
  const probeReference = JSON.parse(probe.params.content.split('\n').at(-1));
  const beforeAck = (await ui('ui.list')).sessions.find(item => item.session_id === first.session_id);
  assert.equal(beforeAck.continuation_ready, false, 'notification write alone cannot enable selection');
  assert.equal(beforeAck.boundary_id, first.boundary_id, 'probe must not create a task boundary');
  assert.equal(beforeAck.packet.packet_id, proposal.result.packet_id, 'probe must not replace a proposal');
  assert.equal(beforeAck.selection, undefined, 'probe must not select or claim work');
  const wrongProbeSession = await second.client.callTool({ name: 'ack_readiness_probe', arguments: probeReference });
  assert.equal(wrongProbeSession.isError, true);
  const ack = toolResult(await first.client.callTool({ name: 'ack_readiness_probe', arguments: probeReference }));
  assert.equal(ack.result.ready, true);
  assert.equal((await ui('ui.list')).sessions.find(item => item.session_id === first.session_id).continuation_ready, true);
  const replayAck = await first.client.callTool({ name: 'ack_readiness_probe', arguments: probeReference });
  assert.equal(replayAck.isError, true);
  const selected = await ui('ui.select', click);
  await assert.rejects(ui('ui.select', click));
  await until(async () => first.events, events => events.some(event => event.params.meta.selection_id === selected.selection_id));
  const event = first.events.find(event => event.params.meta.selection_id === selected.selection_id);
  assert.equal(event.params.meta.selection_id, selected.selection_id);
  assert.equal(second.events.length, 0, 'other session must not receive the selection');
  assert.ok(!event.params.content.includes(options[0].task), 'channel carries a ref, not executable task text');
  const reference = JSON.parse(event.params.content.split('\n').at(-1));
  // Claude 2.1.276 also invokes UserPromptSubmit for the received Channel turn.
  // Use the observed message wrapper and a new native prompt ID before claim.
  const selectionPrompt = `<channel source="blabee-claude" selection_id="${selected.selection_id}">\n${event.params.content}\n</channel>`;
  const continuationPromptID = randomUUID();
  const continuation = await runHook(first, 'UserPromptSubmit', continuationPromptID, selectionPrompt);
  assert.match(continuation.hookSpecificOutput.additionalContext, new RegExp(`boundary_id=${first.boundary_id}`));
  first.prompt_id = continuationPromptID;
  const delivered = (await ui('ui.list')).sessions.find(item => item.session_id === first.session_id);
  assert.equal(delivered.selection.status, 'delivered', 'the selection Channel must not invalidate its own pending selection');
  assert.equal(delivered.packet.packet_id, proposal.result.packet_id);
  assert.equal(delivered.prompt_id, continuationPromptID, 'record the native Channel turn without inventing an ID');
  const wrongSession = await second.client.callTool({ name: 'claim_selection', arguments: reference });
  assert.equal(wrongSession.isError, true);
  const claim = toolResult(await first.client.callTool({ name: 'claim_selection', arguments: reference }));
  assert.equal(claim.ok, true);
  assert.equal(claim.result.task, options[0].task);
  assert.equal(claim.result.done_when, options[0].done_when);
  assert.notEqual(claim.result.boundary_id, first.boundary_id);
  assert.equal(claim.result.prompt_id, first.prompt_id, 'peer delivery must not forge a native prompt ID');
  const duplicate = await first.client.callTool({ name: 'claim_selection', arguments: reference });
  assert.equal(duplicate.isError, true);
  let newerCard;
  if (completeAfterNewInput) {
    first.prompt_id = randomUUID();
    const newerContext = await runHook(first, 'UserPromptSubmit', first.prompt_id, 'Start a new task without restarting the previous selection.');
    first.boundary_id = newerContext.hookSpecificOutput.additionalContext.match(/boundary_id=([0-9a-f-]+)/)[1];
    const newerProposal = toolResult(await first.client.callTool({ name: 'emit_decision', arguments: {
      boundary_id: first.boundary_id, summary: 'New task awaiting its own selection', options,
    } }));
    assert.equal(newerProposal.ok, true);
    await runHook(first, 'Stop', first.prompt_id);
    newerCard = (await ui('ui.list')).sessions.find(item => item.session_id === first.session_id);
    assert.equal(newerCard.phase, 'ready', 'a superseded claim must not block the new task');
    assert.equal(newerCard.packet.packet_id, newerProposal.result.packet_id);
    assert.equal(newerCard.selection, undefined);
    const wrongCompletion = await second.client.callTool({ name: 'complete_selection', arguments: {
      selection_id: selected.selection_id, outcome: 'completed', note: 'Another session cannot report this result.',
    } });
    assert.equal(wrongCompletion.isError, true);
  }
  const complete = toolResult(await first.client.callTool({ name: 'complete_selection', arguments: {
    selection_id: selected.selection_id, outcome: 'completed', note: 'BLABEE_CLAUDE_PROTOCOL_OK: protocol fixture, not a live Claude model run',
  } }));
  assert.deepEqual(complete.result, { recorded: true, reported_by: 'model' });
  if (completeAfterNewInput) {
    const rewrite = await first.client.callTool({ name: 'complete_selection', arguments: {
      selection_id: selected.selection_id, outcome: 'failed', note: 'A duplicate must not replace the recorded result.',
    } });
    assert.equal(rewrite.isError, true);
    assert.deepEqual((await ui('ui.list')).sessions.find(item => item.session_id === first.session_id), newerCard);
  } else {
    await runHook(first, 'Stop', first.prompt_id);
    const visible = (await ui('ui.list')).sessions.find(item => item.session_id === first.session_id);
    assert.equal(visible.selection.status, 'completed');
    assert.equal(visible.selection.reported_by, 'model');
  }
  const journal = await readFile(join(runtime, 'journal.json'), 'utf8');
  const outcomes = JSON.parse(journal).history.filter(item => item.type === 'selection.completed' && item.selection_id === selected.selection_id);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].outcome, 'completed');
  assert.equal(outcomes[0].reported_by, 'model');
  assert.ok(!journal.includes(uiToken));
  assert.ok(!journal.includes(first.env.BLABEE_CLAUDE_SESSION_TOKEN));
  assert.ok(!journal.includes(reference.delivery_token));
  assert.ok(!journal.includes(probeReference.nonce));
  await runHook(first, 'SessionEnd', first.prompt_id);
  await runHook(second, 'SessionEnd', second.prompt_id);
});
