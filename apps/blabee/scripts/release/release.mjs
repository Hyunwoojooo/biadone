#!/usr/bin/env node
// Blabee public release driver. Replaces the per-release copies of
// prepare/validate/build/inspect/validate-payload/finalize scripts that used to
// live only in the ignored build/ folder (r89–r91), and enforces their order.
//
//   node scripts/release/release.mjs <step> --build N [options]
//
// Steps (each writes JSON evidence into the release folder and refuses to run
// unless the evidence of every earlier step exists and passed):
//   preflight   clean apps/blabee tree, record commit, fingerprint inputs
//   test        npm run test:release (all suites) on the release tree
//   prepare     prepare the Claude runtime payload
//   package     npm run test:t012 (packaging) with unchanged inputs
//   build       scripts/build-release-dmg.mjs
//   inspect     signature, plist, contract pins, bundled Claude sources
//   payload     ClaudeRuntimePayloadTests/actualPackagedRuntime on signed-app
//   notarize    npm run notarize:dmg (GATED on test + payload evidence)
//   finalize    stapler, Gatekeeper, embedded app equality, provenance
//   all         preflight..inspect, payload, notarize, finalize in order
//
// Options:
//   --build N                    required, the new build number
//   --previous-app PATH          signed Blabee.app of the previous public build
//                                (default: build/release-public-*-r<N-1 or older>/signed-app)
//   --node-runtime DIR           prepared runtime whose node/ binary is reused
//                                (default: the previous release folder's claude-runtime)
//   --identity NAME --team-id ID Developer ID identity (defaults: current team)
//   --output DIR                 release folder (default: build/release-public-<yyyymmdd>-r<N>)
//
// Publication (GitHub release, public docs repository, README) is still run by
// hand from the printed checklist after `finalize`; see docs/development/RELEASE.md.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile as callbackExecFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, readlink, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fingerprintReleaseInputs } from '../build-fresh-internal-dmg.mjs';
import { attachAndVerifyDMG } from '../build-internal-dmg.mjs';
import { CLAUDE_RUNTIME_SOURCE_FILES, prepareClaudeRuntime, verifyPublicClaudeRuntimeDirectory } from '../prepare-claude-runtime.mjs';
import { updateReadmes } from './update-readme.mjs';
import { claudeNodeIdentifier, verifyDeveloperIDSignature, verifyEmbeddedSigningEntitlements } from '../release-signing.mjs';

const execFile = promisify(callbackExecFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STEPS = ['preflight', 'test', 'prepare', 'package', 'build', 'inspect', 'payload', 'notarize', 'finalize'];
const DEFAULT_IDENTITY = 'Developer ID Application: Hyunwoo Joo (VN7AMDG677)';
const DEFAULT_TEAM = 'VN7AMDG677';
const VERSION = '0.1.0';

export function parseReleaseArguments(argv) {
  const [step, ...rest] = argv;
  if (![...STEPS, 'all'].includes(step)) throw new Error(`Unknown step: ${step ?? '(none)'}. Use one of ${[...STEPS, 'all'].join(', ')}.`);
  const options = { step, identity: DEFAULT_IDENTITY, teamID: DEFAULT_TEAM };
  const names = new Map([['--build', 'build'], ['--previous-app', 'previousApp'], ['--node-runtime', 'nodeRuntime'],
    ['--identity', 'identity'], ['--team-id', 'teamID'], ['--output', 'output']]);
  for (let index = 0; index < rest.length; index += 2) {
    const key = names.get(rest[index]);
    if (!key || rest[index + 1] === undefined) throw new Error(`Unknown or incomplete argument: ${rest[index]}`);
    options[key] = rest[index + 1];
  }
  if (!/^[1-9][0-9]{0,4}$/.test(options.build ?? '')) throw new Error('--build must be a positive integer');
  options.build = Number(options.build);
  for (const key of ['previousApp', 'nodeRuntime', 'output']) if (options[key]) options[key] = resolve(options[key]);
  return options;
}

const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const exists = path => access(path).then(() => true, () => false);
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const today = () => new Date().toISOString().slice(0, 10).replaceAll('-', '');

export const releaseTagName = build => `blabee-v${VERSION}+build.${build}`;

// Tags the provenance commit locally so every published build maps to its source.
// An existing tag is accepted only when it already points at the same commit;
// pushing the tag stays a manual publication step.
export async function createReleaseTag(build, commit, git = args => execFile('git', args, { cwd: root })) {
  assert.match(commit ?? '', /^[0-9a-f]{40}$/, 'provenance source_commit must be a full commit id');
  const name = releaseTagName(build);
  let existing = null;
  try { existing = (await git(['rev-parse', '--verify', '--quiet', `refs/tags/${name}^{commit}`])).stdout.trim(); }
  catch { existing = null; }
  if (existing) {
    if (existing !== commit) throw new Error(`Tag ${name} already points at ${existing}, not the build commit ${commit}`);
    return { name, commit, created: false };
  }
  await git(['tag', '-a', name, commit, '-m', `Blabee ${VERSION} r${build}`]);
  return { name, commit, created: true };
}

async function previousReleaseFolder(build) {
  const folders = (await readdir(join(root, 'build')).catch(() => []))
    .map(name => ({ name, build: Number(name.match(/^release-public-\d{8}-r(\d+)$/)?.[1]) }))
    .filter(entry => entry.build && entry.build < build).sort((a, b) => b.build - a.build);
  for (const entry of folders) {
    const folder = join(root, 'build', entry.name);
    // A discarded build (r90) has no finalize evidence; never use it as "previous".
    if (await exists(join(folder, 'signed-app/Blabee.app'))
        && (await exists(join(folder, 'step-finalize.json')) || await exists(join(folder, 'notarized-artifact-validation.json')))) {
      return folder;
    }
  }
  return null;
}

async function context(options) {
  const output = options.output ?? join(root, 'build', `release-public-${today()}-r${options.build}`);
  const existing = (await readdir(join(root, 'build')).catch(() => [])).find(name => name.endsWith(`-r${options.build}`)
    && name.startsWith('release-public-'));
  const folder = options.output ?? (existing ? join(root, 'build', existing) : output);
  const previous = await previousReleaseFolder(options.build);
  return {
    ...options, folder, previous,
    previousApp: options.previousApp ?? (previous && join(previous, 'signed-app/Blabee.app')),
    nodeRuntime: options.nodeRuntime ?? (previous && join(previous, 'claude-runtime')),
    dmgName: `Blabee-${VERSION}-arm64-r${options.build}.dmg`,
  };
}

const evidencePath = (ctx, step) => join(ctx.folder, `step-${step}.json`);
async function requireSteps(ctx, steps) {
  for (const step of steps) {
    const path = evidencePath(ctx, step);
    assert.ok(await exists(path), `Step "${step}" has not run for r${ctx.build}. Run it first; steps cannot be skipped.`);
    const evidence = await readJSON(path);
    assert.equal(evidence.passed, true, `Step "${step}" did not pass; see ${path}`);
  }
}
async function record(ctx, step, value) {
  const evidence = { step, build: ctx.build, passed: true, completed_at: new Date().toISOString(), ...value };
  await writeFile(evidencePath(ctx, step), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(evidence));
  return evidence;
}
async function requireInputsUnchanged(ctx) {
  const before = await readJSON(evidencePath(ctx, 'preflight'));
  assert.deepEqual(await fingerprintReleaseInputs(root), before.release_inputs, 'Release inputs changed after preflight');
  const { stdout } = await execFile('git', ['status', '--porcelain', '--', '.'], { cwd: root });
  assert.equal(stdout.trim(), '', 'apps/blabee has uncommitted changes; the release must be built from a commit');
}

function cleanEnvironment(extra = {}) {
  const env = { ...process.env, DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer' };
  for (const name of Object.keys(env)) if (name.startsWith('BLABEE_')) delete env[name];
  return { ...env, ...extra };
}
async function run(ctx, logName, command, args, env = cleanEnvironment()) {
  const logPath = join(ctx.folder, logName);
  const stream = createWriteStream(logPath, { flags: 'wx' });
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
  const result = await new Promise((done, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => done({ exit_code: code, signal }));
  });
  await new Promise(done => stream.end(done));
  return { ...result, stdout, log: await readFile(logPath, 'utf8'), logPath };
}
const count = (log, key) => [...log.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].reduce((sum, m) => sum + Number(m[1]), 0);

const steps = {
  async preflight(ctx) {
    await mkdir(ctx.folder, { recursive: true });
    assert.ok(ctx.previousApp && await exists(ctx.previousApp), 'Previous signed app not found; pass --previous-app');
    assert.ok(ctx.nodeRuntime && await exists(join(ctx.nodeRuntime, 'node/bin/node')), 'Node runtime not found; pass --node-runtime');
    const { stdout: status } = await execFile('git', ['status', '--porcelain', '--', '.'], { cwd: root });
    assert.equal(status.trim(), '', 'apps/blabee has uncommitted changes; commit them before a release');
    const commit = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    const installed = '/Applications/Blabee.app/Contents';
    const installedBefore = await exists(installed) ? Object.fromEntries(await Promise.all(
      ['Info.plist', 'MacOS/blabee-coordinator', '_CodeSignature/CodeResources'].map(async name => [name, await sha(join(installed, name))]))) : null;
    return record(ctx, 'preflight', { source_commit: commit, previous_app: ctx.previousApp, node_runtime: ctx.nodeRuntime,
      release_inputs: await fingerprintReleaseInputs(root), installed_app_before: installedBefore });
  },

  async test(ctx) {
    await requireSteps(ctx, ['preflight']);
    await requireInputsUnchanged(ctx);
    const result = await run(ctx, 'test-release.log', 'npm', ['run', 'test:release']);
    assert.equal(result.exit_code, 0, `test:release failed; see ${result.logPath}`);
    assert.ok(!/✘ Test run/.test(result.log), 'a Swift Testing run failed');
    await requireInputsUnchanged(ctx);
    return record(ctx, 'test', { node_pass: count(result.log, 'pass'), node_fail: count(result.log, 'fail'),
      swift_runs: [...result.log.matchAll(/✔ Test run with (\d+) tests?/g)].map(m => Number(m[1])) });
  },

  async prepare(ctx) {
    await requireSteps(ctx, ['preflight', 'test']);
    const manifest = await readJSON(join(ctx.nodeRuntime, 'manifest.json'));
    const result = await prepareClaudeRuntime({ bridgeRoot: join(root, 'bridges/claude'),
      nodeBinaryPath: join(ctx.nodeRuntime, 'node/bin/node'), nodeLicensePath: join(ctx.nodeRuntime, 'node/LICENSE'),
      nodeVersion: manifest.node_version, nodeArch: 'arm64', outputDirectory: join(ctx.folder, 'claude-runtime') });
    const { stdout } = await execFile(join(result.outputDirectory, 'node/bin/node'), ['--version']);
    assert.equal(stdout.trim(), `v${manifest.node_version}`);
    await requireInputsUnchanged(ctx);
    return record(ctx, 'prepare', { payload_digest: result.manifest.payload_digest, files: result.manifest.files.length,
      node_version: result.manifest.node_version, delivery_mode: result.manifest.delivery_mode });
  },

  async package(ctx) {
    await requireSteps(ctx, ['preflight', 'test', 'prepare']);
    await requireInputsUnchanged(ctx);
    const result = await run(ctx, 'packaging.log', 'npm', ['run', 'test:t012']);
    assert.equal(result.exit_code, 0, `test:t012 failed; see ${result.logPath}`);
    assert.equal(count(result.log, 'fail'), 0);
    await requireInputsUnchanged(ctx);
    return record(ctx, 'package', { pass: count(result.log, 'pass'), skipped: count(result.log, 'skipped') });
  },

  async build(ctx) {
    await requireSteps(ctx, ['preflight', 'test', 'prepare', 'package']);
    await requireInputsUnchanged(ctx);
    const args = [join(root, 'scripts/build-release-dmg.mjs'), '--build-number', String(ctx.build),
      '--identity', ctx.identity, '--team-id', ctx.teamID,
      '--claude-runtime-directory', join(ctx.folder, 'claude-runtime'),
      '--compatible-previous-app', ctx.previousApp, '--output', join(ctx.folder, ctx.dmgName)];
    const result = await run(ctx, 'build.log', process.execPath, args);
    assert.equal(result.exit_code, 0, `Build failed; see ${result.logPath}`);
    await requireInputsUnchanged(ctx);
    return record(ctx, 'build', { command: args, result: JSON.parse(result.stdout.trim()) });
  },

  async inspect(ctx) {
    await requireSteps(ctx, ['preflight', 'test', 'prepare', 'package', 'build']);
    const built = (await readJSON(evidencePath(ctx, 'build'))).result;
    const dmg = join(ctx.folder, ctx.dmgName);
    assert.equal(built.app.build, String(ctx.build)); assert.equal(await sha(dmg), built.sha256);
    await verifyDeveloperIDSignature(dmg, { teamID: ctx.teamID, kind: 'dmg' });
    await execFile('/usr/bin/hdiutil', ['verify', dmg], { timeout: 120000 });
    const mount = join(ctx.folder, 'inspection-mount');
    await mkdir(mount); await mkdir(join(ctx.folder, 'signed-app'));
    let attached = false;
    try {
      await execFile('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], { timeout: 120000 });
      attached = true;
      assert.equal(await readlink(join(mount, 'Applications')), '/Applications');
      await execFile('/usr/bin/ditto', [join(mount, 'Blabee.app'), join(ctx.folder, 'signed-app/Blabee.app')], { timeout: 120000 });
    } finally { if (attached) await execFile('/usr/bin/hdiutil', ['detach', mount], { timeout: 120000 }); }
    const app = join(ctx.folder, 'signed-app/Blabee.app'), contents = join(app, 'Contents'), resources = join(contents, 'Resources');
    const plist = JSON.parse((await execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(contents, 'Info.plist')])).stdout);
    assert.equal(plist.CFBundleIdentifier, 'com.biadone.blabee'); assert.equal(plist.CFBundleVersion, String(ctx.build));
    assert.equal(plist.CFBundleShortVersionString, VERSION);
    const signature = await verifyDeveloperIDSignature(app, { teamID: ctx.teamID });
    await verifyEmbeddedSigningEntitlements(app, 'com.apple.security.automation.apple-events');
    const node = join(resources, 'claude/node/bin/node');
    await verifyDeveloperIDSignature(node, { teamID: ctx.teamID, kind: 'executable', identifier: claudeNodeIdentifier });
    await verifyEmbeddedSigningEntitlements(node, 'com.apple.security.cs.allow-jit');
    const runtime = await verifyPublicClaudeRuntimeDirectory(join(resources, 'claude'));
    for (const name of CLAUDE_RUNTIME_SOURCE_FILES) {
      assert.equal(await sha(join(resources, 'claude/payload/src', name)), await sha(join(root, 'bridges/claude/src', name)),
        `bundled Claude source differs from the checkout: ${name}`);
    }
    const pin = await readFile(join(root, 'engine/validation/ContractPin.swift'), 'utf8');
    const pins = Object.fromEntries([...pin.matchAll(/"([^"\n]+\.schema\.json)": "([a-f0-9]{64})"/g)].map(m => [m[1], m[2]]));
    pins['manifest.json'] = pin.match(/manifestSHA256 = "([a-f0-9]{64})"/)[1];
    for (const [name, digest] of Object.entries(pins)) {
      assert.equal(await sha(join(resources, 'Contracts/v1', name)), digest, `bundled contract pin: ${name}`);
    }
    const binary = await readFile(join(contents, 'MacOS/blabee-coordinator'));
    assert.ok(!binary.includes(Buffer.from('/Users/')), 'the coordinator binary embeds a home path');
    await requireInputsUnchanged(ctx);
    return record(ctx, 'inspect', { dmg: { name: ctx.dmgName, sha256: built.sha256, bytes: (await stat(dmg)).size },
      signature, contracts_matching_pins: Object.keys(pins).length, claude_payload_digest: runtime.payload_digest,
      claude_sources_matching_checkout: CLAUDE_RUNTIME_SOURCE_FILES.length });
  },

  // The check that discarded r90 after notarization. It now runs before.
  async payload(ctx) {
    await requireSteps(ctx, ['preflight', 'test', 'prepare', 'package', 'build', 'inspect']);
    const env = cleanEnvironment({ BLABEE_CLAUDE_PACKAGED_RUNTIME: join(ctx.folder, 'signed-app/Blabee.app/Contents/Resources/claude') });
    const result = await run(ctx, 'actual-payload-swift.log', 'npm', ['run', 'test:swift', '--', '--disable-keychain',
      '--disable-netrc', '--filter', 'ClaudeRuntimePayloadTests/actualPackagedRuntime'], env);
    const passed = Number(result.log.match(/Test run with (\d+) tests? in \d+ suites? passed/)?.[1]);
    assert.equal(result.exit_code, 0, `The app rejects its own bundled Claude runtime; see ${result.logPath}`);
    assert.equal(passed, 1);
    return record(ctx, 'payload', { passed });
  },

  async notarize(ctx) {
    // Notarization is irreversible: nothing is submitted until every suite and
    // the packaged-runtime qualifier have passed for this exact build.
    await requireSteps(ctx, ['preflight', 'test', 'prepare', 'package', 'build', 'inspect', 'payload']);
    const dmg = join(ctx.folder, ctx.dmgName);
    assert.equal(await sha(dmg), (await readJSON(evidencePath(ctx, 'inspect'))).dmg.sha256);
    const result = await run(ctx, 'notarize.log', 'npm', ['run', 'notarize:dmg', '--', '--dmg', dmg,
      '--team-id', ctx.teamID, '--distribution-mode', 'public', '--timeout', '1800'], cleanEnvironment());
    assert.equal(result.exit_code, 0, result.exit_code === 2
      ? 'Apple is still processing; rerun `npm run notarize:dmg -- --resume …` and then this step'
      : `Notarization failed; see ${result.logPath}`);
    return record(ctx, 'notarize', { dmg: ctx.dmgName });
  },

  async finalize(ctx) {
    await requireSteps(ctx, ['preflight', 'test', 'prepare', 'package', 'build', 'inspect', 'payload', 'notarize']);
    const dmg = join(ctx.folder, ctx.dmgName);
    const state = await readJSON(`${dmg}.notarization.json`);
    const before = await readJSON(evidencePath(ctx, 'inspect'));
    assert.equal(state.phase, 'complete'); assert.equal(state.status, 'Accepted'); assert.equal(state.notarized, true);
    assert.equal(state.distribution_mode, 'public'); assert.equal(state.submitted_sha256, before.dmg.sha256);
    assert.equal(await sha(dmg), state.final_sha256);
    const text = r => `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    const execute = (command, args, options = {}) => execFile(command, args, { ...options, timeout: 120000 });
    const ticket = text(await execute('/usr/bin/xcrun', ['stapler', 'validate', dmg]));
    const work = await mkdtemp(join(ctx.folder, 'final-inspection-'));
    const embedded = await attachAndVerifyDMG(dmg, work, null, { execute, verifyMounted: async mount => {
      const contents = join(mount, 'Blabee.app/Contents');
      for (const path of ['Info.plist', 'MacOS/blabee-coordinator', '_CodeSignature/CodeResources']) {
        assert.equal(await sha(join(contents, path)), await sha(join(ctx.folder, 'signed-app/Blabee.app/Contents', path)));
      }
      const gatekeeper = text(await execute('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', join(mount, 'Blabee.app')]));
      assert.match(gatekeeper, /accepted/); assert.match(gatekeeper, /Notarized Developer ID/);
      return { gatekeeper, matches_pre_notary_app: true };
    } });
    await rmdir(work);
    const preflight = await readJSON(evidencePath(ctx, 'preflight'));
    // Before any write-once evidence, so a conflicting tag stops finalize cleanly.
    const tag = await createReleaseTag(ctx.build, preflight.source_commit);
    const provenance = { schema_version: 'blabee.local-build-provenance.v2', version: VERSION, build: ctx.build,
      source_commit: preflight.source_commit, source_contains_uncommitted_changes: false,
      artifact: { name: ctx.dmgName, sha256: state.final_sha256, bytes: (await stat(dmg)).size },
      notarization: { submission_id: state.submission_id, status: state.status, submitted_sha256: state.submitted_sha256 },
      tests: await readJSON(evidencePath(ctx, 'test')), packaged_runtime_qualifier_passed: true };
    await writeFile(join(ctx.folder, `r${ctx.build}-provenance.json`), JSON.stringify(provenance, null, 2) + '\n', { flag: 'wx' });
    const evidence = await record(ctx, 'finalize', { artifact: provenance.artifact, ticket, embedded_app: embedded,
      source_commit: preflight.source_commit, tag: tag.name });
    // After the evidence: README edits must not change the recorded source tree.
    const readmes = await updateReadmes(ctx.build);
    console.log(['', `Release r${ctx.build} is notarized. Publication checklist (manual):`,
      `  1. ${tag.created ? 'Created' : 'Kept'} local tag ${tag.name} at ${tag.commit}; push it: git push origin ${tag.name}`,
      `  2. Create the GitHub release from that tag (gh release create ${tag.name} --verify-tag) with ${ctx.dmgName} and its .sha256, notes from the CHANGELOG entry`,
      `  3. ${readmes.length ? `README links now point at r${ctx.build} (${readmes.join(', ')}); commit them after the release is public.`
        : 'README links already point at this build.'} Update the public docs repository (Biadone/blabee)`,
      '  4. Run an in-app update from the previous build on a test Mac and record the result',
    ].join('\n'));
    return evidence;
  },
};

export async function runRelease(options) {
  const ctx = await context(options);
  const order = options.step === 'all' ? STEPS : [options.step];
  for (const step of order) {
    if (options.step === 'all' && await exists(evidencePath(ctx, step))) continue;
    await steps[step](ctx);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runRelease(parseReleaseArguments(process.argv.slice(2))); }
  catch (error) { console.error(`release: ${error.message}`); process.exitCode = 1; }
}
