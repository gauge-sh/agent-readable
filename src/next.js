import { userAgentMatchers } from './user-agents.js';
import { applyMarkdownHeaders, createMarkdownHandler, resolveMarkdownRequest } from './runtime.js';

const targetParam = '__agent_readable';
const defaultExclude = ['/api', '/_next'];

function validateRoute(route) {
  if (typeof route !== 'string' || !/^\/(?!\/)[^?#\\\s]+$/.test(route) || new URL(route, 'https://example.com').pathname !== route) {
    throw new TypeError('route must be an absolute pathname without queries or fragments.');
  }
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
  index = true,
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
    return NextResponse.rewrite(url);
  }

  /** Apply Vary and alternate Markdown Link headers to an existing response for covered HTML pages. */
  function applyHeaders(request, response) {
    return applyMarkdownHeaders(request, response, routing);
  }

  /** Standalone Next.js proxy handler when no other middleware needs to compose with it. */
  function proxy(NextResponse) {
    if (typeof NextResponse?.rewrite !== 'function' || typeof NextResponse?.next !== 'function') {
      throw new TypeError('Pass NextResponse from next/server.');
    }
    return function nextMarkdownProxy(request) {
      return rewrite(NextResponse, request) ?? applyHeaders(request, NextResponse.next());
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
      throw new TypeError('Cannot supply an index callback when defineNextMarkdown disabled index routing (index: false).');
    }
    return createNextMarkdownRoute({
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

/** NextResponse is supplied by the app so other frameworks do not install Next.js. */
export function createNextMarkdownProxy(NextResponse, options = {}) {
  return defineNextMarkdown(options).proxy(NextResponse);
}

/** GET/HEAD route handler paired with createNextMarkdownProxy. */
export function createNextMarkdownRoute(options) {
  const handle = createMarkdownHandler(options);
  return async function route(request) {
    const url = new URL(request.url);
    let target;
    const encoded = url.searchParams.get(targetParam);
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
    return await handle(new Request(url, { method: request.method, headers: request.headers, signal: request.signal }))
      ?? new Response(null, { status: 404 });
  };
}

export { applyMarkdownHeaders };
