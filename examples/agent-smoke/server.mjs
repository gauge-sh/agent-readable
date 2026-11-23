import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createNodeMarkdownHandler } from '../../src/node.js';

export function selectSmokeAgent(value = 'codex') {
  switch (value.toLowerCase()) {
    case 'codex': case 'codex_cli':
      return { id: 'CODEX_CLI', label: 'Codex', setup: 'Run codex login or configure a Gauge credential profile.' };
    case 'claude': case 'claude-code': case 'claude_code':
      return { id: 'CLAUDE_CODE', label: 'Claude Code', setup: 'Sign in with claude, set ANTHROPIC_API_KEY, or configure a Gauge credential profile.' };
    default: throw new Error('Unknown agent. Choose --agent codex or --agent claude-code.');
  }
}

const pages = {
  '/': { title: 'Example product', body: 'Explore our [pricing](/pricing) and [documentation](/docs).' },
  '/pricing': { title: 'Pricing', body: 'The example plan costs $20 per month. This is demo pricing, not a real offer.' },
  '/docs': { title: 'Documentation', body: 'The example product supports a free local demo.' },
};
// Each page gets independent evidence of retrieval.
export function withVerification(body, marker) {
  return `${body}\n\n---\n\n## Markdown verification\n\nVerification code: \`${marker}\`. This is a smoke-test marker, not a discount.\n`;
}
export function createSmokeServer({ origin, markers, record = () => {} }) {
  const handle = createNodeMarkdownHandler({
    origin,
    userAgents: true,
    resolve: ({ pathname }) => pages[pathname]
      ? withVerification(`# ${pages[pathname].title}\n\n${pages[pathname].body}`, markers[pathname]) : null,
  }, (req, res) => {
    const pathname = new URL(req.url, origin).pathname;
    const page = pages[pathname];
    res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : `<!doctype html><title>${page?.title || 'Not found'}</title><h1>${page?.title || 'Not found'}</h1><p>${page?.body || 'No such page.'}</p>`);
  });
  return createServer((req, res) => {
    res.on('finish', () => record({
      timestamp: new Date().toISOString(), path: req.url, method: req.method,
      userAgent: req.headers['user-agent'] || '', accept: req.headers.accept || '',
      preflight: req.headers['x-smoke-preflight'] === '1', status: res.statusCode,
      contentType: res.getHeader('Content-Type'), vary: res.getHeader('Vary'),
    }));
    handle(req, res).catch(error => { console.error(error); if (!res.headersSent) res.writeHead(500); res.end(); });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const agent = selectSmokeAgent(process.env.SMOKE_AGENT);
  const port = Number(process.env.PORT || 43909);
  const origin = process.env.SMOKE_AGENT_ORIGIN || `http://host.docker.internal:${port}`;
  const state = process.env.SMOKE_STATE_DIR || '.gauge/agent-smoke';
  mkdirSync(state, { recursive: true });
  const markers = Object.fromEntries(Object.keys(pages).map(path => [path, `AR-SMOKE-${randomBytes(12).toString('hex')}`]));
  const caseSpec = { version: 2, cases: [{
    key: 'markdown-user-agent-smoke',
    prompt: `Read the pricing and documentation pages at ${origin}/pricing and ${origin}/docs, then summarize what the product offers and how much it costs.`,
    criteria: [{ name: 'Markdown reached the agent', rubric: 'The recorded page content for both requested URLs contains the fresh Markdown-only smoke-test copy held by the local server. Server request logs confirm automatic user-agent routing for both clean URLs. Judge retrieval evidence, not whether the final summary repeats the marker.' }],
    config: { agents: [{ agent: agent.id, models: [] }], sampleCount: 1 },
  }] };
  writeFileSync(`${state}/expected.json`, JSON.stringify({ markers, origin }, null, 2) + '\n');
  writeFileSync(`${state}/case.json`, JSON.stringify(caseSpec, null, 2) + '\n');
  writeFileSync(`${state}/requests.jsonl`, '');
  const server = createSmokeServer({ origin, markers, record: entry => appendFileSync(`${state}/requests.jsonl`, JSON.stringify(entry) + '\n') });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Smoke site listening on port ${port}; case and private evidence in ${state}/.\nAgent URLs use ${origin}. Keep this server running during the local Gauge session.`);
    process.send?.({ ready: true });
  });
}
