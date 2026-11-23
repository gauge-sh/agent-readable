import { userAgentMatchers } from './user-agents.js';
import { createMarkdownHandler, resolveMarkdownRequest, markdownDiscovery } from './runtime.js';

const targetParam = '__agent_readable';
const defaultExclude = ['/api', '/_next'];
const excluded = (pathname, prefixes) => prefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix.replace(/\/$/, '')}/`));

/** NextResponse is supplied by the app so other frameworks do not install Next.js. */
export function createNextMarkdownProxy(NextResponse, { route = '/api/markdown', exclude = defaultExclude, userAgents = false } = {}) {
  if (typeof NextResponse?.rewrite !== 'function' || typeof NextResponse?.next !== 'function') throw new TypeError('Pass NextResponse from next/server.');
  if (typeof route !== 'string' || !/^\/(?!\/)[^?#\\\s]+$/.test(route) || new URL(route, 'https://example.com').pathname !== route) throw new TypeError('route must be an absolute pathname without queries or fragments.');
  const auto = userAgentMatchers(userAgents).length > 0;
  const exclusions = [...exclude, route];
  return function proxy(request) {
    const url = new URL(request.url);
    const target = resolveMarkdownRequest(request, { exclude: exclusions, userAgents });
    if (target) {
      // Nest the entire original target so even repeated/internal-looking query
      // keys survive the framework rewrite without collisions.
      const target = btoa(JSON.stringify([url.pathname, url.search])).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      url.pathname = route;
      url.search = '';
      url.searchParams.set(targetParam, target);
      return NextResponse.rewrite(url);
    }
    const response = NextResponse.next();
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    if (['GET', 'HEAD'].includes(request.method) && !excluded(pathname, exclusions) && !pathname.split('/').pop().includes('.')) {
      const vary = response.headers.get('Vary');
      if (!vary?.split(',').some(value => ['accept', '*'].includes(value.trim().toLowerCase()))) response.headers.set('Vary', vary ? `${vary}, Accept` : 'Accept');
      const currentVary = response.headers.get('Vary');
      if (auto && !currentVary.split(',').some(value => ['*', 'user-agent'].includes(value.trim().toLowerCase()))) response.headers.set('Vary', `${currentVary}, User-Agent`);
      const link = markdownDiscovery(url);
      const previous = response.headers.get('Link');
      response.headers.set('Link', previous ? `${previous}, ${link}` : link);
    }
    return response;
  };
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
