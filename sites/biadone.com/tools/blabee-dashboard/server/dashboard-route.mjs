// The only part of the public site that invokes dashboard Functions.
export const DASHBOARD_BASE = '/blabee/admin/';
export const DASHBOARD_ASSETS = Object.freeze([
  'index.html', 'styles.css', 'app.mjs', 'auth.mjs', 'paths.mjs',
  'charts.mjs', 'data.mjs', 'demo.mjs', 'mark.svg',
]);
const assets = new Set(DASHBOARD_ASSETS);
const apis = new Set(['api/config', 'api/admin/overview', 'api/admin/posts', 'api/admin/analytics']);
const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://vulnkqyqqbucvbhwjswr.supabase.co; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function protect(response, api = false) {
  // ASSETS/fetch responses may have immutable headers. Replace overlapping
  // landing policies instead of appending a second, conflicting CSP.
  const wrapped = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) wrapped.headers.set(name, value);
  if (api) {
    wrapped.headers.set('Cache-Control', 'private, no-store');
    wrapped.headers.set('Pragma', 'no-cache');
    const vary = new Set((wrapped.headers.get('Vary') || '').split(',').map(value => value.trim()).filter(Boolean));
    vary.add('Authorization'); vary.add('Origin');
    wrapped.headers.set('Vary', [...vary].join(', '));
  } else {
    // Keep Cloudflare's automatic analytics injection out of the owner console.
    wrapped.headers.set('Cache-Control', 'no-store, no-transform');
  }
  return wrapped;
}

function error(status, code) {
  return protect(Response.json({ error: { code } }, { status }), true);
}

export async function onRequestDashboard(context) {
  const url = new URL(context.request.url);
  if (url.pathname === DASHBOARD_BASE.slice(0, -1) || url.pathname === `${DASHBOARD_BASE}index.html`) {
    url.pathname = DASHBOARD_BASE;
    return protect(new Response(null, { status: 308, headers: { Location: url.href } }));
  }
  if (!url.pathname.startsWith(DASHBOARD_BASE)) return error(404, 'NOT_FOUND');
  const path = url.pathname.slice(DASHBOARD_BASE.length);
  const api = apis.has(path);
  if (!api && path !== '' && !assets.has(path)) return error(404, 'NOT_FOUND');
  if (!api && !['GET', 'HEAD'].includes(context.request.method)) {
    const response = error(405, 'METHOD_NOT_ALLOWED');
    response.headers.set('Allow', 'GET, HEAD');
    return response;
  }
  // API handlers still verify the actual user with Supabase and check the UID.
  // Unknown API/static paths above never fall through to the site's SPA shell.
  return protect(await context.next(), api);
}
