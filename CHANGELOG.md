# Changelog

## 0.4.1

Send canonical `Link` headers on Markdown responses across runtime, Next.js, Vercel static, and Netlify static adapters so search engines consolidate indexing signals onto the HTML URL.

- **Canonical `Link` header on Markdown responses.** Emit `<html-url>; rel="canonical"` in the HTTP `Link` header for `200` page Markdown responses across `agent-readable/runtime`, `agent-readable/next`, `agent-readable/node`, static Vercel builds (honoring `site` and `trailingSlash`), and static Netlify builds. Index responses (`/llms.txt`, `/lm.txt`) and `404`s omit `rel="canonical"`.
- **Verifier check.** `agent-readable check` / `checkPage()` now verifies that direct `.md` responses include a `Link` header with `rel="canonical"` pointing to the corresponding HTML page.

## 0.4.0

Fix Next.js 16 rewrite target handoff, add automatic HTML conversion and Netlify static builds, make `defineNextMarkdown` safer by default, and add composable `userAgents` matching and testing helpers.

- **Next.js 16 rewrite handoff fix & production E2E tests.** Pass the encoded rewrite target via an internal `x-agent-readable-target` request header alongside the `__agent_readable` query parameter so Next.js 16 route handlers receive the target even when Next.js retains the original `request.url`. Strip `x-agent-readable-target` on pass-through and before invoking resolvers. Add real `next build && next start` E2E verification (`scripts/next-production.js`) across Next.js 14 and Next.js 16.
- **Safe `index: false` default in `defineNextMarkdown()`.** Default `index` to `false` so existing `/llms.txt` routes are never silently intercepted, and throw eagerly in `route()` if `index: true` lacks an `index` callback (or if `index: false` receives one).
- **Composable `userAgents` configuration.** Support `{ defaults?, include?, exclude? }` across runtime, Next.js, static Vercel builds, and static Netlify builds—for example `{ exclude: ['curl/'] }` to keep Mintlify's agent/crawler patterns while returning HTML to plain `curl`.
- **Supported Next.js test helper.** Export `createNextMarkdownTester({ proxy, route, fallback?, routePath? })` from `agent-readable/next` so consumer tests can run `proxy` + `route` end-to-end without reading Next.js's private `x-middleware-*` headers directly.
- **Deprecate legacy Next.js factories.** Mark `createNextMarkdownProxy` and `createNextMarkdownRoute` as `@deprecated` with a one-time deprecation warning in favor of `defineNextMarkdown()`.
- **Automatic runtime HTML conversion (`agent-readable/html`) & Netlify static target.** Add `createHtmlMarkdownResolver` for runtime HTML → Markdown conversion, `setup-netlify` / `--target netlify` static builds with generated Netlify Edge Functions, and `Cache-Control: private, no-store` on covered Next.js HTML pass-through responses to prevent cache mixing when Next.js replaces `Vary`.
- **PR canary builds.** Add a `pkg.pr.new` GitHub Actions preview workflow so unreleased PRs can be installed directly for testing.

- **Older template compatibility.** Bundle the pinned user-agent patterns as plain JavaScript so Next.js 14/Babel does not need a custom JSON-import loader; include upstream attribution. Add TypeScript `typesVersions` for legacy `moduleResolution: node` consumers.
- **Packaged integration guides and verification.** Ship Markdown guides with npm, normalize heading whitespace in the checker, and add an official Netlify build/local edge-runtime check (`npm run test:netlify`). Next.js 14 cache correctness requires dynamic covered pages or the final-response custom server; the guide now explains the tradeoff.

### Upgrading from 0.3

1. **`defineNextMarkdown()` now defaults `index` to `false`.** If your app relies on `agent-readable` to serve `/llms.txt` or `/lm.txt`, set `index: true` in `defineNextMarkdown({ index: true })` and pass an `index` callback to `route({ resolve, index })`. If your app serves its own `/llms.txt`, you can remove `index: false`.
2. **Migrate off `createNextMarkdownProxy` / `createNextMarkdownRoute`.** Replace separate proxy and route calls with a shared `defineNextMarkdown()` config (`markdown.proxy(NextResponse)` + `markdown.route({ resolve })`). The old factories still work in this release with a deprecation warning.
3. **Optional `curl/` opt-out.** If you previously used `userAgents: true` and want plain `curl` requests to receive HTML, switch to `userAgents: { exclude: ['curl/'] }`.

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
