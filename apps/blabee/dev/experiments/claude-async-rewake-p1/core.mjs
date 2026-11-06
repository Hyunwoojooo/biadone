// P1 development instrument only: no product imports, Claude process, network, or execution claims.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const MODES = Object.freeze({
  'async-exit0': { async: true, exitCode: 0 },
  'rewake-exit0': { asyncRewake: true, exitCode: 0 },
  'rewake-exit2': { asyncRewake: true, exitCode: 2 },
});
export const EVENTS = Object.freeze(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']);
export const WAIT_MS = 5_000;
export const INPUT_LIMIT = 65_536;
const FILE_LIMIT = 524_288;
const EVENT_LIMIT = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HERE = dirname(fileURLToPath(import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const mono = () => process.hrtime.bigint();
const runtime = { now: mono, sleep: (ms, signal) => delay(ms, undefined, { signal }) };
const fixtureError = (code) => Object.assign(new Error(code), { fixtureCode: code });
export function check(condition, code) { if (!condition) throw fixtureError(code); }
export function safeError(error) { return error.fixtureCode ?? 'io_or_runtime_failure'; }

function privateFile(path, max = FILE_LIMIT) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    check(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid()
      && (stat.mode & 0o077) === 0 && stat.size <= max, 'unsafe_file');
    const bytes = readFileSync(fd);
    check(bytes.length <= max, 'file_too_large');
    return bytes;
  } finally { closeSync(fd); }
}

function parseJSON(bytes, code) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw fixtureError(code); }
}

function writeNew(path, value) {
  writeFileSync(path, value, { mode: 0o600, flag: 'wx' });
}

export function settingsFor(run, nodePath = process.execPath, hookPath = join(HERE, 'hook.mjs')) {
  const profile = MODES[run.mode];
  check(profile, 'unknown_mode');
  const hooks = Object.fromEntries(EVENTS.map((event) => {
    const command = {
      type: 'command', command: '/usr/bin/env',
      args: ['-u', 'NODE_OPTIONS', '-u', 'NODE_PATH', nodePath, hookPath,
        '--run', run.directory, '--event', event],
      timeout: event === 'Stop' ? 15 : 5,
    };
    if (event === 'Stop') command[profile.async ? 'async' : 'asyncRewake'] = true;
    return [event, [{ hooks: [command] }]];
  }));
  return { syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, hooks };
}

// Preparation writes only a new explicitly named directory; it never starts Claude.
export function prepareRun(directory, mode, origin = 'native-prepared') {
  check(isAbsolute(directory) && Object.hasOwn(MODES, mode), 'invalid_run_arguments');
  check(['synthetic', 'native-prepared'].includes(origin), 'invalid_origin');
  directory = join(realpathSync(dirname(resolve(directory))), basename(resolve(directory)));
  mkdirSync(directory, { mode: 0o700 }); // Existing directories/symlinks are rejected, never overwritten.
  mkdirSync(join(directory, 'project'), { mode: 0o700 });
  const createdAt = Date.now();
  const run = {
    schema_version: 1, directory, run_id: randomUUID(), mode, origin,
    session_id: randomUUID(), salt: randomBytes(32).toString('hex'),
    ack: `P1_ACK_${randomBytes(8).toString('hex').toUpperCase()}`,
    node_path: process.execPath, node_version: process.version,
    wait_ms: WAIT_MS, created_at_ms: createdAt, expires_at_ms: createdAt + 30 * 60_000,
    source_hashes: Object.fromEntries(['core.mjs', 'hook.mjs'].map((file) => [file, hash(readFileSync(join(HERE, file)))])),
  };
  const settings = `${JSON.stringify(settingsFor(run), null, 2)}\n`;
  run.settings_sha256 = hash(settings);
  writeNew(join(directory, 'settings.json'), settings);
  writeNew(join(directory, 'mcp-empty.json'), '{"mcpServers":{}}\n');
  const manifestText = `${JSON.stringify(run, null, 2)}\n`;
  writeNew(join(directory, 'manifest.json'), manifestText);
  writeNew(join(directory, 'events.jsonl'), `${JSON.stringify({
    schema_version: 1, run_id: run.run_id, sequence: 1, configuration_hash: hash(manifestText),
    event: 'run_prepared', invocation_id: randomUUID(), wall_time: new Date().toISOString(),
    monotonic_ns: mono().toString(), details: { origin, native_execution: 'NOT_RUN' },
  })}\n`);
  writeNew(join(directory, 'launch-args.json'), `${JSON.stringify([
    '--session-id', run.session_id, '--setting-sources', '',
    '--settings', join(directory, 'settings.json'), '--tools', '',
    '--strict-mcp-config', '--mcp-config', join(directory, 'mcp-empty.json'),
  ], null, 2)}\n`);
  writeNew(join(directory, 'observations.json'), `${JSON.stringify({
    native_execution: 'NOT_RUN', claude_version: null, os_version: null,
    same_session_wake: 'NOT_OBSERVED', hook_error_ui: 'NOT_OBSERVED',
    tools_verified_empty: false, isolation_verified: false,
  }, null, 2)}\n`);
  return run;
}

export function readRun(directory) {
  check(isAbsolute(directory) && resolve(directory) === directory, 'invalid_run_path');
  const stat = lstatSync(directory);
  check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
    && (stat.mode & 0o077) === 0 && realpathSync(directory) === directory, 'unsafe_run_directory');
  const bytes = privateFile(join(directory, 'manifest.json'), 16_384);
  const run = parseJSON(bytes, 'manifest_invalid');
  check(run.schema_version === 1 && run.directory === directory && UUID.test(run.run_id)
    && UUID.test(run.session_id) && /^[0-9a-f]{64}$/.test(run.salt)
    && /^P1_ACK_[A-F0-9]{16}$/.test(run.ack) && Object.hasOwn(MODES, run.mode)
    && ['synthetic', 'native-prepared'].includes(run.origin) && run.wait_ms === WAIT_MS
    && typeof run.node_path === 'string' && isAbsolute(run.node_path)
    && Number.isSafeInteger(run.created_at_ms) && Number.isSafeInteger(run.expires_at_ms)
    && run.expires_at_ms - run.created_at_ms <= 30 * 60_000
    && run.expires_at_ms > run.created_at_ms, 'manifest_invalid');
  check(hash(privateFile(join(directory, 'settings.json'))) === run.settings_sha256, 'settings_changed');
  check(JSON.stringify(parseJSON(privateFile(join(directory, 'settings.json')), 'settings_invalid'))
    === JSON.stringify(settingsFor(run, run.node_path)), 'profile_changed');
  for (const file of ['core.mjs', 'hook.mjs']) {
    check(run.source_hashes?.[file] === hash(readFileSync(join(HERE, file))), 'source_changed');
  }
  return { ...run, fingerprint: hash(bytes) };
}

function readEvents(run) {
  const text = privateFile(join(run.directory, 'events.jsonl')).toString('utf8');
  check(text === '' || text.endsWith('\n'), 'events_truncated');
  const rows = text.trim() ? text.trimEnd().split('\n').map((line) => parseJSON(Buffer.from(line), 'events_invalid')) : [];
  check(rows.length > 0 && rows.length <= EVENT_LIMIT && rows[0].event === 'run_prepared', 'events_invalid');
  for (const [index, row] of rows.entries()) {
    check(row?.schema_version === 1 && row.run_id === run.run_id && row.sequence === index + 1
      && typeof row.event === 'string' && /^[0-9]+$/.test(row.monotonic_ns)
      && UUID.test(row.invocation_id) && typeof row.details === 'object' && row.details !== null, 'events_invalid');
    check(row.configuration_hash === run.fingerprint, 'run_configuration_changed');
  }
  return rows;
}

async function transaction(directory, update, clock = mono) {
  readRun(directory);
  const lock = join(directory, 'writer.lock');
  const started = mono();
  while (true) {
    try { mkdirSync(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      check(Number(mono() - started) / 1e6 < 500, 'lock_busy');
      await delay(10);
    }
  }
  try {
    const run = readRun(directory); // Recheck after a contending writer released the lock.
    const rows = readEvents(run);
    const originalLength = rows.length;
    const append = (event, invocation, details = {}) => {
      check(rows.length < EVENT_LIMIT, 'event_limit');
      rows.push({ schema_version: 1, run_id: run.run_id, sequence: rows.length + 1,
        configuration_hash: run.fingerprint,
        event, invocation_id: invocation, wall_time: new Date().toISOString(),
        monotonic_ns: clock().toString(), details });
    };
    const value = update(run, rows, append);
    if (rows.length !== originalLength) {
      const bytes = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
      check(Buffer.byteLength(bytes) <= FILE_LIMIT, 'file_too_large');
      const temporary = join(directory, `.events-${randomUUID()}.tmp`);
      try { writeNew(temporary, bytes); renameSync(temporary, join(directory, 'events.jsonl')); }
      finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    }
    return value;
  } finally { rmdirSync(lock); }
}

function localHash(run, kind, value) { return hash(`${run.salt}:${kind}:${value}`); }
function expectedCwd(run) { return join(run.directory, 'project'); }
function cancellationLatched(run) {
  try { lstatSync(join(run.directory, 'cancelled')); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
const isCancelled = (run, rows) => cancellationLatched(run) || rows.some((row) => row.event === 'run_cancelled');

function observation(run, input, expectedEvent) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'input_invalid');
  check(EVENTS.includes(expectedEvent) && input.hook_event_name === expectedEvent, 'event_mismatch');
  check(typeof input.session_id === 'string' && UUID.test(input.session_id)
    && typeof input.cwd === 'string' && input.cwd.length <= 4096, 'identity_missing');
  if (input.prompt_id !== undefined) check(typeof input.prompt_id === 'string' && UUID.test(input.prompt_id), 'prompt_id_invalid');
  const notice = `Blabee P1 연결 관측입니다. 도구를 사용하지 말고 ${run.ack} 한 줄만 응답해 주세요.\n`;
  const expectedWake = '<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n'
    + '<system-reminder>\nStop hook blocking error from command "Stop": ' + notice + '\n</system-reminder>';
  return {
    hook_event_name: expectedEvent,
    session_hash: localHash(run, 'session', input.session_id),
    cwd_hash: localHash(run, 'cwd', input.cwd),
    prompt_id_observed: input.prompt_id !== undefined,
    prompt_text_sha256: expectedEvent === 'UserPromptSubmit' && typeof input.prompt === 'string' ? hash(input.prompt) : null,
    expected_wake_prompt_matches: expectedEvent === 'UserPromptSubmit' && input.prompt === expectedWake,
    prompt_hash: input.prompt_id ? localHash(run, 'prompt', input.prompt_id) : null,
    stop_hook_active: typeof input.stop_hook_active === 'boolean' ? input.stop_hook_active : null,
    background_tasks_count: Array.isArray(input.background_tasks) ? input.background_tasks.length : null,
    session_crons_count: Array.isArray(input.session_crons) ? input.session_crons.length : null,
    subagent: input.agent_id !== undefined,
    source: ['startup', 'resume', 'clear', 'compact'].includes(input.source) ? input.source : null,
    identity_matches: input.session_id === run.session_id && input.cwd === expectedCwd(run)
      && input.agent_id === undefined,
    ack_exact: expectedEvent === 'Stop' && input.session_id === run.session_id
      && input.cwd === expectedCwd(run) && input.agent_id === undefined && input.last_assistant_message === run.ack,
  };
}

export async function processHook(directory, expectedEvent, input, options = {}) {
  try { return await processObservedHook(directory, expectedEvent, input, options); }
  catch (error) {
    // Observation uncertainty must not leave an older waiter eligible to notify.
    try { await cancelRun(directory, 'observation_error'); } catch { /* A latch survives writer-lock failure; unreadable state is not repaired. */ }
    throw error;
  }
}

async function processObservedHook(directory, expectedEvent, input, options) {
  input = structuredClone(input);
  const { now, sleep } = { ...runtime, ...options };
  const invocation = randomUUID();
  const started = await transaction(directory, (run, rows, append) => {
    const details = observation(run, input, expectedEvent);
    append('hook_observed', invocation, details);
    const suppress = (reason) => { append('hook_suppressed', invocation, { reason }); return null; };
    if (input.session_id !== run.session_id || input.cwd !== expectedCwd(run)) return suppress('wrong_session_or_cwd');
    if (details.subagent) return suppress('subagent');
    if (Date.now() < run.created_at_ms || Date.now() >= run.expires_at_ms) return suppress('run_expired');
    const bound = rows.some((row) => row.event === 'session_bound');
    if (expectedEvent === 'SessionStart') {
      if (!bound && input.source === 'startup' && !isCancelled(run, rows)) append('session_bound', invocation);
      else append('run_cancelled', invocation, { reason: 'session_restarted_or_not_fresh' });
      return null;
    }
    if (!bound) return suppress('session_start_required');
    if (expectedEvent === 'SessionEnd') {
      append('run_cancelled', invocation, { reason: 'session_end' });
      return null;
    }
    if (expectedEvent === 'UserPromptSubmit') {
      const existing = rows.some((row) => row.event === 'prompt_observed');
      append('prompt_observed', invocation, { prompt_hash: details.prompt_hash });
      if (existing) append('run_cancelled', invocation, { reason: 'new_prompt' });
      return null;
    }
    if (isCancelled(run, rows)) return suppress('cancelled');
    if (rows.some((row) => row.event === 'wait_started')) return suppress('one_attempt_per_run');
    const prompt = rows.find((row) => row.event === 'prompt_observed');
    if (!prompt?.details.prompt_hash || details.prompt_hash !== prompt.details.prompt_hash) return suppress('prompt_not_matched');
    if (details.stop_hook_active !== false) return suppress('stop_active_or_unknown');
    if (details.background_tasks_count !== 0 || details.session_crons_count !== 0) return suppress('idle_not_confirmed');
    append('wait_started', invocation, { wait_ms: WAIT_MS, mode: run.mode, prompt_hash: details.prompt_hash });
    return rows.at(-1).monotonic_ns;
  }, now);
  if (started === null) return { exitCode: 0, stdout: '', stderr: '' };

  let interrupted = false;
  try { await sleep(WAIT_MS, options.signal); }
  catch (error) { if (error.name === 'AbortError') interrupted = true; else throw error; }
  return transaction(directory, (run, rows, append) => {
    const waiter = rows.find((row) => row.event === 'wait_started' && row.invocation_id === invocation);
    check(waiter?.monotonic_ns === started, 'waiter_missing');
    if (interrupted || options.signal?.aborted) append('run_cancelled', invocation, { reason: 'hook_signal' });
    const elapsed = Number(now() - BigInt(started)) / 1e6;
    const reason = isCancelled(run, rows) ? 'cancelled'
      : Date.now() < run.created_at_ms || Date.now() >= run.expires_at_ms ? 'run_expired'
        : elapsed < WAIT_MS ? 'wait_incomplete'
          : rows.some((row) => row.event === 'hook_exit_committed') ? 'already_committed' : null;
    if (reason) {
      append('wake_suppressed', invocation, { reason, elapsed_ms: elapsed });
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    const exitCode = MODES[run.mode].exitCode;
    // Atomic local commitment precedes stdout/stderr. It is NOT proof of process exit/delivery.
    append('hook_exit_committed', invocation, { planned_exit_code: exitCode, elapsed_ms: elapsed });
    return {
      exitCode, stdout: '',
      stderr: exitCode === 2
        ? `Blabee P1 연결 관측입니다. 도구를 사용하지 말고 ${run.ack} 한 줄만 응답해 주세요.\n` : '',
    };
  }, now);
}

export function cancelRun(directory, reason = 'operator_cancel') {
  check(['operator_cancel', 'observation_error'].includes(reason), 'cancel_reason_invalid');
  const run = readRun(directory);
  // An atomic, content-free latch does not wait for the journal writer. It only denies wake.
  // Never clear or follow it; even an unexpected existing entry means this run is cancelled.
  try { mkdirSync(join(run.directory, 'cancelled'), { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return transaction(directory, (_run, _rows, append) => {
    append('run_cancelled', randomUUID(), { reason });
  });
}

export function reportRun(directory) {
  const run = readRun(directory);
  const rows = readEvents(run);
  const counts = {};
  for (const row of rows) counts[row.event] = (counts[row.event] ?? 0) + 1;
  return {
    run_id: run.run_id, mode: run.mode, input_origin_label: run.origin,
    native_qualification: 'NOT_EVALUATED', // Never infer native success from injected stdin/exit intent.
    cancellation_latched: cancellationLatched(run),
    counts,
    planned_exits: rows.filter((row) => row.event === 'hook_exit_committed').map((row) => row.details),
    hook_ack_match_count: rows.filter((row) => row.event === 'hook_observed' && row.details.ack_exact).length,
    observed_prompt_hashes: [...new Set(rows.filter((row) => row.event === 'hook_observed')
      .map((row) => row.details.prompt_hash).filter(Boolean))],
    suppression_reasons: rows.filter((row) => ['hook_suppressed', 'wake_suppressed'].includes(row.event)).map((row) => row.details.reason),
    limitations: ['stdin_provenance_not_authenticated', 'exit_commit_not_delivery',
      'human_native_observations_required', 'no_claim_or_action_execution'],
  };
}

export function parseArguments(argv, required, optional = []) {
  check(argv.length % 2 === 0, 'arguments_invalid');
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    check([...required, ...optional].includes(argv[i]) && !Object.hasOwn(values, argv[i]), 'arguments_invalid');
    values[argv[i]] = argv[i + 1];
  }
  check(required.every((key) => Object.hasOwn(values, key)), 'arguments_invalid');
  return values;
}
