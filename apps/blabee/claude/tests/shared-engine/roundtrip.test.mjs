import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../../src/shared/identity.mjs';
import { startSharedCore } from '../../src/bridge/shared-core-client.mjs';

const executable = process.env.BLABEE_CLAUDE_SHARED_CORE_FIXTURE;
assert.ok(executable, 'Run npm run test:shared-engine to build the real Swift fixture first');

async function runtime(t) {
  const path = await realpath(await mkdtemp(join(PROJECT_ROOT, 'build/shared-roundtrip-')));
  const clients = [];
  const start = async () => {
    const client = await startSharedCore({ executable, fixtureRuntime: path });
    clients.push(client);
    // A short request must return while stdin stays open, before any large
    // activation frame. This catches buffered reads waiting for 4096 bytes/EOF.
    const initial = await client.request({ operation: 'snapshot' });
    assert.ok(Array.isArray(initial.cards));
    return client;
  };
  t.after(async () => { for (const client of clients) await client.close(); await rm(path, { recursive: true, force: true }); });
  return { path, start, client: await start() };
}

function binding(sessionID = randomUUID()) {
  // The fixture supplies an observed native prompt ID. The turn ID is explicitly
  // a Blabee internal identity; it is never presented as a Claude native turn.
  const nativePromptID = randomUUID();
  return {
    project_id: 'project_shared_core_fixture', session_id: sessionID,
    source_turn_id: `blabee_turn_${randomUUID()}`, source_prompt_id: nativePromptID,
    episode_id: `episode_${randomUUID()}`, episode_root_prompt_id: nativePromptID,
    episode_baseline_checkpoint_id: `checkpoint_${randomUUID()}`,
    decision_boundary_id: `boundary_${randomUUID()}`, boundary_sequence: 1,
  };
}

function proposal(label = 'A/B') {
  return {
    proposal_id: randomUUID(), task_goal: '공통 Swift 엔진과 Claude 연결을 검증한다.',
    outcome: { status: 'completed', summary: `${label} 테스트 준비 완료. 실행 결과를 아직 보고하지 않았다.` },
    reported_side_effects: [],
    options: ['a', 'b'].map(id => ({ id: `${label.replace('/', '-')}-${id}`, title: `선택 ${id}`,
      description: `${id} 선택의 원래 설명`, task: `선택 ${id}의 검증 파일에 표식을 한 번 기록한다.`,
      constraints: ['선택한 작업만 실행한다.'], done_when: `선택 ${id}의 파일 내용을 확인한다.` })),
  };
}

function stableSnapshot(snapshot) {
  // The real engine uses a continuous clock. A read must not be mistaken for a
  // mutation merely because the same pending card's countdown decreased.
  return JSON.parse(JSON.stringify(snapshot, (key, value) => key === 'milliseconds_until_expiry' ? undefined : value));
}

async function activate(client, sourceBinding, input = proposal()) {
  const card = await client.request({ operation: 'activate', binding: sourceBinding, proposal: input });
  assert.deepEqual(card.claude_proposal, input);
  assert.deepEqual(card.packet.evidence, []);
  assert.equal(card.packet.session_id, sourceBinding.session_id);
  assert.equal(card.packet.source_prompt_id, sourceBinding.source_prompt_id);
  assert.equal(card.option_bindings.length, 2);
  return card;
}

async function select(client, sourceBinding, card) {
  const selectionID = randomUUID();
  const selected = await client.request({ operation: 'select', binding: sourceBinding,
    packet_id: card.packet.packet_id, revision: card.packet.revision,
    selection_id: selectionID, option_id: card.option_bindings[0].option_id });
  assert.equal(selected.selection_id, selectionID);
  return selectionID;
}

test('real Node to Swift to SQLite roundtrip preserves old A result and new C/D card', async t => {
  const { path, client } = await runtime(t);
  const a = binding();
  const oldProposal = proposal();
  const first = await activate(client, a, oldProposal);
  const selectionID = await select(client, a, first);
  const claimed = await client.request({ operation: 'claim', binding: a, selection_id: selectionID });
  assert.deepEqual(claimed.option, oldProposal.options[0]);
  await assert.rejects(client.request({ operation: 'claim', binding: a, selection_id: selectionID }));
  const resultPath = join(path, 'selected-a.txt');
  await writeFile(resultPath, 'BLABEE_SHARED_CORE_A_OK\n', { flag: 'wx' });
  assert.equal(await readFile(resultPath, 'utf8'), 'BLABEE_SHARED_CORE_A_OK\n');

  const next = binding(a.session_id);
  const second = await activate(client, next, proposal('C/D'));
  const before = await client.request({ operation: 'snapshot' });
  const latestBefore = before.cards.find(card => card.packet.packet_id === second.packet.packet_id);
  assert.ok(latestBefore);
  await assert.rejects(client.request({ operation: 'complete', binding: { ...a, session_id: randomUUID() },
    selection_id: selectionID, outcome: 'completed', note: 'wrong session' }));
  const completed = await client.request({ operation: 'complete', binding: a, selection_id: selectionID,
    outcome: 'completed', note: 'selected-a.txt: BLABEE_SHARED_CORE_A_OK' });
  assert.equal(completed.recorded, true);
  assert.equal(completed.reported_by, 'model');
  const after = await client.request({ operation: 'snapshot' });
  assert.deepEqual(after.cards.find(card => card.packet.packet_id === second.packet.packet_id), latestBefore);
  assert.ok(after.outcomes.some(item => item.selection_id === selectionID && item.reported_by === 'model'));
  await assert.rejects(client.request({ operation: 'complete', binding: a, selection_id: selectionID,
    outcome: 'failed', note: 'must not replace first result' }));
  const nextSelection = await select(client, next, second);
  assert.equal((await client.request({ operation: 'claim', binding: next, selection_id: nextSelection })).selection_id, nextSelection);
});

test('separate engine contexts allow equal native IDs without sharing selection rights', async t => {
  const first = await runtime(t);
  const second = await runtime(t);
  const same = binding();
  const a = await activate(first.client, same);
  await activate(second.client, same, proposal('independent'));
  const selectionID = await select(first.client, same, a);
  const before = await second.client.request({ operation: 'snapshot' });
  await assert.rejects(second.client.request({ operation: 'claim', binding: same, selection_id: selectionID }));
  assert.deepEqual(stableSnapshot(await second.client.request({ operation: 'snapshot' })), stableSnapshot(before));
  assert.equal((await first.client.request({ operation: 'claim', binding: same, selection_id: selectionID })).selection_id, selectionID);
});

test('restarting a fixture cannot restore an old selected action execution right', async t => {
  const host = await runtime(t);
  const original = binding();
  const card = await activate(host.client, original);
  const selectionID = await select(host.client, original, card);
  await host.client.close();
  const replacement = await host.start();
  await assert.rejects(replacement.request({ operation: 'claim', binding: original, selection_id: selectionID }));
});

test('missing outcome and constraints are rejected rather than filled in by the bridge', async t => {
  const { client } = await runtime(t);
  const noOutcome = proposal();
  delete noOutcome.outcome;
  await assert.rejects(client.request({ operation: 'activate', binding: binding(), proposal: noOutcome }));
  const noConstraints = proposal();
  delete noConstraints.options[0].constraints;
  await assert.rejects(client.request({ operation: 'activate', binding: binding(), proposal: noConstraints }));
  assert.equal((await client.request({ operation: 'snapshot' })).cards.length, 0);
});
