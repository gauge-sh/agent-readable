# Agent Readable (`agent-readable`)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/gauge-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/gauge-logo-light.svg">
  <img alt="Gauge" src="docs/assets/gauge-logo-light.svg" width="800">
</picture>

[![npm version](https://img.shields.io/npm/v/agent-readable)](https://www.npmjs.com/package/agent-readable)
[![CI](https://github.com/gauge-sh/agent-readable/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/gauge-sh/agent-readable/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933)](https://github.com/gauge-sh/agent-readable/blob/main/package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/gauge-sh/agent-readable/blob/main/LICENSE)

**Serve Markdown alongside your existing web pages.** Generate it from a static HTML export for Vercel or Netlify, or convert your existing HTML at runtime with a Next.js or Node adapter.

Try the live demo. Open [the documentation page](https://agent-markdown-preview.vercel.app/docs) in a browser, then request its Markdown representation.

```sh
curl -i -H 'Accept: text/markdown' https://agent-markdown-preview.vercel.app/docs
```

Look for `content-type: text/markdown` in the response headers and `# Complete your first integration` in the body.

Available on [npm](https://www.npmjs.com/package/agent-readable) (`npm install -D agent-readable`). Requires Node.js 22 or newer — see the [installation guide](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md) for static and runtime setups.

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

### Static site on Vercel

Run these commands from your site directory. Replace `https://example.com` with your site URL and `out` with your HTML export directory.

```sh
npm install --save-dev agent-readable

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

### Static site on Netlify

Keep your existing host. After `init`, configure the static build and verify it:

```sh
npx --no-install agent-readable setup-netlify --build-command "npm run build"
npm run build
npx --no-install agent-readable build
npx --no-install agent-readable check --local
```

This preserves Netlify configuration values, sets the publish directory, and generates
an edge function for content negotiation. See the [Netlify guide](https://github.com/gauge-sh/agent-readable/blob/main/docs/netlify.md).

### Choose your integration

**Already exporting static HTML? Keep that workflow and your existing host.** Use the
static Vercel or Netlify adapter. You do not need to switch to SSR or configure a
runtime origin just to add Markdown.


| Your setup | How to serve Markdown |
| --- | --- |
| Static export on Vercel | Point the CLI at the HTML output from your site generator. The [static guide](https://github.com/gauge-sh/agent-readable/blob/main/docs/static.md) covers Next.js static exports and Eleventy, with example configurations for Astro and Hugo. |
| Static export on Netlify | Use `setup-netlify` and `build --target netlify`. Keep existing redirects and headers. |
| Next.js App Router (Vercel, serverless, or self-hosted) | Use the [Next.js adapter](https://github.com/gauge-sh/agent-readable/blob/main/docs/next.md) with `defineNextMarkdown()` and either `createHtmlMarkdownResolver` from `agent-readable/html` (automatic HTML conversion) or your own CMS resolver. |
| Existing Node HTTP server | Wrap the request handler and resolve Markdown from files, a CMS, or a database. See the [Node adapter](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md#node-http-server). |
| Framework with Web `Request` and `Response` | Call the [Web handler](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md#web-requestresponse-adapter) from your adapter and set discovery and cache headers on HTML responses. |

## Custom Markdown and inline controls

For a pricing matrix or interactive product tour, control what agents read either inline in HTML or with a full per-page Markdown file:

- **Inline HTML attributes:** Add `data-agent-hidden` to keep decorative UI out of Markdown, and `data-agent-only` (or `AgentOnly` from `agent-readable/react` in Next.js) to include agent-only copy in Markdown. Static builds strip it from shipped HTML; runtime HTML conversion does not modify your original HTML response.
- **Static sites (per-page overrides):** Map any page route to a local `.md` file in `agent-readable.json`. Unmapped pages still convert from HTML automatically:

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

- **Runtime servers:** Pass `createHtmlMarkdownResolver({ origin: 'https://your-trusted-site.example' })` from `agent-readable/html` as `resolve` to convert existing HTML, including inline controls. Or return Markdown from your CMS directly. The converter belongs in the Node route handler, not middleware.

Conversion selects `main`, `article`, or `[role="main"]` by default. If your page lacks a landmark, add a semantic `<main>` or configure `contentSelector` for the real content container. Use `body` only deliberately, with `excludeSelectors` to remove navigation and decorative UI.

See [custom Markdown](https://github.com/gauge-sh/agent-readable/blob/main/docs/custom-markdown.md) for route rules, examples, and verification behavior.

## Automatic User-Agent routing

Many coding agents and AI crawlers fetch regular page URLs without appending `.md` or sending `Accept: text/markdown`. Setting `userAgents: true` enables automatic User-Agent negotiation so matching agents receive Markdown on normal URLs while browsers still receive HTML.

- **Default matches (when enabled):** [Mintlify’s agent and AI-crawler patterns](https://github.com/mintlify/agent-traffic), plus `curl/` for shell fetches. Examples include Claude Code, ChatGPT-User, and OAI-SearchBot. Matching is case-insensitive.
- **Customize defaults:** Pass an object to keep defaults while adding or removing tokens, e.g. `"userAgents": { "exclude": ["curl/"] }` or `"userAgents": { "defaults": true, "include": ["MyAgent/"], "exclude": ["curl/"] }`.
- **Replace defaults:** Pass an array of literal substring tokens, e.g. `"userAgents": ["MyAgent/"]`.
- **Disabled by default:** Enable `"userAgents": true` (or an object/array) in `agent-readable.json` (static) or handler options (`defineNextMarkdown` / runtime).

See [static configuration](https://github.com/gauge-sh/agent-readable/blob/main/docs/static.md#optional-user-agent-routing) and [runtime configuration](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md#optional-user-agent-routing) for `Vary` headers and edge cases.

## Built-in coding-agent smoke test

To check what a coding agent receives when it fetches an ordinary page URL, run the [local coding-agent smoke test](https://github.com/gauge-sh/agent-readable/tree/main/examples/agent-smoke).

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
| Automatic HTML → Markdown conversion | Yes, from exported files | Yes, with `createHtmlMarkdownResolver`; or supply your own `resolve` |
| Custom per-page Markdown | Per-page file mapping in `agent-readable.json` | `resolve` returns your Markdown |
| Query-dependent content | No | Yes; `resolve` receives `searchParams` |
| `Accept: text/markdown` | Yes, with explicit opt-in and `q=0` rejection | Yes, with quality ranking against HTML |
| `Accept: text/x-markdown` | Netlify: yes; Vercel: no | Yes |
| Optional User-Agent routing (`userAgents`) | Yes | Yes |
| Root Markdown URL | `/index.md` | `/index.md` and `/.md` |
| Site index URLs | `/llms.txt` | `/llms.txt` and `/lm.txt` |
| Site index content | Auto-generated, or preserve your existing file | Optional `index` callback |
| HTML discovery links & headers | Injected into copied HTML + host routing | HTTP `Link`/`Vary` headers (Node adapter); add HTML `<link>` in your template |
| Existing APIs and SSR | Not part of a static export | Delegated to your application |

Use public HTML exports for static builds. Excluding a route skips its Markdown file and still deploys the original HTML. In a runtime resolver, apply the same authorization rules as the corresponding page.

## Documentation

- [Installation](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md): add the package to a static build or a runtime server.
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

`npm run check` runs syntax checks, unit tests, and a packed-install smoke test. CI runs on Node.js 22, 24, and 26. `npm run test:next` builds production Next.js 14/16 fixtures. `npm run test:netlify` uses Netlify’s official build and local edge runtime. See the [contributing guide](https://github.com/gauge-sh/agent-readable/blob/main/CONTRIBUTING.md) for changes. If a page serves the wrong format or loses content during conversion, [report a bug](https://github.com/gauge-sh/agent-readable/issues) with the URL path, request headers, and a small example.

## Built by Gauge

[Gauge](https://www.withgauge.com) is the Agent-Led Growth platform for AI search visibility, agent preference, and agent experience. [Gauge Agents](https://www.withgauge.com/agents) measures which products coding agents choose and whether they can successfully use yours—helping teams evaluate docs, SDKs, CLIs, and skills, find where agents get stuck, and test improvements with controlled evaluations and GitHub PR checks.

`agent-readable` is an open-source project by Gauge, licensed under [MIT](https://github.com/gauge-sh/agent-readable/blob/main/LICENSE).

Static builds include a short Gauge attribution in the generated `llms.txt` by default; set `"attribution": false` to omit it. Runtime indexes opt in with `attribution: true`. Attribution never modifies individual Markdown pages.
