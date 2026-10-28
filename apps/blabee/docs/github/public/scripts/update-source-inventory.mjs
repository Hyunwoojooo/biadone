import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPublicSources } from './verify-public-sources.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(root, 'PUBLIC_SOURCES.json');
const manifest = JSON.parse(await readFile(filename, 'utf8'));
// This updates existing inventory entries only. Adding a file is an explicit
// scope review: add its path/origin/mode to the manifest, then run this command.
for (const entry of manifest.files) {
  if (typeof entry.path !== 'string' || path.isAbsolute(entry.path)
      || entry.path.includes('\\') || entry.path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid inventory path.');
  }
  const destination = path.join(root, entry.path);
  let current = root;
  for (const part of entry.path.split('/')) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink inventory path rejected.');
  }
  if (!(await lstat(destination)).isFile()) throw new Error('Inventory entry is not a regular file.');
  entry.sha256 = createHash('sha256').update(await readFile(destination)).digest('hex');
}
await writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`);
await verifyPublicSources(root);
console.log('Updated source hashes. Review PUBLIC_SOURCES.json before committing.');
