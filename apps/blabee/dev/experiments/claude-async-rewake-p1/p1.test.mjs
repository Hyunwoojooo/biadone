import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  EVENTS, INPUT_LIMIT, MODES, WAIT_MS, cancelRun, prepareRun, processHook, readRun, reportRun, settingsFor,
} from './core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
function fixture(t, mode = 'rewake-exit2') {
  const parent = mkdtempSync(join(tmpdir(), 'blabee-p1-tools-'));
  chmodSync(parent, 0o700);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const run = prepareRun(join(parent, 'private run'), mode, 'synthetic');
  return { run, parent, promptId: randomUUID() };
}
function input(context, event, extra = {}) {
  return {
    session_id: context.run.session_id, cwd: join(context.run.directory, 'project'),
    hook_event_name: event, prompt_id: context.promptId,
    ...(event === 'SessionStart' ? { source: 'startup' } : {}),
    ...(event === 'Stop' ? { stop_hook_active: false, background_tasks: [], session_crons: [] } : {}),
    ...extra,
  };
}
async function ready(context) {
  for (const event of ['SessionStart', 'UserPromptSubmit']) {
    assert.equal((await processHook(context.run.directory, event, input(context, event))).exitCode, 0);
  }
}
function fakeWait() {
  let ns = process.hrtime.bigint();
  return { now: () => ns, sleep: async (ms) => { ns += BigInt(ms) * 1_000_000n; } };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const rejectCode = (promise, code) => assert.rejects(promise, { fixtureCode: code });

// Only the fixture's Node script is spawned. No shell, Claude, app, inherited credentials, or network.
function launchHook(t, context, event, raw, { leaveInputOpen = false } = {}) {
  const child = spawn(process.execPath, [join(here, 'hook.mjs'), '--run', context.run.directory, '--event', event], {
    cwd: context.run.directory, stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: dirname(process.execPath), LANG: 'C.UTF-8' },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.on('error', () => {}); // Size-limit rejection can close the pipe before the writer finishes.
  const start = process.hrtime.bigint();
  const result = new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveResult({ code, signal, stdout, stderr,
      elapsedMs: Number(process.hrtime.bigint() - start) / 1e6 }));
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 12_000);
  result.finally(() => clearTimeout(deadline));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  if (raw !== undefined) child.stdin.write(typeof raw === 'string' ? raw : JSON.stringify(raw));
  if (!leaveInputOpen) child.stdin.end();
  return { child, result };
}

for (const mode of Object.keys(MODES)) {
  test(`${mode}: prepared settings, fixed wait, private files, fake-clock result`, async (t) => {
    const context = fixture(t, mode);
    const { run } = context;
    assert.equal(statSync(run.directory).mode & 0o777, 0o700);
    for (const name of ['manifest.json', 'settings.json', 'events.jsonl', 'launch-args.json']) {
      assert.equal(statSync(join(run.directory, name)).mode & 0o777, 0o600);
    }
    const settings = JSON.parse(readFileSync(join(run.directory, 'settings.json')));
    assert.equal(settings.syncClaudeAiPlugins, false);
    assert.equal(settings.disableClaudeAiConnectors, true);
    assert.deepEqual(Object.keys(settings.hooks), EVENTS);
    const command = settings.hooks.Stop[0].hooks[0];
    assert.equal(command.type, 'command');
    assert.equal(command.command, '/usr/bin/env');
    assert.equal(command.args.includes(run.directory), true); // Paths with spaces remain one argv element.
    assert.equal(command.timeout, 15);
    assert.equal(command[mode === 'async-exit0' ? 'async' : 'asyncRewake'], true);
    assert.equal(command[mode === 'async-exit0' ? 'asyncRewake' : 'async'], undefined);
    const args = JSON.parse(readFileSync(join(run.directory, 'launch-args.json')));
    assert.equal(args[args.indexOf('--session-id') + 1], run.session_id);
    assert.equal(args[args.indexOf('--tools') + 1], '');
    assert.equal(args.includes('--dangerously-load-development-channels'), false);
    await ready(context);
    const result = await processHook(run.directory, 'Stop', input(context, 'Stop'), fakeWait());
    assert.equal(result.exitCode, MODES[mode].exitCode);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes(run.ack), mode === 'rewake-exit2');
    const report = reportRun(run.directory);
    assert.equal(report.counts.wait_started, 1);
    assert.equal(report.planned_exits[0].elapsed_ms, WAIT_MS);
    assert.equal(report.native_qualification, 'NOT_EVALUATED');
  });
}

test('settings examples match the generator and contain no real user paths', () => {
  const examples = JSON.parse(readFileSync(join(here, 'settings.examples.json')));
  for (const mode of Object.keys(MODES)) {
    assert.deepEqual(examples[mode], settingsFor({ mode, directory: '/ABSOLUTE/PRIVATE-RUN' },
      '/ABSOLUTE/PATH/TO/node', '/ABSOLUTE/P1/hook.mjs'));
  }
});

test('native wake observations compare the complete prompt without logging its text', async (t) => {
  const context = fixture(t);
  await ready(context);
  const result = await processHook(context.run.directory, 'Stop', input(context, 'Stop'), fakeWait());
  const prompt = '<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n'
    + '<system-reminder>\nStop hook blocking error from command "Stop": ' + result.stderr + '\n</system-reminder>';
  await processHook(context.run.directory, 'UserPromptSubmit', input(context, 'UserPromptSubmit', {
    prompt_id: randomUUID(), prompt,
  }));
  const rows = readFileSync(join(context.run.directory, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const details = rows.filter(row => row.event === 'hook_observed').at(-1).details;
  assert.equal(details.expected_wake_prompt_matches, true);
  assert.match(details.prompt_text_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(rows).includes(context.run.ack), false);
});

test('concurrent Stop calls and later Stop/UPS never reset the consumed run', async (t) => {
  const context = fixture(t);
  await ready(context);
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    processHook(context.run.directory, 'Stop', input(context, 'Stop'), fakeWait())));
  assert.equal(results.filter((result) => result.exitCode === 2).length, 1);
  await processHook(context.run.directory, 'UserPromptSubmit', input(context, 'UserPromptSubmit', { prompt_id: randomUUID() }));
  const later = await processHook(context.run.directory, 'Stop', input(context, 'Stop'), fakeWait());
  assert.equal(later.exitCode, 0);
  assert.equal(later.stderr, '');
  const report = reportRun(context.run.directory);
  assert.equal(report.counts.wait_started, 1);
  assert.equal(report.counts.hook_exit_committed, 1);
});

for (const change of ['operator', 'prompt', 'end', 'restart']) {
  test(`${change} during the wait suppresses exit 2; wait holds no writer lock`, async (t) => {
    const context = fixture(t);
    await ready(context);
    const entered = deferred();
    const release = deferred();
    const clock = fakeWait();
    const pending = processHook(context.run.directory, 'Stop', input(context, 'Stop'), {
      now: clock.now, sleep: async (ms) => { entered.resolve(); await release.promise; await clock.sleep(ms); },
    });
    await entered.promise;
    if (change === 'operator') await cancelRun(context.run.directory);
    if (change === 'prompt') await processHook(context.run.directory, 'UserPromptSubmit', input(context, 'UserPromptSubmit', { prompt_id: randomUUID() }));
    if (change === 'end') await processHook(context.run.directory, 'SessionEnd', input(context, 'SessionEnd'));
    if (change === 'restart') await processHook(context.run.directory, 'SessionStart', input(context, 'SessionStart', { source: 'resume' }));
    release.resolve();
    const result = await pending;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.equal(reportRun(context.run.directory).counts.hook_exit_committed, undefined);
  });
}

for (const event of ['UserPromptSubmit', 'SessionEnd']) {
  test(`regression: invalid ${event} observation cancels an already waiting Stop`, async (t) => {
    const context = fixture(t);
    await ready(context);
    const entered = deferred();
    const release = deferred();
    const clock = fakeWait();
    const pending = processHook(context.run.directory, 'Stop', input(context, 'Stop'), {
      now: clock.now, sleep: async (ms) => { entered.resolve(); await release.promise; await clock.sleep(ms); },
    });
    await entered.promise;
    await rejectCode(processHook(context.run.directory, event, input(context, event, { prompt_id: 'invalid' })), 'prompt_id_invalid');
    release.resolve();
    const result = await pending;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.equal(reportRun(context.run.directory).counts.hook_exit_committed, undefined);
  });
}

test('regression: malformed/oversized CLI observations invalidate an older pending waiter', async (t) => {
  const context = fixture(t);
  await ready(context);
  const entered = deferred();
  const release = deferred();
  const clock = fakeWait();
  const pending = processHook(context.run.directory, 'Stop', input(context, 'Stop'), {
    now: clock.now, sleep: async (ms) => { entered.resolve(); await release.promise; await clock.sleep(ms); },
  });
  await entered.promise;
  const failures = await Promise.all([
    launchHook(t, context, 'UserPromptSubmit', 'NOT_JSON_PRIVATE').result,
    launchHook(t, context, 'SessionEnd', 'x'.repeat(INPUT_LIMIT + 1)).result,
  ]);
  assert.ok(failures.every(({ code }) => code === 1));
  release.resolve();
  const result = await pending;
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

for (const trigger of ['malformed-cli', 'observer-lock-busy', 'operator-cancel']) {
  test(`regression: ${trigger} latches cancellation even when its journal write cannot acquire the lock`, async (t) => {
    const context = fixture(t);
    await ready(context);
    const entered = deferred();
    const release = deferred();
    const clock = fakeWait();
    const pending = processHook(context.run.directory, 'Stop', input(context, 'Stop'), {
      now: clock.now, sleep: async (ms) => { entered.resolve(); await release.promise; await clock.sleep(ms); },
    });
    await entered.promise;
    const lock = join(context.run.directory, 'writer.lock');
    mkdirSync(lock, { mode: 0o700 });
    try {
      if (trigger === 'malformed-cli') {
        const failed = await launchHook(t, context, 'UserPromptSubmit', 'NOT_JSON_PRIVATE').result;
        assert.equal(failed.code, 1);
      } else if (trigger === 'observer-lock-busy') {
        await rejectCode(processHook(context.run.directory, 'UserPromptSubmit', input(context, 'UserPromptSubmit')), 'lock_busy');
      } else {
        await rejectCode(cancelRun(context.run.directory), 'lock_busy');
      }
      const report = reportRun(context.run.directory);
      assert.equal(report.cancellation_latched, true);
      assert.equal(report.counts.run_cancelled, undefined); // Journal write failed; the independent latch is essential.
      assert.equal(statSync(join(context.run.directory, 'cancelled')).mode & 0o777, 0o700);
    } finally {
      rmdirSync(lock);
      release.resolve();
    }
    const result = await pending;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.equal(reportRun(context.run.directory).counts.hook_exit_committed, undefined);
  });
}

for (const change of ['session', 'cwd', 'subagent', 'prompt', 'stop-active', 'missing-prompt', 'busy', 'unknown-idle']) {
  test(`wrong or unknown ${change} cannot arm a wake`, async (t) => {
    const context = fixture(t);
    await ready(context);
    const stop = input(context, 'Stop');
    if (change === 'session') stop.session_id = randomUUID();
    if (change === 'cwd') stop.cwd = '/wrong/project';
    if (change === 'subagent') stop.agent_id = 'untrusted-subagent';
    if (change === 'prompt') stop.prompt_id = randomUUID();
    if (change === 'stop-active') stop.stop_hook_active = true;
    if (change === 'missing-prompt') delete stop.prompt_id;
    if (change === 'busy') stop.background_tasks = [{ command: 'must-not-be-logged' }];
    if (change === 'unknown-idle') delete stop.background_tasks;
    const result = await processHook(context.run.directory, 'Stop', stop, {
      sleep: async () => assert.fail('rejected input must not start waiting'),
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.equal(reportRun(context.run.directory).counts.wait_started, undefined);
  });
}

test('fresh SessionStart and first prompt are required; missing prompt IDs are never invented', async (t) => {
  const context = fixture(t);
  await processHook(context.run.directory, 'Stop', input(context, 'Stop'));
  await processHook(context.run.directory, 'SessionStart', input(context, 'SessionStart'));
  const prompt = input(context, 'UserPromptSubmit');
  delete prompt.prompt_id;
  await processHook(context.run.directory, 'UserPromptSubmit', prompt);
  await processHook(context.run.directory, 'Stop', input(context, 'Stop'));
  const report = reportRun(context.run.directory);
  assert.equal(report.counts.wait_started, undefined);
  assert.deepEqual(report.suppression_reasons, ['session_start_required', 'prompt_not_matched']);
});

test('input observations redact prompt, transcript, message, cwd, IDs, and task descriptions', async (t) => {
  const context = fixture(t);
  await ready(context);
  await processHook(context.run.directory, 'Stop', input(context, 'Stop', {
    prompt: 'PRIVATE_PROMPT', transcript_path: '/private/SECRET_TRANSCRIPT',
    last_assistant_message: 'PRIVATE_RESPONSE', permission_mode: 'PRIVATE_MODE',
    background_tasks: [{ description: 'PRIVATE_TASK', command: 'PRIVATE_COMMAND' }],
  }));
  const log = readFileSync(join(context.run.directory, 'events.jsonl'), 'utf8');
  for (const privateText of [context.run.session_id, context.promptId, context.run.directory,
    'PRIVATE_PROMPT', 'SECRET_TRANSCRIPT', 'PRIVATE_RESPONSE', 'PRIVATE_MODE', 'PRIVATE_TASK', 'PRIVATE_COMMAND']) {
    assert.equal(log.includes(privateText), false);
  }
  await processHook(context.run.directory, 'Stop', input(context, 'Stop', {
    session_id: randomUUID(), last_assistant_message: context.run.ack,
  }));
  assert.equal(reportRun(context.run.directory).hook_ack_match_count, 0);
});

test('a matching ACK in injected Hook input is recorded but never becomes native qualification', async (t) => {
  const context = fixture(t);
  await ready(context);
  await processHook(context.run.directory, 'Stop', input(context, 'Stop'), fakeWait());
  await processHook(context.run.directory, 'Stop', input(context, 'Stop', { last_assistant_message: context.run.ack, stop_hook_active: true }));
  const report = reportRun(context.run.directory);
  assert.equal(report.hook_ack_match_count, 1);
  assert.equal(report.counts.wait_started, 1);
  assert.equal(report.native_qualification, 'NOT_EVALUATED');
});

test('failure after wait reservation consumes the attempt without automatic replay', async (t) => {
  const context = fixture(t);
  await ready(context);
  await assert.rejects(processHook(context.run.directory, 'Stop', input(context, 'Stop'), {
    sleep: async () => { throw new Error('injected timer failure'); },
  }));
  assert.equal((await processHook(context.run.directory, 'Stop', input(context, 'Stop'), fakeWait())).exitCode, 0);
  assert.equal(reportRun(context.run.directory).counts.hook_exit_committed, undefined);
});

test('a wait that ends early cannot emit exit 2', async (t) => {
  const context = fixture(t);
  await ready(context);
  const result = await processHook(context.run.directory, 'Stop', input(context, 'Stop'), { now: () => 1n, sleep: async () => {} });
  assert.equal(result.exitCode, 0);
  assert.ok(reportRun(context.run.directory).suppression_reasons.includes('wait_incomplete'));
});

for (const damage of ['truncate', 'empty', 'settings', 'manifest', 'symlink', 'permissions']) {
  test(`${damage} is refused without wake, repair, or overwrite`, async (t) => {
    const context = fixture(t);
    await ready(context);
    const { directory } = context.run;
    let expected;
    if (damage === 'truncate') { writeFileSync(join(directory, 'events.jsonl'), '{'); expected = 'events_truncated'; }
    if (damage === 'empty') { writeFileSync(join(directory, 'events.jsonl'), ''); expected = 'events_invalid'; }
    if (damage === 'settings') { writeFileSync(join(directory, 'settings.json'), '{}'); expected = 'settings_changed'; }
    if (damage === 'manifest') {
      const path = join(directory, 'manifest.json');
      const data = JSON.parse(readFileSync(path));
      data.expires_at_ms -= 1;
      writeFileSync(path, JSON.stringify(data));
      expected = 'run_configuration_changed';
    }
    if (damage === 'symlink') {
      const victim = join(context.parent, 'outside-log');
      writeFileSync(victim, 'UNTOUCHED');
      rmSync(join(directory, 'events.jsonl'));
      symlinkSync(victim, join(directory, 'events.jsonl'));
    }
    if (damage === 'permissions') { chmodSync(join(directory, 'events.jsonl'), 0o644); expected = 'unsafe_file'; }
    if (expected) await rejectCode(processHook(directory, 'Stop', input(context, 'Stop'), fakeWait()), expected);
    else {
      await assert.rejects(processHook(directory, 'Stop', input(context, 'Stop'), fakeWait()));
      assert.equal(readFileSync(join(context.parent, 'outside-log'), 'utf8'), 'UNTOUCHED');
    }
  });
}

test('existing run/symlink and a stuck writer lock are never replaced or reclaimed', async (t) => {
  const context = fixture(t);
  assert.throws(() => prepareRun(context.run.directory, 'rewake-exit2'));
  const alias = join(context.parent, 'alias');
  symlinkSync(context.run.directory, alias);
  assert.throws(() => prepareRun(alias, 'rewake-exit2'));
  assert.throws(() => readRun(alias), { fixtureCode: 'unsafe_run_directory' });
  mkdirSync(join(context.run.directory, 'writer.lock'));
  await rejectCode(processHook(context.run.directory, 'Stop', input(context, 'Stop')), 'lock_busy');
  assert.ok(statSync(join(context.run.directory, 'writer.lock')).isDirectory());
});

test('CLI: two real Node Hook processes wait once for five seconds and emit exactly one exit 2', async (t) => {
  const context = fixture(t);
  // Exercise observer entrypoints over real stdin before concurrent Stop processes.
  for (const event of ['SessionStart', 'UserPromptSubmit']) {
    const result = await launchHook(t, context, event, input(context, event)).result;
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
  }
  const results = await Promise.all(Array.from({ length: 2 }, () =>
    launchHook(t, context, 'Stop', input(context, 'Stop')).result));
  assert.deepEqual(results.map(({ code }) => code).sort(), [0, 2]);
  const wake = results.find(({ code }) => code === 2);
  assert.ok(wake.elapsedMs >= WAIT_MS);
  assert.equal(wake.stdout, '');
  assert.ok(wake.stderr.includes(context.run.ack));
  assert.equal(results.filter(({ stderr }) => stderr.includes(context.run.ack)).length, 1);
  const later = await launchHook(t, context, 'Stop', input(context, 'Stop')).result;
  assert.equal(later.code, 0);
  assert.equal(later.stderr, '');
  const report = reportRun(context.run.directory);
  assert.equal(report.counts.wait_started, 1);
  assert.equal(report.counts.hook_exit_committed, 1);
  t.diagnostic(`Synthetic stdin, actual Node processes: ${JSON.stringify({
    exitCodes: results.map(({ code }) => code), wakeElapsedMs: Math.round(wake.elapsedMs),
    waiters: report.counts.wait_started, exitCommitments: report.counts.hook_exit_committed,
    nativeClaude: 'NOT_RUN',
  })}`);
});

test('CLI: malformed, oversized, mismatched and incomplete stdin always exit 1, never 2', async (t) => {
  const context = fixture(t);
  const results = await Promise.all([
    launchHook(t, context, 'Stop', 'NOT_JSON_PRIVATE').result,
    launchHook(t, context, 'Stop', 'X'.repeat(INPUT_LIMIT + 1)).result,
    launchHook(t, context, 'Stop', input(context, 'SessionStart')).result,
    launchHook(t, context, 'Stop', undefined, { leaveInputOpen: true }).result,
  ]);
  for (const result of results) {
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^P1_FIXTURE_ERROR [a-z_]+\n$/);
    assert.equal(result.stderr.includes('PRIVATE'), false);
  }
  assert.ok(results.at(-1).elapsedMs >= 1_800);
  assert.equal(reportRun(context.run.directory).counts.wait_started, undefined);
});

test('CLI: prepare and event report/cancel tools operate only on a newly created run', async (t) => {
  const context = fixture(t);
  const directory = join(context.parent, 'cli-prepared');
  async function tool(file, args) {
    const child = spawn(process.execPath, [join(here, file), ...args], {
      cwd: context.parent, stdio: ['ignore', 'pipe', 'pipe'], timeout: 4_000,
      env: { PATH: dirname(process.execPath), LANG: 'C.UTF-8' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  }
  const prepared = await tool('prepare.mjs', ['--run', directory, '--mode', 'rewake-exit0', '--origin', 'synthetic']);
  assert.equal(prepared.native_execution, 'NOT_RUN');
  const report = await tool('record.mjs', ['--run', prepared.directory, '--operation', 'report']);
  assert.deepEqual(report.counts, { run_prepared: 1 });
  const cancelled = await tool('record.mjs', ['--run', prepared.directory, '--operation', 'cancel']);
  assert.equal(cancelled.counts.run_cancelled, 1);
  assert.equal(cancelled.native_qualification, 'NOT_EVALUATED');
});

test('runtime modules contain only permitted built-in/local imports and no launcher or network', () => {
  for (const file of ['core.mjs', 'hook.mjs', 'prepare.mjs', 'record.mjs']) {
    const source = readFileSync(join(here, file), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.ok(imports.every((name) => ['node:crypto', 'node:fs', 'node:path', 'node:url', 'node:timers/promises', './core.mjs'].includes(name)));
    assert.doesNotMatch(source, /\b(?:fetch|spawn|execFile|execSync|setInterval)\s*\(|process\.env|import\s*\(/);
  }
});
