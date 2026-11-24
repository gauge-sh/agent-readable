import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { markdownPath } from './content.js';

function normalizeHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new TypeError('headers must be a plain object mapping header names to string values.');
  }
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== 'string' || !key.trim() || typeof value !== 'string' || /[\r\n]/.test(key) || /[\r\n]/.test(value)) {
      throw new TypeError(`Invalid request header: ${key}`);
    }
    if (key.toLowerCase() === 'accept') continue;
    normalized[key] = value;
  }
  return normalized;
}

async function request(url, accept, extraHeaders = {}) {
  let current = new URL(url);
  const origin = current.origin;
  const signal = AbortSignal.timeout(15000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(current, { headers: { ...extraHeaders, Accept: accept }, signal, redirect: 'manual' });
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
const normalizeWhitespace = value => value.replace(/\s+/g, ' ').trim();
const normalizeRoute = pathname => pathname.replace(/\/$/, '') || '/';
const looksHtml = body => /^\s*(?:<!doctype\s+html|<html\b)/i.test(body);

function canonicalLinkTarget(response, baseUrl) {
  const header = response.headers.get('link') || '';
  for (const part of header.split(',')) {
    const match = /^\s*<([^>]+)>\s*;(.*)$/.exec(part);
    if (!match) continue;
    if (/(?:^|;)\s*rel\s*=\s*(?:"[^"]*\bcanonical\b[^"]*"|canonical\b)/i.test(match[2])) {
      try { return new URL(match[1], baseUrl); } catch { return null; }
    }
  }
  return null;
}

export async function checkPage(url, { skipHeadingCheck = false, headers } = {}) {
  const extraHeaders = normalizeHeaders(headers);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) });
  try {
    const html = await request(url, 'text/html', extraHeaders);
    add('HTML response', html.response.ok && htmlType(html.response));
    const $ = load(html.body);
    add('No leaked agent-only elements', !$('[data-agent-only]').length);
    const alternate = $('link[rel="alternate"][type="text/markdown"]').attr('href');
    add('HTML discovery link', alternate);
    add('HTTP discovery link', /rel="?alternate"?/.test(html.response.headers.get('link') || '') && /text\/markdown/.test(html.response.headers.get('link') || ''));
    const mdUrl = new URL(alternate || markdownPath(new URL(html.response.url).pathname), html.response.url);
    if (mdUrl.origin !== new URL(url).origin) throw new Error('Markdown alternate points to another origin; inspect it manually.');
    const direct = await request(mdUrl, 'text/markdown', extraHeaders);
    const negotiated = await request(url, 'text/markdown', extraHeaders);
    const reject = await request(url, 'text/html, text/markdown;q=0', extraHeaders);
    add('Direct Markdown response', direct.response.ok && markdownType(direct.response) && direct.body.trim() && !looksHtml(direct.body));
    const canonical = canonicalLinkTarget(direct.response, html.response.url);
    add(
      'Markdown canonical link',
      canonical && !canonical.pathname.endsWith('.md') && normalizeRoute(canonical.pathname) === normalizeRoute(new URL(html.response.url).pathname),
      'Direct Markdown responses must include a Link header with rel="canonical" pointing to the HTML page.',
    );
    add('Negotiated Markdown response', negotiated.response.ok && markdownType(negotiated.response) && negotiated.body.trim() && !looksHtml(negotiated.body));
    add('Markdown responses match', direct.body.trim() === negotiated.body.trim());
    add('HTML cache safety', varies(html.response) || /(?:^|,)\s*no-store\s*(?:,|$)/i.test(html.response.headers.get('cache-control') || ''), 'HTML must vary on Accept or disable storage with Cache-Control: no-store.');
    add('Markdown varies on Accept', varies(negotiated.response));
    add('q=0 keeps HTML', reject.response.ok && htmlType(reject.response));
    const h1 = $('main h1, article h1, [role="main"] h1').first();
    const heading = h1.text().trim() || h1.attr('aria-label')?.trim() || '';
    if (heading && !skipHeadingCheck) add('Page heading retained', normalizeWhitespace(direct.body).includes(normalizeWhitespace(heading)), 'A basic content check, not a full parity audit.');
  } catch (error) { add('Request completed', false, error.message); }
  return { url, ok: checks.every(c => c.ok), checks };
}

export async function check(site, paths = ['/'], { manifest, skipHeadingCheck = false, headers } = {}) {
  const extraHeaders = normalizeHeaders(headers);
  const origin = new URL(site);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Expected an HTTP(S) URL without credentials.');
  if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string' || !p.trim())) throw new Error('Provide at least one nonempty check path.');
  const normalize = route => route.replace(/\/$/, '') || '/';
  const customRoutes = new Set((manifest?.pages || []).filter(page => page.source === 'custom').map(page => normalize(new URL(page.route, origin).pathname)));
  const results = [];
  for (const p of paths) {
    const url = new URL(p, origin);
    if (url.origin !== origin.origin) throw new Error('Check paths must stay on the supplied origin.');
    results.push(await checkPage(url.href, { skipHeadingCheck: skipHeadingCheck || customRoutes.has(normalize(url.pathname)), headers: extraHeaders }));
  }
  return { ok: results.every(r => r.ok), pages: results };
}

function contentTypeFor(file) {
  if (file.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/**
 * Verify a built `.vercel/output` artifact locally by serving its `config.json`
 * routes on an ephemeral loopback port and running `check()` against it.
 */
export async function checkLocal(cwd, { target, paths, skipHeadingCheck = false, headers } = {}) {
  if (!target) {
    try { target = JSON.parse(await readFile(path.join(cwd, 'agent-readable.json'), 'utf8')).target; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (target && !['vercel', 'netlify'].includes(target)) throw new Error('target must be vercel or netlify.');
  if (target === 'netlify') {
    const { checkNetlifyLocal } = await import('./check-netlify.js');
    return checkNetlifyLocal(cwd, { paths, skipHeadingCheck, headers });
  }
  const output = path.resolve(cwd, '.vercel/output');
  const staticDir = path.join(output, 'static');
  let artifact;
  try { artifact = await readFile(path.join(output, 'config.json'), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('No Vercel static artifact found. Run agent-readable build first, or select --target netlify. For runtime Next.js, start the app and pass its running server URL: agent-readable check http://localhost:3000');
    throw error;
  }
  const { routes } = JSON.parse(artifact);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(output, '.agent-readable'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const targetPaths = paths?.length ? paths : (manifest?.pages?.length ? manifest.pages.map(p => p.route) : ['/']);
  const readStatic = async target => {
    const rel = target.replace(/^\/+/, '');
    const candidates = target === '/' ? ['index.html'] : target.endsWith('/') ? [`${rel}index.html`] : [rel, `${rel}/index.html`];
    for (const candidate of candidates) {
      const resolved = path.resolve(staticDir, candidate);
      if (!resolved.startsWith(`${staticDir}${path.sep}`)) continue;
      try { return { file: candidate, body: await readFile(resolved) }; }
      catch { /* try next candidate */ }
    }
    return null;
  };
  const matchesConditions = (items, reqHeaders, negate = false) => items.every(c => {
    if (c.type !== 'header') return !negate;
    const raw = reqHeaders[c.key.toLowerCase()];
    const hit = raw !== undefined && (c.value === undefined || new RegExp(c.value).test(raw));
    return negate ? !hit : hit;
  });
  const fsIndex = routes.findIndex(r => r.handle === 'filesystem');
  const pre = fsIndex >= 0 ? routes.slice(0, fsIndex) : routes;
  const post = fsIndex >= 0 ? routes.slice(fsIndex + 1) : [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let current = url.pathname;
      const apply = (route, target) => {
        if (!route.src) return null;
        const re = new RegExp(route.src);
        if (!re.test(target)) return null;
        if (route.methods && !route.methods.includes(req.method)) return null;
        if (route.has && !matchesConditions(route.has, req.headers)) return null;
        if (route.missing && !matchesConditions(route.missing, req.headers, true)) return null;
        for (const [k, v] of Object.entries(route.headers || {})) {
          res.setHeader(k, target.replace(re, v));
        }
        return {
          status: route.status,
          dest: route.dest ? target.replace(re, route.dest) : null,
          continue: Boolean(route.continue),
        };
      };
      for (const route of pre) {
        const hit = apply(route, current);
        if (!hit) continue;
        if (hit.status && !hit.dest) { res.statusCode = hit.status; res.end(); return; }
        if (hit.dest) { current = hit.dest; if (!hit.continue) break; }
      }
      let found = await readStatic(current);
      if (!found) {
        for (const route of post) {
          const hit = apply(route, current);
          if (!hit) continue;
          if (route.check && hit.dest) {
            const checked = await readStatic(hit.dest);
            if (checked) { found = checked; break; }
            continue;
          }
          if (hit.status) res.statusCode = hit.status;
          if (hit.dest) { found = await readStatic(hit.dest); break; }
        }
      }
      if (!found) { res.writeHead(404); res.end('Not found'); return; }
      if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', contentTypeFor(found.file));
      res.end(req.method === 'HEAD' ? undefined : found.body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    return await check(origin, targetPaths, { manifest, skipHeadingCheck, headers });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
