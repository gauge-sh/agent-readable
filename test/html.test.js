import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHtmlMarkdownResolver } from '../src/html.js';
const context = (pathname = '/') => ({ pathname, searchParams: new URLSearchParams('q=one&q=two'), request: new Request('https://untrusted.example/index.md', { headers: { cookie: 'session=one', authorization: 'Bearer token' } }) });
const html = body => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

test('HTML resolver converts source and applies inline controls, selection, noindex and status', async () => {
  let received;
  const resolve = createHtmlMarkdownResolver({ fetchHtml: ctx => { received = ctx; return html('<main><h1>Source content</h1><p data-agent-hidden>Decoration</p><p data-agent-only hidden>Agent instructions</p></main>'); } });
  const result = await resolve(context());
  assert.match(result, /Source content/);
  assert.match(result, /Agent instructions/);
  assert.doesNotMatch(result, /Decoration/);
  assert.deepEqual(received.url.searchParams.getAll('q'), ['one', 'two']);
  for (const status of [401, 403, 404, 410]) assert.equal(await createHtmlMarkdownResolver({ fetchHtml: () => new Response('', { status }) })(context()), null);
  assert.equal(await createHtmlMarkdownResolver({ fetchHtml: () => html('<meta name="robots" content="noindex"><main>Private</main>') })(context()), null);
  await assert.rejects(createHtmlMarkdownResolver({ fetchHtml: () => html('<body>No landmark</body>') })(context()), /no content matching/);
  await assert.rejects(createHtmlMarkdownResolver({ fetchHtml: () => new Response('{}') })(context()), /Expected HTML/);
  assert.throws(() => createHtmlMarkdownResolver(), /trusted origin/);
});

test('trusted source preserves query and credentials, rejects cross-origin redirects, prevents negotiation recursion', async t => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    if (req.url.startsWith('/redirect')) { res.writeHead(302, { Location: 'https://other.example/' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<main><h1>Live source</h1></main>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const resolve = createHtmlMarkdownResolver({ origin: `http://127.0.0.1:${server.address().port}` });
  assert.match(await resolve(context()), /Live source/);
  assert.equal(requests[0].url, '/?q=one&q=two');
  assert.equal(requests[0].headers.cookie, 'session=one');
  assert.equal(requests[0].headers.authorization, 'Bearer token');
  assert.match(requests[0].headers.accept, /text\/markdown;q=0/);
  await assert.rejects(resolve(context('/redirect')), /outside the configured origin/);
  await assert.rejects(resolve(context('//other.example')), /page pathname/);
});
