// Opt-in visible-window qualification. A harness supplies Hook/model messages;
// a human/computer-use click must select A in the actual shared Pet panel.
// It never starts Claude, accesses production freshness, or selects by API.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PROJECT_ROOT } from '../../src/shared/identity.mjs';
import { startSharedRuntime } from '../../src/bridge/shared-launcher.mjs';
import { createNativeSessionClient } from '../../src/bridge/native-session-client.mjs';

assert.equal(process.argv.length, 3, 'Pass the test-harness common coordinator executable.');
const binary = resolve(process.argv[2]);
const root = await realpath(await mkdtemp(join(PROJECT_ROOT, 'build/pu-')));
const cwd = join(root, 'project');
const runtime = join(root, 'runtime');
await mkdir(cwd, { mode: 0o700 });
await mkdir(runtime, { mode: 0o700 });
let host, hook, bridge;
let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });
process.stdin.once('data', () => { stopping = true; });
process.stdin.resume();
const until = Date.now() + 180_000;

try {
  host = await startSharedRuntime({ coordinatorBinary: binary, contractsDirectory: join(PROJECT_ROOT, '../Contracts/v1'),
    runtime, cwd, fixture: true, pet: true });
  const base = { socketPath: host.socketPath, runtimeIdentity: host.runtimeIdentity,
    scopeID: host.scopeID, sessionID: host.sessionID };
  hook = await createNativeSessionClient({ ...base, role: 'hook', authToken: host.hookEnvironment.BLABEE_CLAUDE_SHARED_HOOK_TOKEN });
  bridge = await createNativeSessionClient({ ...base, role: 'bridge', authToken: host.mcpEnvironment.BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN });
  const observe = (event, fields = {}) => hook.request({ operation: 'hook', event, session_id_native: host.sessionID, cwd, ...fields });
  const prompt = async text => {
    const id = randomUUID();
    const result = await observe('UserPromptSubmit', { prompt_id: id, prompt_sha256: createHash('sha256').update(text).digest('hex') });
    return { id, boundary: result.boundary_id };
  };
  await observe('SessionStart', { source: 'startup' });
  const first = await prompt('Shared Pet visible-window qualification.');
  const { bridge_id } = await bridge.request({ operation: 'bridge.open' });
  const call = (operation, fields = {}) => bridge.request({ operation, bridge_id, ...fields });
  await call('readiness.begin');
  const { event: probe } = await call('bridge.poll');
  assert.equal(probe.kind, 'readiness_probe');
  await call('readiness.ack', { probe_id: probe.probe_id, nonce: probe.nonce });
  const proposal = (suffix, title) => ({ proposal_id: randomUUID(), task_goal: 'Qualify the shared Pet button and native selection path.',
    outcome: { status: 'completed', summary: title }, reported_side_effects: [],
    options: [
      { id: 'a' + suffix, title: 'A · 선택 연결 확인', description: '격리된 테스트 폴더에 A 표식을 기록합니다.',
        task: 'Write the A qualification marker in this isolated test project.', done_when: 'The A marker is present.', constraints: ['Only the isolated test project.'] },
      { id: 'b' + suffix, title: 'B · 대안 확인', description: '다른 선택지 전달을 위한 테스트 항목입니다.',
        task: 'Report the B qualification selection.', done_when: 'B is reported.', constraints: ['Do not modify product files.'] },
    ] });
  const offered = await call('proposal.emit', { boundary_id: first.boundary,
    proposal: proposal('', '공통 Pet UI 연결 테스트 · A를 선택하세요') });
  await observe('Stop', { prompt_id: first.id });
  console.log(JSON.stringify({ stage: 'awaiting_ui_click', root, cwd, packet_id: offered.packet_id }));
  let selected;
  while (!stopping && Date.now() < until) {
    const { event } = await call('bridge.poll');
    if (event?.kind === 'selection') { selected = event; break; }
    await delay(400);
  }
  assert.ok(selected, 'No actual Pet selection received before cancellation/deadline.');
  await prompt(selected.content);
  const claimed = await call('selection.claim', { selection_id: selected.selection_id, delivery_token: selected.delivery_token });
  assert.equal(claimed.action.id, 'a');
  await writeFile(join(cwd, 'ui-a.txt'), 'BLABEE_SHARED_PET_A_OK\n', { flag: 'wx' });
  const next = await prompt('Preserve a new card while the original A is reported.');
  const successor = await call('proposal.emit', { boundary_id: next.boundary,
    proposal: proposal('-next', '새 선택지 유지 · 이전 A 결과 확인') });
  await observe('Stop', { prompt_id: next.id });
  await call('selection.complete', { selection_id: selected.selection_id, outcome: 'completed', note: 'ui-a.txt: BLABEE_SHARED_PET_A_OK (test harness report)' });
  const state = await host.selectorClient.request({ operation: 'snapshot' });
  assert.equal(state.cards.length, 1);
  assert.equal(state.cards[0].packet.packet_id, successor.packet_id);
  const outcome = state.outcomes.find(value => value.selection_id === selected.selection_id);
  assert.equal(outcome.reported_by, 'model');
  assert.equal(outcome.status, 'succeeded');
  const evidence = { schema_version: 'blabee.claude-pet-ui-qualification.v1', model: 'harness',
    selection_input: 'actual_pet_button', initial_packet: offered.packet_id, selection_id: selected.selection_id,
    successor_packet: successor.packet_id, outcome, marker: await readFile(join(cwd, 'ui-a.txt'), 'utf8') };
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ stage: 'ui_roundtrip_passed', evidence: join(root, 'evidence.json') }));
  while (!stopping && Date.now() < until) { await call('bridge.poll'); await delay(400); }
} finally {
  await Promise.allSettled([hook?.close(), bridge?.close()]);
  await host?.close();
  process.stdin.pause();
}
