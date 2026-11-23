# Prove a coding agent received Markdown

Each page gets its own random code at server startup. Only its Markdown response contains that code.

The agent receives only two ordinary page URLs and a request to summarize the
product and pricing. It is never told about the marker or smoke test. It is not told to use curl, set an Accept header, or request
`.md` URLs. The request log establishes whether automatic user-agent routing
actually happened. The example uses the real Node adapter, not mocked responses.

## One-command run

From a checkout of this repository:

```sh
npm ci
npm run smoke:agent
```

To use Claude Code instead:

```sh
npm run smoke:agent -- --agent claude-code
```

`--agent codex` is the default. Each option uses its own Gauge credential check
and configured default model. For Claude Code, sign in with `claude`, supply
`ANTHROPIC_API_KEY`, or use a compatible Gauge credential profile.

Requires Node.js 22.12+, npm, Docker installed and running, and an existing login for the selected agent (or configured Gauge credentials). If Gauge is absent, it uses the pinned CLI version 0.34.0 through
npm's cache without a global install. Missing Docker and authentication require
manual setup; the command explains what is missing.

The script initializes private Gauge state, pulls a missing runtime image,
starts the site on an available port, checks Docker-to-host connectivity, previews
credentials, runs one local session with the selected agent, verifies actual tool output and HTTP
request logs, and publishes a narrowly scoped machine-verifier analysis to Gauge.
The demo server is stopped on completion, failure, timeout, or Ctrl+C; an active
batch is cancelled on interruption. The read-only Gauge viewer remains available.

The task is an ordinary request to read the site's pricing/docs and summarize the
product and cost. Neither the task nor any supplied files reveal the fresh marker.
Agent usage may be billed by your coding-agent provider; this is not a hosted
Gauge run. Model selection uses the selected agent’s configured default.

Check setup without launching a coding agent:

```sh
npm run smoke:agent -- --check-only
npm run smoke:agent -- --agent claude-code --check-only
```

Each invocation keeps separate evidence in `.gauge/agent-smoke/runs/<timestamp>/`.
The command prints the directory, batch/run IDs, and a trace inspection command.
A successful agent exit is insufficient: the runner exits nonzero unless fresh
smoke copy appears in recorded tool results and both clean page URLs received
Markdown automatically with a matching User-Agent and no Markdown Accept header.
The machine analysis covers that criterion only; it does not claim semantic review
of the answer or general session-friction analysis.

Docker Desktop uses `host.docker.internal`. On Linux the script discovers the
Docker bridge gateway. It checks the connection from a real container before
spending an agent session. For remote/custom Docker networking, override the
reachable origin and matching local port:

```sh
PORT=43909 SMOKE_AGENT_ORIGIN=http://HOST_REACHABLE_FROM_DOCKER:43909 npm run smoke:agent
```

Use `SMOKE_TIMEOUT_MS` to change the session deadline (default ten minutes).
The demo binds to `0.0.0.0` so Docker can reach it. Native Windows shells are not
validated; use a Linux environment such as WSL with Docker configured there.

## Manual workflow

To inspect or customize individual steps, start the server yourself:

```sh
gauge instructions
gauge init --local
gauge instructions run
node examples/agent-smoke/server.mjs
```

In a second terminal, from the repository root:

```sh
node examples/agent-smoke/check.mjs
gauge run --local --apply .gauge/agent-smoke/case.json --dry-run -o json
gauge watch --local
gauge run --local --apply .gauge/agent-smoke/case.json --detach --yes -o json
```

For manual Claude Code cases, start the server with `SMOKE_AGENT=claude-code`.
Manual mode uses port 43909 and `.gauge/agent-smoke/` by default. Set
`SMOKE_STATE_DIR` consistently for the server and checker to use another evidence
directory. Stop the manually started server with Ctrl+C when finished.

## Inspect actual evidence

Use the batch ID returned by the launch; then the run ID returned by status:

```sh
gauge run wait --batch BATCH_ID --local -o json
gauge run status --batch BATCH_ID --local -o json
gauge run get RUN_ID --logs --local -o json > .gauge/agent-smoke/trace.json
node examples/agent-smoke/check.mjs .gauge/agent-smoke/trace.json
gauge instructions session-analysis --local
```

The checker requires a GET to each clean page URL to have received a 200 Markdown
response, a matching default user agent, and no explicit Markdown Accept header.
It also requires each page’s distinct code to appear in recorded tool output from the
agent. The final summary does not need to repeat the marker: this test measures
whether the agent received the Markdown-only content, not whether it chose to
mention every line. A session completing successfully alone is not a pass.

Follow the session-analysis instructions to judge the frozen criterion, publish
structured analysis with `gauge run analysis save`, and retain evidence sequence
references. Execution completion and a Markdown report alone do not mark a
Gauge session analyzed.

Evidence stays in ignored `.gauge/agent-smoke/`:

- `expected.json`: per-page codes and origin.
- `case.json`: portable generated task and success criterion, without the code.
- `requests.jsonl`: request methods, paths, user agents, Accept headers, status,
  content types, and Vary headers. No credentials or cookies are recorded.
- `trace.json`: exported session evidence; keep raw traces private.

Restarting the server regenerates the code and clears the request log, so archive
any evidence you want to retain before restarting. Stop the server with Ctrl+C
when finished. `gauge watch stop --local` stops the optional viewer.

This proves local runtime delivery and agent retrieval for this session. It does
not verify Vercel CDN behavior or guarantee every agent uses a recognized user
agent. If the agent uses an unrecognized client, it can legitimately receive
HTML; inspect the trace rather than changing the result to pass.
