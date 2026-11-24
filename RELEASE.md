# Release checklist

## Validation completed

- **Automated checks & CI:** Syntax checks, unit and local HTTP integration tests, packed-install tarball smoke checks (`npm run check`), and `npm audit --omit=dev` pass across Node.js 22, 24, and 26.
- **Static exports:** Validated against real Next.js (`output: 'export'`) and Eleventy 3.1.8 static builds, including automatic HTML conversion, custom per-page Markdown overrides, `llms.txt` generation, symlink/collision guards, and Vercel Build Output API routing.
- **Runtime & Next.js adapters:** Validated `agent-readable/runtime`, `agent-readable/node`, `agent-readable/next`, and `agent-readable/next/server` against a production Next.js 16 App Router application—covering direct `.md` routes, `Accept` quality negotiation, query variants, `HEAD`, 404s, `/llms.txt` and `/lm.txt`, dynamic image routes, RSC headers, and final HTML `Vary: Accept` header merging via the custom-server helper.
- **User-Agent routing & smoke test:** Verified optional `userAgents: true` routing (`curl/`, `claude-code`, `OAI-SearchBot`, and custom token lists), `q=0` opt-out, `Vary: Accept, User-Agent`, and end-to-end retrieval with the local `npm run smoke:agent` workflow.

For deployment requirements and configuration examples, see the [static build guide](docs/static.md) and the [Next.js guide](docs/next.md).

## Publishing a stable release

Configure the GitHub Actions trusted publisher in the npm settings for `agent-readable`. Use owner `gauge-sh`, repository `agent-readable`, and workflow filename `publish.yml`. Leave the environment blank and allow `npm publish`. The publish job uses OIDC on a GitHub-hosted runner and attaches provenance.

1. Set the release version in the manifest and lockfile, update the changelog, and confirm CI passes on the release commit.
2. Verify a live Vercel preview with generated and custom Markdown pages using `agent-readable check <preview-origin> --manifest .vercel/output/.agent-readable`. Request HTML and Markdown in both orders at the same URL and compare custom Markdown with its source.
3. Push the matching stable tag (for example, `v0.3.0`). The **Publish to npm** workflow checks the version, runs the test suite and packed-install smoke test, audits dependencies, and publishes the archive to the public registry.
4. Verify the published version and provenance on npm and install that exact version in a fresh project to run `npx --no-install agent-readable --help`.

### Existing v0.2.0 tag

After merging the workflow and configuring the npm trusted publisher, run **Actions → Publish to npm → Run workflow** on `main`. The manual run verifies that the tagged commit is an ancestor and that only the publishing workflow and this checklist differ from the tag. Provenance identifies the workflow commit on `main`. Run this before merging additional changes.
