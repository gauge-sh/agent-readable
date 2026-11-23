import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { userAgentMatchers } from '../../src/user-agents.js';
const defaultAgents = userAgentMatchers(true);
const state = process.env.SMOKE_STATE_DIR || '.gauge/agent-smoke';
const expected = JSON.parse(readFileSync(`${state}/expected.json`, 'utf8'));
if (process.argv[2]) {
  const trace = readFileSync(process.argv[2], 'utf8');
  const events = trace.trim().split('\n').filter(Boolean).map(JSON.parse);
  const results = events.filter(event => event.payload?.type === 'tool_result');
  const requests = readFileSync(`${state}/requests.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  for (const path of ['/pricing', '/docs']) {
    assert.ok(results.some(event => String(event.payload.output).includes(expected.markers[path])),
      `Missing Markdown body for ${path} in recorded tool output`);
    assert.ok(requests.some(r => r.method === 'GET' && !r.preflight && r.path === path && r.status === 200
      && /^text\/markdown/.test(r.contentType) && !/markdown/i.test(r.accept)
      && defaultAgents.some(matcher => matcher.test(r.userAgent))), `No automatic user-agent Markdown request for ${path}`);
  }
  console.log('PASS: both page markers appear in agent trace, and both clean URLs were automatically served as Markdown. The final answer need not mention the marker.');
} else {
  const origin = process.env.SMOKE_CHECK_ORIGIN || `http://127.0.0.1:${new URL(expected.origin).port || 43909}`;
  for (const [path, marker] of Object.entries(expected.markers)) {
    for (const [ua, accept, markdown] of [['Mozilla/5.0', '*/*', false], ['curl/8', '*/*', true], ['claude-code/2.1', '*/*', true], ['ChatGPT-User/1.0', '*/*', true], ['OAI-SearchBot/1.0', '*/*', true], ['curl/8', 'text/markdown;q=0', false]]) {
      const r = await fetch(origin + path, { headers: { 'User-Agent': ua, Accept: accept, 'X-Smoke-Preflight': '1' } });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type').startsWith('text/markdown'), markdown);
      assert.equal((await r.text()).includes(marker), markdown);
      assert.ok(r.headers.get('vary').includes('User-Agent'));
    }
    const suffix = path === '/' ? '/index.md' : `${path}.md`;
    assert.ok((await (await fetch(origin + suffix, { headers: { 'X-Smoke-Preflight': '1' } })).text()).includes(marker));
  }
  console.log('PASS: all pages carry the marker only in Markdown; browsers, agent routing, q=0 and direct .md URLs verified.');
}
