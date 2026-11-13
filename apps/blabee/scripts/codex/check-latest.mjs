#!/usr/bin/env node
// Lists official stable Codex releases newer than the newest registered one
// (audit CDX-7: nothing watched for new versions). Read-only; it only queries
// the public GitHub releases API.
//
//   npm run codex:check-latest            print the result
//   npm run codex:check-latest -- --fail-on-new   exit 2 when a newer release exists

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, loadRecords } from './qualification.mjs';

/** Stable `rust-vX.Y.Z` releases newer than every registered version. */
export function unregisteredReleases(releases, registeredVersions) {
  const newest = [...registeredVersions].sort(compareVersions).at(-1);
  return releases
    .filter(r => !r.draft && !r.prerelease && /^rust-v\d+\.\d+\.\d+$/.test(r.tag_name ?? ''))
    .map(r => ({ version: r.tag_name.slice('rust-v'.length), publishedAt: r.published_at }))
    .filter(r => !registeredVersions.includes(r.version) && compareVersions(r.version, newest) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const failOnNew = process.argv.includes('--fail-on-new');
    const response = await fetch('https://api.github.com/repos/openai/codex/releases?per_page=50',
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'blabee-codex-check-latest' } });
    if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`);
    const records = await loadRecords();
    const versions = records.map(r => r.version);
    const pending = unregisteredReleases(await response.json(), versions);
    console.log(`Newest registered Codex: ${versions.at(-1)}`);
    if (pending.length === 0) console.log('No newer stable Codex release.');
    else {
      console.log('Not yet registered (users on these versions see "Codex version not supported"):');
      for (const r of pending) console.log(`  ${r.version}  published ${r.publishedAt?.slice(0, 10) ?? 'unknown'}`);
      console.log(`Register with: npm run codex:register -- --version ${pending.at(-1).version} --download --check-notarization`);
      if (failOnNew) process.exitCode = 2;
    }
  } catch (error) { console.error(`codex check-latest: ${error.message}`); process.exitCode = 1; }
}
