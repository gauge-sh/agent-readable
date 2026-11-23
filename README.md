# agent-readable

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/gauge-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/gauge-logo-light.svg">
  <img alt="Gauge" src="docs/assets/gauge-logo-light.svg" width="800">
</picture>

[![CI](https://github.com/gauge-sh/agent-readable/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/gauge-sh/agent-readable/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933)](https://github.com/gauge-sh/agent-readable/blob/main/package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/gauge-sh/agent-readable/blob/main/LICENSE)

**Serve Markdown alongside your existing web pages.** Generate it from a static HTML export for Vercel, or serve it from your application’s own content with a Next.js or Node adapter.

Try the live demo. Open [the documentation page](https://agent-markdown-preview.vercel.app/docs) in a browser, then request its Markdown representation.

```sh
curl -i -H 'Accept: text/markdown' https://agent-markdown-preview.vercel.app/docs
```

Look for `content-type: text/markdown` in the response headers and `# Complete your first integration` in the body.

For the 0.1.0 candidate, [build the tarball](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md), then install it in your static site:

```sh
npm install --save-dev ./vendor/agent-readable-0.1.0.tgz
```

The CLI and Node adapter require Node.js 22+. No Gauge account or API key is required.

## How requests work

| Request | Response |
| --- | --- |
| Browser opens `/pricing` | Your existing HTML page (with Markdown discovery links/headers) |
| Agent fetches `/pricing.md` | Markdown for `/pricing` |
| Agent requests `/pricing` with `Accept: text/markdown` | Markdown for `/pricing` |
| Matching coding agent or crawler opens `/pricing` *(with `userAgents: true`)* | Markdown for `/pricing` automatically |
| Agent fetches `/index.md` | Markdown for the homepage |
| Agent fetches `/llms.txt` | Generated or custom site-wide Markdown index |

## Quickstart

> **Release status:** `0.1.0` is an unreleased candidate and is not yet published to npm. Build and install a local tarball first—see [installation](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md) and the [release checklist](https://github.com/gauge-sh/agent-readable/blob/main/RELEASE.md).

### Static site on Vercel

After [installing the package](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md) as a dev dependency, initialize config, build your site, and generate the Markdown output:

```sh
# 1. Create agent-readable.json pointing at your static HTML export
npx --no-install agent-readable init --site https://example.com --input out

# 2. Build your site as usual, then generate Markdown, llms.txt, and Vercel routing
npm run build
npx --no-install agent-readable build

# 3. Wire Vercel Git builds to deploy .vercel/output
npx --no-install agent-readable setup-vercel --build-command "npm run build"

# 4. Verify the deployed site
npx --no-install agent-readable check https://example.com \
  --manifest .vercel/output/.agent-readable
```

### Choose your integration

Pick the setup that matches how your site is built and hosted:

| Your setup | Integration guide | Where Markdown comes from |
| --- | --- | --- |
| Static HTML export deployed to Vercel | [Static build guide](https://github.com/gauge-sh/agent-readable/blob/main/docs/static.md) | Automatically converted from exported HTML; override any page with a custom `.md` file |
| Next.js App Router | [Next.js adapter guide](https://github.com/gauge-sh/agent-readable/blob/main/docs/next.md) | Your content callbacks; supports Proxy/route wiring or a custom Node server with final header handling |
| Persistent Node HTTP server | [Node runtime guide](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md#node-http-server) | Your `resolve` function (renderers, files, CMS, or database) |
| Custom Web `Request` / `Response` adapter | [Web runtime guide](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md#web-requestresponse-adapter) | Your `resolve` function; your adapter also sets final HTML discovery and `Vary` headers |
| Managed SSR/serverless without a custom server | No ready-made integration yet | Requires a host-specific runtime adapter; the static build tool cannot preserve an SSR app |

The static build has been tested with Next.js static exports and Eleventy. Astro and Hugo are compatible in principle when they emit static HTML. The Next.js App Router custom server has been verified locally. With Proxy alone, the tested Next.js version overwrites the final HTML `Vary: Accept` header.

## Custom Markdown overrides

You do not have to serve a literal conversion of your HTML. When a page relies on visual layout or interactive controls—like a pricing matrix or product tour—you can write a dedicated Markdown version tailored for agents.

- **Static sites:** Map any page route to a local `.md` file in `agent-readable.json`. Unmapped pages still convert from HTML automatically:

```json
{
  "site": "https://example.com",
  "input": "out",
  "userAgents": true,
  "markdown": {
    "/pricing": "agent-content/pricing.md"
  }
}
```

- **Runtime servers:** Return your chosen Markdown string directly from the `resolve` callback. Runtime handlers serve your returned text verbatim and do not convert SSR HTML automatically.

See [custom Markdown](https://github.com/gauge-sh/agent-readable/blob/main/docs/custom-markdown.md) for route rules, examples, and verification behavior.

## Automatic User-Agent routing

Many coding agents and AI crawlers fetch regular page URLs without appending `.md` or sending `Accept: text/markdown`. Setting `userAgents: true` enables automatic User-Agent negotiation so matching agents receive Markdown on normal URLs while browsers still receive HTML.

- **Default matches (when enabled):** [Mintlify’s agent and AI-crawler patterns](https://github.com/mintlify/agent-traffic), plus `curl/` for shell fetches. Examples include Claude Code, ChatGPT-User, and OAI-SearchBot. Matching is case-insensitive.
- **Custom matches:** Pass an array of literal substring tokens, e.g. `"userAgents": ["MyAgent/"]`.
- **Disabled by default:** Enable `"userAgents": true` in `agent-readable.json` (static) or `userAgents: true` in handler options (runtime and Next.js proxy + route).

See [static configuration](https://github.com/gauge-sh/agent-readable/blob/main/docs/static.md#optional-user-agent-routing) and [runtime configuration](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md#optional-user-agent-routing) for `Vary` headers and edge cases.

## Built-in coding-agent smoke test

To verify that real coding agents actually receive and read your Markdown by default, the repository includes a [local coding-agent smoke test](https://github.com/gauge-sh/agent-readable/tree/main/examples/agent-smoke).

It starts a local demo site with a different random marker in each page’s Markdown response, launches a real coding agent via the Gauge CLI with ordinary page URLs, and cross-checks both the agent's recorded tool output and the server's HTTP request logs to confirm a GET for each page and the presence of both markers in tool output.

```sh
# Run with Codex (default)
npm run smoke:agent

# Run with Claude Code
npm run smoke:agent -- --agent claude-code
```

The command handles setup checks, the local session, verification, and server cleanup automatically. Docker and authentication for the selected agent must be ready.

## Static build vs. runtime handlers

| Capability | Static build | Runtime handlers |
| --- | --- | --- |
| Automatic HTML → Markdown conversion | Yes, from exported files | No; supply a `resolve` callback |
| Custom per-page Markdown | Per-page file mapping in `agent-readable.json` | `resolve` returns your Markdown |
| Query-dependent content | No | Yes; `resolve` receives `searchParams` |
| `Accept: text/markdown` | Yes, with explicit opt-in and `q=0` rejection | Yes, with quality ranking against HTML |
| `Accept: text/x-markdown` | No | Yes |
| Optional User-Agent routing (`userAgents`) | Yes | Yes |
| Root Markdown URL | `/index.md` | `/index.md` and `/.md` |
| Site index URLs | `/llms.txt` | `/llms.txt` and `/lm.txt` |
| Site index content | Auto-generated, or preserve your existing file | Optional `index` callback |
| HTML discovery links & headers | Injected into copied HTML + Vercel routing rules | HTTP `Link`/`Vary` headers (Node adapter); add HTML `<link>` in your template |
| Existing APIs and SSR | Not part of a static export | Delegated to your application |

**Scope boundaries:** `agent-readable` does not execute client-side JavaScript to extract content, supply an AI agent, or enforce access control. Runtime resolvers must apply your app's authorization rules before returning content; static exclusions prevent Markdown generation but do not make exported HTML private.

## Documentation

- [Installation](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md): build the unpublished candidate tarball and choose the dependency type.
- [Static sites](https://github.com/gauge-sh/agent-readable/blob/main/docs/static.md): build order, Vercel deployment, `llms.txt`, and configuration reference.
- [Next.js](https://github.com/gauge-sh/agent-readable/blob/main/docs/next.md): reusable Proxy, route, and custom-server adapters.
- [Existing servers](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md): Node integration, Web adapter contract, and runtime options.
- [Custom Markdown](https://github.com/gauge-sh/agent-readable/blob/main/docs/custom-markdown.md): override individual routes with agent-specific Markdown.
- [Verification](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md): verify live or local routes and diagnose common failures.
- [Release checklist](https://github.com/gauge-sh/agent-readable/blob/main/RELEASE.md) and [changelog](https://github.com/gauge-sh/agent-readable/blob/main/CHANGELOG.md): validation evidence and release status.

## Development

```sh
npm ci
npm run check
npm run demo
```

`npm run check` runs syntax checks, unit tests, and a packed-install smoke test. CI runs on Node.js 22, 24, and 26. See the [contributing guide](https://github.com/gauge-sh/agent-readable/blob/main/CONTRIBUTING.md) for changes, and report bugs through [GitHub issues](https://github.com/gauge-sh/agent-readable/issues).

## Built by Gauge

[Gauge](https://www.withgauge.com) is the Agent-Led Growth platform for AI search visibility, agent preference, and agent experience. [Gauge Agents](https://www.withgauge.com/agents) measures which products coding agents choose and whether they can successfully use yours—helping teams evaluate docs, SDKs, CLIs, and skills, find where agents get stuck, and test improvements with controlled evaluations and GitHub PR checks.

`agent-readable` is an open-source project by Gauge, licensed under [MIT](https://github.com/gauge-sh/agent-readable/blob/main/LICENSE).

Static builds include a short Gauge attribution in the generated `llms.txt` by default; set `"attribution": false` to omit it. Runtime indexes opt in with `attribution: true`. Attribution never modifies individual Markdown pages.
