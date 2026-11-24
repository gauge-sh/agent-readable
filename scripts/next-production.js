import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const root = await mkdtemp(path.join(tmpdir(), 'ar-next-production-'));
const npm = (args, cwd, extra = {}) => execFileSync('npm', args, { cwd, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, ...extra });
try {
  const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', root], process.cwd(), { stdio: 'pipe', encoding: 'utf8' }));
  for (const [next, react, babel] of [['14.2.3', '18.3.1'], ['14.2.3', '18.3.1', true], ['16.4.6', '19.2.4']]) {
    const cwd = path.join(root, next + (babel ? '-babel' : ''));
    await mkdir(path.join(cwd, 'app/api/markdown'), { recursive: true });
    await mkdir(path.join(cwd, 'app/llms.txt'), { recursive: true });
    const socket = createServer().listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ private: true, dependencies: { ...(babel ? { '@babel/runtime': '7.26.10' } : {}), next, react, 'react-dom': react, 'agent-readable': `file:${path.join(root, packed.filename)}` } }));
    await writeFile(path.join(cwd, 'next.config.mjs'), `export default { experimental: { cpus: 2${babel ? ", serverComponentsExternalPackages: ['agent-readable']" : ''} } };`);
    await writeFile(path.join(cwd, 'app/layout.js'), `${next.startsWith('14.') ? "export const dynamic = 'force-dynamic';" : ''} export default function Layout({children}) {return <html><body>{children}</body></html>}`);
    await writeFile(path.join(cwd, 'app/page.js'), 'export default function Page() {return <main><h1>Automatic source heading</h1><p data-agent-hidden>Decorative UI</p><p data-agent-only hidden>Agent instructions</p></main>}');
    await writeFile(path.join(cwd, 'app/llms.txt/route.js'), `export function GET() { return new Response('# Existing app llms.txt\\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }`);
    if (babel) await writeFile(path.join(cwd, '.babelrc'), JSON.stringify({ presets: ['next/babel'] }));
    const name = next.startsWith('14.') ? 'middleware' : 'proxy';
    await writeFile(path.join(cwd, `${name}.js`), `import {NextResponse} from 'next/server'; import {defineNextMarkdown} from 'agent-readable/next'; export const ${name} = defineNextMarkdown({userAgents:{exclude:['curl/']}}).proxy(NextResponse); export const config={matcher:['/((?!_next/|favicon\\\\.).*)']};`);
    await writeFile(path.join(cwd, 'app/api/markdown/route.js'), `import {defineNextMarkdown} from 'agent-readable/next'; import {createHtmlMarkdownResolver} from 'agent-readable/html'; const resolveHtml=createHtmlMarkdownResolver({origin:${JSON.stringify(origin)}}); const handle=defineNextMarkdown({userAgents:{exclude:['curl/']}}).route({resolve: async ctx => {const md=await resolveHtml(ctx); return md === null ? null : md+'\\nQuery: '+ctx.searchParams.getAll('q').join(',')+'\\nCookie: '+ctx.request.headers.get('cookie');}}); export const GET=handle; export const HEAD=handle; export const runtime='nodejs'; export const dynamic='force-dynamic';`);
    npm(['install', '--no-audit', '--no-fund'], cwd);
    // Verify createNextMarkdownTester against the real NextResponse exported by this Next.js version.
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { NextResponse } from 'next/server.js';
      import { defineNextMarkdown, createNextMarkdownTester } from 'agent-readable/next';
      const md = defineNextMarkdown({ userAgents: { exclude: ['curl/'] } });
      const run = createNextMarkdownTester({
        proxy: md.proxy(NextResponse),
        route: md.route({ resolve: ({ pathname, searchParams }) => '# ' + pathname + ' ' + searchParams.get('q') }),
        fallback: req => new Response('html:' + req.headers.has('x-agent-readable-target'), { headers: { 'Content-Type': 'text/html' } }),
      });
      const mdRes = await run('https://example.com/docs?q=ok', { headers: { 'User-Agent': 'claude-code/2.0' } });
      assert.equal(mdRes.status, 200);
      assert.equal(await mdRes.text(), '# /docs ok');
      const curlRes = await run('https://example.com/docs', { headers: { 'User-Agent': 'curl/8', 'x-agent-readable-target': 'spoof' } });
      assert.equal(await curlRes.text(), 'html:false');
      assert.match(curlRes.headers.get('link'), /\\/docs\\.md/);
    `], { cwd, stdio: 'inherit' });
    npm(['exec', '--', 'next', 'build', ...(name === 'proxy' ? ['--webpack'] : [])], cwd);
    const child = spawn(process.execPath, [path.join(cwd, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd, stdio: 'inherit' });
    try {
      let ready = false;
      for (let i = 0; i < 120; i++) {
        try { const response = await fetch(origin); await response.body?.cancel(); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      assert.ok(ready, 'Next server started');
      for (const [url, headers] of [
        ['/?q=one&q=two', { Accept: 'text/markdown', Cookie: 'session=test', 'x-agent-readable-target': 'spoofed' }],
        ['/index.md?q=one&q=two', { Accept: '*/*', Cookie: 'session=test', 'x-agent-readable-target': 'spoofed' }],
        ['/?q=one&q=two', { Accept: 'text/html', 'User-Agent': 'claude-code/2.0', Cookie: 'session=test', 'x-agent-readable-target': 'spoofed' }],
      ]) {
        const response = await fetch(origin + url, { headers });
        assert.equal(response.status, 200, `${next} ${url}`);
        assert.match(response.headers.get('content-type'), /text\/markdown/);
        assert.match(response.headers.get('vary'), /Accept/i);
        const body = await response.text();
        assert.match(body, /Automatic source heading/); assert.match(body, /Agent instructions/); assert.doesNotMatch(body, /Decorative UI/);
        assert.match(body, /Query: one,two/); assert.match(body, /Cookie: session=test/);
      }
      for (const [accept, ua] of [['text/html', 'Mozilla/5.0'], ['text/html', 'curl/8'], ['text/html, text/markdown;q=0', 'claude-code/2.0']]) {
        const response = await fetch(origin, { headers: { Accept: accept, 'User-Agent': ua } });
        assert.match(response.headers.get('content-type'), /text\/html/);
        assert.match(response.headers.get('cache-control'), /no-store/);
        await response.body?.cancel();
      }
      // Default index: false preserves the app's own /llms.txt route.
      const llms = await fetch(origin + '/llms.txt');
      assert.equal(llms.status, 200);
      assert.equal(await llms.text(), '# Existing app llms.txt\n');
      // Direct /api/markdown requests fail closed even with a spoofed target header.
      const directApi = await fetch(origin + '/api/markdown', { headers: { 'x-agent-readable-target': btoa(JSON.stringify(['/', ''])) } });
      assert.equal(directApi.status, 404);
      await directApi.body?.cancel();
      const missing = await fetch(origin + '/missing.md'); assert.equal(missing.status, 404); await missing.body?.cancel();
      const head = await fetch(origin + '/index.md', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
      console.log(`PASS Next.js ${next}${babel ? ' (Babel)' : ''}: packed install, production build, automatic HTML conversion, controls, negotiated/direct/UA Markdown, curl exclude, default llms.txt preservation, query/cookies, cache safety, q=0, HEAD, tester helper, and 404.`);
    } finally { child.kill('SIGTERM'); await once(child, 'exit'); }
  }
} finally { await rm(root, { recursive: true, force: true }); }
