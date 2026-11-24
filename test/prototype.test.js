import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync, spawnSync } from 'node:child_process';
import { init, build, convert, check, routesFor } from '../src/index.js';

async function fixture(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'agent-readable-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await cp(new URL('../examples/site/', import.meta.url), cwd, { recursive: true, filter: p => !p.includes('.vercel') });
  return cwd;
}

test('conversion retains tables, code, relative links and content; removes UI noise', () => {
  const result = convert('<title>Docs</title><nav>Noise</nav><main><h1>Docs</h1><a href="../start?q=1#install">Start</a><img src="./image.png" alt="Diagram"><pre><code class="language-js">const x = 1;</code></pre><table><thead><tr><th>Plan</th></tr></thead><tbody><tr><td>Free</td></tr></tbody></table><span hidden>Secret UI</span><div data-agent-readable="exclude">Mock dashboard</div><script>evil()</script></main>', 'https://example.com/docs/guide/');
  assert.match(result.markdown, /https:\/\/example.com\/docs\/start\?q=1#install/);
  assert.match(result.markdown, /https:\/\/example.com\/docs\/guide\/image.png/);
  assert.match(result.markdown, /```js\nconst x = 1;/);
  assert.match(result.markdown, /\| Plan \|/);
  assert.doesNotMatch(result.markdown, /Noise|Secret UI|Mock dashboard|evil/);
  assert.throws(() => convert('<body>Oops</body>', 'https://example.com'), /no content matching/);
});

test('init never overwrites config', async t => {
  const cwd = await fixture(t);
  await assert.rejects(init(cwd, 'https://example.com'), /EEXIST/);
  await assert.rejects(init(cwd, 'file:///tmp'), /HTTP/);
});

test('build produces Markdown, discovery, precise routes and preserves original export', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'out/hidden.html'), '<meta name="robots" content="noindex"><main>Private</main>');
  const result = await build(cwd);
  assert.equal(result.pages.length, 2);
  assert.deepEqual(result.skipped, ['/hidden', '/preview']);
  const output = path.join(cwd, '.vercel/output');
  const md = await readFile(path.join(output, 'static/docs.md'), 'utf8');
  assert.match(md, /npm install example-sdk/);
  assert.match(await readFile(path.join(output, 'static/docs/index.html'), 'utf8'), /type="text\/markdown" href="\/docs.md"/);
  assert.doesNotMatch(await readFile(path.join(cwd, 'out/docs/index.html'), 'utf8'), /text\/markdown/);
  await assert.rejects(access(path.join(output, 'static/preview.md')));
  const llms = await readFile(path.join(output, 'static/llms.txt'), 'utf8');
  assert.match(llms, /https:\/\/example.com\/docs.md/);
  assert.doesNotMatch(llms, /preview|hidden/);
  const config = JSON.parse(await readFile(path.join(output, 'config.json'), 'utf8'));
  assert.equal(config.version, 3);
  const negotiated = config.routes.filter(r => r.dest && r.has);
  assert.ok(negotiated.every(r => !new RegExp(r.src).test('/preview') && !new RegExp(r.src).test('/hidden')));
  const site = await serveArtifact(t, cwd);
  const preview = await fetch(`${site}/preview`, { headers: { Accept: 'text/markdown' } });
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type') || '', /text\/html/);
  const hidden = await fetch(`${site}/hidden`, { headers: { Accept: 'text/markdown' } });
  assert.equal(hidden.status, 200);
  assert.match(hidden.headers.get('content-type') || '', /text\/html/);
  await build(cwd); // A second build replaces only our own artifact.
});

test('build stops on conflicting deployment config, native Markdown, and unowned output', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'vercel.json'), '{"rewrites":[]}');
  await assert.rejects(build(cwd), /Existing vercel.json/);
  await rm(path.join(cwd, 'vercel.json'));
  await writeFile(path.join(cwd, 'out/docs.md'), '# Existing');
  await assert.rejects(build(cwd), /Existing Markdown/);
  await rm(path.join(cwd, 'out/docs.md'));
  await mkdir(path.join(cwd, '.vercel/output'), { recursive: true });
  await assert.rejects(build(cwd), /Refusing to replace/);
});

test('routing requires an explicit Markdown media range and respects q=0', () => {
  const routes = routesFor([{ route: '/docs', file: 'docs/index.html', markdown: '/docs.md' }]);
  const regex = new RegExp(routes.find(r => r.has).has[0].value);
  for (const accept of ['text/markdown', 'text/markdown;q=0.8', 'text/html, text/markdown', 'TEXT/MARKDOWN', 'text/markdown, */*']) assert.ok(regex.test(accept), accept);
  for (const accept of ['text/html', '*/*', 'text/markdown;q=0', 'text/markdown;q=0.000', 'text/markdown; charset=utf-8;q=0, text/html', 'application/text/markdown', 'text/markdown-extra']) assert.ok(!regex.test(accept), accept);
  assert.equal(routes[0].headers.Vary, 'Accept');
});

// A small local harness exercises the generated route definitions, not Vercel's CDN.
async function serveArtifact(t, cwd, broken = false) {
  const output = path.join(cwd, '.vercel/output');
  const staticDir = path.join(output, 'static');
  const { routes } = JSON.parse(await readFile(path.join(output, 'config.json'), 'utf8'));
  const readStatic = async target => {
    const rel = target.replace(/^\/+/, '');
    const candidates = target === '/' ? ['index.html'] : target.endsWith('/') ? [`${rel}index.html`] : [rel, `${rel}/index.html`];
    for (const candidate of candidates) {
      try { return { file: candidate, body: await readFile(path.join(staticDir, candidate)) }; }
      catch { /* try next candidate */ }
    }
    return null;
  };
  const matchesConditions = (items, headers, negate = false) => items.every(c => {
    const raw = headers[c.key.toLowerCase()];
    const hit = raw !== undefined && (c.value === undefined || new RegExp(c.value).test(raw));
    return negate ? !hit : hit;
  });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let current = url.pathname;
      const fsIndex = routes.findIndex(r => r.handle === 'filesystem');
      const pre = fsIndex >= 0 ? routes.slice(0, fsIndex) : routes;
      const post = fsIndex >= 0 ? routes.slice(fsIndex + 1) : [];
      const apply = (route, target) => {
        const re = new RegExp(route.src);
        if (!re.test(target)) return null;
        if (route.methods && !route.methods.includes(req.method)) return null;
        if (route.has && (broken || !matchesConditions(route.has, req.headers))) return null;
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
        if (hit.status && !hit.dest) {
          res.statusCode = hit.status;
          res.end();
          return;
        }
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
      if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', found.file.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(found.body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('checker passes a working artifact and reports broken negotiation', async t => {
  const cwd = await fixture(t);
  await build(cwd);
  const site = await serveArtifact(t, cwd);
  const good = await check(site, ['/', '/docs/']);
  assert.equal(good.ok, true, JSON.stringify(good));
  const brokenSite = await serveArtifact(t, cwd, true);
  const bad = await check(brokenSite, ['/docs/']);
  assert.equal(bad.ok, false);
  assert.equal(bad.pages[0].checks.find(c => c.name === 'Negotiated Markdown response').ok, false);
  assert.equal((await check(site, ['/missing'])).ok, false);
});

test('CLI builds example and exits nonzero on invalid command', async t => {
  const cwd = await fixture(t);
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  assert.match(execFileSync(process.execPath, [cli, 'build', '--cwd', cwd], { encoding: 'utf8' }), /Generated 2 Markdown pages/);
  assert.equal(spawnSync(process.execPath, [cli, 'unknown']).status, 1);
});

 test('custom selectors remove Webflow chrome without losing article content', () => {
  const html = '<title>Article</title><body><div class="navigation">Navigation</div><div class="title-section"><h1>Article</h1></div><div class="post-content"><p>Useful content</p></div><div class="footer">Subscribe noise</div></body>';
  const result = convert(html, 'https://example.com/article', 'body', ['.navigation', '.footer']);
  assert.match(result.markdown, /# Article/);
  assert.match(result.markdown, /Useful content/);
  assert.doesNotMatch(result.markdown, /Navigation|Subscribe noise/);
  assert.throws(() => convert(html, 'https://example.com', 'body', 'footer'), /excludeSelectors/);
});

test('Vercel Git setup replaces framework settings, preserves unrelated settings and is repeatable', async t => {
  const { setupVercel, validateVercel } = await import('../src/index.js');
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'vercel.json'), JSON.stringify({ framework: 'nextjs', outputDirectory: 'out', regions: ['iad1'], installCommand: 'npm ci' }));
  await assert.rejects(validateVercel(cwd, true), /discard the Markdown artifact/);
  const config = await setupVercel(cwd, 'npm run build:site');
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, null);
  assert.equal(config.buildCommand, '(npm run build:site) && npx --no-install agent-readable build');
  assert.deepEqual(config.regions, ['iad1']);
  assert.equal(config.installCommand, 'npm ci');
  assert.deepEqual(await setupVercel(cwd, 'npm run build:site'), config);
  await validateVercel(cwd, true);
  await build(cwd);
});

test('Vercel setup refuses incompatible configurations without changing them', async t => {
  const { setupVercel } = await import('../src/index.js');
  const cwd = await fixture(t);
  for (const config of [{ rewrites: [] }, { builds: [] }, { functions: {} }]) {
    const original = JSON.stringify(config);
    await writeFile(path.join(cwd, 'vercel.json'), original);
    await assert.rejects(setupVercel(cwd, 'hugo'), /automatic merging/);
    assert.equal(await readFile(path.join(cwd, 'vercel.json'), 'utf8'), original);
  }
  await rm(path.join(cwd, 'vercel.json'));
  await writeFile(path.join(cwd, 'vercel.ts'), 'export default {}');
  await assert.rejects(setupVercel(cwd, 'hugo'), /vercel.ts/);
  await assert.rejects(setupVercel(cwd, 'hugo && agent-readable build'), /only the site build/);
});

test('CLI supports arbitrary static export directories and nested HTML routes', async t => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'agent-readable-framework-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  execFileSync(process.execPath, [cli, 'init', '--cwd', cwd, '--site', 'https://example.com', '--input', 'dist/client']);
  await mkdir(path.join(cwd, 'dist/client/guide'), { recursive: true });
  await writeFile(path.join(cwd, 'dist/client/index.html'), '<main><h1>Home</h1></main>');
  await writeFile(path.join(cwd, 'dist/client/guide/index.html'), '<main><h1>Guide</h1><p>Framework independent</p></main>');
  const failed = spawnSync(process.execPath, [cli, 'build', '--cwd', cwd], { encoding: 'utf8', env: { ...process.env, VERCEL: '1' } });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /setup-vercel/);
  await assert.rejects(access(path.join(cwd, '.vercel/output')));
  execFileSync(process.execPath, [cli, 'setup-vercel', '--cwd', cwd, '--build-command', 'npm run generate']);
  execFileSync(process.execPath, [cli, 'build', '--cwd', cwd], { env: { ...process.env, VERCEL: '1' } });
  const site = await serveArtifact(t, cwd);
  assert.equal((await check(site, ['/', '/guide/'])).ok, true);
});

test('configuration rejects misspelled options, invalid lists and unsafe export paths before output changes', async t => {
  const cwd = await fixture(t);
  await build(cwd);
  const original = await readFile(path.join(cwd, '.vercel/output/config.json'), 'utf8');
  const base = JSON.parse(await readFile(path.join(cwd, 'agent-readable.json')));
  for (const patch of [{ exclude: '/private' }, { llms: 'false' }, { attribution: 'false' }, { contentSelector: '' }, { excludeSelectors: [7] }, { input: '../outside' }, { input: '.vercel/output/static' }, { inputs: 'dist' }]) {
    await writeFile(path.join(cwd, 'agent-readable.json'), JSON.stringify({ ...base, ...patch }));
    await assert.rejects(build(cwd));
    assert.equal(await readFile(path.join(cwd, '.vercel/output/config.json'), 'utf8'), original);
  }
});

test('symlinked export roots and output parents are rejected', async t => {
  const cwd = await fixture(t);
  await symlink(path.join(cwd, 'out'), path.join(cwd, 'linked'), 'dir');
  const config = JSON.parse(await readFile(path.join(cwd, 'agent-readable.json')));
  await writeFile(path.join(cwd, 'agent-readable.json'), JSON.stringify({ ...config, input: 'linked' }));
  await assert.rejects(build(cwd), /Symlinks/);
  await writeFile(path.join(cwd, 'agent-readable.json'), JSON.stringify(config));
  await mkdir(path.join(cwd, 'external'));
  await symlink(path.join(cwd, 'external'), path.join(cwd, '.vercel'), 'dir');
  await assert.rejects(build(cwd), /Symlinks/);
  await assert.rejects(access(path.join(cwd, 'external/output')));
});

test('conversion removes unsafe URL schemes, preserves ordinary links, and supports an h1 root', () => {
  const result = convert('<main><h1>Title</h1><a href=" java&#x09;script:alert(1)">bad</a><a href="vbscript:foo">bad2</a><a href="mailto:test@example.com">Email</a><img src="data:text/html,bad"><a href="/safe">Safe</a></main>', 'https://example.com');
  assert.doesNotMatch(result.markdown, /javascript:|vbscript:|data:text/);
  assert.match(result.markdown, /mailto:test@example.com/);
  assert.match(result.markdown, /https:\/\/example.com\/safe/);
  assert.match(convert('<h1>Only heading</h1>', 'https://example.com', 'h1').markdown, /# Only heading/);
});

test('checker rejects empty inventories and does not follow cross-origin redirects', async t => {
  await assert.rejects(check('https://example.com', []), /at least one/);
  let visited = false;
  const target = createServer((req, res) => { visited = true; res.end('Unexpected'); });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const source = createServer((req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/` }); res.end(); });
  source.listen(0, '127.0.0.1');
  await once(source, 'listening');
  t.after(() => { source.closeAllConnections(); source.close(); target.closeAllConnections(); target.close(); });
  const result = await check(`http://127.0.0.1:${source.address().port}`);
  assert.equal(result.ok, false);
  assert.match(result.pages[0].checks.at(-1).detail, /Redirect leaves/);
  assert.equal(visited, false);
});

test('duplicate route and reserved HTML URL characters fail before artifact creation', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'out/docs.html'), '<main><h1>Duplicate</h1></main>');
  await assert.rejects(build(cwd), /Duplicate route/);
  await rm(path.join(cwd, 'out/docs.html'));
  await writeFile(path.join(cwd, 'out/question?.html'), '<main><h1>Ambiguous URL</h1></main>');
  await assert.rejects(build(cwd), /unsupported URL characters/);
});

async function setOverrides(cwd, markdown) {
  const configPath = path.join(cwd, 'agent-readable.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(configPath, JSON.stringify({ ...config, markdown }));
}

test('custom Markdown is served verbatim with discovery and negotiation while other pages convert', async t => {
  const cwd = await fixture(t);
  const body = '---\r\naudience: agents\r\n---\r\n\r\n# A deliberately different guide\r\n\r\nFollow [this workflow](/custom-workflow).\r\n';
  await mkdir(path.join(cwd, 'agent-content'));
  await writeFile(path.join(cwd, 'agent-content/guide.md'), body);
  await setOverrides(cwd, { '/docs/': 'agent-content/guide.md' });
  const manifest = await build(cwd);
  const custom = manifest.pages.find(page => page.route === '/docs');
  assert.equal(custom.source, 'custom');
  assert.equal(custom.sourceFile, 'agent-content/guide.md');
  assert.equal(custom.bytes, Buffer.byteLength(body));
  assert.equal(manifest.pages.find(page => page.route === '/').source, 'html');
  assert.equal(await readFile(path.join(cwd, '.vercel/output/static/docs.md'), 'utf8'), body);
  assert.match(await readFile(path.join(cwd, '.vercel/output/static/index.md'), 'utf8'), /^---/);
  assert.match(await readFile(path.join(cwd, '.vercel/output/static/llms.txt'), 'utf8'), /https:\/\/example.com\/docs.md/);
  const site = await serveArtifact(t, cwd);
  assert.equal(await (await fetch(`${site}/docs.md`)).text(), body);
  assert.equal(await (await fetch(`${site}/docs`, { headers: { Accept: 'text/markdown' } })).text(), body);
  const result = await check(site, ['/', '/docs/'], { manifest });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.pages[0].checks.some(item => item.name === 'Page heading retained'));
  assert.ok(!result.pages[1].checks.some(item => item.name === 'Page heading retained'));
  assert.equal((await check(site, ['/docs'])).ok, false);
  assert.equal((await check(site, ['/docs'], { skipHeadingCheck: true })).ok, true);
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'check', site, '--cwd', cwd, '--manifest', '.vercel/output/.agent-readable', '--json']);
  assert.equal(JSON.parse(stdout).ok, true);
  const explicit = await promisify(execFile)(process.execPath, [cli, 'check', site, '--path', '/docs', '--skip-heading-check', '--json']);
  assert.equal(JSON.parse(explicit.stdout).ok, true);
});

test('custom homepage bypasses extraction and existing native Markdown requires an explicit mapping', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'out/index.html'), '<title>Landing</title><div>HTML without a semantic container</div>');
  await writeFile(path.join(cwd, 'out/index.md'), '# Agent landing\n');
  await setOverrides(cwd, { '/': 'out/index.md' });
  await build(cwd);
  assert.equal(await readFile(path.join(cwd, '.vercel/output/static/index.md'), 'utf8'), '# Agent landing\n');
  assert.equal(await readFile(path.join(cwd, 'out/index.md'), 'utf8'), '# Agent landing\n');
  await writeFile(path.join(cwd, 'another.md'), '# Different content\n');
  await setOverrides(cwd, { '/': 'another.md' });
  await assert.rejects(build(cwd), /Existing Markdown would be overwritten/);
});

test('overrides fail for missing, excluded, and noindex routes instead of silently publishing', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'custom.md'), '# Custom\n');
  await writeFile(path.join(cwd, 'out/hidden.html'), '<meta name="robots" content="noindex"><main>Hidden</main>');
  await build(cwd);
  const previous = await readFile(path.join(cwd, '.vercel/output/.agent-readable'), 'utf8');
  for (const route of ['/missing', '/preview', '/hidden']) {
    await setOverrides(cwd, { [route]: 'custom.md' });
    await assert.rejects(build(cwd), /no eligible HTML page/);
    assert.equal(await readFile(path.join(cwd, '.vercel/output/.agent-readable'), 'utf8'), previous);
  }
});

test('overrides reject invalid maps, duplicate routes, escaped paths and symlinks', async t => {
  const cwd = await fixture(t);
  for (const markdown of [null, [], 'file.md', { docs: 'custom.md' }, { '/docs?x=1': 'custom.md' }, { '/docs/../secret': 'custom.md' }, { '/docs': '../outside.md' }, { '/docs': '/absolute.md' }, { '/docs': '.vercel/output/static/docs.md' }, { '/docs': 'custom.html' }, { '/docs': 'a.md', '/docs/': 'b.md' }]) {
    await setOverrides(cwd, markdown);
    await assert.rejects(build(cwd), /Markdown|markdown/);
  }
  await writeFile(path.join(cwd, 'custom.md'), '# Custom');
  await symlink(path.join(cwd, 'custom.md'), path.join(cwd, 'linked.md'));
  await setOverrides(cwd, { '/docs': 'linked.md' });
  await assert.rejects(build(cwd), /Symlinks/);
});

test('missing, empty and HTML-document overrides fail before replacing an existing artifact', async t => {
  const cwd = await fixture(t);
  await build(cwd);
  const previous = await readFile(path.join(cwd, '.vercel/output/static/docs.md'), 'utf8');
  await setOverrides(cwd, { '/docs': 'custom.md' });
  await assert.rejects(build(cwd), /Cannot read Markdown source/);
  await writeFile(path.join(cwd, 'custom.md'), '  \n');
  await assert.rejects(build(cwd), /Markdown source is empty/);
  await writeFile(path.join(cwd, 'custom.md'), '<!DOCTYPE html><html>Oops</html>');
  await assert.rejects(build(cwd), /HTML document/);
  assert.equal(await readFile(path.join(cwd, '.vercel/output/static/docs.md'), 'utf8'), previous);
});

test('Gauge attribution is confined to the generated index and can be disabled', async t => {
  const cwd = await fixture(t);
  const configPath = path.join(cwd, 'agent-readable.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const output = path.join(cwd, '.vercel/output/static');
  await build(cwd);
  const credited = await readFile(path.join(output, 'llms.txt'), 'utf8');
  assert.match(credited, /Generated with \[agent-readable\]\(https:\/\/github.com\/gauge-sh\/agent-readable\)/);
  assert.match(credited, /\[Gauge\]\(https:\/\/www.withgauge.com\)/);
  const plain = credited.split("\n## About this site's Markdown")[0];
  const originalMarkdown = await readFile(path.join(output, 'docs.md'), 'utf8');
  assert.doesNotMatch(originalMarkdown, /withgauge.com|About this site's Markdown/);
  assert.doesNotMatch(await readFile(path.join(output, 'docs/index.html'), 'utf8'), /withgauge.com|About this site's Markdown/);
  await writeFile(configPath, JSON.stringify({ ...config, attribution: false }));
  await build(cwd);
  assert.equal(await readFile(path.join(output, 'llms.txt'), 'utf8'), plain);
  assert.equal(await readFile(path.join(output, 'docs.md'), 'utf8'), originalMarkdown);
  const existing = '# My own index\n\nKeep this exact content.\n';
  await writeFile(path.join(cwd, 'out/llms.txt'), existing);
  await writeFile(configPath, JSON.stringify({ ...config, llms: false, attribution: true }));
  await build(cwd);
  assert.equal(await readFile(path.join(output, 'llms.txt'), 'utf8'), existing);
});

test('data-agent-only and data-agent-hidden control HTML vs Markdown output cleanly', async t => {
  const cwd = await fixture(t);
  await writeFile(
    path.join(cwd, 'out/docs/index.html'),
    '<!doctype html><html><head><title>Docs</title></head><body><main><h1>Docs</h1><p>Visible to all.</p><section data-agent-hidden>Interactive widget</section><div data-agent-only hidden><h2>Agent instructions</h2><p>Use <a href="/api">the API</a>.<span data-agent-hidden>Never in md</span></p></div><span hidden>Regular hidden UI</span></main></body></html>',
  );
  await writeFile(
    path.join(cwd, 'out/preview/index.html'),
    '<!doctype html><html><head><title>Preview</title></head><body><main><h1>Preview</h1><div data-agent-only hidden>Layout agent footer</div></main></body></html>',
  );
  await build(cwd);
  const output = path.join(cwd, '.vercel/output/static');
  const md = await readFile(path.join(output, 'docs.md'), 'utf8');
  assert.match(md, /Visible to all\./);
  assert.match(md, /## Agent instructions/);
  assert.match(md, /https:\/\/example\.com\/api/);
  assert.doesNotMatch(md, /Interactive widget|Never in md|Regular hidden UI/);

  const html = await readFile(path.join(output, 'docs/index.html'), 'utf8');
  assert.match(html, /Interactive widget/);
  assert.doesNotMatch(html, /Agent instructions|data-agent-only/);

  // Skipped/excluded HTML files also strip data-agent-only from shared layouts.
  const previewHtml = await readFile(path.join(output, 'preview/index.html'), 'utf8');
  assert.doesNotMatch(previewHtml, /Layout agent footer|data-agent-only/);

  // Original export remains untouched.
  assert.match(await readFile(path.join(cwd, 'out/docs/index.html'), 'utf8'), /data-agent-only/);

  const site = await serveArtifact(t, cwd);
  assert.equal((await check(site, ['/docs/'])).ok, true);

  // Checker flags leaked data-agent-only elements in HTML.
  await writeFile(path.join(output, 'docs/index.html'), `${html}<div data-agent-only>Leaked</div>`);
  const leaked = await check(site, ['/docs/']);
  assert.equal(leaked.ok, false);
  assert.equal(leaked.pages[0].checks.find(c => c.name === 'No leaked agent-only elements').ok, false);
});

test('vercel.json redirects and headers compile ahead of Markdown negotiation and survive setup-vercel', async t => {
  const { setupVercel } = await import('../src/index.js');
  const cwd = await fixture(t);
  const configPath = path.join(cwd, 'agent-readable.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(configPath, JSON.stringify({ ...config, userAgents: true }));
  await writeFile(path.join(cwd, 'out/llms-full.txt'), 'Full content\n');
  const vercelConfig = {
    redirects: [
      { source: '/about', destination: '/docs/', statusCode: 301 },
      { source: '/about.md', destination: '/docs.md', statusCode: 301 },
      { source: '/external', destination: 'https://docs.example.com/', permanent: true },
      { source: '/old/:slug', destination: '/new/:slug/', permanent: false },
    ],
    headers: [
      { source: '/llms-full.txt', headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }] },
    ],
  };
  await writeFile(path.join(cwd, 'vercel.json'), JSON.stringify(vercelConfig));
  const updated = await setupVercel(cwd, 'npm run build:site');
  assert.deepEqual(updated.redirects, vercelConfig.redirects);
  assert.deepEqual(updated.headers, vercelConfig.headers);
  await build(cwd);

  const site = await serveArtifact(t, cwd);
  // Redirects beat both Accept: text/markdown and User-Agent routing.
  for (const headers of [{ Accept: 'text/html' }, { Accept: 'text/markdown' }, { 'User-Agent': 'curl/8' }]) {
    const res = await fetch(`${site}/about`, { headers, redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/docs/');
  }
  const mdRedirect = await fetch(`${site}/about.md`, { redirect: 'manual' });
  assert.equal(mdRedirect.status, 301);
  assert.equal(mdRedirect.headers.get('location'), '/docs.md');

  const extRedirect = await fetch(`${site}/external`, { redirect: 'manual' });
  assert.equal(extRedirect.status, 308);
  assert.equal(extRedirect.headers.get('location'), 'https://docs.example.com/');

  const paramRedirect = await fetch(`${site}/old/guide`, { redirect: 'manual' });
  assert.equal(paramRedirect.status, 307);
  assert.equal(paramRedirect.headers.get('location'), '/new/guide/');

  const llmsFull = await fetch(`${site}/llms-full.txt`);
  assert.equal(llmsFull.status, 200);
  assert.equal(llmsFull.headers.get('content-type'), 'text/plain; charset=utf-8');

  // Invalid redirects fail validation cleanly.
  await writeFile(path.join(cwd, 'vercel.json'), JSON.stringify({ redirects: [{ source: '/bad', destination: '//evil.com', statusCode: 301 }] }));
  await assert.rejects(build(cwd), /root-relative/);
});

test('pattern routes stay constant for large sites and support trailingSlash redirects', async t => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    route: i === 0 ? '/' : `/blog/post-${i}`,
    file: i === 0 ? 'index.html' : `blog/post-${i}/index.html`,
    markdown: i === 0 ? '/index.md' : `/blog/post-${i}.md`,
  }));
  const routes = routesFor(many, many, { userAgents: true, trailingSlash: true });
  assert.ok(routes.length < 20, `Expected <20 routes for 500 pages, got ${routes.length}`);

  const cwd = await fixture(t);
  const configPath = path.join(cwd, 'agent-readable.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(configPath, JSON.stringify({ ...config, userAgents: true, trailingSlash: true }));
  await build(cwd);

  const site = await serveArtifact(t, cwd);
  // Browser HTML request without trailing slash gets 308 redirect.
  const htmlNoSlash = await fetch(`${site}/docs`, { headers: { Accept: 'text/html' }, redirect: 'manual' });
  assert.equal(htmlNoSlash.status, 308);
  assert.equal(htmlNoSlash.headers.get('location'), '/docs/');

  // Markdown negotiation serves 200 directly without an extra redirect hop.
  const mdAccept = await fetch(`${site}/docs`, { headers: { Accept: 'text/markdown' }, redirect: 'manual' });
  assert.equal(mdAccept.status, 200);
  assert.match(mdAccept.headers.get('content-type') || '', /text\/markdown/);

  const mdCurl = await fetch(`${site}/docs`, { headers: { 'User-Agent': 'curl/8' }, redirect: 'manual' });
  assert.equal(mdCurl.status, 200);
  assert.match(mdCurl.headers.get('content-type') || '', /text\/markdown/);

  // Direct .md files do not redirect.
  const mdDirect = await fetch(`${site}/docs.md`, { redirect: 'manual' });
  assert.equal(mdDirect.status, 200);

  // Checker succeeds on both slash and non-slash forms.
  assert.equal((await check(site, ['/', '/docs', '/docs/'])).ok, true);

  // Duplicate excluded error pages emitted by Next.js trailingSlash exports (404.html + 404/index.html) are allowed.
  await mkdir(path.join(cwd, 'out/404'), { recursive: true });
  await writeFile(path.join(cwd, 'out/404.html'), '<main><h1>404</h1><div data-agent-only hidden>Strip me</div></main>');
  await writeFile(path.join(cwd, 'out/404/index.html'), '<main><h1>404</h1><div data-agent-only hidden>Strip me</div></main>');
  await build(cwd);
  assert.doesNotMatch(await readFile(path.join(cwd, '.vercel/output/static/404.html'), 'utf8'), /data-agent-only/);
  assert.doesNotMatch(await readFile(path.join(cwd, '.vercel/output/static/404/index.html'), 'utf8'), /data-agent-only/);

  // Conflicting trailingSlash between agent-readable.json and vercel.json fails.
  await writeFile(path.join(cwd, 'vercel.json'), JSON.stringify({ trailingSlash: false }));
  await assert.rejects(build(cwd), /Conflicting trailingSlash/);
});

test('conversion recovers aria-label headings/icons, drops alt="" images, flattens table cells, and spaces adjacent links', () => {
  const html = [
    '<title>Pricing</title><main>',
    '<h1 aria-label="Animated Pricing"><span aria-hidden="true">Animated</span> <span aria-hidden="true">Pricing</span></h1>',
    '<img src="/dot.svg" alt=""><img src="/chart.png" alt="Chart">',
    '<div><a href="/a">Start free</a><a href="/b">Book a demo</a><button>Talk to sales</button></div>',
    '<table><thead><tr><th>Feature</th><th><div>Growth</div><div>$599</div><div>Per month</div></th></tr></thead>',
    '<tbody><tr><td>Tracking</td><td><svg role="img" aria-label="Yes"><path d="M0 0"/></svg></td></tr>',
    '<tr><td>Exports</td><td><svg aria-label="No"><path d="M0 0"/></svg></td></tr></tbody></table>',
    '</main>',
  ].join('');
  const result = convert(html, 'https://example.com/pricing/');
  assert.match(result.markdown, /# Animated Pricing/);
  assert.doesNotMatch(result.markdown, /dot\.svg/);
  assert.match(result.markdown, /!\[Chart\]\(https:\/\/example\.com\/chart\.png\)/);
  assert.match(result.markdown, /\[Start free\]\(https:\/\/example\.com\/a\) \[Book a demo\]\(https:\/\/example\.com\/b\) Talk to sales/);
  assert.match(result.markdown, /\| Feature \| Growth \$599 Per month \|/);
  assert.match(result.markdown, /\| Tracking \| Yes \|/);
  assert.match(result.markdown, /\| Exports \| No \|/);
});

test('llmsFull generates combined Markdown and Link headers advertise llms.txt describedby when present', async t => {
  const cwd = await fixture(t);
  const configPath = path.join(cwd, 'agent-readable.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(configPath, JSON.stringify({ ...config, llmsFull: true }));
  await build(cwd);

  const output = path.join(cwd, '.vercel/output');
  const full = await readFile(path.join(output, 'static/llms-full.txt'), 'utf8');
  assert.match(full, /# example\.com/);
  assert.match(full, /Source: https:\/\/example\.com\//);
  assert.match(full, /Source: https:\/\/example\.com\/docs\//);
  assert.match(full, /npm install example-sdk/);
  assert.doesNotMatch(full, /preview/i);

  const site = await serveArtifact(t, cwd);
  const html = await fetch(`${site}/docs/`, { headers: { Accept: 'text/html' } });
  const link = html.headers.get('link') || '';
  assert.match(link, /<\/docs\.md>; rel="alternate"; type="text\/markdown"/);
  assert.match(link, /<\/llms\.txt>; rel="describedby"; type="text\/plain"/);
  const fullRes = await fetch(`${site}/llms-full.txt`);
  assert.equal(fullRes.status, 200);
  assert.equal(fullRes.headers.get('content-type'), 'text/plain; charset=utf-8');

  // Guard against overwriting an existing llms-full.txt.
  await writeFile(path.join(cwd, 'out/llms-full.txt'), 'Custom full index\n');
  await assert.rejects(build(cwd), /Existing llms-full\.txt/);

  // Without llms.txt (llms: false and no exported llms.txt), Link omits describedby.
  await rm(path.join(cwd, 'out/llms-full.txt'));
  await writeFile(configPath, JSON.stringify({ ...config, llms: false, llmsFull: false }));
  await build(cwd);
  const siteNoLlms = await serveArtifact(t, cwd);
  const noLlmsLink = (await fetch(`${siteNoLlms}/docs/`, { headers: { Accept: 'text/html' } })).headers.get('link') || '';
  assert.doesNotMatch(noLlmsLink, /describedby/);
});

test('checkLocal and check --header verify local artifacts and protected origins', async t => {
  const { checkLocal } = await import('../src/index.js');
  const cwd = await fixture(t);
  await build(cwd);

  const localResult = await checkLocal(cwd);
  assert.equal(localResult.ok, true, JSON.stringify(localResult));
  assert.equal(localResult.pages.length, 2);

  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const cliOut = execFileSync(process.execPath, [cli, 'check', '--local', '--cwd', cwd, '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(cliOut).ok, true);

  // Protected preview origin requiring a bypass header (simulating Vercel Deployment Protection).
  const site = await serveArtifact(t, cwd);
  const protectedServer = createServer(async (req, res) => {
    if (req.headers['x-vercel-protection-bypass'] !== 'secret-token') {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
    const upstream = await fetch(`${site}${req.url}`, { headers: { Accept: req.headers.accept || '*/*' }, redirect: 'manual' });
    res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
    res.end(await upstream.text());
  });
  protectedServer.listen(0, '127.0.0.1');
  await once(protectedServer, 'listening');
  t.after(() => { protectedServer.closeAllConnections(); protectedServer.close(); });
  const protectedUrl = `http://127.0.0.1:${protectedServer.address().port}`;

  assert.equal((await check(protectedUrl, ['/docs/'])).ok, false);
  const passed = await check(protectedUrl, ['/docs/'], { headers: { 'x-vercel-protection-bypass': 'secret-token' } });
  assert.equal(passed.ok, true, JSON.stringify(passed));
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const { stdout: cliProtected } = await promisify(execFile)(process.execPath, [cli, 'check', protectedUrl, '--path', '/docs/', '--header', 'x-vercel-protection-bypass: secret-token', '--json']);
  assert.equal(JSON.parse(cliProtected).ok, true);
});
