import { load } from 'cheerio';
import { markdownPath } from './content.js';

async function request(url, accept) {
  let current = new URL(url);
  const origin = current.origin;
  const signal = AbortSignal.timeout(15000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(current, { headers: { Accept: accept }, signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has('location')) {
      await response.body?.cancel();
      const next = new URL(response.headers.get('location'), current);
      if (next.origin !== origin || next.username || next.password) throw new Error('Redirect leaves the supplied origin; check the canonical origin directly.');
      current = next;
      continue;
    }
    const body = await response.text();
    return { response, body };
  }
  throw new Error('Too many redirects.');
}
const markdownType = response => /^text\/markdown(?:\s*;|$)/i.test(response.headers.get('content-type') || '');
const htmlType = response => /^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') || '');
const varies = response => (response.headers.get('vary') || '').split(',').some(v => ['accept', '*'].includes(v.trim().toLowerCase()));
const looksHtml = body => /^\s*(?:<!doctype\s+html|<html\b)/i.test(body);

export async function checkPage(url, { skipHeadingCheck = false } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) });
  try {
    const html = await request(url, 'text/html');
    add('HTML response', html.response.ok && htmlType(html.response));
    const $ = load(html.body);
    const alternate = $('link[rel="alternate"][type="text/markdown"]').attr('href');
    add('HTML discovery link', alternate);
    add('HTTP discovery link', /rel="?alternate"?/.test(html.response.headers.get('link') || '') && /text\/markdown/.test(html.response.headers.get('link') || ''));
    const mdUrl = new URL(alternate || markdownPath(new URL(html.response.url).pathname), html.response.url);
    if (mdUrl.origin !== new URL(url).origin) throw new Error('Markdown alternate points to another origin; inspect it manually.');
    const direct = await request(mdUrl, 'text/markdown');
    const negotiated = await request(url, 'text/markdown');
    const reject = await request(url, 'text/html, text/markdown;q=0');
    add('Direct Markdown response', direct.response.ok && markdownType(direct.response) && direct.body.trim() && !looksHtml(direct.body));
    add('Negotiated Markdown response', negotiated.response.ok && markdownType(negotiated.response) && negotiated.body.trim() && !looksHtml(negotiated.body));
    add('Markdown responses match', direct.body.trim() === negotiated.body.trim());
    add('HTML varies on Accept', varies(html.response));
    add('Markdown varies on Accept', varies(negotiated.response));
    add('q=0 keeps HTML', reject.response.ok && htmlType(reject.response));
    const heading = $('main h1, article h1, [role="main"] h1').first().text().trim();
    if (heading && !skipHeadingCheck) add('Page heading retained', direct.body.includes(heading), 'A basic content check, not a full parity audit.');
  } catch (error) { add('Request completed', false, error.message); }
  return { url, ok: checks.every(c => c.ok), checks };
}

export async function check(site, paths = ['/'], { manifest, skipHeadingCheck = false } = {}) {
  const origin = new URL(site);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Expected an HTTP(S) URL without credentials.');
  if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string' || !p.trim())) throw new Error('Provide at least one nonempty check path.');
  const normalize = route => route.replace(/\/$/, '') || '/';
  const customRoutes = new Set((manifest?.pages || []).filter(page => page.source === 'custom').map(page => normalize(new URL(page.route, origin).pathname)));
  const results = [];
  for (const p of paths) {
    const url = new URL(p, origin);
    if (url.origin !== origin.origin) throw new Error('Check paths must stay on the supplied origin.');
    results.push(await checkPage(url.href, { skipHeadingCheck: skipHeadingCheck || customRoutes.has(normalize(url.pathname)) }));
  }
  return { ok: results.every(r => r.ok), pages: results };
}
