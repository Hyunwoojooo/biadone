import { BUILD_ROOT } from '../support/paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEVELOPMENT_BUILD_ROOT } from '../../../../dev/claude-standalone/src/shared/identity.mjs';

const binary = process.env.BLABEE_CLAUDE_PET_BINARY
  ?? join(DEVELOPMENT_BUILD_ROOT, 'blabee-claude.app/Contents/MacOS/blabee-claude');
const options = { skip: existsSync(binary) ? false : 'Build the native Blabee Claude app before running Pet checks.' };

async function fixture(t) {
  await mkdir(BUILD_ROOT, { recursive: true });
  const directory = await mkdtemp(join(BUILD_ROOT, 'pet-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function run(...args) {
  return spawnSync(binary, args, { encoding: 'utf8', timeout: 8000 });
}

async function hold(t, runtime) {
  const child = spawn(binary, ['--probe-instance', '--runtime', runtime, '--hold-seconds', '5'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  });
  let output = '';
  let error = '';
  child.stderr.on('data', data => { error += data; });
  const ready = new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Pet lease probe did not become ready.')), 4000);
    child.stdout.on('data', data => {
      output += data;
      if (output.includes('\n')) {
        clearTimeout(timeout);
        try { resolveReady(JSON.parse(output.split('\n')[0])); } catch (error) { reject(error); }
      }
    });
    exited.then(({ code }) => {
      clearTimeout(timeout);
      reject(new Error(`Pet lease exited before ready (${code}): ${error}`));
    }, reject);
  });
  assert.equal((await ready).probe, 'holding');
  return { child, exited };
}

test('Pet diagnosis is read-only and identifies only Claude paths', options, async t => {
  const directory = await fixture(t);
  const runtime = join(directory, 'not-created');
  const result = run('--diagnose', '--runtime', runtime);
  assert.equal(result.status, 0, result.stderr);
  const diagnosis = JSON.parse(result.stdout);
  assert.equal(diagnosis.product, 'blabee-claude');
  assert.equal(diagnosis.bundle_identifier, 'com.biadone.blabee.claude');
  assert.equal(diagnosis.read_only, true);
  assert.equal(diagnosis.lock_path, join(runtime, 'pet/instance-v1.lock'));
  assert.equal(existsSync(runtime), false);
  assert.equal(result.stdout.includes('token'), false);
});

test('Pet rejects a second instance and releases its kernel lease after process exit', options, async t => {
  const runtime = join(await fixture(t), 'runtime');
  const first = await hold(t, runtime);
  const duplicate = run('--probe-instance', '--runtime', runtime, '--hold-seconds', '0.01');
  assert.equal(duplicate.status, 2, duplicate.stderr);
  assert.match(duplicate.stderr, /already running/);
  assert.equal((await stat(runtime)).mode & 0o777, 0o700);
  assert.equal((await stat(join(runtime, 'pet'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(runtime, 'pet/instance-v1.lock'))).mode & 0o777, 0o600);
  assert.equal(existsSync(join(runtime, 'blabee-claude.sock')), false, 'Probe must not launch coordinator');
  first.child.kill('SIGTERM');
  await first.exited;
  const next = run('--probe-instance', '--runtime', runtime, '--hold-seconds', '0.01');
  assert.equal(next.status, 0, next.stderr);
});

test('Independent Claude runtime leases coexist without touching a foreign lock', options, async t => {
  const directory = await fixture(t);
  const foreign = join(directory, 'codex-lock-sentinel');
  await writeFile(foreign, 'existing Codex state\n');
  await hold(t, join(directory, 'first'));
  await hold(t, join(directory, 'second'));
  assert.equal(await readFile(foreign, 'utf8'), 'existing Codex state\n');
});

test('Pet refuses symlink runtimes and symlink lock files', options, async t => {
  const directory = await fixture(t);
  const real = join(directory, 'real');
  await mkdir(real, { mode: 0o700 });
  const linked = join(directory, 'linked');
  await symlink(real, linked);
  assert.notEqual(run('--probe-instance', '--runtime', linked).status, 0);
  await mkdir(join(real, 'pet'), { mode: 0o700 });
  const foreign = join(directory, 'foreign');
  await writeFile(foreign, 'untouched', { mode: 0o600 });
  await symlink(foreign, join(real, 'pet/instance-v1.lock'));
  assert.notEqual(run('--probe-instance', '--runtime', real).status, 0);
  assert.equal(await readFile(foreign, 'utf8'), 'untouched');
});

test('Pet rejects unsafe permissions and the legacy Codex runtime', options, async t => {
  const runtime = join(await fixture(t), 'public');
  await mkdir(runtime, { mode: 0o700 });
  await chmod(runtime, 0o755);
  const publicResult = run('--probe-instance', '--runtime', runtime);
  assert.notEqual(publicResult.status, 0);
  assert.match(publicResult.stderr, /0700/);
  const legacy = run('--diagnose', '--runtime', '/Users/example/Library/Application Support/Blabee/runtime');
  assert.notEqual(legacy.status, 0);
  assert.match(legacy.stderr, /Codex Blabee runtime/);
  assert.notEqual(run('--diagnose', '--runtime', 'relative/path').status, 0);
  assert.notEqual(run('--probe-instance', '--runtime', runtime, '--hold-seconds', '61').status, 0);
});
