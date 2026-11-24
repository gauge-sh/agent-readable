import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const cwd = await mkdtemp(path.join(tmpdir(), 'agent-readable-package-'));
const npm = (args, options = {}) => execFileSync('npm', args, { encoding: 'utf8', ...options });
try {
  // A publish dry-run still needs a real temporary tarball and installation.
  const [packed] = JSON.parse(npm(['pack', '--dry-run=false', '--json', '--ignore-scripts', '--pack-destination', cwd]));
  assert.ok(packed.files.some(file => file.path === 'src/cli.js'));
  for (const dts of ['src/index.d.ts', 'src/runtime.d.ts', 'src/node.d.ts', 'src/next.d.ts', 'src/next-server.d.ts', 'src/react.d.ts']) {
    assert.ok(packed.files.some(file => file.path === dts), `Missing declaration file in tarball: ${dts}`);
  }
  for (const file of packed.files) assert.match(file.path, /^(src\/|README\.md$|LICENSE$|package\.json$)/);
  await writeFile(path.join(cwd, 'package.json'), '{"private":true,"type":"module"}');
  npm(['install', '--dry-run=false', '--ignore-scripts', '--no-audit', '--no-fund', path.join(cwd, packed.filename)], { cwd });
  assert.match(npm(['exec', '--offline', '--', 'agent-readable', '--help'], { cwd }), /setup-vercel/);
  const cli = path.join(cwd, 'node_modules/agent-readable/src/cli.js');
  const run = args => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  run(['init', '--site', 'https://example.com', '--input', 'dist']);
  run(['setup-vercel', '--build-command', 'npm run build:site']);
  await mkdir(path.join(cwd, 'dist'));
  await writeFile(path.join(cwd, 'dist/index.html'), '<main><h1>Installed package</h1><div data-agent-hidden>Skip UI</div><div data-agent-only hidden><p>Agent context</p></div></main>');
  assert.match(run(['build']), /Generated 1 Markdown pages/);
  const builtMd = await readFile(path.join(cwd, '.vercel/output/static/index.md'), 'utf8');
  assert.match(builtMd, /# Installed package/);
  assert.match(builtMd, /Agent context/);
  assert.doesNotMatch(builtMd, /Skip UI/);
  const builtHtml = await readFile(path.join(cwd, '.vercel/output/static/index.html'), 'utf8');
  assert.match(builtHtml, /Skip UI/);
  assert.doesNotMatch(builtHtml, /Agent context|data-agent-only/);
  const configPath = path.join(cwd, 'agent-readable.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(path.join(cwd, 'custom.md'), '# A custom agent workflow\n');
  await writeFile(configPath, JSON.stringify({ ...config, markdown: { '/': 'custom.md' } }));
  run(['build']);
  assert.equal(await readFile(path.join(cwd, '.vercel/output/static/index.md'), 'utf8'), '# A custom agent workflow\n');
  execFileSync(process.execPath, ['--input-type=module', '-e', 'import { build, check, setupVercel } from "agent-readable"; if (![build,check,setupVercel].every(v => typeof v === "function")) process.exit(1);'], { cwd });
  execFileSync(process.execPath, ['--input-type=module', '-e', 'import { createMarkdownHandler, applyMarkdownHeaders } from "agent-readable/runtime"; const handler = createMarkdownHandler({ resolve: ({ searchParams }) => "# " + searchParams.get("q") }); const response = await handler(new Request("https://example.com/index.md?q=runtime")); if (await response.text() !== "# runtime" || typeof applyMarkdownHeaders !== "function") process.exit(1);'], { cwd });
  execFileSync(process.execPath, ['--input-type=module', '-e', 'import { createNodeMarkdownHandler } from "agent-readable/node"; if (typeof createNodeMarkdownHandler !== "function") process.exit(1);'], { cwd });
  execFileSync(process.execPath, ['--input-type=module', '-e', 'import { createNextMarkdownProxy, createNextMarkdownRoute, defineNextMarkdown, applyMarkdownHeaders } from "agent-readable/next"; import { createNextMarkdownServer } from "agent-readable/next/server"; if (![createNextMarkdownProxy, createNextMarkdownRoute, defineNextMarkdown, applyMarkdownHeaders, createNextMarkdownServer].every(value => typeof value === "function")) process.exit(1);'], { cwd });
  console.log('Packed install, CLI, exports, and artifact smoke checks passed.');
} finally { await rm(cwd, { recursive: true, force: true }); }
