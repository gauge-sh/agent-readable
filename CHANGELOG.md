# Changelog

## 0.3.0

Make runtime and Next.js adapters easier to compose in production TypeScript apps, improve static HTML → Markdown conversion, and add local and protected-preview verification.

- **Shared Next.js routing config & proxy composition.** Add `defineNextMarkdown()` in `agent-readable/next` to share `match`, `exclude`, `userAgents`, `index`, and `route` between `proxy.ts` and the route handler without pulling content resolvers into the proxy bundle. Expose `rewrite()` (returning `NextResponse.rewrite(...) | null`) and `applyHeaders()` / `applyMarkdownHeaders()` so apps with Clerk or custom auth proxies can compose cleanly.
- **Route matching & index opt-out.** Add an optional `match(pathname)` predicate across runtime, Node, and Next.js adapters so uncovered pages stay HTML and never receive broken `Link` headers or negotiated 404s. Support `index: false` to leave existing `/llms.txt` and `/lm.txt` routes untouched.
- **Response customization.** Support configurable `cacheControl` (string or callback, keeping `404` responses `no-store`) and custom `notFound` Markdown bodies in `createMarkdownHandler`, `createNodeMarkdownHandler`, `createNextMarkdownRoute`, and `defineNextMarkdown().route()`. Change the default `404` Markdown body to `# Page not found\n` (removing the hardcoded `/index.md` link).
- **Full TypeScript declarations.** Ship `.d.ts` type definitions for `.`, `./runtime`, `./node`, `./next`, and `./next/server` (in addition to `./react`).
- **Cleaner HTML → Markdown conversion.** Recover `aria-label` text on empty headings and accessible icon SVGs (such as animated headings and check/cross table marks), drop decorative `alt=""` images, flatten multi-line `<th>`/`<td>` cells into valid GFM pipe tables, and space adjacent link/button siblings.
- **Built-in `llms-full.txt` and `describedby` discovery.** Add `"llmsFull": true` to generate `llms-full.txt` alongside static builds, and append `</llms.txt>; rel="describedby"; type="text/plain"` to HTTP `Link` headers whenever `llms.txt` is present.
- **Local and protected-preview verification.** Add `checkLocal()` / `agent-readable check --local` to verify `.vercel/output` before deploying, plus `--header` / `headers` support on `check()` for SSO-protected preview deployments.

## 0.2.0

Control HTML vs. Markdown inline with data attributes, preserve `vercel.json` redirects and headers in static builds, and scale static Vercel deployments past hundreds of pages.

- **Inline HTML controls.** Add `data-agent-hidden` to keep decorative UI out of Markdown and `data-agent-only` to include agent-only content in Markdown while stripping it from shipped HTML. React / Next.js apps can import `AgentOnly` from `agent-readable/react` to avoid hydration mismatches.
- **`vercel.json` redirects and headers.** Preserve `redirects`, `headers`, and `trailingSlash` in `vercel.json` across `setup-vercel` and compile them into `.vercel/output/config.json` with redirects ordered ahead of Markdown negotiation.
- **Pattern-based static routing and `trailingSlash`.** Generate a constant set of Vercel Build Output API routes regardless of site size (avoiding Vercel's 2,048-route limit), support `trailingSlash: true` redirects for HTML URLs, and allow duplicate excluded error pages (`404.html` + `404/index.html`) from Next.js exports.
- **Verification.** `agent-readable check` now verifies that no `[data-agent-only]` elements leak into HTML responses.

## 0.1.0

Serve a Markdown version of a page at its `.md` URL or at the original URL when a client requests `text/markdown`. HTML pages advertise their Markdown version so clients can discover it.

- **Static sites on Vercel.** Generate Markdown from exported HTML, override individual pages with hand-authored files, and generate an `llms.txt` index. The CLI configures the Vercel build and routing.
- **Next.js and Node servers.** Serve Markdown from your existing content source with access to the original request and query parameters. The Node and Next.js custom-server adapters preserve the final HTML discovery and cache headers.
- **Automatic agent routing.** Enable `userAgents` to serve Markdown to recognized coding agents, AI crawlers, and curl on ordinary page URLs. Supply your own list to customize matching.
- **Deployment verification.** Run `agent-readable check` with the build manifest to verify discovery links, content types, cache headers, and matching direct and negotiated Markdown across the site.
