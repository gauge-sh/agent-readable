import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownHandler, resolveMarkdownRequest, prefersMarkdown, markdownDiscovery } from '../src/runtime.js';

const request = (path, accept = '*/*', method = 'GET') => new Request(`https://example.com${path}`, { method, headers: { Accept: accept } });

test('runtime negotiation preserves explicit Markdown preferences and rejects malformed quality values', () => {
  for (const accept of ['text/markdown', 'text/x-markdown', 'text/markdown; charset=utf-8', 'text/html;q=0.4, text/markdown;q=0.8', 'text/markdown, text/html', 'TEXT/MARKDOWN', 'text/*;q=1,text/html;q=0,text/markdown;q=0.5']) assert.equal(prefersMarkdown(accept), true, accept);
  for (const accept of ['', '*/*', 'text/*', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'text/markdown;q=0', 'text/markdown;q=0.5,text/html', 'text/markdown;q=bad', 'text/markdown;q=2', 'text/x-component', 'text/markdown;q=', 'text/markdown;q=-1', 'text/markdown;q=0.1234', 'text/markdown;q=1;q=0', 'text/markdown;q=0.5,application/xhtml+xml;q=0.8']) assert.equal(prefersMarkdown(accept), false, accept);
});

test('runtime keeps methods, assets, APIs and HTML requests with the host app', () => {
  for (const path of ['/logo.svg', '/styles.css', '/api/markdown', '/api/og', '/_next/data']) assert.equal(resolveMarkdownRequest(request(path, 'text/markdown')), null);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal(resolveMarkdownRequest(request('/docs.md', 'text/markdown', method)), null);
  assert.equal(resolveMarkdownRequest(request('/docs', 'text/html')), null);
  assert.equal(resolveMarkdownRequest(request('/private.md'), { exclude: ['/private.md'] }), null);
});

test('runtime handles suffix aliases, async custom content, query filters and discovery', async () => {
  const handle = createMarkdownHandler({ resolve: async ({ pathname, searchParams }) => pathname === '/' ? `# Directory\n\nFilter: ${searchParams.get('q') || 'all'}\n` : pathname === '/docs' ? '# Entirely custom\n' : null, index: () => '# Site index\n' });
  for (const url of ['/index.md?q=surge', '/.md?q=surge', '/?q=surge']) {
    const response = await handle(request(url, 'text/markdown'));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '# Directory\n\nFilter: surge\n');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('vary'), 'Accept');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('link'), '</index.md?q=surge>; rel="alternate"; type="text/markdown"');
  }
  for (const path of ['/docs.md', '/docs/']) assert.equal(await (await handle(request(path, 'text/x-markdown'))).text(), '# Entirely custom\n');
  for (const path of ['/lm.txt', '/llms.txt']) assert.equal(await (await handle(request(path))).text(), '# Site index\n');
  assert.equal(markdownDiscovery('https://example.com/docs/?q=hello'), '</docs.md?q=hello>; rel="alternate"; type="text/markdown"');
});

test('runtime preserves HEAD/404 behavior and leaves index attribution opt-in', async () => {
  const handle = createMarkdownHandler({ resolve: ({ pathname }) => pathname === '/' ? '# Root\n' : null });
  for (const path of ['/missing.md', '/missing']) {
    const response = await handle(request(path, 'text/markdown'));
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^text\/markdown/);
  }
  for (const path of ['/index.md', '/missing.md', '/llms.txt']) {
    const response = await handle(request(path, '*/*', 'HEAD'));
    assert.equal(response.status, path === '/index.md' ? 200 : 404);
    assert.equal(await response.text(), '');
  }
  const attributed = createMarkdownHandler({ resolve: () => '# Original\n', index: () => '# Index\n', attribution: true });
  assert.match(await (await attributed(request('/llms.txt'))).text(), /\[Gauge\]/);
  assert.equal(await (await attributed(request('/docs.md'))).text(), '# Original\n');
  assert.equal(await handle(request('/')), null);
});

test('runtime propagates resolver failures instead of disguising them as missing pages', async () => {
  assert.throws(() => createMarkdownHandler(), /resolve/);
  const fail = createMarkdownHandler({ resolve: () => { throw new Error('database unavailable'); } });
  await assert.rejects(fail(request('/docs.md')), /database unavailable/);
  await assert.rejects(createMarkdownHandler({ resolve: () => ({ invalid: true }) })(request('/docs.md')), /string or null/);
});
