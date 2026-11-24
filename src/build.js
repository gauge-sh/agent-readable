import { parseUserAgents, markdownRejection } from './user-agents.js';
import { gaugeAttribution } from './attribution.js';
import { readFile, writeFile, mkdir, readdir, cp, access, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { convert, addDiscovery, stripAgentOnly, markdownPath } from './content.js';

import { validateConfig, rejectSymlinks } from './config.js';
import { validateVercel, compileVercelRoutes } from './vercel.js';

import { netlifyOutput, validateNetlifyOutput, writeNetlifyEdge } from './netlify.js';

const configName = 'agent-readable.json';
const defaultExclusions = ['/404', '/500', '/_not-found', '/_next', '/preview', '/admin', '/api'];
const exists = async p => { try { await access(p); return true; } catch { return false; } };
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const excluded = (route, prefixes) => prefixes.some(p => route === p || route.startsWith(`${p.replace(/\/$/, '')}/`));
const trimSlashes = route => route.replace(/^\/+|\/+$/g, '');

async function walk(dir, base = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = path.posix.join(base, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported in the static export: ${name}`);
    if (entry.isDirectory()) result.push(...await walk(path.join(dir, entry.name), name));
    else result.push(name);
  }
  return result.sort();
}

export async function init(cwd, site, input = 'out') {
  const url = new URL(site);
  if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('--site must be an HTTP(S) origin, e.g. https://example.com');
  const config = { site: url.origin, input, contentSelector: 'main, article, [role="main"]', exclude: ['/preview', '/admin', '/api'], llms: true };
  validateConfig(config, cwd);
  await writeFile(path.join(cwd, configName), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  return config;
}

function nonRootPagePattern(pages, htmlPages, exclude = []) {
  const pageRoutes = new Set(pages.map(p => p.route));
  const prefixRoutes = [...new Set([...defaultExclusions, ...exclude].map(p => p === '/' ? '/' : p.replace(/\/+$/, '')))];
  const prefixes = [...new Set(prefixRoutes.map(trimSlashes).filter(Boolean))].sort();
  const exactSkipped = [...new Set(
    htmlPages
      .map(p => p.route)
      .filter(route => route !== '/' && !pageRoutes.has(route) && !excluded(route, prefixRoutes))
      .map(trimSlashes)
      .filter(Boolean),
  )].sort();
  const parts = [];
  if (prefixes.length) parts.push(`(?:${prefixes.map(escapeRegex).join('|')})(?:/|$)`);
  if (exactSkipped.length) parts.push(`(?:${exactSkipped.map(escapeRegex).join('|')})/?$`);
  // Never negotiate paths whose final segment carries a file extension (e.g. .md, .txt, .js).
  parts.push('(?:.*/)?[^/]*\\.[^/]+/?$');
  const pattern = `^/(?!${parts.join('|')})(.+?)/?$`;
  if (pattern.length > 4096) throw new Error('Too many excluded/noindex routes for a single Vercel route pattern.');
  return pattern;
}

export function routesFor(pages, htmlPages = pages, { site, userAgents = false, exclude = [], trailingSlash = false, redirects = [], headers = [], llms = false, llmsFull = false } = {}) {
  // Vercel header conditions take regex source without flags. The pinned dataset
  // uses ASCII literals and case-neutral character classes. Preserve its escapes.
  // Each category fits in a separate Vercel header condition (4096 characters).
  const toVercelPattern = matcher => {
    const source = matcher.source.replace(/\\.|\[[^\]]*\]|[a-z]/gi, part =>
      /^[a-z]$/i.test(part) ? `[${part.toLowerCase()}${part.toUpperCase()}]` : part);
    return `.*(?:${source}).*`;
  };
  const { include: includeMatchers, exclude: excludeMatchers } = parseUserAgents(userAgents);
  const patterns = includeMatchers.map(toVercelPattern);
  const excludedPatterns = excludeMatchers.map(toVercelPattern);
  const vary = patterns.length ? 'Accept, User-Agent' : 'Accept';
  const describedBy = llms ? ', </llms.txt>; rel="describedby"; type="text/plain"' : '';
  const canonicalBase = site ? new URL(site).origin : '';
  // Conservative explicit opt-in: reject q=0 even if another Markdown range is present.
  const media = '[tT][eE][xX][tT]/[mM][aA][rR][kK][dD][oO][wW][nN]';
  const acceptValue = `^(?!.*${media}[^,]*;\\s*[qQ]=0(?:\\.0*)?(?:\\s*[,;]|\\s*$))(?:[^,]*,)*\\s*${media}(?:\\s*;[^,]*)?(?:\\s*,.*)?\\s*$`;

  const routes = [...redirects, ...headers];
  const pushNegotiation = (src, dest, link, canonical) => {
    const markdownLink = `${link}${describedBy}, <${canonical}>; rel="canonical"`;
    routes.push({ src, headers: { Vary: vary, Link: `${link}${describedBy}` }, continue: true });
    routes.push({
      src,
      methods: ['GET', 'HEAD'],
      has: [{ type: 'header', key: 'accept', value: acceptValue }],
      dest,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', Link: markdownLink },
    });
    const missing = [
      { type: 'header', key: 'accept', value: `.*${markdownRejection}.*` },
      ...excludedPatterns.map(value => ({ type: 'header', key: 'user-agent', value })),
    ];
    for (const pattern of patterns) {
      routes.push({
        src,
        methods: ['GET', 'HEAD'],
        has: [{ type: 'header', key: 'user-agent', value: pattern }],
        missing,
        dest,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8', Link: markdownLink },
      });
    }
  };

  if (pages.some(p => p.route === '/')) {
    pushNegotiation('^/$', '/index.md', '</index.md>; rel="alternate"; type="text/markdown"', `${canonicalBase}/`);
  }
  if (pages.some(p => p.route !== '/')) {
    const src = nonRootPagePattern(pages, htmlPages, exclude);
    pushNegotiation(src, '/$1.md', '</$1.md>; rel="alternate"; type="text/markdown"', `${canonicalBase}/$1${trailingSlash ? '/' : ''}`);
  }

  routes.push(
    {
      src: '^/index\\.md$',
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        Link: `<${canonicalBase}/>; rel="canonical"`,
      },
      continue: true,
    },
    {
      src: '^/(?!index\\.md$)(.+)\\.md$',
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        Link: `<${canonicalBase}/$1${trailingSlash ? '/' : ''}>; rel="canonical"`,
      },
      continue: true,
    },
  );
  if (llmsFull) {
    routes.push({ src: '^/llms-full\\.txt$', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, continue: true });
  }
  if (trailingSlash) {
    routes.push({ src: '^/((?:.*/)?[^/.]+)$', status: 308, headers: { Location: '/$1/' } });
  }
  routes.push(
    { handle: 'filesystem' },
    { src: '^/((?:.*/)?[^/.]+)/?$', dest: '/$1/index.html', check: true },
    { src: '^/((?:.*/)?[^/.]+)/?$', dest: '/$1.html', check: true },
    { src: '/.*', status: 404, dest: '/404.html', headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
  return routes;
}

export async function build(cwd, { target } = {}) {
  const config = JSON.parse(await readFile(path.join(cwd, configName), 'utf8'));
  if (target !== undefined) config.target = target;
  target = config.target || 'vercel';
  cwd = path.resolve(cwd);
  const { site, input, markdown } = validateConfig(config, cwd);
  const output = path.join(cwd, target === 'netlify' ? netlifyOutput : '.vercel/output');
  await rejectSymlinks(cwd, input);
  await rejectSymlinks(cwd, output);
  if (target === 'netlify') await validateNetlifyOutput(cwd);
  const vercel = target === 'vercel' ? await validateVercel(cwd) : {};
  if (config.trailingSlash !== undefined && vercel.trailingSlash !== undefined && config.trailingSlash !== vercel.trailingSlash) {
    throw new Error('Conflicting trailingSlash settings in agent-readable.json and vercel.json.');
  }
  const trailingSlash = config.trailingSlash ?? vercel.trailingSlash ?? false;
  const { redirects, headers } = compileVercelRoutes(vercel);
  if (await exists(output) && !await exists(path.join(output, '.agent-readable'))) throw new Error(`Refusing to replace an existing ${path.relative(cwd, output)} not generated by agent-readable.`);
  if (!await exists(input)) throw new Error(`Static HTML output not found: ${input}. Run your framework build first and set input in agent-readable.json to its export directory.`);
  const files = await walk(input);
  const pages = [];
  const usedMarkdown = new Set();
  const htmlPages = [];
  const skipped = [];
  const skippedHtml = [];
  const exclusions = [...defaultExclusions, ...(config.exclude || [])];
  for (const file of files.filter(f => f.endsWith('.html'))) {
    if (/[?#%\\<>\s]/.test(file)) throw new Error(`HTML filename contains unsupported URL characters: ${file}`);
    const route = file === 'index.html' ? '/' : `/${file.replace(/(?:\/index)?\.html$/, '')}`;
    const html = await readFile(path.join(input, file), 'utf8');
    if (excluded(route, exclusions)) {
      if (!skipped.includes(route)) skipped.push(route);
      if (!htmlPages.some(p => p.route === route)) htmlPages.push({ route, file });
      if (html.includes('data-agent-only')) skippedHtml.push({ file, html: stripAgentOnly(html) });
      continue;
    }
    if (htmlPages.some(p => p.route === route)) throw new Error(`Duplicate route: ${route}`);
    htmlPages.push({ route, file });
    const $ = load(html);
    if ($('meta[name="robots"],meta[name="googlebot"]').toArray().some(e => /\b(noindex|none)\b/i.test($(e).attr('content') || ''))) {
      skipped.push(route);
      if (html.includes('data-agent-only')) skippedHtml.push({ file, html: stripAgentOnly(html) });
      continue;
    }
    const canonicalPath = route === '/' ? '/' : (trailingSlash || file.endsWith('/index.html')) ? `${route}/` : route;
    const canonical = new URL(canonicalPath, site).href;
    const custom = markdown.get(route);
    const md = markdownPath(route);
    if (pages.some(p => p.markdown === md)) throw new Error(`Markdown URL collision: ${md}`);
    if (files.includes(md.slice(1)) && custom?.path !== path.resolve(input, md.slice(1))) throw new Error(`Existing Markdown would be overwritten: ${md}. Map this page to that existing file in markdown configuration to use it explicitly.`);
    let title, body;
    if (custom) {
      await rejectSymlinks(cwd, custom.path);
      try { body = await readFile(custom.path, 'utf8'); }
      catch (error) { throw new Error(`Cannot read Markdown source for ${route}: ${custom.file} (${error.code || error.message})`); }
      if (!body.trim()) throw new Error(`Markdown source is empty for ${route}: ${custom.file}`);
      if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(body)) throw new Error(`Markdown source contains an HTML document for ${route}: ${custom.file}`);
      title = $('title').first().text().trim() || $('h1').first().text().trim() || route;
      usedMarkdown.add(route);
    } else {
      const converted = convert(html, canonical, config.contentSelector, config.excludeSelectors);
      title = converted.title;
      body = converted.markdown;
    }
    pages.push({ route, file, markdown: md, canonical, title, body, source: custom ? 'custom' : 'html', ...(custom ? { sourceFile: custom.file } : {}), html: addDiscovery(html, md) });
  }
  for (const route of markdown.keys()) {
    if (!usedMarkdown.has(route)) throw new Error(`Markdown override has no eligible HTML page: ${route}. Check the route, exclusions, and robots metadata.`);
  }
  if (!pages.length) throw new Error('No public HTML pages found. Build your static export first.');
  if (config.llms !== false && files.includes('llms.txt')) throw new Error('Existing llms.txt found. Set llms: false to preserve it.');
  if (config.llmsFull === true && files.includes('llms-full.txt')) throw new Error('Existing llms-full.txt found. Set llmsFull: false to preserve it.');
  // Stage everything before replacing a previous build.
  const stage = path.join(cwd, `${target === 'netlify' ? '.netlify' : '.vercel'}/agent-readable-stage-${process.pid}-${Date.now()}`);
  try {
    await mkdir(stage, { recursive: true });
    await cp(input, path.join(stage, 'static'), { recursive: true });
    for (const page of pages) {
      const target = path.join(stage, 'static', page.markdown);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, page.body);
      await writeFile(path.join(stage, 'static', page.file), page.html);
    }
    for (const page of skippedHtml) {
      await writeFile(path.join(stage, 'static', page.file), page.html);
    }
    const attribution = config.attribution === false ? '' : gaugeAttribution;
    if (config.llms !== false) {
      const index = `# ${site.hostname}\n\n## Pages\n\n${pages.map(p => `- [${p.title.replace(/[\[\]\r\n]/g, ' ')}](${new URL(p.markdown, site).href})`).join('\n')}\n`;
      await writeFile(path.join(stage, 'static/llms.txt'), index + attribution);
    }
    if (config.llmsFull === true) {
      const fullHeader = `# ${site.hostname}\n\nFull Markdown content for ${site.origin}.`;
      const sections = pages.map(p => `Source: ${p.canonical}\n\n${p.body.trim()}`);
      await writeFile(path.join(stage, 'static/llms-full.txt'), `${[fullHeader, ...sections].join('\n\n---\n\n')}\n${attribution}`);
    }
    if (!files.includes('404.html')) await writeFile(path.join(stage, 'static/404.html'), '<!doctype html><title>Not found</title><h1>Not found</h1>');
    const hasLlms = config.llms !== false || files.includes('llms.txt');
    const hasLlmsFull = config.llmsFull === true || files.includes('llms-full.txt');
    if (target === 'vercel') {
      const routes = routesFor(pages, htmlPages, { ...config, trailingSlash, redirects, headers, llms: hasLlms, llmsFull: hasLlmsFull });
      await writeFile(path.join(stage, 'config.json'), `${JSON.stringify({ version: 3, routes }, null, 2)}\n`);
    }
    const manifest = { version: 1, target, site: site.origin, pages: pages.map(({ body, html, canonical, ...p }) => ({ ...p, bytes: Buffer.byteLength(body) })), skipped };
    await writeFile(path.join(stage, '.agent-readable'), `${JSON.stringify(manifest, null, 2)}\n`);
    if (await exists(output)) await rm(output, { recursive: true });
    await mkdir(path.dirname(output), { recursive: true });
    await rename(stage, output);
    if (target === 'netlify') await writeNetlifyEdge(cwd, pages, config, hasLlms);
    return manifest;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
