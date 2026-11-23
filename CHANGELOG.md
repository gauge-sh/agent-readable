# Changelog

## 0.1.0 — unreleased

First standalone release candidate.

- Next.js adapter factories for Proxy and route handlers, plus a custom-server helper. Content stays in the app; query forwarding, request classification, responses, and server error handling live in the package.
- Runtime handler with query-aware content resolvers, quality-weighted negotiation, x-markdown, suffix/index aliases, HEAD/404 responses, and conservative no-store caching. Tested against an existing Next.js app. A Node HTTP adapter preserves final Vary/discovery headers even when the framework overwrites earlier headers.
- Optional Gauge attribution in generated llms.txt, enabled by default with an `attribution: false` opt-out. Package author and copyright identify Gauge.
- Per-page custom Markdown files served verbatim, with HTML conversion as the fallback and manifest-aware verification.
- Static HTML conversion, Markdown URLs, Accept negotiation, discovery links, and llms.txt.
- Vercel Git-build setup and compatibility checks; configurable static export directories.
- Strict configuration validation and protection against symlinked input/output paths.
- Remove unsafe URL schemes during conversion and support heading-only selectors.
- Reject empty checker inventories and cross-origin redirects.
- Automated tests, packed-install smoke checks, CI, and contributor/release documentation.
