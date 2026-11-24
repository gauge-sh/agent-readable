import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createNextMarkdownProxy, createNextMarkdownRoute, createNextMarkdownTester, defineNextMarkdown, applyMarkdownHeaders } from '../src/next.js';
import { createNextMarkdownServer } from '../src/next-server.js';

// Capture the documented NextResponse boundary; full Next builds run in an external app.
const NextResponse = {
  rewrite: (url, init) => ({ url, requestHeaders: init?.request?.headers }),
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
    assert.equal(response.headers.get('link'), '</index.md?q=one&q=two&__page=customer&__agent_readable=customer>; rel="alternate"; type="text/markdown", </?q=one&q=two&__page=customer&__agent_readable=customer>; rel="canonical"');
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

test('defineNextMarkdown shares config across composable proxy rewrite, headers, and route', async () => {
  const md = defineNextMarkdown({
    match: pathname => pathname.startsWith('/posts/'),
    userAgents: true,
    index: false,
  });
  const route = md.route({
    resolve: ({ pathname }) => pathname === '/posts/launch' ? '# Launch\n' : null,
    cacheControl: 'public, s-maxage=3600, stale-while-revalidate=86400',
    notFound: '# Post not found\n',
  });

  // Composed proxy simulation (e.g., inside Clerk middleware).
  const composedProxy = req => {
    const rewritten = md.rewrite(NextResponse, req);
    if (rewritten) return rewritten;
    const response = { status: 200, headers: new Headers({ 'x-app-header': 'kept', Vary: 'RSC' }) };
    return md.applyHeaders(req, response);
  };

  // Uncovered home page: even curl/Claude Code passes through without rewrite or discovery headers.
  const home = composedProxy(request('/', '*/*', 'GET', { 'User-Agent': 'curl/8.0' }));
  assert.equal(home.url, undefined);
  assert.equal(home.headers.get('x-app-header'), 'kept');
  assert.equal(home.headers.get('vary'), 'RSC');
  assert.equal(home.headers.get('link'), null);

  // Existing /llms.txt is preserved when index: false.
  const llms = composedProxy(request('/llms.txt', '*/*', 'GET', { 'User-Agent': 'curl/8.0' }));
  assert.equal(llms.url, undefined);

  // Covered HTML page keeps app headers and receives discovery Link + Vary.
  const postHtml = composedProxy(request('/posts/launch', 'text/html', 'GET', { 'User-Agent': 'Mozilla/5.0' }));
  assert.equal(postHtml.url, undefined);
  assert.equal(postHtml.headers.get('x-app-header'), 'kept');
  assert.equal(postHtml.headers.get('vary'), 'RSC, Accept, User-Agent');
  assert.equal(postHtml.headers.get('link'), '</posts/launch.md>; rel="alternate"; type="text/markdown"');

  // Covered Markdown request rewrites and resolves with shared userAgents, cacheControl, and notFound.
  const agentReq = request('/posts/launch', 'text/html', 'GET', { 'User-Agent': 'claude-code/2.0' });
  const rewritten = composedProxy(agentReq);
  assert.equal(rewritten.url.pathname, '/api/markdown');
  const mdRes = await route(new Request(rewritten.url, { headers: agentReq.headers }));
  assert.equal(mdRes.status, 200);
  assert.equal(await mdRes.text(), '# Launch\n');
  assert.equal(mdRes.headers.get('cache-control'), 'public, s-maxage=3600, stale-while-revalidate=86400');
  assert.equal(mdRes.headers.get('vary'), 'Accept, User-Agent');

  // Covered missing post uses custom 404 body and no-store.
  const missingReq = request('/posts/nope.md');
  const missingRewrite = composedProxy(missingReq);
  const missingRes = await route(new Request(missingRewrite.url, { headers: missingReq.headers }));
  assert.equal(missingRes.status, 404);
  assert.equal(await missingRes.text(), '# Post not found\n');
  assert.equal(missingRes.headers.get('cache-control'), 'no-store');

  // Standalone proxy helper also works directly.
  const standalone = md.proxy(NextResponse);
  assert.equal(standalone(request('/posts/launch.md')).url.pathname, '/api/markdown');
  const standaloneHome = standalone(request('/', 'text/html'));
  assert.equal(standaloneHome.headers.get('link'), '</app.js>; rel="preload"');
  assert.equal(standaloneHome.headers.get('vary'), 'RSC');

  // Config drift guards reject overriding routing options in route() or supplying index when index: false.
  assert.throws(() => md.route({ resolve: () => '', userAgents: false }), /defineNextMarkdown/);
  assert.throws(() => md.route({ resolve: () => '', match: () => true }), /defineNextMarkdown/);
  assert.throws(() => md.route({ resolve: () => '', exclude: ['/api'] }), /defineNextMarkdown/);
  assert.throws(() => md.route({ resolve: () => '', index: () => '# Index' }), /index: false/);
  assert.equal(typeof applyMarkdownHeaders, 'function');
});


test('Next route uses forwarded target when framework retains original URL', async () => {
  const original = request('/docs.md?q=one&q=two&__agent_readable=customer', '*/*', 'GET', {
    Cookie: 'locale=en', 'x-agent-readable-target': 'spoofed',
  });
  const rewritten = proxy(original);
  const response = await route(new Request(original.url, { headers: rewritten.requestHeaders }));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(await response.text()), {
    pathname: '/docs', query: [['q', 'one'], ['q', 'two'], ['__agent_readable', 'customer']], cookie: 'locale=en',
  });
  const checkHeaders = createNextMarkdownRoute({ resolve: ({ request }) => String(request.headers.has('x-agent-readable-target')) });
  assert.equal(await (await checkHeaders(new Request(original.url, { headers: rewritten.requestHeaders }))).text(), 'false');
});

test('defineNextMarkdown defaults index to false and enforces index callback parity', async () => {
  const defaultMd = defineNextMarkdown();
  assert.equal(defaultMd.options.index, false);
  const defaultProxy = defaultMd.proxy(NextResponse);
  // Existing /llms.txt and /lm.txt pass through by default without index: false boilerplate.
  assert.equal(defaultProxy(request('/llms.txt')).url, undefined);
  assert.equal(defaultProxy(request('/lm.txt')).url, undefined);
  assert.throws(() => defaultMd.route({ resolve: () => '# Page', index: () => '# Index' }), /index: false/);

  // Opting into index: true requires an index callback in route().
  const withIndex = defineNextMarkdown({ index: true });
  assert.equal(withIndex.options.index, true);
  assert.throws(() => withIndex.route({ resolve: () => '# Page' }), /requires an index callback/);
  const idxProxy = withIndex.proxy(NextResponse);
  const idxRoute = withIndex.route({ resolve: () => '# Page', index: () => '# Custom Index\n' });
  const req = request('/llms.txt');
  const rewritten = idxProxy(req);
  assert.equal(rewritten.url.pathname, '/api/markdown');
  const res = await idxRoute(new Request(req.url, { headers: rewritten.requestHeaders }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '# Custom Index\n');
});

test('createNextMarkdownTester runs proxy and route using Next.js middleware headers', async () => {
  // Mirror NextResponse.rewrite / NextResponse.next header encoding from next/server.
  const applyOverrideHeaders = (headers, init) => {
    if (!init?.request?.headers) return;
    const keys = [];
    for (const [key, value] of init.request.headers.entries()) {
      headers.set(`x-middleware-request-${key}`, value);
      keys.push(key);
    }
    headers.set('x-middleware-override-headers', keys.join(','));
  };
  const RealLikeNextResponse = {
    rewrite(destination, init) {
      const headers = new Headers(init?.headers);
      headers.set('x-middleware-rewrite', String(destination));
      applyOverrideHeaders(headers, init);
      return new Response(null, { status: 200, headers });
    },
    next(init) {
      const headers = new Headers(init?.headers);
      headers.set('x-middleware-next', '1');
      applyOverrideHeaders(headers, init);
      return new Response(null, { status: 200, headers });
    },
  };

  const md = defineNextMarkdown({
    match: pathname => pathname.startsWith('/docs'),
    userAgents: { exclude: ['curl/'] },
  });
  const mdProxy = md.proxy(RealLikeNextResponse);
  const mdRoute = md.route({
    resolve: ({ pathname, searchParams, request }) => JSON.stringify({
      pathname,
      q: searchParams.getAll('q'),
      cookie: request.headers.get('cookie'),
      leakedTarget: request.headers.has('x-agent-readable-target'),
    }),
  });

  let fallbackHeaders;
  const run = createNextMarkdownTester({
    proxy: mdProxy,
    route: mdRoute,
    fallback: req => {
      fallbackHeaders = req.headers;
      return new Response('<html>Docs</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html', Vary: 'RSC' },
      });
    },
  });

  // Markdown rewrite executes route with original URL + forwarded headers (matching Next.js 16).
  const mdRes = await run('https://example.com/docs/intro?q=a&q=b', {
    headers: { 'User-Agent': 'claude-code/2.0', Cookie: 's=1', 'x-agent-readable-target': 'spoof' },
  });
  assert.equal(mdRes.status, 200);
  assert.match(mdRes.headers.get('content-type'), /text\/markdown/);
  assert.deepEqual(JSON.parse(await mdRes.text()), {
    pathname: '/docs/intro', q: ['a', 'b'], cookie: 's=1', leakedTarget: false,
  });

  // Excluded curl/ passes through to fallback with proxy response headers merged and spoofed target stripped.
  const htmlRes = await run('https://example.com/docs/intro', {
    headers: { 'User-Agent': 'curl/8.7.1', 'x-agent-readable-target': 'spoof' },
  });
  assert.equal(htmlRes.status, 200);
  assert.equal(await htmlRes.text(), '<html>Docs</html>');
  assert.equal(fallbackHeaders.has('x-agent-readable-target'), false);
  assert.match(htmlRes.headers.get('link'), /\/docs\/intro\.md/);
  assert.equal(htmlRes.headers.get('cache-control'), 'private, no-store');
  assert.equal(htmlRes.headers.get('vary'), 'RSC, Accept, User-Agent');

  // Non-markdown redirects from composed auth middleware pass straight through.
  const authRun = createNextMarkdownTester({
    proxy: req => {
      const rewritten = md.rewrite(RealLikeNextResponse, req);
      if (rewritten) return rewritten;
      return new Response(null, { status: 307, headers: { Location: '/sign-in' } });
    },
    route: mdRoute,
  });
  const redirectRes = await authRun('https://example.com/private');
  assert.equal(redirectRes.status, 307);
  assert.equal(redirectRes.headers.get('location'), '/sign-in');
});
