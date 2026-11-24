#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { init, build, check, checkLocal, setupVercel } from './index.js';

function parseHeaderFlags(entries = []) {
  const headers = {};
  for (const raw of entries) {
    const sep = raw.indexOf(':');
    if (sep <= 0) throw new Error(`Invalid --header value (expected "Name: Value"): ${raw}`);
    const key = raw.slice(0, sep).trim();
    const value = raw.slice(sep + 1).trim();
    if (!key || /[\r\n]/.test(key) || /[\r\n]/.test(value)) throw new Error(`Invalid --header value: ${raw}`);
    headers[key] = value;
  }
  return headers;
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    cwd: { type: 'string' }, input: { type: 'string' }, 'build-command': { type: 'string' }, site: { type: 'string' }, path: { type: 'string', multiple: true },
    manifest: { type: 'string' }, local: { type: 'boolean' }, header: { type: 'string', multiple: true }, 'skip-heading-check': { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  const cwd = path.resolve(values.cwd || process.cwd());
  const [command, target] = positionals;
  if (values.help || !command) {
    console.log(`agent-readable\n\n  init --site https://example.com [--input out] [--cwd dir]\n  setup-vercel --build-command "<static site build command>" [--cwd dir]\n  build [--cwd dir]\n  check https://example.com [--path /docs] [--manifest file] [--header "Name: Value"] [--skip-heading-check] [--json]\n  check --local [--cwd dir] [--path /docs] [--skip-heading-check] [--json]\n\nBuild expects a static HTML export, default: out/.\nOutput: .vercel/output, deployable with vercel deploy --prebuilt.\nCheck defaults to /; use --manifest or --local to check every generated page.`);
  } else if (command === 'init') {
    if (!values.site) throw new Error('init requires --site https://example.com');
    await init(cwd, values.site, values.input);
    console.log('Created agent-readable.json. Build your static site, then run agent-readable build.');
  } else if (command === 'setup-vercel') {
    await setupVercel(cwd, values['build-command']);
    console.log('Configured vercel.json for static Git builds. Commit it with agent-readable.json. The supplied command must produce static HTML and must not run agent-readable itself.');
  } else if (command === 'build') {
    const result = await build(cwd);
    console.log(`Generated ${result.pages.length} Markdown pages; skipped ${result.skipped.length}.\nVercel artifact: ${path.join(cwd, '.vercel/output')}`);
  } else if (command === 'check') {
    const headers = parseHeaderFlags(values.header);
    let result;
    if (values.local) {
      result = await checkLocal(cwd, { paths: values.path, skipHeadingCheck: values['skip-heading-check'], headers });
    } else {
      if (!target) throw new Error('check requires a site URL (or pass --local to verify .vercel/output)');
      let paths = values.path;
      let manifest;
      if (values.manifest) {
        manifest = JSON.parse(await readFile(path.resolve(cwd, values.manifest), 'utf8'));
        paths = manifest.pages.map(p => p.route);
      }
      result = await check(target, paths, { manifest, skipHeadingCheck: values['skip-heading-check'], headers });
    }
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else for (const page of result.pages) {
      console.log(`${page.ok ? 'PASS' : 'FAIL'} ${page.url}`);
      for (const item of page.checks) console.log(`  ${item.ok ? '✓' : '✗'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
    }
    if (!result.ok) process.exitCode = 1;
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) { console.error(`agent-readable: ${error.message}`); process.exitCode = 1; }
