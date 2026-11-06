import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleConfig } from '../server/config.mjs';
import { handleOverview } from '../server/overview.mjs';
import { handlePosts } from '../server/posts.mjs';
import { handleAnalytics } from '../server/analytics.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(root, 'public');
const prefix = '/blabee/admin/';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const routes = { '/api/config': handleConfig, '/api/admin/overview': handleOverview, '/api/admin/posts': handlePosts, '/api/admin/analytics': handleAnalytics };

export function createDevHandler({ env = {}, headers = {}, port = 8814, publicDirectory = publicRoot, apiRoutes = routes } = {}) {
  const directory = resolve(publicDirectory);
  return async (incoming, outgoing) => {
    try {
      // Inspect the original target before URL dot-segment normalization can hide traversal.
      if (typeof incoming.url !== 'string' || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) throw new Error('Not found');
      const rawPath = incoming.url.split('?')[0];
      const path = decodeURIComponent(rawPath);
      if (path.includes('\0') || path.includes('\\') || /%2f|%5c/i.test(rawPath)
          || path.split('/').some(part => part === '.' || part === '..')) throw new Error('Not found');
      const host = incoming.headers.host || `127.0.0.1:${port}`;
      if (!new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]).has(host)) throw new Error('Not found');
      const url = new URL(incoming.url, `http://${host}`);
      if (path === prefix.slice(0, -1)) {
        outgoing.writeHead(308, { ...headers, Location: `${prefix}${url.search}`, 'Cache-Control': 'no-store' });
        outgoing.end(); return;
      }
      const pathname = path.startsWith(prefix) ? `/${path.slice(prefix.length)}` : path;
      if (Object.hasOwn(apiRoutes, pathname)) {
        const chunks = []; let bytes = 0;
        for await (const chunk of incoming) {
          bytes += chunk.length;
          if (bytes > 32768) { outgoing.writeHead(413, { ...headers, 'Cache-Control': 'private, no-store' }); outgoing.end(); return; }
          chunks.push(chunk);
        }
        const request = new Request(url, { method: incoming.method, headers: incoming.headers,
          ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }) });
        const response = await apiRoutes[pathname]({ request, env });
        const responseHeaders = new Headers(headers);
        response.headers.forEach((value, key) => responseHeaders.set(key, value));
        outgoing.writeHead(response.status, Object.fromEntries(responseHeaders));
        outgoing.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(incoming.method)) throw new Error('Not found');
      const target = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!target.startsWith(directory + sep) || pathname.split('/').some(part => part.startsWith('_')) || !types[extname(target)]) throw new Error('Not found');
      const [actualDirectory, actualTarget] = await Promise.all([realpath(directory), realpath(target)]);
      if (!actualTarget.startsWith(actualDirectory + sep) || !(await stat(actualTarget)).isFile()) throw new Error('Not found');
      const content = await readFile(actualTarget);
      outgoing.writeHead(200, { ...headers, 'Content-Type': types[extname(target)], 'Cache-Control': 'no-store' });
      outgoing.end(incoming.method === 'HEAD' ? undefined : content);
    } catch { outgoing.writeHead(404, headers); outgoing.end('Not found'); }
  };
}

export function withDevelopmentOverrides(vars, overrides = process.env) {
  const env = { ...vars };
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'DASHBOARD_OWNER_UIDS', 'DASHBOARD_OWNER_UID', 'DASHBOARD_OWNER_EMAIL', 'CF_ANALYTICS_API_TOKEN']) {
    if (overrides[key] || (key === 'DASHBOARD_OWNER_UIDS' && Object.hasOwn(overrides, key))) env[key] = overrides[key];
  }
  return env;
}

async function main() {
  const flag = process.argv.indexOf('--port');
  const port = Number(flag < 0 ? process.env.PORT || 8814 : process.argv[flag + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.');
  const config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  const env = withDevelopmentOverrides(config.vars);
  // Reuse only the existing intentionally public browser key, in memory, for local development.
  // This does not read/write environment or credential files and is not included in deployment.
  if (!env.SUPABASE_PUBLISHABLE_KEY) {
    try {
      const existing = await readFile(resolve(root, '../../blabee/js/beta-config.js'), 'utf8');
      env.SUPABASE_PUBLISHABLE_KEY = existing.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
    } catch { /* An isolated checkout can still run the clearly labeled demo. */ }
  }
  const rules = await readFile(resolve(publicRoot, '_headers'), 'utf8');
  const headers = Object.fromEntries(rules.split('\n').filter(line => /^\s+[^:]+:/.test(line)).map(line => {
    const colon = line.indexOf(':'); return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }));
  const server = createServer(createDevHandler({ env, headers, port }));
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Blabee dashboard: http://127.0.0.1:${port}\nSample: http://127.0.0.1:${port}/?demo=1\nSubpath: http://127.0.0.1:${port}${prefix}\n`));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
