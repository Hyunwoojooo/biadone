/** The shipped module's directory is the app base; page paths and query values cannot override it. */
export function createDashboardPaths(moduleURL = import.meta.url, locationURL = moduleURL) {
  const module = new URL(moduleURL);
  const page = new URL(locationURL);
  if (!['https:', 'http:'].includes(module.protocol) || module.origin !== page.origin
      || module.username || module.password || page.username || page.password) {
    throw new TypeError('Dashboard modules and the current page must use the same HTTP(S) origin.');
  }
  const base = new URL('./', module);
  const callback = new URL(base);
  callback.searchParams.set('auth_return', '1');
  return Object.freeze({
    basePath: base.pathname,
    homeURL: base.href,
    oauthCallbackURL: callback.href,
    apiPath(route) {
      if (typeof route !== 'string' || !/^\/api\/(?:config|admin\/overview|admin\/posts|admin\/analytics)(?:\?[^#]*)?$/.test(route)) {
        throw new TypeError('Use a supported dashboard API route.');
      }
      const target = new URL(route.slice(1), base);
      return target.pathname + target.search;
    },
  });
}
