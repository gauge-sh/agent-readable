# Changelog

## 0.1.0

Serve a Markdown version of a page at its `.md` URL or at the original URL when a client requests `text/markdown`. HTML pages advertise their Markdown version so clients can discover it.

- **Static sites on Vercel.** Generate Markdown from exported HTML, override individual pages with hand-authored files, and generate an `llms.txt` index. The CLI configures the Vercel build and routing.
- **Next.js and Node servers.** Serve Markdown from your existing content source with access to the original request and query parameters. The Node and Next.js custom-server adapters preserve the final HTML discovery and cache headers.
- **Automatic agent routing.** Enable `userAgents` to serve Markdown to recognized coding agents, AI crawlers, and curl on ordinary page URLs. Supply your own list to customize matching.
- **Deployment verification.** Run `agent-readable check` with the build manifest to verify discovery links, content types, cache headers, and matching direct and negotiated Markdown across the site.
