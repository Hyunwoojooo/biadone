import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'PUBLIC_SOURCES.json'), 'utf8'));
let count = 0;
for (const entry of manifest.files) {
  if (entry.path.endsWith('.mjs')) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, entry.path)], {
      encoding: 'utf8', timeout: 10_000,
    });
    if (result.error || result.status !== 0) throw new Error(`Syntax check failed: ${entry.path}`);
    count++;
  } else if (entry.path.endsWith('.json')) {
    JSON.parse(await readFile(path.join(root, entry.path), 'utf8'));
    count++;
  }
}
const launcher = 'bridges/codex/plugin/scripts/blabee-launcher';
const shell = spawnSync('/bin/sh', ['-n', path.join(root, launcher)], { encoding: 'utf8', timeout: 10_000 });
if (shell.error || shell.status !== 0) throw new Error(`Shell syntax check failed: ${launcher}`);
console.log(`Syntax checked ${count} JavaScript/JSON files and the Codex shell launcher.`);
