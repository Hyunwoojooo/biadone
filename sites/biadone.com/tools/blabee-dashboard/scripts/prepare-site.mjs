import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DASHBOARD_ASSETS, DASHBOARD_BASE } from '../server/dashboard-route.mjs';
import { readConfig } from '../server/auth.mjs';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = resolve(dashboardRoot, '../..');
const sitePublic = ['index.html', 'css', 'js', 'blabase', 'blabee', '_headers', '_redirects'];

export async function prepareSite({ configPath = join(dashboardRoot, 'wrangler.jsonc') } = {}) {
  const publicNames = await readdir(join(dashboardRoot, 'public'));
  const expected = new Set([...DASHBOARD_ASSETS, '_headers', '_routes.json']);
  if (publicNames.length !== expected.size || publicNames.some(name => !expected.has(name))) {
    throw new Error('Review the dashboard public deployment allowlist before packaging.');
  }
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!readConfig(config.vars)?.ownerUids.length) throw new Error('Confirmed dashboard owner UIDs are required before packaging.');
  const destination = await mkdtemp(join(tmpdir(), 'biadone-dashboard-deploy-'));
  const publicRoot = join(destination, 'public');
  await mkdir(publicRoot);
  for (const item of sitePublic) await cp(join(siteRoot, item), join(publicRoot, item), { recursive: true });
  const adminRoot = join(publicRoot, DASHBOARD_BASE);
  // Never merge a second, independently edited admin source tree silently.
  try { await readdir(adminRoot); throw new Error('An existing public admin directory requires review.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(adminRoot, { recursive: true });
  for (const name of DASHBOARD_ASSETS) await cp(join(dashboardRoot, 'public', name), join(adminRoot, name));
  await writeFile(join(publicRoot, '_routes.json'), JSON.stringify({
    version: 1, include: [DASHBOARD_BASE.slice(0, -1), `${DASHBOARD_BASE}*`], exclude: [],
  }, null, 2) + '\n');
  await cp(join(dashboardRoot, 'server'), join(destination, 'dashboard-server'), { recursive: true });

  const entries = [
    ['_middleware.js', 'dashboard-route.mjs', 'onRequestDashboard'],
    ['api/config.js', 'config.mjs', 'handleConfig'],
    ['api/admin/overview.js', 'overview.mjs', 'handleOverview'],
    ['api/admin/posts.js', 'posts.mjs', 'handlePosts'],
    ['api/admin/analytics.js', 'analytics.mjs', 'handleAnalytics'],
  ];
  for (const [file, module, handler] of entries) {
    const target = join(destination, 'functions', DASHBOARD_BASE, file);
    await mkdir(dirname(target), { recursive: true });
    const imported = relative(dirname(target), join(destination, 'dashboard-server', module)).split('\\').join('/');
    await writeFile(target, `export { ${handler} as onRequest } from '${imported}';\n`);
  }
  await writeFile(join(destination, 'wrangler.jsonc'), JSON.stringify({
    ...config, name: 'biadone', pages_build_output_dir: './public',
  }, null, 2) + '\n');
  await cp(join(dashboardRoot, 'package.json'), join(destination, 'package.json'));
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${await prepareSite()}\n`);
}
