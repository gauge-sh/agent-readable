# Release checklist

## Validation completed

- **Automated checks & CI:** Syntax checks, unit and local HTTP integration tests, packed-install tarball smoke checks (`npm run check`), and `npm audit --omit=dev` pass across Node.js 22, 24, and 26.
- **Static exports:** Validated against real Next.js (`output: 'export'`) and Eleventy 3.1.8 static builds, including automatic HTML conversion, custom per-page Markdown overrides, `llms.txt` generation, symlink/collision guards, and Vercel Build Output API routing.
- **Runtime & Next.js adapters:** Validated `agent-readable/runtime`, `agent-readable/node`, `agent-readable/next`, and `agent-readable/next/server` against a production Next.js 16 App Router application—covering direct `.md` routes, `Accept` quality negotiation, query variants, `HEAD`, 404s, `/llms.txt` and `/lm.txt`, dynamic image routes, RSC headers, and final HTML `Vary: Accept` header merging via the custom-server helper.
- **User-Agent routing & smoke test:** Verified optional `userAgents: true` routing (`curl/`, `claude-code`, `OAI-SearchBot`, and custom token lists), `q=0` opt-out, `Vary: Accept, User-Agent`, and end-to-end retrieval with the local `npm run smoke:agent` workflow.

For deployment requirements and configuration examples, see the [static build guide](docs/static.md) and the [Next.js guide](docs/next.md).

## Publish 0.1.0

1. Confirm green CI on Node 22, 24, and 26, and run `npm ci`, `npm run check`, `npm audit --omit=dev`, and `npm pack --dry-run` from the exact release commit.
2. Deploy a live Vercel Git preview of a static site using `setup-vercel` with both generated and custom Markdown pages, and pass `agent-readable check <preview-origin> --manifest .vercel/output/.agent-readable`.
   The demo project uses `examples/custom` as its Vercel root with access to source files outside that directory. It packs and installs this Git revision at build time. Enable Vercel system environment variables so the fixture can generate links for the deployment hostname. Check HTML then Markdown and Markdown then HTML on the same URL. Check the authored body against its source.
3. Pack the release with `npm pack`. Install the resulting `agent-readable-0.1.0.tgz` in an empty project and run `npx --no-install agent-readable --help`.
4. From the directory containing the tested archive, run `npm publish ./agent-readable-0.1.0.tgz --access public --dry-run`. Tag the verified commit `v0.1.0` and publish the same archive with `npm publish ./agent-readable-0.1.0.tgz --access public`.
5. Install `agent-readable@0.1.0` from the public registry in a fresh project and verify the CLI. Add the registry install commands to the installation guide and the README, and add the npm version badge.
