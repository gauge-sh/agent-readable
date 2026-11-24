import { convert } from './content.js';

/** Convert existing HTML on demand. Keep this Node-only helper out of middleware. */
export function createHtmlMarkdownResolver({ origin, fetchHtml, contentSelector, excludeSelectors = [] } = {}) {
  let base;
  if (origin !== undefined) {
    base = new URL(origin);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
      throw new TypeError('origin must be a trusted HTTP(S) origin without a path or credentials.');
    }
  }
  if (fetchHtml !== undefined && typeof fetchHtml !== 'function') throw new TypeError('fetchHtml must be a function.');
  if (!base && !fetchHtml) throw new TypeError('Supply a trusted origin or a fetchHtml function.');
  return async function resolveHtml(context) {
    const { pathname, searchParams, request } = context;
    if (typeof pathname !== 'string' || !/^\/(?!\/)[^?#\\\s]*$/.test(pathname)) throw new TypeError('Expected a page pathname.');
    // Never derive a credential-bearing fetch destination from a client Host header.
    let url = new URL(pathname, base || new URL(request.url).origin);
    url.search = searchParams.toString();
    let response;
    if (fetchHtml) response = await fetchHtml({ ...context, url });
    else {
      const headers = new Headers({ Accept: 'text/html, text/markdown;q=0', 'User-Agent': 'agent-readable-html/1' });
      for (const name of ['cookie', 'authorization', 'accept-language']) {
        if (request.headers.has(name)) headers.set(name, request.headers.get(name));
      }
      // No redirects to other origins: cookies and authorization remain on the trusted host.
      for (let redirects = 0; redirects <= 5; redirects++) {
        response = await fetch(url, { method: 'GET', headers, redirect: 'manual', cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
        if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.has('location')) break;
        await response.body?.cancel();
        const next = new URL(response.headers.get('location'), url);
        if (next.origin !== base.origin || next.username || next.password) throw new Error('HTML source redirected outside the configured origin.');
        if (redirects === 5) throw new Error('Too many HTML source redirects.');
        url = next;
      }
    }
    if (!(response instanceof Response)) throw new TypeError('fetchHtml must return a Response.');
    if ([401, 403, 404, 410].includes(response.status)) { await response.body?.cancel(); return null; }
    if (!response.ok || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel();
      throw new Error(`Expected HTML from page source (status ${response.status}).`);
    }
    const converted = convert(await response.text(), url.href, contentSelector, excludeSelectors);
    return converted.noindex ? null : converted.markdown;
  };
}
