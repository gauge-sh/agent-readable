import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { init, build, checkLocal, setupNetlify, setupVercel } from '../src/index.js';
async function fixture(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ar-netlify-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await init(cwd, 'https://example.com');
  await mkdir(path.join(cwd, 'out/docs'), { recursive: true });
  await writeFile(path.join(cwd, 'out/index.html'), '<main><h1>Heading\n    with whitespace</h1><p data-agent-only hidden>Agent copy</p></main>');
  await writeFile(path.join(cwd, 'out/docs/index.html'), '<main><h1>Documentation</h1></main>');
  await writeFile(path.join(cwd, 'out/private.html'), '<meta name="robots" content="noindex"><main>Private</main>');
  return cwd;
}
test('Netlify build converts pages and executes generated edge function over HTTP', async t => {
  const cwd = await fixture(t);
  const configPath = path.join(cwd, 'agent-readable.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(configPath, JSON.stringify({ ...config, userAgents: { exclude: ['curl/'] } }, null, 2));
  await writeFile(path.join(cwd, 'out/_redirects'), '/old /docs 301\n');
  // An unrelated Vercel config must not affect Netlify builds.
  await writeFile(path.join(cwd, 'vercel.json'), '{"rewrites":[]}');
  const manifest = await build(cwd, { target: 'netlify' });
  assert.equal(manifest.target, 'netlify'); assert.deepEqual(manifest.skipped, ['/private']);
  assert.equal(await readFile(path.join(cwd, '.netlify/agent-readable/output/static/_redirects'), 'utf8'), '/old /docs 301\n');
  const result = await checkLocal(cwd, { target: 'netlify' });
  assert.equal(result.ok, true, JSON.stringify(result));
  // Verify userAgents.exclude in the generated Netlify edge function.
  const source = await readFile(path.join(cwd, '.netlify/v1/edge-functions/agent-readable.js'), 'utf8');
  const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const htmlNext = async () => new Response('<html>Docs</html>', { headers: { 'Content-Type': 'text/html' } });
  const curlRes = await handler(new Request('https://example.com/docs', { headers: { 'User-Agent': 'curl/8.7.1' } }), { next: htmlNext });
  assert.match(curlRes.headers.get('content-type'), /text\/html/);
  await build(cwd, { target: 'netlify' });
});
test('setup preserves Netlify settings and refuses conflicting context commands', async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, 'netlify.toml'), '[build]\ncommand="old"\npublish="out"\n[build.environment]\nNODE_VERSION="22"\n[[redirects]]\nfrom="/old"\nto="/new"\nstatus=301\n');
  await setupNetlify(cwd, 'npm run build:site');
  const config = parse(await readFile(path.join(cwd, 'netlify.toml'), 'utf8'));
  assert.equal(config.redirects[0].to, '/new'); assert.equal(config.build.environment.NODE_VERSION, '22');
  assert.match(config.build.command, /--target netlify/);
  assert.equal(config.build.publish, '.netlify/agent-readable/output/static');
  await build(cwd); assert.equal((await checkLocal(cwd)).ok, true);
  await assert.rejects(setupVercel(cwd, 'npm run build'), /targets Netlify/);
  const conflicting = '[context.production]\ncommand="custom"\n';
  await writeFile(path.join(cwd, 'netlify.toml'), conflicting);
  await assert.rejects(setupNetlify(cwd, 'npm run build'), /Context-specific/);
  assert.equal(await readFile(path.join(cwd, 'netlify.toml'), 'utf8'), conflicting);
});
test('Netlify build refuses unowned edge functions and symlinked output', async t => {
  const cwd = await fixture(t);
  await mkdir(path.join(cwd, '.netlify/v1/edge-functions'), { recursive: true });
  const edge = path.join(cwd, '.netlify/v1/edge-functions/agent-readable.js');
  await writeFile(edge, '// custom');
  await assert.rejects(build(cwd, { target: 'netlify' }), /Refusing to replace/);
  await rm(edge);
  await symlink(path.join(cwd, 'out'), path.join(cwd, '.netlify/agent-readable'));
  await assert.rejects(build(cwd, { target: 'netlify' }), /Symlinks/);
});


test('Netlify handler honors agents, explicit rejection, methods, HEAD and existing redirects', async t => {
  const { createNetlifyHandler } = await import('../src/netlify-edge.js');
  const { prefersMarkdown } = await import('../src/runtime.js');
  const { markdownRejection } = await import('../src/user-agents.js');
  const handler = createNetlifyHandler([{ route: '/', markdown: '/index.md' }], [['TestAgent', 'i']], [], markdownRejection, prefersMarkdown, true);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push([url.href, options]); return new Response(options.method === 'HEAD' ? null : '# Content', { headers: { 'Content-Type': 'text/plain' } }); });
  const context = { next: async () => new Response('<main>Content</main>', { headers: { 'Content-Type': 'text/html', Vary: 'Origin', Link: '</style.css>; rel="preload"' } }) };
  const request = (url = '/', headers = {}, method = 'GET') => new Request('https://site.example' + url, { headers, method });
  const response = await handler(request('/?q=1', { 'User-Agent': 'testagent' }), context);
  assert.match(response.headers.get('content-type'), /text\/markdown/);
  assert.match(response.headers.get('vary'), /User-Agent/);
  assert.equal(calls[0][0], 'https://site.example/index.md?q=1');
  const rejected = await handler(request('/', { Accept: 'text/html, text/markdown;q=0', 'User-Agent': 'TestAgent' }), context);
  assert.match(rejected.headers.get('content-type'), /text\/html/);
  assert.match(rejected.headers.get('vary'), /Origin/);
  assert.match(rejected.headers.get('link'), /preload/);
  assert.match(rejected.headers.get('link'), /alternate/);
  assert.equal(calls.length, 1);
  const head = await handler(request('/', { Accept: 'text/markdown' }, 'HEAD'), context);
  assert.equal(await head.text(), '');
  for (const url of ['/private', '/missing.md', '/asset.js']) assert.equal(await handler(request(url), context), undefined);
  assert.equal(await handler(request('/', {}, 'POST'), context), undefined);
  const redirect = new Response(null, { status: 301, headers: { Location: '/new' } });
  assert.equal(await handler(request('/', { Accept: 'text/markdown' }), { next: async () => redirect }), redirect);
});


test('local checker explains missing static artifacts to runtime app users', async t => {
  const cwd = await fixture(t);
  await assert.rejects(checkLocal(cwd), /running server URL/);
  await assert.rejects(checkLocal(cwd, { target: 'netlify' }), /running server URL/);
});
