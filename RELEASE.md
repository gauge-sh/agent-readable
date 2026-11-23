# Release status

Version `0.1.0` is an unreleased candidate and has not yet been published to npm.

## Validation completed

- **Automated checks & CI:** Syntax checks, unit and local HTTP integration tests, packed-install tarball smoke checks (`npm run check`), and `npm audit --omit=dev` pass across Node.js 22, 24, and 26.
- **Static exports:** Validated against real Next.js (`output: 'export'`) and Eleventy 3.1.8 static builds, including automatic HTML conversion, custom per-page Markdown overrides, `llms.txt` generation, symlink/collision guards, and Vercel Build Output API routing.
- **Runtime & Next.js adapters:** Validated `agent-readable/runtime`, `agent-readable/node`, `agent-readable/next`, and `agent-readable/next/server` against a production Next.js 16 App Router application—covering direct `.md` routes, `Accept` quality negotiation, query variants, `HEAD`, 404s, `/llms.txt` and `/lm.txt`, dynamic image routes, RSC headers, and final HTML `Vary: Accept` header merging via the custom-server helper.
- **User-Agent routing & smoke test:** Verified optional `userAgents: true` routing (`curl/`, `claude-code`, `OAI-SearchBot`, and custom token lists), `q=0` opt-out, `Vary: Accept, User-Agent`, and end-to-end retrieval with the local `npm run smoke:agent` workflow.

### Known host boundaries

- **Static builds:** Next.js static export and Eleventy have been validated with real builds; Astro and Hugo are documented as configuration examples. The static adapter cannot preserve SSR, middleware, API routes, ISR, or client-only SPA routes, and does not merge existing `vercel.json` routing rules.
- **Next.js App Router:** Plain `next start` with Proxy alone overwrites HTML `Vary: Accept` after Proxy runs; use the custom-server helper (`agent-readable/next/server`) for full final-header preservation on a persistent Node server. Managed serverless SSR hosting is not yet validated.

## Remaining before `0.1.0` npm publication

1. Confirm green CI on Node 22, 24, and 26, and run `npm ci`, `npm run check`, `npm audit --omit=dev`, and `npm pack --dry-run` from the exact release commit.
2. Deploy a live Vercel Git preview of a static site using `setup-vercel` with both generated and custom Markdown pages, and pass `agent-readable check <preview-origin> --manifest .vercel/output/.agent-readable`.
   The demo project uses `examples/custom` as its Vercel root with access to source files outside that directory. It packs and installs this Git revision at build time. Enable Vercel system environment variables so the fixture can generate links for the deployment hostname. Check HTML then Markdown and Markdown then HTML on the same URL. Check the authored body against its source.
3. Update `CHANGELOG.md` and install docs (`README.md`, `docs/installation.md`), tag `v0.1.0`, and run `npm publish --dry-run` followed by `npm publish --access public`.
4. Verify a fresh install from the npm registry in an empty directory. Add the npm version badge and registry install command to the README once that install succeeds.
