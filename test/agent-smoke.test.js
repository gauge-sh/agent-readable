import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createSmokeServer, selectSmokeAgent } from '../examples/agent-smoke/server.mjs';

test('each Markdown page carries only its own marker', async t => {
  const markers = { '/': 'AR-SMOKE-home', '/pricing': 'AR-SMOKE-pricing', '/docs': 'AR-SMOKE-docs' };
  const server = createSmokeServer({ origin: 'http://example.test', markers });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [path, marker] of Object.entries(markers)) {
    const html = await fetch(origin + path, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    assert.ok(!(await html.text()).includes(marker));
    const md = await fetch(origin + path, { headers: { 'User-Agent': 'curl/8' } });
    assert.match(md.headers.get('content-type'), /^text\/markdown/);
    const body = await md.text();
    assert.deepEqual(Object.values(markers).filter(value => body.includes(value)), [marker]);
    const rejected = await fetch(origin + path, { headers: { 'User-Agent': 'curl/8', Accept: 'text/markdown;q=0' } });
    assert.ok(!(await rejected.text()).includes(marker));
  }
  const missing = await fetch(origin + '/missing.md');
  assert.equal(missing.status, 404);
  assert.doesNotMatch(await missing.text(), /AR-SMOKE/);
});


test('smoke agent selection keeps harness and credential instructions aligned', () => {
  assert.equal(selectSmokeAgent().id, 'CODEX_CLI');
  for (const name of ['claude-code', 'claude', 'CLAUDE_CODE']) {
    const agent = selectSmokeAgent(name);
    assert.equal(agent.id, 'CLAUDE_CODE');
    assert.match(agent.setup, /ANTHROPIC_API_KEY/);
    assert.doesNotMatch(agent.setup, /codex login/);
  }
  assert.throws(() => selectSmokeAgent('unknown'), /Unknown agent/);
});

test('retrieval requires both page codes and a non-preflight GET for each page', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-smoke-check-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const markers = { '/pricing': 'pricing-code', '/docs': 'docs-code' };
  await writeFile(path.join(dir, 'expected.json'), JSON.stringify({ markers }));
  const requests = Object.keys(markers).map(path => ({
    path, method: 'GET', status: 200, preflight: false, accept: '*/*',
    userAgent: 'curl/8', contentType: 'text/markdown',
  }));
  const script = fileURLToPath(new URL('../examples/agent-smoke/check.mjs', import.meta.url));
  async function verify(output, requests) {
    const trace = path.join(dir, 'trace.json');
    await writeFile(trace, JSON.stringify({ payload: { type: 'tool_result', output } }));
    await writeFile(path.join(dir, 'requests.jsonl'), requests.map(r => JSON.stringify(r)).join('\n'));
    return spawnSync(process.execPath, [script, trace], {
      env: { ...process.env, SMOKE_STATE_DIR: dir }, encoding: 'utf8',
    });
  }
  const both = Object.values(markers).join(' ');
  const pass = await verify(both, requests);
  assert.equal(pass.status, 0, pass.stderr);
  assert.match((await verify('pricing-code pricing-code', requests)).stderr, /Missing Markdown body for \/docs/);
  for (const override of [{ method: 'HEAD' }, { preflight: true }]) {
    const failure = await verify(both, [requests[0], { ...requests[1], ...override }]);
    assert.match(failure.stderr, /No automatic user-agent Markdown request for \/docs/);
  }
});
