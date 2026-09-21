import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BRIDGE_ROOT, TEST_ROOT } from '../support/paths.mjs';

let count = 0;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
      count++;
    }
  }
}
for (const directory of ['src', 'launchers', 'test-support']) await check(join(BRIDGE_ROOT, directory));
for (const directory of ['integration', 'scripts', 'support']) await check(join(TEST_ROOT, directory));
for (const entry of await readdir(TEST_ROOT, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.mjs')) {
    const result = spawnSync(process.execPath, ['--check', join(TEST_ROOT, entry.name)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
    count++;
  }
}
console.log(`JavaScript syntax: ${count} files passed`);
