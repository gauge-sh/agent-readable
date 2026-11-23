import { matchesUserAgent, userAgentMatchers } from './user-agents.js';
import { gaugeAttribution } from './attribution.js';

// Framework-independent runtime support. Uses only Web Request/Response APIs.
// Import this subpath in server adapters to avoid the build-time filesystem stack.

/** Explicit Markdown opt-in, with exact media types overriding wildcard ranges. */
export function prefersMarkdown(accept = '') {
  const ranges = String(accept).toLowerCase().split(',').map(part => {
    const [type, ...parameters] = part.trim().split(';');
    const qualities = parameters.map(p => p.trim()).filter(p => /^q\s*=/.test(p));
    const raw = qualities[0]?.replace(/^q\s*=\s*/, '');
    const q = qualities.length === 0 ? 1 : qualities.length === 1 && /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw) ? Number(raw) : 0;
    return { type: type.trim(), q };
  });
  const quality = type => {
    for (const match of [type, `${type.split('/')[0]}/*`, '*/*']) {
      const found = ranges.filter(range => range.type === match);
      if (found.length) return Math.max(...found.map(range => range.q));
    }
    return 0;
  };
  const markdown = Math.max(0, ...ranges.filter(range => ['text/markdown', 'text/x-markdown'].includes(range.type)).map(range => range.q));
  return markdown > 0 && markdown >= Math.max(quality('text/html'), quality('application/xhtml+xml'));
}

/** Returns a page target, or null when the request belongs to the existing app. */
export function resolveMarkdownRequest(request, { exclude = ['/api', '/_next'], userAgents = false } = {}) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (exclude.some(prefix => pathname === prefix || pathname.startsWith(`${prefix.replace(/\/$/, '')}/`))) return null;
  const index = ['/lm.txt', '/llms.txt'].includes(pathname);
  let page;
  if (['/.md', '/index.md'].includes(pathname)) page = '/';
  else if (pathname.endsWith('.md')) page = pathname.slice(0, -3) || '/';
  else if (index) page = pathname;
  else if (!pathname.split('/').pop().includes('.') && (prefersMarkdown(request.headers.get('accept') || '') || matchesUserAgent(request, userAgents))) page = pathname;
  else return null;
  return { pathname: page, searchParams: new URLSearchParams(url.searchParams), index };
}

/** HTTP discovery header value, retaining query-dependent page variants. */
export function markdownDiscovery(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.replace(/\/$/, '') || '/';
  const markdown = pathname === '/' ? '/index.md' : `${pathname}.md`;
  return `<${markdown}${parsed.search}>; rel="alternate"; type="text/markdown"`;
}

/**
 * resolve({ pathname, searchParams, request }) => string | null | Promise
 * index receives the same context. null/undefined means 404, never the homepage.
 * null from the returned handler means normal app routing should continue.
 */
export function createMarkdownHandler({ resolve, index, attribution = false, exclude, userAgents = false } = {}) {
  if (typeof resolve !== 'function') throw new TypeError('resolve must be a Markdown resolver function.');
  if (index !== undefined && typeof index !== 'function') throw new TypeError('index must be a function.');
  if (typeof attribution !== 'boolean') throw new TypeError('attribution must be a boolean.');
  const vary = userAgentMatchers(userAgents).length ? 'Accept, User-Agent' : 'Accept';
  return async function handleMarkdown(request) {
    const target = resolveMarkdownRequest(request, { exclude, userAgents });
    if (!target) return null;
    const context = { ...target, request };
    let body = target.index ? await index?.(context) : await resolve(context);
    const missing = body === null || body === undefined;
    if (!missing && typeof body !== 'string') throw new TypeError('Markdown resolvers must return a string or null.');
    if (missing) body = '# Page not found\n\n[Return to the directory](/index.md)\n';
    else if (target.index && attribution) body += gaugeAttribution;
    const headers = {
      'Content-Type': target.index ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Cache-Control': 'no-store',
      Vary: vary,
      'X-Content-Type-Options': 'nosniff',
    };
    if (!target.index && !missing) {
      const canonical = new URL(request.url);
      canonical.pathname = target.pathname;
      headers.Link = markdownDiscovery(canonical);
    }
    return new Response(request.method === 'HEAD' ? null : body, { status: missing ? 404 : 200, headers });
  };
}
