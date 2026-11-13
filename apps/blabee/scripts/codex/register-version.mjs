#!/usr/bin/env node
// Registers one official Codex release as reviewed qualification data
// (audit CDX-7/CDX-14, 2026-11-13). It replaces hand-editing ~21 files.
//
//   npm run codex:register -- --version 0.167.1 --download [--check-notarization]
//   npm run codex:register -- --version 0.167.1 --archive /path/codex-package-aarch64-apple-darwin.tar.gz
//
// Steps: fetch (or take) the official arm64 package, check its SHA-256 and
// size against GitHub's asset metadata, extract it into a new empty folder,
// measure it with the production Swift inspector (opt-in registration probe),
// read the primary `bin/codex` CDHash and Team ID with codesign, then write
//   bridges/codex/qualification/<version>.json   (reviewed record)
//   docs/features/codex-evidence/<version>.json  (kept evidence; never /tmp only)
//   Fixtures/codex/<version>/voice-runtime.json  (when the package has one)
// and regenerate the Swift sources. Nothing is trusted from a version number
// or Team ID alone: every file digest is pinned. Review the diff before commit.

import { createHash } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CAPABILITIES, compareVersions, generated, loadRecords, QUALIFICATION_DIRECTORY, SCHEMA, validateRecord } from './qualification.mjs';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ASSET = 'codex-package-aarch64-apple-darwin.tar.gz';
export const OFFICIAL_TEAM = '2DC432GLL2';
const TARGET = 'aarch64-apple-darwin';

export function parseArguments(argv) {
  const options = { download: false, checkNotarization: false, replace: false, dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith('--')) throw new Error(`${argument} needs a value`);
      return next;
    };
    if (argument === '--version') options.version = value();
    else if (argument === '--archive') options.archive = resolve(value());
    else if (argument === '--capabilities') options.capabilities = value().split(',');
    else if (argument === '--download') options.download = true;
    else if (argument === '--check-notarization') options.checkNotarization = true;
    else if (argument === '--replace') options.replace = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(options.version ?? '')) throw new Error('--version must be an exact stable version, e.g. 0.167.1');
  if (options.download === Boolean(options.archive)) throw new Error('give exactly one of --download or --archive');
  if (options.capabilities?.some(c => !CAPABILITIES.includes(c))) throw new Error(`capabilities must be from ${CAPABILITIES.join(', ')}`);
  return options;
}

/** Builds the reviewed record from measured facts only. */
export function buildRecord({ version, capabilities, probe, codesign, archive, notarization, date }) {
  if (probe.version !== version || probe.target !== TARGET) throw new Error(`package is ${probe.version}/${probe.target}, expected ${version}/${TARGET}`);
  if (codesign.team !== OFFICIAL_TEAM) throw new Error(`bin/codex Team ID ${codesign.team} is not ${OFFICIAL_TEAM}`);
  if (probe.executable_teams.length !== 1 || probe.executable_teams[0] !== OFFICIAL_TEAM) {
    throw new Error(`executables are signed by ${probe.executable_teams.join(', ') || 'nobody'}, expected only ${OFFICIAL_TEAM}`);
  }
  if (!/^[0-9a-f]{40}$/.test(codesign.cdhash)) throw new Error('bin/codex CDHash was not read');
  const files = Object.keys(probe.file_digests).length;
  return validateRecord({
    schema: SCHEMA, version, target: TARGET, capabilities: CAPABILITIES.filter(c => capabilities.includes(c)),
    hook_cdhash: codesign.cdhash,
    catalog: { signing_team: OFFICIAL_TEAM, fingerprint: probe.fingerprint,
      file_digests: Object.fromEntries(Object.entries(probe.file_digests).sort(([a], [b]) => (a < b ? -1 : 1))) },
    notes: [
      `Official rust-v${version} ${ASSET} sha256:${archive.sha256} (${archive.bytes} bytes${archive.publishedAt ? `, published ${archive.publishedAt}` : ''}).`,
      `Registered ${date} by scripts/codex/register-version.mjs: ${files} file digests from production inspection, Team ID ${OFFICIAL_TEAM}`
        + `${notarization ? ', every native file notarized (paced online lookup)' : ''}${probe.exec_server ? `, declares ${probe.exec_server}` : ''}.`,
    ],
  }, `${version}.json`);
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function fetchJSON(url) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'blabee-codex-register' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function download(version, directory) {
  const release = await fetchJSON(`https://api.github.com/repos/openai/codex/releases/tags/rust-v${version}`);
  if (release.draft || release.prerelease) throw new Error(`rust-v${version} is not a stable release`);
  const asset = release.assets?.find(a => a.name === ASSET);
  if (!asset) throw new Error(`rust-v${version} has no ${ASSET}`);
  const expected = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7) : null;
  if (!expected) throw new Error('GitHub did not publish a sha256 digest for the asset');
  const response = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'blabee-codex-register' } });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const path = join(directory, ASSET);
  await writeFile(path, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
  const sha256 = await sha256File(path), bytes = (await stat(path)).size;
  if (sha256 !== expected || bytes !== asset.size) throw new Error('downloaded archive does not match GitHub asset metadata');
  return { path, sha256, bytes, publishedAt: release.published_at, url: asset.browser_download_url };
}

async function packageRoot(directory) {
  const has = async path => access(join(path, 'codex-package.json')).then(() => true, () => false);
  if (await has(directory)) return directory;
  const entries = (await readdir(directory, { withFileTypes: true })).filter(e => e.isDirectory());
  if (entries.length === 1 && await has(join(directory, entries[0].name))) return join(directory, entries[0].name);
  throw new Error('extracted archive has no codex-package.json');
}

export function parseCodesign(text) {
  return { cdhash: text.match(/^CDHash=([0-9a-f]{40})$/m)?.[1], team: text.match(/^TeamIdentifier=(\S+)$/m)?.[1] };
}

const pause = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

/** Every Mach-O file, one paced online lookup each. Apple's lookup fails with
 * the same exit code when queried in a burst, so retry before concluding. */
async function checkNotarization(packageDirectory, paths) {
  const results = {};
  for (const path of [...paths].sort()) {
    const full = join(packageDirectory, path);
    const { stdout } = await execFile('/usr/bin/file', ['-b', full]);
    if (!stdout.includes('Mach-O')) continue;
    results[path] = false;
    for (let attempt = 1; attempt <= 3 && !results[path]; attempt++) {
      await pause(attempt === 1 ? 1000 : 5000);
      results[path] = await execFile('/usr/bin/codesign', ['--verify', '--strict', '-R=notarized', '--check-notarization', full])
        .then(() => true, () => false);
    }
  }
  return results;
}

function runProbe(packageDirectory, output) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('npm', ['run', 'test:swift', '--', '--filter', 'codexQualificationRegistrationProbe'], {
      cwd: root, stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, BLABEE_CODEX_REGISTER_PACKAGE: packageDirectory, BLABEE_CODEX_REGISTER_OUTPUT: output },
    });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolveRun() : reject(new Error(`registration probe failed (${code})`))));
  });
}

export async function register(options) {
  const existing = await loadRecords();
  if (existing.some(r => r.version === options.version) && !options.replace && !options.dryRun) {
    throw new Error(`${options.version} is already registered; pass --replace to re-measure it`);
  }
  // Default to the newest fully reviewed release (with a catalog), never the
  // record being replaced, so a restricted record cannot narrow the next one.
  const latest = existing.filter(r => r.version !== options.version && r.catalog).at(-1);
  const capabilities = options.capabilities ?? latest.capabilities;
  const work = await mkdtemp(join(tmpdir(), `blabee-codex-register-${options.version}-`));
  const downloads = join(work, 'download'), extracted = join(work, 'package');
  await mkdir(downloads); await mkdir(extracted);
  const archive = options.download ? await download(options.version, downloads)
    : { path: options.archive, sha256: await sha256File(options.archive), bytes: (await stat(options.archive)).size };
  await execFile('/usr/bin/tar', ['-xzf', archive.path, '-C', extracted]);
  const packageDirectory = await packageRoot(extracted);
  const probeOutput = join(work, 'probe.json');
  await runProbe(packageDirectory, probeOutput);
  const probe = JSON.parse(await readFile(probeOutput, 'utf8'));
  const binary = join(packageDirectory, 'bin/codex');
  const { stderr } = await execFile('/usr/bin/codesign', ['-dvvv', binary]);
  const codesign = parseCodesign(stderr);
  let notarization = false;
  let notarizedFiles = null;
  if (options.checkNotarization) {
    notarizedFiles = await checkNotarization(packageDirectory, Object.keys(probe.file_digests));
    const missing = Object.entries(notarizedFiles).filter(([, ok]) => !ok).map(([path]) => path);
    if (missing.length) throw new Error(`not notarized after retries: ${missing.join(', ')}`);
    notarization = true;
  }
  const date = new Date().toISOString().slice(0, 10);
  const record = buildRecord({ version: options.version, capabilities, probe, codesign, archive, notarization, date });
  const evidence = { schema: 'blabee.codex-qualification-evidence.v1', version: options.version, measured_on: date,
    archive: { name: ASSET, sha256: archive.sha256, bytes: archive.bytes, url: archive.url ?? null, published_at: archive.publishedAt ?? null,
      source: options.download ? 'github-release' : 'local-archive' },
    bin_codex: { cdhash: codesign.cdhash, team: codesign.team, sha256: probe.file_digests['bin/codex'] },
    exec_server: probe.exec_server, file_count: Object.keys(probe.file_digests).length,
    fingerprint: probe.fingerprint, notarization_checked: notarization,
    notarized_native_files: notarizedFiles ? Object.keys(notarizedFiles).length : null };
  if (options.dryRun) { console.log(JSON.stringify({ record, evidence }, null, 2)); return { record, evidence }; }
  await writeFile(join(QUALIFICATION_DIRECTORY, `${options.version}.json`), JSON.stringify(record, null, 2) + '\n');
  await mkdir(join(root, 'docs/features/codex-evidence'), { recursive: true });
  await writeFile(join(root, `docs/features/codex-evidence/${options.version}.json`), JSON.stringify(evidence, null, 2) + '\n');
  const voice = join(packageDirectory, 'codex-resources/voice/runtime.json');
  if (await access(voice).then(() => true, () => false)) {
    await mkdir(join(root, `Fixtures/codex/${options.version}`), { recursive: true });
    await copyFile(voice, join(root, `Fixtures/codex/${options.version}/voice-runtime.json`));
  }
  for (const [path, text] of await generated()) await writeFile(path, text);
  const previous = existing.filter(r => compareVersions(r.version, options.version) < 0).at(-1)?.version;
  console.log([``, `Registered Codex ${options.version} (${record.capabilities.join(', ')}). Review before committing:`,
    `  - git diff: qualification JSON, generated Swift, evidence, fixture`,
    `  - Compare with ${previous ?? 'the previous release'}: \`codex queue\` arguments, Hook payloads, App Server approval schema`,
    `  - npm run test:t005 && npm run test:codex-compatibility && npm run test:swift -- --filter 'Codex|ManagedCodex|UpdateManagedCodex|Hook|DoctorApplication'`,
    `  - docs/features/CODEX_LATEST_SUPPORT.md (top) and CHANGELOG entries`].join('\n'));
  return { record, evidence };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await register(parseArguments(process.argv.slice(2))); }
  catch (error) { console.error(`codex register: ${error.message}`); process.exitCode = 1; }
}
