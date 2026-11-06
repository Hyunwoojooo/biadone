// Executable P0 model only. No Claude/MCP/Hook process, product imports, or commands.
import { randomBytes, randomUUID } from 'node:crypto';
import { createTestStorage, requireThat, unchanged } from './test-store.mjs';

export const LIMITS = Object.freeze({ card: 600_000, continuation: 120_000, readiness: 300_000 });
const BINDING = ['sessionId', 'cwd', 'ownerId', 'sessionEpoch', 'connectionEpoch', 'serviceEpoch'];
const opaque = () => randomBytes(24).toString('hex');
const copy = (value) => structuredClone(value);

export class FakeClock {
  #time;
  constructor(time = 1_000_000) {
    requireThat(Number.isSafeInteger(time) && time >= 0, 'clock_invalid');
    this.#time = time;
  }
  now() { return this.#time; }
  advance(delta) {
    requireThat(Number.isSafeInteger(delta) && delta >= 0
      && Number.isSafeInteger(this.#time + delta), 'clock_invalid');
    this.#time += delta;
  }
}

// This is a trusted test issuer, not an MCP peer authentication implementation.
class TestAuthentication {
  #tokens = new Map();
  issue(role, binding) {
    const token = opaque();
    this.#tokens.set(token, { role, ...copy(binding) });
    return token;
  }
  resolve(token, role) {
    const auth = this.#tokens.get(token);
    requireThat(auth, 'unauthenticated');
    requireThat(auth.role === role, 'wrong_role');
    return auth;
  }
}

function bindingOf(state, session) {
  return Object.fromEntries(BINDING.map((key) => [key,
    key === 'serviceEpoch' ? state.serviceEpoch : session[key]]));
}

function invalidate(state, session, reason) {
  for (const selection of Object.values(state.selections)) {
    if (selection.binding.sessionId === session.sessionId && !selection.invalidated) {
      selection.invalidated = reason;
    }
  }
  session.packet = null;
  session.waiter = null;
}

export class RewakeFixture {
  constructor(storage, clock, auth) {
    this.storage = storage;
    this.journal = storage.reopen();
    this.clock = clock;
    this.auth = auth;
    this.metrics = { claimPreflights: 0, claimCommitChecks: 0, actionResponses: 0 };
  }

  static create(clock = new FakeClock()) {
    const storage = createTestStorage({
      serviceEpoch: opaque(), sessions: {}, selections: {}, markers: [],
      counts: { waiters: 0, wakes: 0, claims: 0, completions: 0 },
    }, clock);
    return new RewakeFixture(storage, clock, new TestAuthentication());
  }

  // File state is reloaded; only the test issuer/freshness authority deliberately survive.
  reopenStoreObject() { return new RewakeFixture(this.storage, this.clock, this.auth); }
  inspect() { return this.journal.read(); }
  dispose() { this.storage.dispose(); }

  sessionFor(state, token, role) {
    const auth = this.auth.resolve(token, role);
    const session = state.sessions[auth.sessionId];
    requireThat(session && !session.ended, 'session_unavailable');
    const expected = bindingOf(state, session);
    requireThat(BINDING.every((key) => expected[key] === auth[key]), 'binding_mismatch');
    return session;
  }

  // Only the harness controls session creation and credential issuance.
  async openTestSession({ sessionId, cwd = '/fixture/project-a', ownerId = 'fixture-owner' }) {
    requireThat(/^test-[a-z0-9-]+$/.test(sessionId), 'invalid_test_session');
    requireThat(/^\/fixture\/[a-z0-9/-]+$/.test(cwd) && !cwd.includes('//'), 'invalid_test_cwd');
    await this.journal.mutate('open_test_session', this.clock, (state) => {
      requireThat(!state.sessions[sessionId], 'session_exists');
      state.sessions[sessionId] = {
        sessionId, cwd, ownerId, sessionEpoch: opaque(), connectionEpoch: opaque(),
        generation: 0, promptId: null, stopped: false, readyUntil: 0,
        packet: null, waiter: null, ended: false,
      };
    });
    return this.issueTestCredentials(sessionId);
  }

  async issueTestCredentials(sessionId, overrides = {}) {
    const state = await this.inspect();
    requireThat(state.sessions[sessionId], 'session_unavailable');
    const binding = { ...bindingOf(state, state.sessions[sessionId]), ...overrides };
    return Object.fromEntries(['hook', 'bridge', 'selector'].map((role) => [role, this.auth.issue(role, binding)]));
  }

  observeSyntheticPrompt(token, promptId) {
    requireThat(typeof promptId === 'string' && promptId.startsWith('test-prompt-'), 'invalid_test_prompt');
    return this.journal.mutate('trusted_test_prompt', this.clock, (state) => {
      const session = this.sessionFor(state, token, 'hook');
      requireThat(session.promptId !== promptId, 'duplicate_prompt');
      invalidate(state, session, 'new_prompt');
      session.generation += 1;
      session.promptId = promptId;
      session.stopped = false;
      return session.generation;
    });
  }

  observeSyntheticStop(token, generation) {
    return this.journal.mutate('test_stop', this.clock, (state) => {
      const session = this.sessionFor(state, token, 'hook');
      this.checkGeneration(session, generation);
      session.stopped = true;
    });
  }

  ackTestReadiness(token) {
    return this.journal.mutate('test_readiness', this.clock, (state) => {
      const session = this.sessionFor(state, token, 'bridge');
      session.readyUntil = this.clock.now() + LIMITS.readiness;
    });
  }

  checkGeneration(session, generation) {
    requireThat(generation > 0 && session.generation === generation, 'stale_generation');
  }
  checkPacket(session, request) {
    this.checkGeneration(session, request.generation);
    requireThat(session.packet, 'no_card');
    requireThat(session.packet.id === request.packetId && session.packet.revision === request.revision, 'stale_revision');
    requireThat(this.clock.now() < session.packet.expiresAt, 'card_expired');
  }
  checkReady(session) {
    requireThat(session.stopped, 'not_idle');
    requireThat(this.clock.now() < session.readyUntil, 'readiness_expired');
  }

  offer(token, { generation, packetId = randomUUID(), revision = 1, choices }) {
    choices = copy(choices);
    requireThat(typeof packetId === 'string' && packetId.length > 0, 'invalid_packet');
    requireThat(Number.isSafeInteger(revision) && revision > 0, 'invalid_revision');
    requireThat(Array.isArray(choices) && choices.length > 0 && choices.length <= 4, 'invalid_choices');
    requireThat(new Set(choices.map((choice) => choice.id)).size === choices.length
      && choices.every((choice) => /^[a-z0-9-]+$/.test(choice.id)
        && /^[A-Z][A-Z0-9_-]{0,31}$/.test(choice.marker)), 'invalid_marker_choice');
    return this.journal.mutate('offer', this.clock, (state) => {
      const session = this.sessionFor(state, token, 'bridge');
      this.checkGeneration(session, generation);
      if (session.packet?.id === packetId) requireThat(revision > session.packet.revision, 'stale_revision');
      invalidate(state, session, 'stale_revision');
      session.packet = { id: packetId, revision, choices: copy(choices), expiresAt: this.clock.now() + LIMITS.card };
      return { generation, packetId, revision };
    });
  }

  arm(token, request, timeout = LIMITS.card) {
    request = copy(request);
    requireThat(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= LIMITS.card, 'invalid_wait_timeout');
    return this.journal.mutate('arm_waiter', this.clock, (state) => {
      const session = this.sessionFor(state, token, 'hook');
      this.checkGeneration(session, request.generation);
      if (!session.packet) return unchanged(null);
      this.checkPacket(session, request);
      this.checkReady(session);
      // Terminal waiter stays a tombstone until a NEW packet/generation. No re-arm loop.
      if (session.waiter) return unchanged(copy(session.waiter));
      session.waiter = { id: opaque(), deadline: Math.min(this.clock.now() + timeout, session.packet.expiresAt), state: 'armed' };
      state.counts.waiters += 1;
      return copy(session.waiter);
    });
  }

  select(token, request, choiceId) {
    request = copy(request);
    return this.journal.mutate('selection_committed', this.clock, (state) => {
      const session = this.sessionFor(state, token, 'selector');
      this.checkPacket(session, request);
      this.checkReady(session);
      requireThat(!Object.values(state.selections).some((selection) =>
        selection.binding.sessionId === session.sessionId && selection.generation === session.generation
        && selection.packetId === request.packetId && selection.revision === request.revision), 'duplicate_selection');
      const choice = session.packet.choices.find((item) => item.id === choiceId);
      requireThat(choice, 'unknown_choice');
      const ref = opaque();
      state.selections[ref] = {
        ref, nonce: opaque(), binding: bindingOf(state, session),
        generation: request.generation, packetId: request.packetId, revision: request.revision,
        choiceId, marker: choice.marker, selectedAt: this.clock.now(),
        deadline: this.clock.now() + LIMITS.continuation,
        status: 'selected', invalidated: null, notified: false,
      };
      // The selector receives a receipt, not execution authority or an action body.
      return { ref };
    });
  }

  wake(token, waiterId) {
    return this.journal.mutate('wake_attempt', this.clock, (state) => {
      const session = this.sessionFor(state, token, 'hook');
      requireThat(session.waiter?.id === waiterId, 'waiter_unavailable');
      const waiter = session.waiter;
      if (waiter.state !== 'armed') return unchanged(null);
      if (this.clock.now() >= waiter.deadline) {
        waiter.state = 'timed_out';
        return null;
      }
      const selection = Object.values(state.selections).find((item) =>
        item.binding.sessionId === session.sessionId && !item.invalidated && item.status === 'selected');
      if (!selection) return unchanged(null);
      this.checkPacket(session, selection);
      this.checkReady(session);
      requireThat(this.clock.now() < selection.deadline, 'continuation_expired');
      waiter.state = 'handed_off';
      selection.notified = true;
      state.counts.wakes += 1;
      return { ref: selection.ref, nonce: selection.nonce }; // No marker/body, no prompt forgery.
    });
  }

  checkClaim(state, token, request) {
    const session = this.sessionFor(state, token, 'bridge');
    const selection = state.selections[request.ref];
    requireThat(selection, 'unknown_ref');
    requireThat(BINDING.every((key) => selection.binding[key] === bindingOf(state, session)[key]), 'selection_binding');
    requireThat(selection.nonce === request.nonce, 'wrong_nonce');
    requireThat(!selection.invalidated, selection.invalidated ?? 'cancelled');
    requireThat(selection.status === 'selected', 'already_claimed');
    requireThat(selection.notified, 'not_notified');
    requireThat(selection.generation === request.generation, 'stale_generation');
    requireThat(selection.packetId === request.packetId && selection.revision === request.revision, 'stale_revision');
    this.checkPacket(session, request);
    this.checkReady(session);
    requireThat(this.clock.now() < selection.deadline, 'continuation_expired');
    return selection;
  }

  async claim(token, request, { beforeCommit, fault } = {}) {
    request = copy(request);
    this.metrics.claimPreflights += 1;
    this.checkClaim(await this.inspect(), token, request);
    if (beforeCommit) await beforeCommit(); // TEST barrier: invalidation can happen here.
    const result = await this.journal.mutate('claim_committed', this.clock, (state) => {
      this.metrics.claimCommitChecks += 1;
      const selection = this.checkClaim(state, token, request); // Revalidate UNDER test lock.
      selection.status = 'claimed';
      selection.claimedAt = this.clock.now();
      selection.grant = opaque();
      state.counts.claims += 1;
      return { ref: selection.ref, grant: selection.grant, marker: selection.marker };
    }, fault);
    this.metrics.actionResponses += 1;
    return result;
  }

  recordTestMarker(token, { ref, grant }) {
    return this.journal.mutate('test_marker', this.clock, (state) => {
      const session = this.sessionFor(state, token, 'bridge');
      const selection = state.selections[ref];
      requireThat(selection && BINDING.every((key) => selection.binding[key] === bindingOf(state, session)[key]), 'selection_binding');
      requireThat(!selection.invalidated, selection.invalidated ?? 'cancelled');
      requireThat(selection.status === 'claimed' && selection.grant === grant, 'invalid_grant');
      this.checkPacket(session, selection);
      this.checkReady(session);
      requireThat(this.clock.now() < selection.deadline, 'continuation_expired');
      requireThat(!state.markers.some((item) => item.ref === ref), 'marker_exists');
      state.markers.push({ ref, sessionId: session.sessionId, marker: selection.marker });
      return selection.marker;
    });
  }

  complete(token, { ref, grant }) {
    return this.journal.mutate('completion', this.clock, (state) => {
      const session = this.sessionFor(state, token, 'bridge');
      const selection = state.selections[ref];
      requireThat(selection && BINDING.every((key) => selection.binding[key] === bindingOf(state, session)[key]), 'selection_binding');
      requireThat(selection.status === 'claimed' && selection.grant === grant, 'invalid_grant');
      requireThat(state.markers.some((item) => item.ref === ref), 'marker_missing');
      selection.status = 'completed';
      state.counts.completions += 1;
    });
  }

  cancel(token, reason = 'cancelled') {
    requireThat(['cancelled', 'dismissed', 'interrupted'].includes(reason), 'invalid_cancel_reason');
    return this.journal.mutate(reason, this.clock, (state) => {
      invalidate(state, this.sessionFor(state, token, 'selector'), reason);
    });
  }

  endSession(token) {
    return this.journal.mutate('test_session_end', this.clock, (state) => {
      const session = this.sessionFor(state, token, 'hook');
      invalidate(state, session, 'session_ended');
      session.ended = true;
    });
  }

  // Simulates MCP EOF / reconnect: never restores old authority or auto-claims work.
  async reconnectTestSession(sessionId) {
    await this.journal.mutate('test_reconnect', this.clock, (state) => {
      const session = state.sessions[sessionId];
      requireThat(session && !session.ended, 'session_unavailable');
      invalidate(state, session, 'reconnected');
      session.connectionEpoch = opaque();
      session.generation += 1;
      session.stopped = false;
      session.readyUntil = 0;
    });
    return this.issueTestCredentials(sessionId);
  }

  rotateTestService() {
    return this.journal.mutate('test_service_rotation', this.clock, (state) => {
      state.serviceEpoch = opaque();
      for (const session of Object.values(state.sessions)) {
        invalidate(state, session, 'service_changed');
        session.generation += 1;
        session.stopped = false;
        session.readyUntil = 0;
      }
    });
  }
}
