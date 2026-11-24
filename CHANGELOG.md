# Changelog

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
