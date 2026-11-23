import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createNextMarkdownProxy, createNextMarkdownRoute } from '../src/next.js';
import { createNextMarkdownServer } from '../src/next-server.js';

// Capture the documented NextResponse boundary; full Next builds run in an external app.
const NextResponse = {
  rewrite: url => ({ url }),
  next: () => ({ headers: new Headers({ Vary: 'RSC', Link: '</app.js>; rel="preload"' }) }),
};
const request = (path, accept = '*/*', method = 'GET', extra = {}) => new Request(`https://example.com${path}`, { method, headers: { Accept: accept, ...extra } });
const proxy = createNextMarkdownProxy(NextResponse);
const route = createNextMarkdownRoute({
  resolve: ({ pathname, searchParams, request }) => pathname === '/missing' ? null : JSON.stringify({ pathname, query: [...searchParams], cookie: request.headers.get('cookie') }),
  index: () => '# Index',
});
const through = async req => {
  const rewritten = proxy(req);
  // Next.js may decode one level of escaping in the rewrite query.
  rewritten.url.search = decodeURIComponent(rewritten.url.search);
  return route(new Request(rewritten.url, { method: req.method, headers: req.headers }));
};

test('Next adapters preserve original paths, duplicate query keys, cookies and negotiated requests', async () => {
  for (const path of ['/index.md', '/.md', '/']) {
    const response = await through(request(`${path}?q=one&q=two&__page=customer&__agent_readable=customer`, 'text/markdown', 'GET', { Cookie: 'session=example' }));
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(await response.text()), { pathname: '/', query: [['q', 'one'], ['q', 'two'], ['__page', 'customer'], ['__agent_readable', 'customer']], cookie: 'session=example' });
    assert.equal(response.headers.get('link'), '</index.md?q=one&q=two&__page=customer&__agent_readable=customer>; rel="alternate"; type="text/markdown"');
  }
  assert.equal(JSON.parse(await (await through(request('/docs/', 'text/x-markdown'))).text()).pathname, '/docs');
});

test('Next adapters preserve HEAD, 404 and index responses', async () => {
  for (const path of ['/lm.txt', '/llms.txt']) assert.equal(await (await through(request(path))).text(), '# Index');
  assert.equal((await through(request('/missing.md'))).status, 404);
  const head = await through(request('/docs.md', '*/*', 'HEAD'));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.match(head.headers.get('content-type'), /^text\/markdown/);
});

test('Next proxy passes through excluded routes, assets, HTML preferences and mutations', () => {
  for (const req of [request('/api/markdown'), request('/api/og', 'text/markdown'), request('/_next/data', 'text/markdown'), request('/logo.svg', 'text/markdown'), request('/docs', 'text/html'), request('/docs', 'text/html,text/markdown;q=0.5'), request('/docs.md', 'text/markdown', 'POST')]) {
    const response = proxy(req);
    assert.equal(response.url, undefined);
  }
  const response = proxy(request('/docs?q=one', 'text/html', 'GET', { 'x-agent-readable-path': '/spoof.md' }));
  assert.equal(response.headers.get('vary'), 'RSC, Accept');
  assert.match(response.headers.get('link'), /^<\/app.js>.*<\/docs.md\?q=one>/);
  assert.equal(proxy(request('/api/og')).headers.get('vary'), 'RSC');
});

test('Next adapter supports custom route and exclusions without rewriting its own endpoint', () => {
  const custom = createNextMarkdownProxy(NextResponse, { route: '/internal/markdown', exclude: ['/private', '/api', '/_next'] });
  assert.equal(custom(request('/docs.md')).url.pathname, '/internal/markdown');
  assert.equal(custom(request('/internal/markdown', 'text/markdown')).url, undefined);
  assert.equal(custom(request('/private/page.md')).url, undefined);
  for (const path of ['https://other.test/path', '//other.test', '/api?x=1', '/api/../route', '/api\\route']) assert.throws(() => createNextMarkdownProxy(NextResponse, { route: path }));
});

test('Next route rejects missing, malformed and unhandled targets', async () => {
  assert.equal((await route(request('/api/markdown'))).status, 404);
  assert.equal((await route(request('/api/markdown?__agent_readable=bad'))).status, 404);
  for (const target of ['', '//other.test/docs.md', '/docs.md?secret=1', '/a/../index.md', '/api/private']) {
    const response = await route(request('/api/markdown?' + new URLSearchParams({ __agent_readable: btoa(JSON.stringify([target, ''])).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') })));
    assert.equal(response.status, 404, target);
  }
});

test('Next server prepares the app and preserves final headers and request delegation', async t => {
  let prepared = false;
  const app = { prepare: async () => { prepared = true; }, getRequestHandler: () => (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', Vary: 'RSC', 'Set-Cookie': ['one=1', 'two=2'] });
    res.end('<main>Application</main>');
  } };
  const server = await createNextMarkdownServer(app, { origin: 'http://localhost', resolve: () => '# Docs' });
  assert.equal(prepared, true);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await fetch(base + '/docs');
  assert.equal(html.headers.get('vary'), 'RSC, Accept');
  assert.equal(html.headers.getSetCookie().length, 2);
  assert.match(html.headers.get('link'), /docs.md/);
  assert.equal(await html.text(), '<main>Application</main>');
  assert.equal(await (await fetch(base + '/docs.md')).text(), '# Docs');
  assert.equal(await (await fetch(base + '/api/data')).text(), '<main>Application</main>');
});

test('Next server returns a generic 500 for resolver failures', async t => {
  t.mock.method(console, 'error', () => {});
  const server = await createNextMarkdownServer({ prepare: async () => {}, getRequestHandler: () => () => {} }, {
    origin: 'http://localhost', resolve: () => { throw new Error('private failure'); },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/index.md`);
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Internal server error');
});
