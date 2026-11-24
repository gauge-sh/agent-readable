import { userAgentMatchers } from './user-agents.js';
import { applyMarkdownHeaders, createMarkdownHandler, resolveMarkdownRequest } from './runtime.js';

const targetParam = '__agent_readable';
const targetHeader = 'x-agent-readable-target';
const defaultExclude = ['/api', '/_next'];
const warnedDeprecations = new Set();

function warnDeprecated(name) {
  if (warnedDeprecations.has(name)) return;
  warnedDeprecations.add(name);
  if (typeof console?.warn === 'function') {
    console.warn(`[agent-readable] ${name}() is deprecated and will be removed in a future release. Use defineNextMarkdown() instead.`);
  }
}

function validateRoute(route) {
  if (typeof route !== 'string' || !/^\/(?!\/)[^?#\\\s]+$/.test(route) || new URL(route, 'https://example.com').pathname !== route) {
    throw new TypeError('route must be an absolute pathname without queries or fragments.');
  }
}

function buildNextMarkdownRoute(options) {
  const handle = createMarkdownHandler(options);
  return async function route(request) {
    const url = new URL(request.url);
    let target;
    const encoded = request.headers.get(targetHeader) || url.searchParams.get(targetParam);
    // Base64url prevents framework rewrites from decoding query separators early.
    try {
      if (encoded && /^[A-Za-z0-9_-]+$/.test(encoded)) target = JSON.parse(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')));
    } catch { /* Invalid internal target. */ }
    if (!Array.isArray(target) || target.length !== 2) return new Response(null, { status: 404 });
    const [pathname, search] = target;
    if (typeof pathname !== 'string' || !/^\/(?!\/)[^?#\\\s]*$/.test(pathname)
      || typeof search !== 'string' || (search !== '' && !search.startsWith('?')) || search.includes('#')) return new Response(null, { status: 404 });
    url.pathname = pathname;
    if (url.pathname !== pathname) return new Response(null, { status: 404 });
    url.search = search;
    const headers = new Headers(request.headers);
    headers.delete(targetHeader);
    return await handle(new Request(url, { method: request.method, headers, signal: request.signal }))
      ?? new Response(null, { status: 404 });
  };
}

/**
 * Define shared routing configuration for a Next.js proxy and Markdown route handler.
 * Keep content resolvers out of this module so proxy.ts stays lightweight and Edge-safe.
 */
export function defineNextMarkdown({
  route = '/api/markdown',
  exclude = defaultExclude,
  userAgents = false,
  match,
  index = false,
} = {}) {
  validateRoute(route);
  if (!Array.isArray(exclude)) throw new TypeError('exclude must be an array of pathname prefixes.');
  if (match !== undefined && typeof match !== 'function') throw new TypeError('match must be a function.');
  if (typeof index !== 'boolean') throw new TypeError('index must be a boolean.');
  userAgentMatchers(userAgents);
  const exclusions = [...exclude, route];
  const routing = { exclude: exclusions, userAgents, match, index };

  /** Rewrite matching Markdown requests to the internal route, or return null for normal app routing. */
  function rewrite(NextResponse, request) {
    if (typeof NextResponse?.rewrite !== 'function') throw new TypeError('Pass NextResponse from next/server.');
    const target = resolveMarkdownRequest(request, routing);
    if (!target) return null;
    const url = new URL(request.url);
    // Nest the entire original target so even repeated/internal-looking query
    // keys survive the framework rewrite without collisions.
    const encoded = btoa(JSON.stringify([url.pathname, url.search])).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    url.pathname = route;
    url.search = '';
    url.searchParams.set(targetParam, encoded);
    // Next.js can expose the original URL to route handlers after a rewrite.
    // Forward the same encoded target as a request header, replacing client input.
    const headers = new Headers(request.headers);
    headers.set(targetHeader, encoded);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  /** Apply Vary and alternate Markdown Link headers to an existing response for covered HTML pages. */
  function applyHeaders(request, response) {
    const result = applyMarkdownHeaders(request, response, routing);
    // Next.js replaces Vary after middleware/proxy. A no-store response prevents
    // caches from mixing representations even when that framework header wins.
    const pathname = new URL(request.url).pathname.replace(/\/$/, '') || '/';
    if (result?.headers && ['GET', 'HEAD'].includes(request.method)
      && !pathname.split('/').pop().includes('.')
      && !exclusions.some(prefix => pathname === prefix || pathname.startsWith(`${prefix.replace(/\/$/, '')}/`))
      && (!match || match(pathname))) {
      result.headers.set('Cache-Control', 'private, no-store');
    }
    return result;
  }

  /** Standalone Next.js proxy handler when no other middleware needs to compose with it. */
  function proxy(NextResponse) {
    if (typeof NextResponse?.rewrite !== 'function' || typeof NextResponse?.next !== 'function') {
      throw new TypeError('Pass NextResponse from next/server.');
    }
    return function nextMarkdownProxy(request) {
      const rewritten = rewrite(NextResponse, request);
      if (rewritten) return rewritten;
      if (request.headers.has(targetHeader)) {
        const headers = new Headers(request.headers);
        headers.delete(targetHeader);
        return applyHeaders(request, NextResponse.next({ request: { headers } }));
      }
      return applyHeaders(request, NextResponse.next());
    };
  }

  /** GET/HEAD route handler paired with this routing configuration. */
  function createRoute(options = {}) {
    if (!options || typeof options !== 'object') throw new TypeError('Pass handler options with a resolve function.');
    for (const key of ['route', 'exclude', 'userAgents', 'match']) {
      if (options[key] !== undefined) {
        throw new TypeError(`Configure ${key} in defineNextMarkdown() instead of route() so proxy and route stay aligned.`);
      }
    }
    if (index === false && typeof options.index === 'function') {
      throw new TypeError('Cannot supply an index callback when defineNextMarkdown has index: false. Set index: true in defineNextMarkdown() to handle /llms.txt and /lm.txt.');
    }
    if (index === true && typeof options.index !== 'function') {
      throw new TypeError('defineNextMarkdown() has index: true, so route() requires an index callback.');
    }
    return buildNextMarkdownRoute({
      ...options,
      exclude: exclusions,
      userAgents,
      match,
      index: index === false ? false : options.index,
    });
  }

  return {
    options: Object.freeze({ route, exclude: Object.freeze([...exclude]), userAgents, match, index }),
    rewrite,
    applyHeaders,
    proxy,
    route: createRoute,
  };
}

function extractForwardedRequestHeaders(originalHeaders, proxyHeaders) {
  const overrideList = proxyHeaders?.get('x-middleware-override-headers');
  if (overrideList !== null && overrideList !== undefined) {
    const headers = new Headers();
    for (const rawKey of overrideList.split(',')) {
      const key = rawKey.trim();
      if (!key) continue;
      const value = proxyHeaders.get(`x-middleware-request-${key}`);
      if (value !== null) headers.set(key, value);
    }
    return headers;
  }
  const headers = new Headers(originalHeaders);
  if (proxyHeaders) {
    for (const [key, value] of proxyHeaders.entries()) {
      if (key.toLowerCase().startsWith('x-middleware-request-')) {
        headers.set(key.slice('x-middleware-request-'.length), value);
      }
    }
  }
  return headers;
}

function mergeProxyResponseHeaders(proxyHeaders, appResponse) {
  const headers = new Headers(appResponse.headers);
  for (const [key, value] of proxyHeaders.entries()) {
    const lower = key.toLowerCase();
    if (lower.startsWith('x-middleware-')) continue;
    if (lower === 'vary') {
      const existing = String(headers.get('vary') || '').split(',').map(v => v.trim()).filter(Boolean);
      const incoming = value.split(',').map(v => v.trim()).filter(Boolean);
      if (existing.includes('*') || incoming.includes('*')) headers.set('vary', '*');
      else {
        for (const token of incoming) {
          if (!existing.some(entry => entry.toLowerCase() === token.toLowerCase())) existing.push(token);
        }
        headers.set('vary', existing.join(', '));
      }
    } else if (lower === 'link') {
      const existing = headers.get('link');
      if (!existing) headers.set('link', value);
      else if (!existing.includes(value)) headers.set('link', `${existing}, ${value}`);
    } else if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  return new Response(appResponse.body, {
    status: appResponse.status,
    statusText: appResponse.statusText,
    headers,
  });
}

/**
 * Run a Next.js proxy and Markdown route handler together in tests without
 * reading Next.js internal middleware headers directly.
 */
export function createNextMarkdownTester({ proxy, route, fallback, routePath } = {}) {
  if (typeof proxy !== 'function') throw new TypeError('proxy must be a function.');
  if (typeof route !== 'function') throw new TypeError('route must be a function.');
  if (fallback !== undefined && typeof fallback !== 'function') throw new TypeError('fallback must be a function.');
  if (routePath !== undefined) validateRoute(routePath);

  return async function testNextMarkdown(input, init) {
    const request = input instanceof Request ? input : new Request(input, init);
    const proxyResponse = await proxy(request);
    if (!proxyResponse) {
      return fallback ? await fallback(request) : new Response(null, { status: 200 });
    }
    const proxyHeaders = proxyResponse.headers;
    const forwardedHeaders = extractForwardedRequestHeaders(request.headers, proxyHeaders);
    const rewrite = proxyHeaders?.get('x-middleware-rewrite');
    if (rewrite) {
      const destination = new URL(rewrite, request.url);
      const isMarkdownRoute = routePath
        ? destination.pathname === routePath
        : (forwardedHeaders.has(targetHeader) || destination.searchParams.has(targetParam));
      if (isMarkdownRoute) {
        const routeRequest = new Request(request.url, {
          method: request.method,
          headers: forwardedHeaders,
          signal: request.signal,
        });
        return await route(routeRequest);
      }
      return proxyResponse;
    }
    if (fallback && proxyHeaders?.get('x-middleware-next')) {
      const appRequest = new Request(request.url, {
        method: request.method,
        headers: forwardedHeaders,
        signal: request.signal,
      });
      const appResponse = await fallback(appRequest);
      return mergeProxyResponseHeaders(proxyHeaders, appResponse);
    }
    return proxyResponse;
  };
}

/**
 * NextResponse is supplied by the app so other frameworks do not install Next.js.
 * @deprecated Use defineNextMarkdown().proxy(NextResponse) instead.
 */
export function createNextMarkdownProxy(NextResponse, options = {}) {
  warnDeprecated('createNextMarkdownProxy');
  return defineNextMarkdown({ ...options, index: options.index ?? true }).proxy(NextResponse);
}

/**
 * GET/HEAD route handler paired with createNextMarkdownProxy.
 * @deprecated Use defineNextMarkdown().route(options) instead.
 */
export function createNextMarkdownRoute(options) {
  warnDeprecated('createNextMarkdownRoute');
  return buildNextMarkdownRoute(options);
}

export { applyMarkdownHeaders };
