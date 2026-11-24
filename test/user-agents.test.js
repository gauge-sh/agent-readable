import test from 'node:test';
import assert from 'node:assert/strict';
import { agents, patterns } from '@mintlify/agent-traffic';
import { routesFor } from '../src/build.js';
import { validateConfig } from '../src/config.js';
import { createMarkdownHandler } from '../src/runtime.js';
import { createNextMarkdownProxy, createNextMarkdownRoute } from '../src/next.js';
const req = (ua, accept = '*/*', path = '/docs', method = 'GET') => new Request(`https://example.com${path}`, { method, headers: { 'user-agent': ua, accept } });

test('automatic routing is opt-in, literal, case-insensitive and honors rejection and route boundaries', async () => {
  const handle = createMarkdownHandler({ resolve: () => '# Docs', userAgents: true });
  assert.equal(await createMarkdownHandler({ resolve: () => '# Docs' })(req('curl/8')), null);
  for (const ua of ['curl/8', 'Claude-Code/1', 'Mozilla OAI-SearchBot/1', 'cHaTgPt-UsEr/1.0', 'GPTBot/1.0']) {
    assert.equal(await (await handle(req(ua))).text(), '# Docs');
    assert.equal((await handle(req(ua))).headers.get('vary'), 'Accept, User-Agent');
    assert.equal(await handle(req(ua, 'text/markdown;q=0')), null);
    assert.equal(await handle(req(ua, '*/*', '/api/private')), null);
    assert.equal(await handle(req(ua, '*/*', '/asset.js')), null);
    assert.equal(await handle(req(ua, '*/*', '/docs', 'POST')), null);
    assert.equal(await (await handle(req(ua, '*/*', '/docs', 'HEAD'))).text(), '');
  }
  for (const ua of ['Mozilla/5.0', 'Googlebot/2.1', 'Slackbot-LinkExpanding 1.0', 'axios/1.0']) {
    assert.equal(await handle(req(ua)), null);
  }
  const custom = createMarkdownHandler({ resolve: () => '# Docs', userAgents: ['Agent.+'] });
  assert.ok(await custom(req('agent.+/1')));
  assert.equal(await custom(req('AgentXYZ')), null);
  assert.equal(await custom(req('curl/8')), null);
  for (const userAgents of ['curl', [null], [''], null, { unknown: true }, { defaults: 'yes' }, { include: [''] }, { exclude: [null] }]) {
    assert.throws(() => validateConfig({ site: 'https://example.com', userAgents }, '/tmp/site'), /userAgents/);
    assert.throws(() => createMarkdownHandler({ resolve: () => '', userAgents }), /userAgents/);
  }
});

test('composable userAgents object supports defaults, include, and exclude across runtime and static routes', async () => {
  const noCurl = createMarkdownHandler({ resolve: () => '# Docs', userAgents: { exclude: ['curl/'] } });
  assert.equal(await noCurl(req('curl/8.7.1')), null);
  assert.equal(await (await noCurl(req('claude-code/2.0'))).text(), '# Docs');
  assert.equal(await (await noCurl(req('GPTBot/1.0'))).text(), '# Docs');
  assert.equal((await noCurl(req('claude-code/2.0'))).headers.get('vary'), 'Accept, User-Agent');

  const extended = createMarkdownHandler({
    resolve: () => '# Docs',
    userAgents: { defaults: true, include: ['MyAgent/'], exclude: ['curl/'] },
  });
  assert.equal(await extended(req('curl/8')), null);
  assert.equal(await (await extended(req('MyAgent/1.0'))).text(), '# Docs');
  assert.equal(await (await extended(req('OAI-SearchBot/1.0'))).text(), '# Docs');
  assert.equal(await extended(req('Mozilla/5.0')), null);

  const customOnly = createMarkdownHandler({
    resolve: () => '# Docs',
    userAgents: { defaults: false, include: ['MyAgent/'], exclude: ['MyAgent/Bad'] },
  });
  assert.equal(await (await customOnly(req('MyAgent/1.0'))).text(), '# Docs');
  assert.equal(await customOnly(req('MyAgent/Bad')), null);
  assert.equal(await customOnly(req('claude-code/2.0')), null);

  const disabledObj = createMarkdownHandler({ resolve: () => '# Docs', userAgents: { defaults: false } });
  assert.equal(await disabledObj(req('claude-code/2.0')), null);
  assert.equal((await disabledObj(req('Mozilla/5.0', 'text/markdown'))).headers.get('vary'), 'Accept');

  // Static Vercel routes compile exclude into missing user-agent header conditions.
  const pages = [{ route: '/docs', markdown: '/docs.md', file: 'docs.html' }];
  const routes = routesFor(pages, pages, { userAgents: { defaults: true, include: ['MyAgent/'], exclude: ['curl/'] } });
  const autos = routes.filter(r => r.has?.some(h => h.key === 'user-agent'));
  assert.equal(routes[0].headers.Vary, 'Accept, User-Agent');
  const matchesStatic = ua => autos.some(r =>
    new RegExp(r.has[0].value).test(ua)
    && !r.missing.some(m => m.key === 'user-agent' && new RegExp(m.value).test(ua)),
  );
  assert.equal(matchesStatic('claude-code/2.0'), true);
  assert.equal(matchesStatic('MyAgent/1.0'), true);
  assert.equal(matchesStatic('curl/8.7.1'), false);
  assert.equal(matchesStatic('CURL/8.7.1'), false);
  assert.equal(matchesStatic('Mozilla/5.0'), false);

  const disabledRoutes = routesFor(pages, pages, { userAgents: { defaults: false } });
  assert.ok(!disabledRoutes.some(r => r.has?.some(h => h.key === 'user-agent')));
  assert.equal(disabledRoutes[0].headers.Vary, 'Accept');
  assert.ok(validateConfig({ site: 'https://example.com', userAgents: { defaults: true, include: ['MyAgent/'], exclude: ['curl/'] } }, '/tmp/site'));
});

test('static routes mirror opt-in routing without intercepting excluded HTML or rejected Markdown', () => {
  const pages = [{ route: '/docs', markdown: '/docs.md', file: 'docs.html' }];
  assert.ok(!routesFor(pages).some(r => r.has?.some(h => h.key === 'user-agent')));
  const routes = routesFor(pages, [...pages, { route: '/excluded', file: 'excluded.html' }], { userAgents: true });
  const autos = routes.filter(r => r.has?.some(h => h.key === 'user-agent'));
  const [auto] = autos;
  assert.deepEqual(auto.methods, ['GET', 'HEAD']);
  assert.equal(routes[0].headers.Vary, 'Accept, User-Agent');
  for (const ua of ['curl/8', 'CLAUDE-CODE/1', 'oAi-SeArChBoT/1', 'ChatGPT-User/1.0']) assert.ok(autos.some(r => new RegExp(r.has[0].value).test(ua)));
  assert.doesNotMatch('Mozilla/5.0', new RegExp(auto.has[0].value));
  assert.match('text/html, text/markdown;q=0, */*', new RegExp(auto.missing[0].value));
  assert.doesNotMatch('text/markdown;q=0.5', new RegExp(auto.missing[0].value));
  assert.ok(!routes.some(r => r.dest === '/excluded.md'));
  assert.ok(autos.every(r => !new RegExp(r.src).test('/excluded') && !new RegExp(r.src).test('/excluded/')));
  assert.ok(autos.some(r => new RegExp(r.src).test('/docs') && new RegExp(r.src).test('/docs/')));
  const custom = routesFor(pages, pages, { userAgents: ['Agent.+'] }).find(r => r.has?.some(h => h.key === 'user-agent'));
  assert.match('agent.+/1', new RegExp(custom.has[0].value));
  assert.doesNotMatch('AgentXYZ', new RegExp(custom.has[0].value));
});

test('Next proxy and route share automatic routing and preserve HTML Vary', async () => {
  const NextResponse = { rewrite: url => ({ url }), next: () => ({ headers: new Headers({ Vary: 'RSC' }) }) };
  const proxy = createNextMarkdownProxy(NextResponse, { userAgents: true });
  const route = createNextMarkdownRoute({ userAgents: true, resolve: () => '# Docs' });
  const request = req('curl/8');
  const rewritten = proxy(request);
  assert.equal(await (await route(new Request(rewritten.url, { headers: request.headers }))).text(), '# Docs');
  assert.equal(proxy(req('Mozilla')).headers.get('vary'), 'RSC, Accept, User-Agent');
});


test('runtime and static routing agree with the pinned Mintlify examples', async () => {
  const handle = createMarkdownHandler({ resolve: () => '# Docs', userAgents: true });
  const pages = [{ route: '/docs', markdown: '/docs.md', file: 'docs.html' }];
  const routes = routesFor(pages, pages, { userAgents: true }).filter(r => r.has?.some(h => h.key === 'user-agent'));
  const headers = routes.map(route => {
    const pattern = route.has[0].value;
    assert.ok(pattern.length <= 4096);
    return new RegExp(`^(?:${pattern})$`);
  });
  const examples = agents.flatMap(agent => agent.examples ?? []);
  for (const ua of [...examples, 'curl/8', 'axios/1', 'Mozilla/5.0', 'prefix claude-code/2']) {
    const expected = patterns.agent.test(ua) || patterns['ai-crawler'].test(ua) || /curl\//i.test(ua);
    for (const value of [ua, ua.toUpperCase()]) {
      assert.equal(headers.some(header => header.test(value)), expected, value);
      assert.equal(Boolean(await handle(req(value))), expected, value);
    }
  }
});


test('bundled middleware patterns match the pinned upstream dataset', async () => {
  const { patterns: bundled } = await import('../src/agent-patterns.js');
  for (const key of ['agent', 'ai-crawler']) {
    assert.equal(bundled[key].source, patterns[key].source);
    assert.equal(bundled[key].flags, patterns[key].flags);
  }
});
