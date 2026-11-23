import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createNodeMarkdownHandler } from '../src/node.js';

test('Node adapter preserves downstream APIs and merges final framework headers', async t => {
  let appRequests = 0;
  const handle = createNodeMarkdownHandler({
    origin: 'http://localhost',
    resolve: ({ pathname, searchParams, request }) => pathname === '/docs' ? `# ${searchParams.get('q')} ${request.headers.get('cookie') || ''}` : null,
  }, (req, res) => {
    appRequests++;
    if (req.url.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return; }
    if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end('body{}'); return; }
    res.setHeader('Vary', 'rsc, Accept-Encoding'); // Reproduces framework replacement.
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Link', '</style.css>; rel="preload"');
    if (req.url === '/array') res.writeHead(200, ['Content-Type', 'text/html', 'Set-Cookie', 'a=1', 'Set-Cookie', 'b=2']);
    else res.writeHead(200, { 'Content-Type': 'text/html', Vary: 'rsc, Accept-Encoding' });
    res.end('<html>Page</html>');
  });
  const server = createServer((req, res) => { handle(req, res).catch(() => { res.writeHead(500); res.end(); }); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/docs', '/array']) {
    const response = await fetch(base + path, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html$/);
    const vary = response.headers.get('vary').toLowerCase().split(',').map(v => v.trim());
    for (const token of ['rsc', 'accept-encoding', 'accept']) assert.ok(vary.includes(token));
    assert.match(response.headers.get('link'), /preload/);
    assert.match(response.headers.get('link'), /text\/markdown/);
    if (path === '/array') assert.equal(response.headers.getSetCookie().length, 2);
  }
  const before = appRequests;
  const markdown = await fetch(base + '/docs?q=filter', { headers: { Accept: 'text/x-markdown', Cookie: 'session=abc' } });
  assert.equal(await markdown.text(), '# filter session=abc');
  assert.equal(appRequests, before);
  assert.equal((await fetch(base + '/missing.md')).status, 404);
  assert.equal(await (await fetch(base + '/docs.md', { method: 'HEAD' })).text(), '');
  const api = await fetch(base + '/api/og', { headers: { Accept: 'text/markdown' } });
  assert.deepEqual(await api.json(), { ok: true });
  assert.equal(api.headers.get('vary'), null);
  assert.equal((await fetch(base + '/style.css')).headers.get('content-type'), 'text/css');
  assert.equal((await fetch(base + '/docs', { method: 'POST' })).status, 200);
});
