import net from 'node:net';
import { promises as fs, constants } from 'node:fs';
import { isAbsolute, join, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PROTOCOL, PROVIDER, PRODUCT, MAX_MESSAGE_BYTES, runtimePath, socketPath } from '../shared/identity.mjs';
import { promptSHA256, selectionChannelContent, selectionChannelPrompt } from '../shared/channel.mjs';

export const LIMITS = Object.freeze({ sessions: 8, pending_claims: 32, packet: 12 * 1024, cwd: 1024, summary: 512, id: 64, title: 128, description: 256, task: 2048, done_when: 512 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']);
const OPEN_SELECTION = new Set(['selected', 'delivered', 'claimed']);

class Rejection extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
function ensure(condition, code, message) { if (!condition) throw new Rejection(code, message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fields(value, required, optional = []) {
  ensure(object(value), 'invalid_payload');
  const allowed = new Set([...required, ...optional]);
  ensure(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key)), 'invalid_fields');
}
function string(value, maximum, multiline = false) {
  ensure(typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= maximum, 'invalid_text');
  ensure(!(multiline ? /[\x00-\x08\x0b-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value), 'invalid_text');
  return value;
}
function uuid(value) { ensure(typeof value === 'string' && UUID.test(value), 'invalid_id'); return value; }
function token() { return randomBytes(32).toString('hex'); }
function equalSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function canonicalCwd(value) {
  string(value, LIMITS.cwd);
  ensure(isAbsolute(value) && resolve(value) === value, 'invalid_cwd', 'cwd must be an absolute normalized path');
  return value;
}
function viewSession(session, connected, continuationReady = false) {
  return {
    session_id: session.session_id, cwd: session.cwd, phase: session.phase,
    prompt_id: session.prompt_id, boundary_id: session.boundary_id, connected, continuation_ready: continuationReady,
    ...(session.packet ? { packet: session.packet } : {}),
    ...(session.selection ? { selection: {
      selection_id: session.selection.selection_id, option_id: session.selection.option_id,
      status: session.selection.status, ...(session.selection.note ? { note: session.selection.note } : {}),
      ...(session.selection.reported_by ? { reported_by: session.selection.reported_by } : {}),
    } } : {}),
  };
}

// A private directory is the local OS-user access boundary. Symlink ancestors are
// rejected so a configured Claude runtime cannot silently address another tree.
async function privateDirectory(path) {
  const root = parse(path).root;
  let current = root;
  for (const part of path.slice(root.length).split('/').filter(Boolean)) {
    current = join(current, part);
    try { await fs.mkdir(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(current);
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'unsafe_runtime', 'runtime must use real directories, not symlinks');
  }
  const stat = await fs.lstat(path);
  ensure(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'unsafe_runtime', 'runtime directory must belong to this user and have mode 0700');
}

export async function startCoordinator({ runtime, uiToken, bridgeTTL = 5000, probeTTL = 30_000, readinessTTL = 300_000, connectionTimeout = 3000, now = Date.now } = {}) {
  const runtimeDirectory = runtimePath(runtime);
  const socketFile = socketPath(runtimeDirectory);
  ensure(typeof uiToken === 'string' && Buffer.byteLength(uiToken) >= 32 && Buffer.byteLength(uiToken) <= 256, 'missing_ui_token', 'BLABEE_CLAUDE_UI_TOKEN must contain 32–256 bytes');
  ensure([bridgeTTL, probeTTL, readinessTTL, connectionTimeout].every(value => Number.isFinite(value) && value > 0), 'invalid_timeout');
  await privateDirectory(runtimeDirectory);
  const lockPath = join(runtimeDirectory, 'coordinator.lock');
  const journalPath = join(runtimeDirectory, 'journal.json');
  let lockHandle, socketIdentity, closePromise, journalCounter = 0, closed = false;
  let queue = Promise.resolve();
  // Keep retired credentials for this process lifetime as well. A model can
  // reflect an event token after claim, when it is no longer an active secret.
  // This deny-set is deliberately omitted from every durable snapshot.
  let state = { boot_id: randomUUID(), sessions: {}, history: [], known_secrets: new Set([uiToken]) };
  const clients = new Set();
  const server = net.createServer();

  function connected(session) {
    const elapsed = now() - session.last_poll;
    return !session.ended && session.bridge_id !== null && session.last_poll !== null && elapsed >= 0 && elapsed < bridgeTTL;
  }
  function continuationReady(session) {
    return connected(session) && session.readiness !== null && now() >= session.readiness.verified_at && now() < session.readiness.expires_at;
  }
  function clearReadiness(session) {
    session.readiness = null;
    session.readiness_probe = null;
  }
  function expireBridgeHeartbeat(session) {
    if (session.last_poll !== null && !connected(session)) {
      clearReadiness(session);
      session.last_poll = null;
    }
  }
  function snapshot() {
    return {
      product: PRODUCT, protocol: PROTOCOL, version: 1, boot_id: state.boot_id,
      sessions: Object.values(state.sessions).map(session => viewSession(session, false)),
      history: state.history,
    };
  }
  function history(type, details = {}) {
    state.history.push({ type, at: new Date(now()).toISOString(), ...details });
    if (state.history.length > 1000) state.history.splice(0, state.history.length - 1000);
  }
  function rejectSecretReflection(message) {
    const pending = [];
    for (const [key, value] of Object.entries(message.payload ?? {})) {
      // The token is an authentication input only on this exact field; claim
      // never stores the payload or copies this value into its response.
      if (message.type === 'selection.claim' && key === 'delivery_token') continue;
      if (message.type === 'readiness.ack' && key === 'nonce') continue;
      pending.push(value);
    }
    while (pending.length) {
      const value = pending.pop();
      if (typeof value === 'string') {
        ensure(![...state.known_secrets].some(secret => value.includes(secret)), 'secret_in_payload', 'credentials cannot be included in task content or persisted metadata');
      } else if (value && typeof value === 'object') pending.push(...Object.values(value));
    }
  }
  async function persist() {
    const temporary = join(runtimeDirectory, `.journal-${state.boot_id}-${++journalCounter}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(JSON.stringify(snapshot()) + '\n');
      await handle.sync();
      await handle.close(); handle = undefined;
      await fs.rename(temporary, journalPath);
      const directory = await fs.open(runtimeDirectory, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      await handle?.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
  }
  function authenticate(message) {
    const id = uuid(message.payload.session_id);
    const session = state.sessions[id];
    ensure(session && equalSecret(message.auth, session.token), 'unauthorized', 'session credentials are missing, expired, or belong to another session');
    ensure(!session.ended, 'session_ended');
    return session;
  }
  function authenticateUI(message) { ensure(equalSecret(message.auth, uiToken), 'unauthorized', 'UI credentials are required'); }
  function authenticateBridge(message) {
    const session = authenticate(message);
    ensure(uuid(message.payload.bridge_id) === session.bridge_id, 'stale_bridge', 'the logical bridge registration is no longer current');
    return session;
  }
  function usableBoundary(session, boundary) {
    uuid(boundary);
    ensure(session.boundary_id === boundary && session.prompt_id !== null, 'stale_boundary');
  }
  function refreshPhase(session) {
    if (session.ended) session.phase = 'ended';
    else if (session.selection?.status === 'selected') session.phase = 'selected';
    else if (session.selection?.status === 'delivered') session.phase = 'delivered';
    else if (session.selection?.status === 'claimed' && session.stopped) session.phase = 'awaiting_completion';
    else if (session.stopped) session.phase = session.packet ? 'ready' : 'idle';
    else session.phase = session.boundary_id ? 'working' : 'awaiting_prompt';
  }
  function invalidateSelection(session, reason, includeClaimed = true) {
    if (session.selection && OPEN_SELECTION.has(session.selection.status) && (includeClaimed || session.selection.status !== 'claimed')) {
      session.selection.status = 'invalidated';
      session.selection.note = reason;
      delete session.selection.delivery_token;
      history('selection.invalidated', { session_id: session.session_id, selection_id: session.selection.selection_id, reason });
    }
  }
  function selectionContinuationForm(session, promptDigest) {
    const selection = session.selection;
    if (promptDigest === undefined || selection?.status !== 'delivered' || !session.bridge_id || selection.bridge_id !== session.bridge_id
      || selection.boundary_id !== session.boundary_id || selection.packet_id !== session.packet?.packet_id || selection.revision !== session.packet?.revision
      || typeof selection.delivery_token !== 'string') return undefined;
    for (const [form, prompt] of [['content', selectionChannelContent(selection)], ['wrapped', selectionChannelPrompt(selection)]]) {
      if (equalSecret(promptDigest, promptSHA256(prompt))) return form;
    }
    return undefined;
  }
  function hook(message) {
    fields(message.payload, ['session_id', 'event', 'session_id_native', 'cwd'], ['prompt_id', 'prompt_sha256']);
    const session = authenticate(message), p = message.payload;
    ensure(EVENTS.has(p.event), 'unsupported_hook');
    ensure(uuid(p.session_id_native) === session.session_id, 'native_session_mismatch');
    ensure(canonicalCwd(p.cwd) === session.cwd, 'cwd_mismatch');
    if (p.prompt_id !== undefined) uuid(p.prompt_id);
    if (p.prompt_sha256 !== undefined) ensure(p.event === 'UserPromptSubmit' && typeof p.prompt_sha256 === 'string' && /^[a-f0-9]{64}$/.test(p.prompt_sha256), 'invalid_prompt_sha256');
    let promptKind;
    if (p.event === 'SessionStart') {
      // Claude repeats SessionStart when compacting an existing conversation.
      // Re-deliver its existing context without inventing a user prompt or
      // revoking a pending selection. A different native identity still fails.
      ensure(p.prompt_id === undefined || (session.started && p.prompt_id === session.prompt_id), 'unexpected_prompt', 'SessionStart can only repeat the current native prompt');
      session.started = true;
    } else if (p.event === 'SessionEnd') {
      // Launcher startup can fail before Claude emits its first SessionStart.
      // Cleanup must still revoke that registration and release its slot.
      if (p.prompt_id !== undefined) ensure(p.prompt_id === session.prompt_id, 'stale_prompt');
      invalidateSelection(session, 'session_ended');
      session.ended = true;
      session.packet = null;
      session.token = null;
      session.bridge_id = null;
      session.last_poll = null;
      session.pending_claims = {};
      clearReadiness(session);
    } else {
      ensure(session.started, 'session_not_started');
      if (p.event === 'UserPromptSubmit') {
        uuid(p.prompt_id);
        const continuation = selectionContinuationForm(session, p.prompt_sha256);
        // An exact retry may only repeat the still-current, unclaimed delivery.
        // Another native prompt ID carrying the same message is a new input.
        if (continuation && session.selection.continuation_prompt_form === continuation && session.selection.continuation_prompt_id === p.prompt_id && session.prompt_id === p.prompt_id) {
          return { boundary_id: session.boundary_id, prompt_id: session.prompt_id };
        }
        ensure(!session.seen_prompts.includes(p.prompt_id), 'duplicate_prompt');
        ensure(session.seen_prompts.length < 10000, 'session_limit');
        if (continuation && session.selection.continuation_prompt_id === undefined) {
          session.selection.continuation_prompt_id = p.prompt_id;
          session.selection.continuation_prompt_form = continuation;
          promptKind = 'selection_channel';
        } else {
          if (session.selection?.status === 'claimed') {
            // New input supersedes the card, not the already claimed native
            // work. Its result may still be reported with current credentials.
            history('selection.superseded', { session_id: session.session_id, selection_id: session.selection.selection_id, claim_boundary_id: session.selection.claim_boundary_id, reason: 'new_user_prompt' });
            session.selection = null;
          } else invalidateSelection(session, 'new_user_prompt', false);
          session.boundary_id = randomUUID();
          session.packet = null;
          promptKind = 'user_or_unknown';
        }
        session.seen_prompts.push(p.prompt_id);
        session.prompt_id = p.prompt_id;
        session.stopped = false;
      } else if (p.event === 'Stop') {
        ensure(session.prompt_id !== null && p.prompt_id === session.prompt_id, 'stale_prompt');
        session.stopped = true;
      }
    }
    refreshPhase(session);
    history(`hook.${p.event}`, { session_id: session.session_id, boundary_id: session.boundary_id, prompt_id: session.prompt_id, ...(promptKind ? { prompt_kind: promptKind } : {}) });
    return { boundary_id: session.boundary_id, prompt_id: session.prompt_id };
  }
  function route(message) {
    fields(message, ['protocol', 'provider', 'type', 'payload'], ['auth']);
    ensure(message.protocol === PROTOCOL, 'protocol_mismatch');
    ensure(message.provider === PROVIDER, 'provider_mismatch');
    ensure(typeof message.type === 'string', 'invalid_type');
    if (message.auth !== undefined) string(message.auth, 256);
    rejectSecretReflection(message);
    if (message.type === 'health') {
      fields(message.payload, []);
      return { product: PRODUCT, provider: PROVIDER, protocol: PROTOCOL, version: 1 };
    }
    if (message.type === 'session.register') {
      fields(message.payload, ['session_id', 'cwd']);
      const session_id = uuid(message.payload.session_id), cwd = canonicalCwd(message.payload.cwd);
      ensure(!Object.hasOwn(state.sessions, session_id), 'session_exists');
      const sessions = Object.values(state.sessions);
      if (sessions.length >= LIMITS.sessions) {
        const ended = sessions.find(session => session.ended);
        ensure(ended, 'session_limit', 'at most eight sessions can use this development runtime');
        delete state.sessions[ended.session_id];
      }
      const session_token = token();
      state.known_secrets.add(session_token);
      state.sessions[session_id] = { session_id, cwd, token: session_token, started: false, ended: false, phase: 'awaiting_prompt', prompt_id: null, boundary_id: null, seen_prompts: [], packet: null, revision: 0, selection: null, pending_claims: {}, bridge_id: null, last_poll: null, readiness_probe: null, readiness: null, stopped: false };
      history('session.registered', { session_id, cwd });
      return { session_id, session_token };
    }
    if (message.type === 'hook') return hook(message);
    if (message.type === 'bridge.open') {
      fields(message.payload, ['session_id']);
      const session = authenticate(message);
      // This ID belongs to one logical MCP registration, not each short-lived
      // UDS request. Already claimed native work has not been stopped by a
      // transport replacement and must retain its existing claim state.
      invalidateSelection(session, 'bridge_replaced', false);
      session.bridge_id = randomUUID();
      session.last_poll = null;
      clearReadiness(session);
      refreshPhase(session);
      history('bridge.opened', { session_id: session.session_id, bridge_id: session.bridge_id });
      return { bridge_id: session.bridge_id };
    }
    if (message.type === 'bridge.close') {
      fields(message.payload, ['session_id', 'bridge_id']);
      const session = authenticateBridge(message);
      history('bridge.closed', { session_id: session.session_id, bridge_id: session.bridge_id });
      session.bridge_id = null;
      session.last_poll = null;
      clearReadiness(session);
      return { closed: true };
    }
    if (message.type === 'readiness.begin') {
      fields(message.payload, ['session_id', 'bridge_id']);
      const session = authenticateBridge(message);
      expireBridgeHeartbeat(session);
      clearReadiness(session);
      const probe = { probe_id: randomUUID(), nonce: token(), expires_at: now() + probeTTL, delivered: false };
      state.known_secrets.add(probe.nonce);
      session.readiness_probe = probe;
      history('readiness.started', { session_id: session.session_id, bridge_id: session.bridge_id, probe_id: probe.probe_id });
      return { probe_id: probe.probe_id, expires_at: probe.expires_at, status: 'awaiting_ack' };
    }
    if (message.type === 'readiness.ack') {
      fields(message.payload, ['session_id', 'bridge_id', 'probe_id', 'nonce']);
      const session = authenticateBridge(message), p = message.payload, probe = session.readiness_probe;
      uuid(p.probe_id);
      ensure(probe?.probe_id === p.probe_id && equalSecret(p.nonce, probe.nonce), 'invalid_probe');
      ensure(probe.delivered, 'probe_not_delivered');
      ensure(now() < probe.expires_at, 'probe_expired');
      ensure(connected(session), 'bridge_offline');
      session.readiness = { verified_at: now(), expires_at: now() + readinessTTL };
      session.readiness_probe = null;
      history('readiness.acknowledged', { session_id: session.session_id, bridge_id: session.bridge_id, probe_id: probe.probe_id });
      return { ready: true, expires_at: session.readiness.expires_at };
    }
    if (message.type === 'proposal.emit') {
      fields(message.payload, ['session_id', 'bridge_id', 'boundary_id', 'summary', 'options']);
      const session = authenticateBridge(message), p = message.payload;
      usableBoundary(session, p.boundary_id);
      ensure(!['selected', 'delivered'].includes(session.selection?.status), 'selection_pending');
      string(p.summary, LIMITS.summary, true);
      ensure(Array.isArray(p.options) && p.options.length >= 2 && p.options.length <= 4, 'invalid_options');
      const ids = new Set();
      for (const option of p.options) {
        fields(option, ['id', 'title', 'description', 'task', 'done_when']);
        for (const key of Object.keys(option)) string(option[key], LIMITS[key], !['id', 'title'].includes(key));
        ensure(/^[A-Za-z0-9_-]+$/.test(option.id) && !ids.has(option.id), 'invalid_option_id');
        ids.add(option.id);
      }
      const packet = { packet_id: randomUUID(), revision: session.revision + 1, summary: p.summary, options: structuredClone(p.options) };
      ensure(Buffer.byteLength(JSON.stringify(packet)) <= LIMITS.packet, 'packet_too_large');
      session.packet = packet;
      session.revision = packet.revision;
      refreshPhase(session);
      history('proposal.emitted', { session_id: session.session_id, boundary_id: session.boundary_id, packet_id: packet.packet_id, revision: packet.revision });
      return { packet_id: packet.packet_id, revision: packet.revision };
    }
    if (message.type === 'bridge.poll') {
      fields(message.payload, ['session_id', 'bridge_id']);
      const session = authenticateBridge(message);
      // A heartbeat after a liveness gap cannot revive an earlier receipt.
      // A freshly requested probe after that gap is still deliverable.
      expireBridgeHeartbeat(session);
      session.last_poll = now();
      const probe = session.readiness_probe;
      if (probe && now() >= probe.expires_at) session.readiness_probe = null;
      else if (probe && !probe.delivered) {
        probe.delivered = true;
        history('readiness.delivered', { session_id: session.session_id, bridge_id: session.bridge_id, probe_id: probe.probe_id });
        return { event: { kind: 'readiness_probe', probe_id: probe.probe_id, nonce: probe.nonce, expires_at: probe.expires_at } };
      }
      if (session.selection?.status === 'selected') {
        session.selection.status = 'delivered';
        refreshPhase(session);
        history('selection.delivered', { session_id: session.session_id, selection_id: session.selection.selection_id });
        return { event: { selection_id: session.selection.selection_id, delivery_token: session.selection.delivery_token } };
      }
      return { event: null };
    }
    if (message.type === 'selection.claim') {
      fields(message.payload, ['session_id', 'bridge_id', 'selection_id', 'delivery_token']);
      const session = authenticateBridge(message), p = message.payload, selection = session.selection;
      uuid(p.selection_id);
      ensure(selection?.selection_id === p.selection_id && equalSecret(p.delivery_token, selection.delivery_token), 'invalid_selection');
      ensure(selection.status === 'delivered', 'selection_already_claimed');
      ensure(selection.bridge_id === session.bridge_id && selection.boundary_id === session.boundary_id && session.packet?.packet_id === selection.packet_id && session.packet?.revision === selection.revision, 'stale_selection');
      ensure(Object.keys(session.pending_claims).length < LIMITS.pending_claims, 'pending_claim_limit');
      selection.status = 'claimed';
      delete selection.delivery_token;
      session.boundary_id = randomUUID();
      selection.claim_boundary_id = session.boundary_id;
      session.packet = null;
      session.stopped = false;
      // Keep only original task evidence, never delivery/authentication secrets
      // or executable rights. This map is not restored from the journal.
      const claim = {
        selection_id: selection.selection_id, option_id: selection.option_id,
        packet_id: selection.packet_id, revision: selection.revision,
        boundary_id: selection.boundary_id, claim_boundary_id: selection.claim_boundary_id,
        bridge_id: selection.bridge_id, prompt_id: session.prompt_id, cwd: session.cwd,
        task: selection.task, done_when: selection.done_when, claimed_at: new Date(now()).toISOString(),
      };
      session.pending_claims[selection.selection_id] = claim;
      refreshPhase(session);
      history('selection.claimed', { session_id: session.session_id, selection_id: selection.selection_id, boundary_id: session.boundary_id, claim });
      return { selection_id: selection.selection_id, task: selection.task, done_when: selection.done_when, boundary_id: session.boundary_id, prompt_id: session.prompt_id };
    }
    if (message.type === 'selection.complete') {
      fields(message.payload, ['session_id', 'bridge_id', 'selection_id', 'outcome', 'note']);
      const session = authenticateBridge(message), p = message.payload, selection = session.selection;
      uuid(p.selection_id);
      const claim = session.pending_claims[p.selection_id];
      ensure(claim, 'invalid_completion');
      ensure(['completed', 'failed'].includes(p.outcome), 'invalid_outcome');
      string(p.note, 1024, true);
      if (selection?.selection_id === p.selection_id && selection.status === 'claimed' && claim.claim_boundary_id === session.boundary_id) {
        selection.status = p.outcome;
        selection.note = p.note;
        selection.reported_by = 'model';
        refreshPhase(session);
      }
      delete session.pending_claims[p.selection_id];
      // Repeat the original evidence so a late result remains attributable even
      // after the bounded history has rotated its earlier claim event away.
      history('selection.completed', { session_id: session.session_id, selection_id: p.selection_id, outcome: p.outcome, note: p.note, reported_by: 'model', claim });
      return { recorded: true, reported_by: 'model' };
    }
    if (message.type === 'ui.list') {
      fields(message.payload, []);
      authenticateUI(message);
      return { sessions: Object.values(state.sessions).map(session => viewSession(session, connected(session), continuationReady(session))) };
    }
    if (message.type === 'ui.select') {
      fields(message.payload, ['session_id', 'packet_id', 'revision', 'option_id']);
      authenticateUI(message);
      const p = message.payload, session = state.sessions[uuid(p.session_id)];
      uuid(p.packet_id);
      ensure(session && !session.ended, 'unknown_session');
      ensure(session.packet?.packet_id === p.packet_id && Number.isSafeInteger(p.revision) && session.packet.revision === p.revision, 'stale_packet');
      ensure(session.phase === 'ready', 'not_ready');
      ensure(connected(session), 'bridge_offline');
      ensure(continuationReady(session), 'channel_unverified', 'a current channel receipt is required before selecting work');
      const option = session.packet.options.find(candidate => candidate.id === p.option_id);
      ensure(option, 'unknown_option');
      ensure(Object.keys(session.pending_claims).length < LIMITS.pending_claims, 'pending_claim_limit', 'report an outstanding claim result before selecting more work');
      session.selection = { selection_id: randomUUID(), option_id: option.id, packet_id: p.packet_id, revision: p.revision, boundary_id: session.boundary_id, bridge_id: session.bridge_id, status: 'selected', task: option.task, done_when: option.done_when, delivery_token: token() };
      state.known_secrets.add(session.selection.delivery_token);
      refreshPhase(session);
      history('selection.selected', { session_id: session.session_id, selection_id: session.selection.selection_id, option_id: option.id, packet_id: p.packet_id });
      return { selection_id: session.selection.selection_id, status: 'selected' };
    }
    throw new Rejection('unknown_type');
  }
  async function handle(message) {
    const before = structuredClone(state);
    try {
      const result = route(message);
      ensure(Buffer.byteLength(JSON.stringify({ ok: true, result })) + 1 <= MAX_MESSAGE_BYTES, 'response_too_large');
      const presentation = { ok: true, result: { sessions: Object.values(state.sessions).map(session => viewSession(session, connected(session), continuationReady(session))) } };
      ensure(Buffer.byteLength(JSON.stringify(presentation)) + 1 <= MAX_MESSAGE_BYTES, 'ui_capacity_exceeded', 'session cards exceed the bounded UI response capacity');
      // Empty polls only update the in-memory bridge heartbeat. A delivered
      // selection must be committed before its one-shot event leaves this server.
      if (!['health', 'ui.list'].includes(message.type) && !(message.type === 'bridge.poll' && result.event === null)) await persist();
      return { ok: true, result };
    } catch (error) {
      state = before;
      if (error instanceof Rejection) return { ok: false, error: { code: error.code, message: error.message } };
      return { ok: false, error: { code: 'storage_failure', message: 'coordinator could not durably record this operation' } };
    }
  }
  server.on('connection', socket => {
    if (clients.size >= 64) { socket.destroy(); return; }
    clients.add(socket);
    const deadline = setTimeout(() => { fail('request_timeout'); socket.destroy(); }, connectionTimeout);
    socket.once('close', () => { clearTimeout(deadline); clients.delete(socket); });
    socket.on('error', () => {});
    let bytes = Buffer.alloc(0), handled = false;
    function fail(code, message = code) {
      if (handled) return;
      handled = true;
      socket.end(JSON.stringify({ ok: false, error: { code, message } }) + '\n');
    }
    socket.setTimeout(connectionTimeout, () => { fail('request_timeout'); socket.destroy(); });
    socket.on('data', chunk => {
      if (handled) return;
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > MAX_MESSAGE_BYTES) return fail('request_too_large');
      const newline = bytes.indexOf(10);
      if (newline === -1) return;
      if (bytes.subarray(newline + 1).toString().trim()) return fail('invalid_frame', 'one request per connection is required');
      let message;
      try { message = JSON.parse(bytes.subarray(0, newline).toString('utf8')); }
      catch { return fail('invalid_json'); }
      handled = true;
      queue = queue.then(async () => {
        if (closed || socket.destroyed) return;
        const response = await handle(message);
        socket.end(JSON.stringify(response) + '\n');
      }).catch(() => { socket.destroy(); });
    });
  });

  async function cleanupInternal() {
    closed = true;
    for (const client of clients) client.destroy();
    await queue;
    if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
    if (socketIdentity) {
      const stat = await fs.lstat(socketFile).catch(() => null);
      if (stat?.ino === socketIdentity.ino && stat?.dev === socketIdentity.dev) await fs.unlink(socketFile).catch(() => {});
    }
    if (lockHandle) {
      const owned = await lockHandle.stat().catch(() => null);
      const actual = await fs.lstat(lockPath).catch(() => null);
      await lockHandle.close(); lockHandle = undefined;
      if (owned && actual?.ino === owned.ino && actual?.dev === owned.dev) await fs.unlink(lockPath).catch(() => {});
    }
  }
  function cleanup() { closePromise ??= cleanupInternal(); return closePromise; }
  try {
    try { lockHandle = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Rejection('runtime_locked', 'Claude coordinator runtime is already locked; stop its owner or inspect a stale lock before using a new runtime');
      throw error;
    }
    await lockHandle.writeFile(JSON.stringify({ product: PRODUCT, pid: process.pid, boot_id: state.boot_id }) + '\n');
    await lockHandle.sync();
    const existing = await fs.lstat(socketFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    ensure(!existing, 'socket_exists', 'Claude socket already exists; its owner must be identified before removal, or choose a fresh runtime');
    const journalStat = await fs.lstat(journalPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (journalStat) {
      ensure(journalStat.isFile() && !journalStat.isSymbolicLink() && journalStat.uid === process.getuid() && (journalStat.mode & 0o077) === 0 && journalStat.size <= 8 * 1024 * 1024, 'unsafe_journal');
      const previous = JSON.parse(await fs.readFile(journalPath, 'utf8'));
      ensure(previous.product === PRODUCT && previous.protocol === PROTOCOL && previous.version === 1 && Array.isArray(previous.history) && Array.isArray(previous.sessions), 'invalid_journal');
      state.history = previous.history.slice(-900);
      history('runtime.restarted', { previous_boot_id: previous.boot_id, invalidated_session_ids: previous.sessions.map(session => session.session_id) });
    } else history('runtime.started');
    await persist();
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(socketFile, () => { server.off('error', reject); resolveListen(); });
    });
    socketIdentity = await fs.lstat(socketFile);
    await fs.chmod(socketFile, 0o600);
    server.on('error', () => {});
    return { runtime: runtimeDirectory, socket: socketFile, close: cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function main() {
  const ownerPID = process.ppid;
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--runtime' || !isAbsolute(args[1])) throw new Error('usage: node service.mjs --runtime ABSOLUTE_CLAUDE_RUNTIME');
  const coordinator = await startCoordinator({ runtime: args[1], uiToken: process.env.BLABEE_CLAUDE_UI_TOKEN });
  let stopping = false, parentWatch;
  function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(parentWatch);
    coordinator.close().then(() => process.exit(0), () => process.exit(1));
  }
  // The development service belongs to its launching Pet process. Reparenting
  // after an abrupt Pet exit must release this service's own lock and socket;
  // no other process is looked up or signalled by this check.
  function checkParent() { if (process.ppid !== ownerPID || process.ppid <= 1) stop(); }
  parentWatch = setInterval(checkParent, 1000);
  parentWatch.unref();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  checkParent();
  if (stopping) return;
  process.stdout.write(JSON.stringify({ product: PRODUCT, status: 'ready' }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`blabee-claude coordinator: ${error.message}\n`); process.exitCode = 1; });
}
