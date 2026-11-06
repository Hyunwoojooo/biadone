import { cp, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowedPublic = new Set(['index.html', 'styles.css', 'app.mjs', 'auth.mjs', 'paths.mjs', 'charts.mjs', 'data.mjs', 'demo.mjs', 'mark.svg', '_headers', '_routes.json']);

export async function prepare() {
  const names = await readdir(join(root, 'public'));
  if (names.some(name => !allowedPublic.has(name)) || [...allowedPublic].some(name => !names.includes(name))) throw new Error('Review the public deployment allowlist before packaging.');
  const html = await readFile(join(root, 'public/index.html'), 'utf8');
  if (/sb_secret_|service_role|BEGIN PRIVATE KEY/.test(html)) throw new Error('Private content cannot be packaged.');
  const destination = await mkdtemp(join(tmpdir(), 'blabee-dashboard-deploy-'));
  for (const directory of ['public', 'functions', 'server']) await cp(join(root, directory), join(destination, directory), { recursive: true });
  for (const file of ['wrangler.jsonc', 'package.json']) await cp(join(root, file), join(destination, file));
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.stdout.write(`${await prepare()}\n`);
