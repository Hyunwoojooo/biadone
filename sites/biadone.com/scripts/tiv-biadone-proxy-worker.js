export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/tiv")) {
      return fetch(request);
    }

    url.hostname = "chatgpt-fetcher.biadone.com";
    url.protocol = "https:";

    const response = await fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    headers.set("x-tiv-proxy", "cloudflare-worker-pages");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
