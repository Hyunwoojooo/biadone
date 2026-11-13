#!/usr/bin/env node
// Points README.md / README.ko.md at a published release build (audit REPO-9).
// Only the release badge, download links and the "rN" release mentions are
// rewritten; every other text is left byte-identical.
//
//   node scripts/release/update-readme.mjs --build 92
//
// `npm run release -- finalize` calls this after notarization; commit the
// README change separately, after the GitHub release is published.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const README_FILES = ['README.md', 'README.ko.md'];

export function updateReadmeRelease(text, build) {
  if (!Number.isSafeInteger(build) || build < 1) throw new Error('build must be a positive integer');
  const next = text
    .replace(/build\.\d+/g, `build.${build}`)
    .replace(/release-r\d+/g, `release-r${build}`)
    .replace(/Release r\d+/g, `Release r${build}`)
    .replace(/arm64-r\d+\.dmg/g, `arm64-r${build}.dmg`)
    .replace(/(^|[\s*([])r\d+(?= (?:app|source|앱|소스))/gm, `$1r${build}`)
    .replace(/0\.1\.0 r\d+/g, `0.1.0 r${build}`);
  return next;
}

export async function updateReadmes(build, { directory = root } = {}) {
  const changed = [];
  for (const name of README_FILES) {
    const path = join(directory, name);
    const before = await readFile(path, 'utf8');
    const after = updateReadmeRelease(before, build);
    if (after !== before) { await writeFile(path, after); changed.push(name); }
  }
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--build');
  const build = Number(process.argv[index + 1]);
  try {
    if (index < 0 || process.argv.length !== 4) throw new Error('usage: update-readme.mjs --build N');
    const changed = await updateReadmes(build);
    console.log(changed.length ? `Updated ${changed.join(', ')} to r${build}` : `README already points at r${build}`);
  } catch (error) { console.error(`update-readme: ${error.message}`); process.exitCode = 1; }
}
