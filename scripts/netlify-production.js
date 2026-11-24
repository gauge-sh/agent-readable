import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';

// Optional integration check: installs the pinned official CLI, runs a real build,
// and serves the production artifact in Netlify's local Deno edge runtime.
const cwd = await mkdtemp(path.join(tmpdir(), 'ar-netlify-production-'));
let child;
try {
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', cwd], { encoding: 'utf8' }));
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ private: true, scripts: { 'build:site': 'node -e "process.exit(0)"' } }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(cwd, packed.filename)], { cwd, stdio: 'inherit' });
  await mkdir(path.join(cwd, 'out'));
  await writeFile(path.join(cwd, 'out/index.html'), '<main><h1>Netlify integration</h1><p data-agent-only hidden>Agent context</p></main>');
  await writeFile(path.join(cwd, 'out/old.html'), '<main><h1>Old page</h1></main>');
  await writeFile(path.join(cwd, 'out/_redirects'), '/old / 301!\n');
  const cli = path.join(cwd, 'node_modules/agent-readable/src/cli.js');
  for (const args of [['init', '--site', 'https://example.com'], ['setup-netlify', '--build-command', 'npm run build:site']]) {
    execFileSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' });
  }
  const socket = createServer().listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const origin = `http://localhost:${port}`;
  child = spawn('npx', ['--yes', 'netlify-cli@27.20.1', 'serve', '--offline', '--port', String(port)], {
    cwd, stdio: 'inherit', detached: true, env: { ...process.env, NETLIFY_TELEMETRY_DISABLED: '1', BROWSER: 'none' },
  });
  let ready = false;
  for (let attempt = 0; attempt < 480; attempt++) {
    if (child.exitCode !== null) throw new Error('Netlify serve exited before becoming ready.');
    try { const r = await fetch(origin); await r.body?.cancel(); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(ready, 'Netlify serve started');
  for (const [route, accept, type] of [['/', 'text/html', 'text/html'], ['/', 'text/markdown', 'text/markdown'], ['/index.md', '*/*', 'text/markdown'], ['/', 'text/html, text/markdown;q=0', 'text/html']]) {
    const response = await fetch(origin + route, { headers: { Accept: accept }, signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.match(response.headers.get('x-nf-edge-functions'), /agent-readable/);
    const body = await response.text();
    if (type === 'text/markdown') assert.match(body, /Agent context/);
    else assert.doesNotMatch(body, /Agent context/);
    if (route === '/') assert.match(response.headers.get('cache-control'), /no-store/);
  }
  const redirect = await fetch(origin + '/old', { headers: { Accept: 'text/markdown' }, redirect: 'manual' });
  assert.equal(redirect.status, 301); await redirect.body?.cancel();
  const head = await fetch(origin + '/index.md', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const missing = await fetch(origin + '/missing.md'); assert.equal(missing.status, 404); await missing.body?.cancel();
  console.log('PASS Netlify production build and local edge runtime: negotiation, inline controls, cache headers, q=0, redirects, HEAD and 404.');
} finally {
  if (child?.exitCode === null) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* process already exited */ }
    await once(child, 'exit');
  }
  await rm(cwd, { recursive: true, force: true });
}
