import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { FakeClock, LIMITS, RewakeFixture } from './fixture.mjs';

function setup(t) {
  const fixture = RewakeFixture.create();
  t.after(() => fixture.dispose());
  return fixture;
}

async function card(fixture, sessionId = 'test-a', cwd) {
  const auth = await fixture.openTestSession({ sessionId, cwd });
  const generation = await fixture.observeSyntheticPrompt(auth.hook, 'test-prompt-1');
  await fixture.ackTestReadiness(auth.bridge);
  const packet = await fixture.offer(auth.bridge, {
    generation, choices: [{ id: 'one', marker: 'FIRST' }, { id: 'two', marker: 'SECOND' }],
  });
  await fixture.observeSyntheticStop(auth.hook, generation);
  return { auth, packet, sessionId };
}

async function notified(fixture, context, choice = 'one') {
  const waiter = await fixture.arm(context.auth.hook, context.packet);
  const receipt = await fixture.select(context.auth.selector, context.packet, choice);
  const wake = await fixture.wake(context.auth.hook, waiter.id);
  assert.equal(wake.ref, receipt.ref);
  assert.deepEqual(Object.keys(wake).sort(), ['nonce', 'ref']);
  return { ...wake, ...context.packet };
}

async function denied(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

async function noExecution(fixture) {
  const state = await fixture.inspect();
  assert.equal(state.counts.claims, 0);
  assert.equal(state.markers.length, 0);
  assert.equal(state.counts.completions, 0);
  assert.equal(fixture.metrics.actionResponses, 0);
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('A01: selected second action, claim, marker, completion are separate and occur once', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const request = await notified(fixture, context, 'two');
  await noExecution(fixture); // A wake itself does not execute anything.
  const result = await fixture.claim(context.auth.bridge, request);
  assert.equal(result.marker, 'SECOND');
  assert.equal((await fixture.inspect()).markers.length, 0);
  await denied(fixture.complete(context.auth.bridge, result), 'marker_missing');
  assert.equal(await fixture.recordTestMarker(context.auth.bridge, result), 'SECOND');
  await denied(fixture.recordTestMarker(context.auth.bridge, result), 'marker_exists');
  await fixture.complete(context.auth.bridge, result);
  await denied(fixture.complete(context.auth.bridge, result), 'invalid_grant');
  const state = await fixture.inspect();
  assert.deepEqual(state.markers, [{ ref: request.ref, sessionId: 'test-a', marker: 'SECOND' }]);
  assert.deepEqual(state.counts, { waiters: 1, wakes: 1, claims: 1, completions: 1 });
});

for (const sameCwd of [true, false]) {
  test(`A02/A03: reverse delivery in two sessions (same cwd=${sameCwd})`, async (t) => {
    const fixture = setup(t);
    const a = await card(fixture);
    const b = await card(fixture, 'test-b', sameCwd ? '/fixture/project-a' : '/fixture/project-b');
    const aRequest = await notified(fixture, a, 'one');
    const bRequest = await notified(fixture, b, 'two');
    await denied(fixture.claim(b.auth.bridge, aRequest), 'selection_binding');
    await denied(fixture.claim(a.auth.bridge, bRequest), 'selection_binding');
    await noExecution(fixture);
    for (const [context, request] of [[b, bRequest], [a, aRequest]]) {
      const result = await fixture.claim(context.auth.bridge, request);
      await fixture.recordTestMarker(context.auth.bridge, result);
    }
    assert.deepEqual((await fixture.inspect()).markers.map(({ sessionId, marker }) => [sessionId, marker]),
      [['test-b', 'SECOND'], ['test-a', 'FIRST']]);
  });
}

for (const field of ['sessionId', 'cwd', 'ownerId', 'sessionEpoch', 'connectionEpoch', 'serviceEpoch']) {
  test(`A03: authenticated token with wrong ${field} is denied`, async (t) => {
    const fixture = setup(t);
    const context = await card(fixture);
    const request = await notified(fixture, context);
    const wrong = await fixture.issueTestCredentials('test-a', { [field]: 'different' });
    await denied(fixture.claim(wrong.bridge, request), field === 'sessionId' ? 'session_unavailable' : 'binding_mismatch');
    await noExecution(fixture);
  });
}

test('A03: forged ref, nonce, role and token cannot grant a claim', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const request = await notified(fixture, context);
  await denied(fixture.claim('not-a-test-token', request), 'unauthenticated');
  await denied(fixture.claim(context.auth.selector, request), 'wrong_role');
  await denied(fixture.claim(context.auth.hook, request), 'wrong_role');
  await denied(fixture.claim(context.auth.bridge, { ...request, ref: 'fabricated' }), 'unknown_ref');
  await denied(fixture.claim(context.auth.bridge, { ...request, nonce: 'fabricated' }), 'wrong_nonce');
  await noExecution(fixture);
});

test('A03: select ignores caller-supplied authority, ref and marker fields', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const waiter = await fixture.arm(context.auth.hook, context.packet);
  const receipt = await fixture.select(context.auth.selector, {
    ...context.packet, ref: 'injected', nonce: 'injected', binding: {}, marker: 'WRONG', status: 'claimed',
  }, 'two');
  const wake = await fixture.wake(context.auth.hook, waiter.id);
  assert.notEqual(receipt.ref, 'injected');
  const result = await fixture.claim(context.auth.bridge, { ...wake, ...context.packet });
  assert.equal(result.marker, 'SECOND');
});

test('P0 regression: caller input changes while queued cannot replace validated choices or request identity', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const choices = [{ id: 'one', marker: 'VALID' }];
  const offered = fixture.offer(context.auth.bridge, { ...context.packet, revision: 2, choices });
  choices[0].marker = 'invalid lowercase';
  choices.push({ id: 'two', marker: 'WRONG' });
  const packet = await offered;
  const armRequest = { ...packet };
  const armed = fixture.arm(context.auth.hook, armRequest);
  armRequest.revision = 999;
  const waiter = await armed;
  const selectRequest = { ...packet };
  const selected = fixture.select(context.auth.selector, selectRequest, 'one');
  selectRequest.packetId = 'replaced-by-caller';
  await selected;
  const wake = await fixture.wake(context.auth.hook, waiter.id);
  const claimRequest = { ...wake, ...packet };
  const pendingClaim = fixture.claim(context.auth.bridge, claimRequest);
  claimRequest.nonce = 'replaced-by-caller';
  const claimed = await pendingClaim;
  assert.equal(claimed.marker, 'VALID');
  assert.equal(await fixture.recordTestMarker(context.auth.bridge, claimed), 'VALID');
  assert.equal((await fixture.inspect()).sessions['test-a'].packet.choices.length, 1);
});

test('A04: 100 duplicate arms, duplicate selection/wakes, 20 racing claims produce one action', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const baseline = { ...fixture.journal.metrics };
  const waiters = await Promise.all(Array.from({ length: 100 }, () => fixture.arm(context.auth.hook, context.packet)));
  assert.equal(new Set(waiters.map(({ id }) => id)).size, 1);
  await fixture.select(context.auth.selector, context.packet, 'one');
  await denied(fixture.select(context.auth.selector, context.packet, 'two'), 'duplicate_selection');
  const wake = await fixture.wake(context.auth.hook, waiters[0].id);
  assert.equal(await fixture.wake(context.auth.hook, waiters[0].id), null);
  // Two journal objects share only a TEST serialization/freshness authority.
  const reopened = fixture.reopenStoreObject();
  const requests = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
    (index % 2 ? fixture : reopened).claim(context.auth.bridge, { ...wake, ...context.packet })));
  assert.equal(requests.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.ok(requests.filter(({ status }) => status === 'rejected').every(({ reason }) => reason.code === 'already_claimed'));
  const result = requests.find(({ status }) => status === 'fulfilled').value;
  await fixture.recordTestMarker(context.auth.bridge, result);
  const state = await fixture.inspect();
  assert.equal(state.counts.waiters, 1);
  assert.equal(state.counts.wakes, 1);
  assert.equal(state.counts.claims, 1);
  assert.equal(state.markers.length, 1);
  assert.equal(fixture.metrics.actionResponses + reopened.metrics.actionResponses, 1);
  t.diagnostic(`P0 model counters: ${JSON.stringify({
    armRequests: 100, claimRequests: 20, ...state.counts,
    actionResponses: fixture.metrics.actionResponses + reopened.metrics.actionResponses,
    markerCount: state.markers.length,
    journalLoads: fixture.journal.metrics.loads + reopened.journal.metrics.loads - baseline.loads,
    verifiedSnapshotRecords: fixture.journal.metrics.verifiedRecords + reopened.journal.metrics.verifiedRecords - baseline.verifiedRecords,
  })}; no native timing or production replay measurement`);
});

test('A05: failure before claim write changes no journal state and does not auto-retry', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const request = await notified(fixture, context);
  const before = readFileSync(fixture.storage.path, 'utf8');
  await denied(fixture.claim(context.auth.bridge, request, { fault: 'before_write' }), 'injected_before_write');
  assert.equal(readFileSync(fixture.storage.path, 'utf8'), before);
  const reopened = fixture.reopenStoreObject();
  await noExecution(reopened);
  // An explicit test retry can claim an unconsumed ref. No loop or automatic runner exists.
  await reopened.claim(context.auth.bridge, request);
  assert.equal((await reopened.inspect()).counts.claims, 1);
  assert.equal((await reopened.inspect()).markers.length, 0);
});

test('A05: lost response AFTER committed claim never returns body again, including store reopen', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const request = await notified(fixture, context);
  await denied(fixture.claim(context.auth.bridge, request, { fault: 'after_commit' }), 'response_lost');
  assert.equal(fixture.metrics.actionResponses, 0);
  const reopened = fixture.reopenStoreObject();
  await denied(reopened.claim(context.auth.bridge, request), 'already_claimed');
  const state = await reopened.inspect();
  assert.equal(state.counts.claims, 1);
  assert.equal(state.markers.length, 0);
  assert.equal(state.counts.completions, 0);
  assert.equal(reopened.metrics.actionResponses, 0);
});

test('A05: lost wake response neither executes nor automatically re-sends', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const waiter = await fixture.arm(context.auth.hook, context.packet);
  await fixture.select(context.auth.selector, context.packet, 'one');
  await fixture.wake(context.auth.hook, waiter.id); // Deliberately drop the notification.
  const reopened = fixture.reopenStoreObject();
  assert.equal(await reopened.wake(context.auth.hook, waiter.id), null);
  fixture.clock.advance(LIMITS.continuation);
  await noExecution(reopened);
  assert.equal((await reopened.inspect()).counts.wakes, 1);
});

for (const delta of [LIMITS.continuation - 1, LIMITS.continuation, LIMITS.continuation + 1]) {
  test(`A06: continuation boundary at ${delta}ms`, async (t) => {
    const fixture = setup(t);
    const context = await card(fixture);
    const request = await notified(fixture, context);
    fixture.clock.advance(delta);
    if (delta < LIMITS.continuation) await fixture.claim(context.auth.bridge, request);
    else {
      await denied(fixture.claim(context.auth.bridge, request), 'continuation_expired');
      await noExecution(fixture);
    }
  });
}

for (const delta of [LIMITS.card - 1, LIMITS.card, LIMITS.card + 1]) {
  test(`A06: card boundary at ${delta}ms independently of renewed readiness`, async (t) => {
    const fixture = setup(t);
    const context = await card(fixture);
    fixture.clock.advance(delta);
    await fixture.ackTestReadiness(context.auth.bridge); // Explicit, not a heartbeat/automatic extension.
    if (delta < LIMITS.card) await notified(fixture, context);
    else {
      await denied(fixture.select(context.auth.selector, context.packet, 'one'), 'card_expired');
      await noExecution(fixture);
    }
  });
}

for (const delta of [LIMITS.readiness - 1, LIMITS.readiness, LIMITS.readiness + 1, LIMITS.card - 1]) {
  test(`A12: original readiness at ${delta}ms does not inherit card TTL`, async (t) => {
    const fixture = setup(t);
    const context = await card(fixture);
    fixture.clock.advance(delta);
    if (delta < LIMITS.readiness) await fixture.select(context.auth.selector, context.packet, 'one');
    else {
      await denied(fixture.select(context.auth.selector, context.packet, 'one'), 'readiness_expired');
      await noExecution(fixture);
    }
  });
}

test('A06: old revision, old generation, and replaced packet cannot be claimed', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const request = await notified(fixture, context);
  await denied(fixture.claim(context.auth.bridge, { ...request, revision: 2 }), 'stale_revision');
  await denied(fixture.claim(context.auth.bridge, { ...request, generation: 2 }), 'stale_generation');
  await fixture.offer(context.auth.bridge, {
    ...context.packet, revision: 2, choices: [{ id: 'one', marker: 'NEW' }],
  });
  await denied(fixture.claim(context.auth.bridge, request), 'stale_revision');
  await noExecution(fixture);
});

for (const invalidation of ['new_prompt', 'cancelled', 'expiry', 'reconnected', 'service_changed', 'revision']) {
  test(`A07/A09: ${invalidation} between preflight and commit is revalidated`, async (t) => {
    const fixture = setup(t);
    const context = await card(fixture);
    const request = await notified(fixture, context);
    const entered = deferred();
    const release = deferred();
    const pending = fixture.claim(context.auth.bridge, request, {
      beforeCommit: async () => { entered.resolve(); await release.promise; },
    });
    const expected = {
      new_prompt: 'new_prompt', cancelled: 'cancelled', expiry: 'continuation_expired',
      reconnected: 'binding_mismatch', service_changed: 'binding_mismatch', revision: 'stale_revision',
    }[invalidation];
    const rejection = denied(pending, expected);
    await entered.promise;
    if (invalidation === 'new_prompt') await fixture.observeSyntheticPrompt(context.auth.hook, 'test-prompt-2');
    if (invalidation === 'cancelled') await fixture.cancel(context.auth.selector);
    if (invalidation === 'expiry') fixture.clock.advance(LIMITS.continuation);
    if (invalidation === 'reconnected') await fixture.reconnectTestSession(context.sessionId);
    if (invalidation === 'service_changed') await fixture.rotateTestService();
    if (invalidation === 'revision') await fixture.offer(context.auth.bridge, {
      ...context.packet, revision: 2, choices: [{ id: 'one', marker: 'NEW' }],
    });
    release.resolve();
    await rejection;
    assert.equal(fixture.metrics.claimPreflights, 1);
    assert.equal(fixture.metrics.claimCommitChecks, 1);
    await noExecution(fixture);
  });
}

test('A07: prompt before select and late old Stop cannot revive an old waiter', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const waiter = await fixture.arm(context.auth.hook, context.packet);
  const newGeneration = await fixture.observeSyntheticPrompt(context.auth.hook, 'test-prompt-2');
  await denied(fixture.select(context.auth.selector, context.packet, 'one'), 'stale_generation');
  await denied(fixture.observeSyntheticStop(context.auth.hook, context.packet.generation), 'stale_generation');
  await denied(fixture.arm(context.auth.hook, context.packet), 'stale_generation');
  await denied(fixture.wake(context.auth.hook, waiter.id), 'waiter_unavailable');
  assert.equal(await fixture.arm(context.auth.hook, { generation: newGeneration }), null);
  const state = await fixture.inspect();
  assert.equal(state.sessions['test-a'].stopped, false);
  assert.equal(state.sessions['test-a'].waiter, null);
  await noExecution(fixture);
});

for (const reason of ['cancelled', 'dismissed', 'interrupted', 'new_prompt', 'session_ended']) {
  for (const afterWake of [false, true]) {
    test(`A08: ${reason} ${afterWake ? 'after' : 'before'} notification prevents stale execution`, async (t) => {
      const fixture = setup(t);
      const context = await card(fixture);
      const waiter = await fixture.arm(context.auth.hook, context.packet);
      await fixture.select(context.auth.selector, context.packet, 'one');
      const wake = afterWake ? await fixture.wake(context.auth.hook, waiter.id) : null;
      if (reason === 'new_prompt') await fixture.observeSyntheticPrompt(context.auth.hook, 'test-prompt-2');
      else if (reason === 'session_ended') await fixture.endSession(context.auth.hook);
      else await fixture.cancel(context.auth.selector, reason);
      if (wake) await denied(fixture.claim(context.auth.bridge, { ...wake, ...context.packet }),
        reason === 'session_ended' ? 'session_unavailable' : reason);
      else await denied(fixture.wake(context.auth.hook, waiter.id),
        reason === 'session_ended' ? 'session_unavailable' : 'waiter_unavailable');
      assert.equal((await fixture.inspect()).sessions['test-a'].waiter, null);
      assert.equal((await fixture.inspect()).counts.wakes, afterWake ? 1 : 0);
      await noExecution(fixture);
    });
  }
}

test('A08: cancellation after claim cannot recall a returned body but blocks the fixture marker', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const request = await notified(fixture, context);
  const result = await fixture.claim(context.auth.bridge, request);
  await fixture.cancel(context.auth.selector);
  await denied(fixture.recordTestMarker(context.auth.bridge, result), 'cancelled');
  assert.equal((await fixture.inspect()).counts.claims, 1);
  assert.equal((await fixture.inspect()).markers.length, 0);
  assert.equal(fixture.metrics.actionResponses, 1);
});

for (const invalidation of ['continuation', 'card', 'readiness', 'new_prompt', 'reconnected', 'service_changed']) {
  test(`A06/A08: ${invalidation} after claim blocks marker creation`, async (t) => {
    const fixture = setup(t);
    const context = await card(fixture);
    if (invalidation === 'card') {
      fixture.clock.advance(LIMITS.card - 1);
      await fixture.ackTestReadiness(context.auth.bridge);
    }
    if (invalidation === 'readiness') fixture.clock.advance(LIMITS.readiness - 1);
    const request = await notified(fixture, context);
    const result = await fixture.claim(context.auth.bridge, request);
    if (invalidation === 'card' || invalidation === 'readiness') fixture.clock.advance(1);
    if (invalidation === 'continuation') fixture.clock.advance(LIMITS.continuation);
    if (invalidation === 'new_prompt') await fixture.observeSyntheticPrompt(context.auth.hook, 'test-prompt-2');
    if (invalidation === 'reconnected') await fixture.reconnectTestSession(context.sessionId);
    if (invalidation === 'service_changed') await fixture.rotateTestService();
    await denied(fixture.recordTestMarker(context.auth.bridge, result), {
      continuation: 'continuation_expired', card: 'card_expired', readiness: 'readiness_expired',
      new_prompt: 'new_prompt', reconnected: 'binding_mismatch', service_changed: 'binding_mismatch',
    }[invalidation]);
    assert.equal((await fixture.inspect()).counts.claims, 1);
    assert.equal((await fixture.inspect()).markers.length, 0);
    assert.equal((await fixture.inspect()).counts.completions, 0);
  });
}

for (const damage of ['tamper', 'rollback']) {
  test(`A10: ${damage} after preflight fails at commit instead of using a cached validated snapshot`, async (t) => {
    const fixture = setup(t);
    const context = await card(fixture);
    const earlier = readFileSync(fixture.storage.path, 'utf8');
    const request = await notified(fixture, context);
    const entered = deferred();
    const release = deferred();
    const pending = fixture.claim(context.auth.bridge, request, {
      beforeCommit: async () => { entered.resolve(); await release.promise; },
    });
    const rejected = denied(pending, damage === 'tamper' ? 'journal_mac' : 'freshness_mismatch');
    await entered.promise;
    if (damage === 'tamper') {
      const records = JSON.parse(readFileSync(fixture.storage.path, 'utf8'));
      records.at(-1).state.selections[request.ref].marker = 'TAMPERED';
      writeFileSync(fixture.storage.path, JSON.stringify(records));
    } else writeFileSync(fixture.storage.path, earlier);
    release.resolve();
    await rejected;
    assert.equal(fixture.metrics.actionResponses, 0);
    assert.equal(fixture.metrics.claimCommitChecks, 0); // Integrity load rejects before the state callback.
  });
}

test('A09: logical timeout and repeated Stop/arm do not start another waiter or extend deadlines', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const first = await fixture.arm(context.auth.hook, context.packet, 5_000);
  const original = (await fixture.inspect()).sessions['test-a'];
  fixture.clock.advance(4_999);
  for (let i = 0; i < 10; i += 1) {
    await fixture.inspect();
    await fixture.observeSyntheticStop(context.auth.hook, context.packet.generation);
    assert.deepEqual(await fixture.arm(context.auth.hook, context.packet), first);
  }
  fixture.clock.advance(1);
  assert.equal(await fixture.wake(context.auth.hook, first.id), null);
  const terminal = await fixture.arm(context.auth.hook, context.packet);
  assert.equal(terminal.state, 'timed_out');
  const state = await fixture.inspect();
  assert.equal(state.counts.waiters, 1);
  assert.equal(state.sessions['test-a'].readyUntil, original.readyUntil);
  assert.equal(state.sessions['test-a'].packet.expiresAt, original.packet.expiresAt);
  assert.equal(terminal.deadline, first.deadline);
  await noExecution(fixture);
});

test('A09: reconnect/new service credentials cannot revive a consumed or unclaimed old ref', async (t) => {
  const fixture = setup(t);
  const context = await card(fixture);
  const request = await notified(fixture, context);
  const reconnected = await fixture.reconnectTestSession(context.sessionId);
  await denied(fixture.claim(context.auth.bridge, request), 'binding_mismatch');
  await denied(fixture.claim(reconnected.bridge, request), 'selection_binding');
  await fixture.rotateTestService();
  const restarted = await fixture.issueTestCredentials(context.sessionId);
  await denied(fixture.claim(reconnected.bridge, request), 'binding_mismatch');
  await denied(fixture.claim(restarted.bridge, request), 'selection_binding');
  assert.equal((await fixture.inspect()).sessions['test-a'].waiter, null);
  await noExecution(fixture);
});

for (const damage of ['tamper', 'truncate', 'rollback', 'missing', 'freshness_missing', 'anchor_gap']) {
  test(`A10: ${damage} fails closed on a freshly opened store object`, async (t) => {
    const fixture = setup(t);
    const context = await card(fixture);
    const oldValidFile = readFileSync(fixture.storage.path, 'utf8');
    const request = await notified(fixture, context);
    const latest = readFileSync(fixture.storage.path, 'utf8');
    if (damage === 'tamper') {
      const records = JSON.parse(latest);
      records.at(-1).state.selections[request.ref].marker = 'TAMPERED';
      writeFileSync(fixture.storage.path, JSON.stringify(records));
    }
    if (damage === 'truncate') writeFileSync(fixture.storage.path, latest.slice(0, -10));
    if (damage === 'rollback') writeFileSync(fixture.storage.path, oldValidFile); // MAC still valid.
    if (damage === 'missing') rmSync(fixture.storage.path);
    if (damage === 'freshness_missing') fixture.storage.forgetFreshnessForTest();
    if (damage === 'anchor_gap') await denied(fixture.claim(context.auth.bridge, request,
      { fault: 'after_file_before_anchor' }), 'injected_anchor_gap');
    const expected = { tamper: 'journal_mac', truncate: 'journal_corrupt', rollback: 'freshness_mismatch',
      missing: 'journal_missing', freshness_missing: 'freshness_missing', anchor_gap: 'freshness_mismatch' }[damage];
    const before = damage === 'missing' ? null : readFileSync(fixture.storage.path, 'utf8');
    const reopened = fixture.reopenStoreObject();
    await denied(reopened.claim(context.auth.bridge, request), expected);
    await denied(reopened.inspect(), expected);
    assert.equal(reopened.metrics.actionResponses, 0);
    assert.equal(fixture.metrics.actionResponses, 0);
    if (before !== null) assert.equal(readFileSync(fixture.storage.path, 'utf8'), before);
    else assert.deepEqual(readdirSync(fixture.storage.directory), []);
  });
}

test('P0 isolation: private disposable storage and no product/native imports, processes, or network APIs', async (t) => {
  const fixture = setup(t);
  assert.equal(statSync(fixture.storage.directory).mode & 0o777, 0o700);
  assert.equal(statSync(fixture.storage.path).mode & 0o777, 0o600);
  for (const name of ['fixture.mjs', 'test-store.mjs']) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.ok(imports.every((name) => ['node:crypto', 'node:fs', 'node:os', 'node:path', './test-store.mjs'].includes(name)));
    assert.doesNotMatch(source, /\b(?:fetch|spawn|execFile|execSync|setInterval|setTimeout)\s*\(|process\.env|import\s*\(/);
  }
  const before = await fixture.inspect();
  before.serviceEpoch = 'modified-copy';
  assert.notEqual((await fixture.reopenStoreObject().inspect()).serviceEpoch, 'modified-copy');
});

test('A06: invalid or backward fake time never revives expired authority', async (t) => {
  for (const time of [-1, NaN, Infinity, 0.5]) assert.throws(() => new FakeClock(time), { code: 'clock_invalid' });
  const fixture = setup(t);
  const context = await card(fixture);
  const request = await notified(fixture, context);
  fixture.clock.advance(LIMITS.card);
  for (const delta of [-LIMITS.card, NaN, Infinity, 0.5]) assert.throws(() => fixture.clock.advance(delta), { code: 'clock_invalid' });
  await denied(fixture.claim(context.auth.bridge, request), 'card_expired');
  await noExecution(fixture);
});
