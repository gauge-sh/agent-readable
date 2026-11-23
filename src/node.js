import { userAgentMatchers } from './user-agents.js';
import { createMarkdownHandler, markdownDiscovery } from './runtime.js';

/** Wrap an existing Node HTTP handler without replacing its routes or APIs. */
export function createNodeMarkdownHandler({ origin, ...options }, next) {
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new TypeError('origin must be an HTTP(S) origin.');
  if (typeof next !== 'function') throw new TypeError('next must be a Node HTTP request handler.');
  const handle = createMarkdownHandler(options);
  const exclude = options.exclude ?? ['/api', '/_next'];
  return async function handler(req, res) {
    const url = new URL(req.url, base);
    if (url.origin !== base.origin) { res.writeHead(400); res.end(); return; }
    if (!['GET', 'HEAD'].includes(req.method)) return next(req, res);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
      else if (value !== undefined) headers.set(key, value);
    }
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    const cleanup = () => { req.off('aborted', abort); res.off('close', abort); };
    req.once('aborted', abort);
    res.once('close', abort);
    res.once('finish', cleanup);
    res.once('close', cleanup);
    const request = new Request(url, { method: req.method, headers, signal: controller.signal });
    const response = await handle(request);
    if (response) {
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
      return;
    }
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    const page = !pathname.split('/').pop().includes('.') && !exclude.some(prefix => pathname === prefix || pathname.startsWith(`${prefix.replace(/\/$/, '')}/`));
    if (page) {
      // Frameworks may overwrite headers while rendering. Merge at the actual
      // HTTP commit point, including headers supplied directly to writeHead.
      const writeHead = res.writeHead;
      res.writeHead = function (statusCode, statusMessage, suppliedHeaders) {
        const supplied = typeof statusMessage === 'string' ? suppliedHeaders : statusMessage;
        if (Array.isArray(supplied)) {
          const grouped = new Map();
          for (let i = 0; i < supplied.length; i += 2) {
            const key = supplied[i].toLowerCase();
            grouped.set(key, [...(grouped.get(key) || []), supplied[i + 1]]);
          }
          for (const [key, values] of grouped) this.setHeader(key, values.length === 1 ? values[0] : values);
        } else if (supplied) {
          for (const [key, value] of Object.entries(supplied)) this.setHeader(key, value);
        }
        const vary = String(this.getHeader('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
        if (!vary.some(value => ['*', 'accept'].includes(value.toLowerCase()))) vary.push('Accept');
        if (userAgentMatchers(options.userAgents).length && !vary.some(value => ['*', 'user-agent'].includes(value.toLowerCase()))) vary.push('User-Agent');
        this.setHeader('Vary', vary.join(', '));
        if ((statusCode >= 200 && statusCode < 300) || statusCode === 304) {
          const link = markdownDiscovery(url);
          const previous = String(this.getHeader('Link') || '');
          if (!previous.includes(link)) this.setHeader('Link', previous ? `${previous}, ${link}` : link);
        }
        return typeof statusMessage === 'string' ? writeHead.call(this, statusCode, statusMessage) : writeHead.call(this, statusCode);
      };
    }
    return next(req, res);
  };
}
