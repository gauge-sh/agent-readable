#!/usr/bin/env node
import { spawn, fork } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { selectSmokeAgent } from './server.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const { values } = parseArgs({ options: { agent: { type: 'string', default: 'codex' }, 'check-only': { type: 'boolean' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log(`Usage: npm run smoke:agent -- [--agent codex|claude-code] [--check-only]

Starts the demo, checks Docker and agent credentials, installs Gauge CLI into
npm's cache if needed, pulls a missing Gauge runtime, runs one local coding-agent
session, verifies Markdown evidence, and saves the result. Agent usage may
be billed by your coding-agent provider. Docker must already be running.

--agent            codex (default) or claude-code. Uses that agent’s default model.
--check-only       Check all prerequisites and HTTP behavior without an agent run.
SMOKE_AGENT_ORIGIN Override the origin reachable from Docker (optional).
PORT               Set the demo port; otherwise an available port is selected.
SMOKE_TIMEOUT_MS   Session timeout (default: 600000).

Evidence is preserved under .gauge/agent-smoke/runs/. Ctrl+C cancels the batch
and stops the demo. Agent login and Docker installation are never automated.`);
  process.exit(0);
}
const agent = selectSmokeAgent(values.agent);
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 12)) throw new Error('Use Node.js 22.12 or newer for the Gauge CLI.');
const checkOnly = values['check-only'];
const timeout = Number(process.env.SMOKE_TIMEOUT_MS || 600000);
if (!Number.isFinite(timeout) || timeout < 1000) throw new Error('SMOKE_TIMEOUT_MS must be at least 1000.');
const runKey = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const state = path.join(root, '.gauge/agent-smoke/runs', runKey);
let site, batchId, settled = false, stopping = false, gaugeBin = 'gauge', gaugePrefix = [];
const running = new Set();
const env = { ...process.env, SMOKE_STATE_DIR: state, SMOKE_AGENT: agent.id };

function command(bin, argv, { limit = 120000, inherit = false, commandEnv = env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { cwd: root, env: commandEnv, stdio: ['ignore', inherit ? 'inherit' : 'pipe', 'pipe'], shell: false });
    running.add(child);
    let stdout = '', stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, limit);
    child.once('error', error => { clearTimeout(timer); running.delete(child); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); running.delete(child);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} ${argv.join(' ')} failed (${signal || code}).\n${stderr || stdout}`));
    });
  });
}
const gauge = (argv, options) => command(gaugeBin, [...gaugePrefix, ...argv], options);
const json = text => JSON.parse(text);
async function cleanup() {
  if (batchId && !settled) {
    try { await gauge(['run', 'cancel', '--batch', batchId, '--local', '-o', 'json'], { limit: 30000 }); }
    catch (error) { console.error(`Could not confirm batch cancellation: ${error.message}`); }
  }
  for (const child of running) child.kill('SIGTERM');
  if (site && site.exitCode === null && site.signalCode === null) {
    const closed = once(site, 'exit');
    site.kill('SIGTERM');
    await closed;
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  stopping = true;
  console.error('\nStopping the local smoke test...');
  await cleanup();
  process.exit(signal === 'SIGINT' ? 130 : 143);
});

try {
  try { await command('docker', ['info', '--format', '{{.ServerVersion}}']); }
  catch { throw new Error('Docker is unavailable. Install/start Docker Desktop (or Docker Engine), then rerun this command.'); }
  try { await command('gauge', ['--version']); }
  catch {
    gaugeBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    gaugePrefix = ['exec', '--yes', '--package=@withgauge/cli@0.34.0', '--', 'gauge'];
    console.log('Using Gauge CLI 0.34.0 via npm cache (no global install).');
    await gauge(['--version']);
  }
  await gauge(['init', '--local', '-o', 'json']);
  let runtime = json(await gauge(['local', 'runtime', 'inspect', '-o', 'json']));
  if (!runtime.ready) {
    console.log('Pulling the local Gauge runtime...');
    await gauge(['local', 'runtime', 'pull'], { limit: 600000, inherit: true });
    runtime = json(await gauge(['local', 'runtime', 'inspect', '-o', 'json']));
  }
  if (!runtime.ready || !runtime.imageId) throw new Error('Gauge runtime is not ready; run gauge local runtime inspect.');
  let port = Number(process.env.PORT || (process.env.SMOKE_AGENT_ORIGIN ? new URL(process.env.SMOKE_AGENT_ORIGIN).port : 0));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  if (!port) {
    const reservation = createServer();
    reservation.listen(0, '0.0.0.0');
    await once(reservation, 'listening');
    port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
  }
  let host = 'host.docker.internal';
  if (process.platform === 'linux' && !process.env.SMOKE_AGENT_ORIGIN) {
    host = (await command('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'])).trim();
    if (!host) throw new Error('Cannot discover the Docker host. Set SMOKE_AGENT_ORIGIN to a reachable HTTP origin.');
  }
  const origin = process.env.SMOKE_AGENT_ORIGIN || `http://${host}:${port}`;
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('SMOKE_AGENT_ORIGIN must be an HTTP(S) origin without credentials or a path.');
  Object.assign(env, { PORT: String(port), SMOKE_AGENT_ORIGIN: origin, SMOKE_CHECK_ORIGIN: `http://127.0.0.1:${port}` });
  mkdirSync(state, { recursive: true });
  site = fork(path.join(root, 'examples/agent-smoke/server.mjs'), [], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Demo server did not become ready.')), 15000);
    site.once('error', error => { clearTimeout(timer); reject(error); });
    site.once('exit', code => { clearTimeout(timer); reject(new Error(`Demo server exited (${code}). Check PORT.`)); });
    site.once('message', message => { clearTimeout(timer); message.ready ? resolve() : reject(new Error('Invalid server readiness message.')); });
  });
  await command(process.execPath, ['examples/agent-smoke/check.mjs'], { inherit: true });
  try {
    await command('docker', ['run', '--rm', '--entrypoint', 'node', runtime.imageId, '-e',
      'fetch(process.argv[1], {headers:{"X-Smoke-Preflight":"1"},signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status)}).catch(e=>{console.error(e.message);process.exit(1)})', `${origin}/pricing`], { limit: 20000 });
  } catch { throw new Error(`Docker cannot reach ${origin}. Set SMOKE_AGENT_ORIGIN to this machine's Docker-reachable address (and PORT to match). Remote Docker hosts need an explicitly reachable address.`); }
  const casePath = path.join(state, 'case.json');
  const preview = json(await gauge(['run', '--local', '--apply', casePath, '--dry-run', '-o', 'json']));
  writeFileSync(path.join(state, 'preview.json'), JSON.stringify(preview, null, 2));
  if (preview.error || !preview.credentials?.length || preview.credentials.some(c => !c.ready)) throw new Error(`${agent.label} credentials are not ready. ${agent.setup} Then rerun.`);
  if (checkOnly) {
    console.log(`PASS: prerequisites, Docker connectivity, and Markdown checks. No agent launched.\nEvidence: ${state}`);
  } else {
    const task = json(readFileSync(casePath, 'utf8')).cases[0];
    console.log(`Task: ${task.prompt}\nCriterion: ${task.criteria[0].rubric}\nOne local Docker session: ${agent.label} / ${preview.cases[0].sessions[0].model}.`);
    const viewer = json(await gauge(['watch', '--local', '-o', 'json']));
    console.log(`   ⢰⣧\n  ⣠⣿⣿⠶⢤⡀\n⢀⣴⣿⣿⣿⣶⣾⣿⣶⣶⣶  Watch running sessions: ${viewer.url}\n⠙⢿⣿⣿⣿⣿⣿⣿⣿⡿⠋\n ⠈⠻⡿⠟⠉⠉⠉⠉`);
    const launch = json(await gauge(['run', '--local', '--apply', casePath, '--detach', '--yes', '-o', 'json']));
    batchId = launch.batchId;
    writeFileSync(path.join(state, 'launch.json'), JSON.stringify(launch, null, 2));
    if (!batchId) throw new Error('Gauge returned no batch ID. Inspect launch.json before retrying.');
    const result = json(await gauge(['run', 'wait', '--batch', batchId, '--local', '-o', 'json'], { limit: timeout }));
    writeFileSync(path.join(state, 'result.json'), JSON.stringify(result, null, 2));
    settled = result.batch?.state === 'completed';
    if (!settled || result.runs?.length !== 1 || result.runs[0].state !== 'completed') throw new Error('Gauge session did not complete successfully; inspect result.json.');
    const runId = result.runs[0].id;
    const trace = await gauge(['run', 'get', runId, '--logs', '--local', '-o', 'json']);
    const tracePath = path.join(state, 'trace.json');
    writeFileSync(tracePath, trace);
    await command(process.execPath, ['examples/agent-smoke/check.mjs', tracePath], { inherit: true });
    const { markers } = json(readFileSync(path.join(state, 'expected.json'), 'utf8'));
    const evidence = trace.trim().split('\n').map(json).filter(e => e.payload?.type === 'tool_result' && ['/pricing', '/docs'].some(path => String(e.payload.output).includes(markers[path]))).map(e => ({ kind: 'trace', seq: e.seq }));
    const run = json(await gauge(['run', 'get', runId, '--local', '-o', 'json']));
    const analysis = { schemaVersion: 1, attempt: run.attempt, instructionsVersion: 'agent-smoke-machine-verifier-v2', analyst: { name: 'agent-readable smoke verifier' }, assessability: 'ASSESSED', limitation: 'Automated check of Markdown delivery only; no semantic review of the final summary or general friction analysis. One local session, not CDN verification.', selection: 'NOT_MEASURED', directed: false, findings: [], products: [], criteria: [{ criterionId: run.configuration.case.criteria[0].id, outcome: 'PASS', label: 'Fresh Markdown-only copy is present in tool results for the natural reading task, with automatic routing confirmed by server request logs.', evidence }] };
    const analysisPath = path.join(state, 'analysis.json');
    writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
    await gauge(['run', 'analysis', 'save', runId, '--file', analysisPath, '--local', '-o', 'json']);
    console.log(`PASS: local coding agent received the Markdown-only smoke copy.\nRun: ${runId}\nEvidence: ${state}\nInspect: gauge run trace ${runId} --seq 0 --after 30 --local`);
  }
} catch (error) {
  if (!stopping) { console.error(`FAIL: ${error.message}\nEvidence (if created): ${state}`); process.exitCode = 1; }
} finally {
  if (!stopping) await cleanup();
}
