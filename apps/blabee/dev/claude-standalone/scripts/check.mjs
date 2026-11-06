import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT } from '../src/shared/identity.mjs';

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
for (const directory of ['src', 'scripts', 'test-support', '../../Tests/bridges/claude/standalone']) await check(join(PROJECT_ROOT, directory));
console.log(`JavaScript syntax: ${count} files passed`);
