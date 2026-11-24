import { matchesUserAgent, userAgentMatchers } from './user-agents.js';
import { gaugeAttribution } from './attribution.js';

// Framework-independent runtime support. Uses only Web Request/Response APIs.
// Import this subpath in server adapters to avoid the build-time filesystem stack.

const defaultExclude = ['/api', '/_next'];
const defaultNotFound = '# Page not found\n\n[Return to the directory](/index.md)\n';
const normalizePathname = pathname => pathname.replace(/\/$/, '') || '/';
const isExcluded = (pathname, exclude) => exclude.some(prefix => pathname === prefix || pathname.startsWith(`${prefix.replace(/\/$/, '')}/`));
const hasFileExtension = pathname => pathname.split('/').pop().includes('.');

function validateMatch(match) {
  if (match !== undefined && typeof match !== 'function') throw new TypeError('match must be a function.');
}

function validateCacheControl(value) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
    throw new TypeError('cacheControl must be a nonempty header value string.');
  }
  return value;
}

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
export function resolveMarkdownRequest(request, { exclude = defaultExclude, userAgents = false, match, index = true } = {}) {
  validateMatch(match);
  if (typeof index !== 'boolean') throw new TypeError('index must be a boolean.');
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  const pathname = normalizePathname(url.pathname);
  if (isExcluded(pathname, exclude)) return null;
  const isIndex = ['/lm.txt', '/llms.txt'].includes(pathname);
  if (isIndex) {
    if (!index) return null;
    return { pathname, searchParams: new URLSearchParams(url.searchParams), index: true };
  }
  let page;
  if (['/.md', '/index.md'].includes(pathname)) page = '/';
  else if (pathname.endsWith('.md')) page = pathname.slice(0, -3) || '/';
  else if (!hasFileExtension(pathname) && (prefersMarkdown(request.headers.get('accept') || '') || matchesUserAgent(request, userAgents))) page = pathname;
  else return null;
  if (match && !match(page)) return null;
  return { pathname: page, searchParams: new URLSearchParams(url.searchParams), index: false };
}

/** HTTP discovery header value, retaining query-dependent page variants. */
export function markdownDiscovery(url) {
  const parsed = new URL(url);
  const pathname = normalizePathname(parsed.pathname);
  const markdown = pathname === '/' ? '/index.md' : `${pathname}.md`;
  return `<${markdown}${parsed.search}>; rel="alternate"; type="text/markdown"`;
}

/** Merge Vary and alternate Markdown Link discovery headers onto an eligible HTML response. */
export function applyMarkdownHeaders(request, response, { exclude = defaultExclude, userAgents = false, match } = {}) {
  validateMatch(match);
  const auto = userAgentMatchers(userAgents).length > 0;
  if (!response?.headers || !['GET', 'HEAD'].includes(request.method)) return response;
  const url = new URL(request.url);
  const pathname = normalizePathname(url.pathname);
  if (isExcluded(pathname, exclude) || hasFileExtension(pathname)) return response;
  if (match && !match(pathname)) return response;
  const vary = String(response.headers.get('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!vary.some(value => ['*', 'accept'].includes(value.toLowerCase()))) vary.push('Accept');
  if (auto && !vary.some(value => ['*', 'user-agent'].includes(value.toLowerCase()))) vary.push('User-Agent');
  response.headers.set('Vary', vary.join(', '));
  if (response.status === undefined || (response.status >= 200 && response.status < 300) || response.status === 304) {
    const link = markdownDiscovery(url);
    const previous = response.headers.get('Link');
    if (!previous?.includes(link)) response.headers.set('Link', previous ? `${previous}, ${link}` : link);
  }
  return response;
}

/**
 * resolve({ pathname, searchParams, request }) => string | null | Promise
 * index receives the same context; pass false to delegate /llms.txt and /lm.txt to the app.
 * null/undefined from resolve means 404, never the homepage.
 * null from the returned handler means normal app routing should continue.
 */
export function createMarkdownHandler({
  resolve,
  index,
  attribution = false,
  exclude,
  userAgents = false,
  match,
  cacheControl = 'no-store',
  notFound = defaultNotFound,
} = {}) {
  if (typeof resolve !== 'function') throw new TypeError('resolve must be a Markdown resolver function.');
  if (index !== undefined && index !== false && typeof index !== 'function') throw new TypeError('index must be a function or false.');
  if (typeof attribution !== 'boolean') throw new TypeError('attribution must be a boolean.');
  validateMatch(match);
  if (typeof cacheControl !== 'function') validateCacheControl(cacheControl);
  if (typeof notFound !== 'string' && typeof notFound !== 'function') throw new TypeError('notFound must be a string or a function.');
  const vary = userAgentMatchers(userAgents).length ? 'Accept, User-Agent' : 'Accept';
  const serveIndex = index !== false;
  return async function handleMarkdown(request) {
    const target = resolveMarkdownRequest(request, { exclude, userAgents, match, index: serveIndex });
    if (!target) return null;
    const context = { ...target, request };
    let body = target.index ? (typeof index === 'function' ? await index(context) : null) : await resolve(context);
    const missing = body === null || body === undefined;
    if (!missing && typeof body !== 'string') throw new TypeError('Markdown resolvers must return a string or null.');
    if (missing) {
      body = typeof notFound === 'function' ? await notFound(context) : notFound;
      if (typeof body !== 'string') throw new TypeError('notFound must return a string.');
    } else if (target.index && attribution) body += gaugeAttribution;
    let resolvedCacheControl = 'no-store';
    if (!missing) {
      if (typeof cacheControl === 'function') {
        const value = await cacheControl(context);
        resolvedCacheControl = value === null || value === undefined ? 'no-store' : validateCacheControl(value);
      } else {
        resolvedCacheControl = cacheControl;
      }
    }
    const headers = {
      'Content-Type': target.index ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Cache-Control': resolvedCacheControl,
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
