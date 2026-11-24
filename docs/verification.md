# Verify the served site

[Overview](https://github.com/gauge-sh/agent-readable/blob/main/README.md) · [Static sites](https://github.com/gauge-sh/agent-readable/blob/main/docs/static.md) · [Existing servers](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md)

Run the verifier against a running local server or deployed site. A successful
build proves files were generated; this checks the responses a client receives.

## Static builds

Verify the built artifact locally before deploying (`check --local --target netlify` for an explicit Netlify target):

```sh
npx --no-install agent-readable check --local
```

After deployment, use its origin and the manifest from the matching build (pass `--header` if the preview uses Vercel Deployment Protection):

```sh
npx --no-install agent-readable check https://example.com \
  --manifest .vercel/output/.agent-readable

npx --no-install agent-readable check https://preview.vercel.app \
  --manifest .vercel/output/.agent-readable \
  --header "x-vercel-protection-bypass: $VERCEL_BYPASS_SECRET"
```

The manifest identifies custom Markdown pages, so their headings are not required
to match HTML. All HTTP checks still apply.

## Runtime content

Choose representative routes explicitly. Use `--skip-heading-check` when the
Markdown is intentionally authored differently from the HTML:

```sh
npx --no-install agent-readable check https://example.com \
  --path / --path /pricing --path /docs/getting-started \
  --skip-heading-check
```

Without paths or a manifest, the CLI checks only `/`. **It does not crawl your site.**
Omit `--skip-heading-check` if matching HTML headings are part of your contract.

## What the checker verifies

For each page, checks cover HTML and alternate-format discovery, direct Markdown
and negotiated Markdown status/content type, canonical `Link` (`rel="canonical"`) pointing back to the HTML page on direct Markdown responses, nonempty content that is not an HTML
document, agreement between the two Markdown bodies, HTML cache safety (`Vary: Accept` or `Cache-Control: no-store`), Markdown `Vary: Accept`, and rejection
of `text/markdown;q=0`. Unless skipped, it also compares the HTML's main heading
with the Markdown, ignoring differences in whitespace.

Use `--json` for machine-readable results. Use `--cwd` to select a different
project directory when resolving local files.

Keep application tests for behavior outside this shared check: query-dependent
content, runtime aliases, the full Accept quality matrix, auth, APIs, RSC,
streaming, and social images. Index content should also be checked separately.
The verifier is not a complete framework or security test suite.

## Common failures

| Symptom | What to check |
| --- | --- |
| `.md` returns 404 after a successful static build | Confirm Vercel deployed `.vercel/output`; run `setup-vercel` and review conflicting project settings |
| `.md` returns HTML | Check rewrites, fallback routing, and whether the Markdown handler runs before the HTML handler |
| Markdown is empty or mostly navigation | Inspect exported HTML and `contentSelector`; client-rendered content needs a real export or runtime resolver |
| Discovery points at a different origin | Build with the intended `site` origin or set runtime canonical metadata for the tested origin |
| Custom Markdown fails heading comparison | Use the matching static manifest, or `--skip-heading-check` for runtime content |
| Runtime HTML lacks `Vary: Accept` | Merge headers at the final response step; an early middleware header may be overwritten |
| Runtime Markdown returns 404 | Check the resolver's normalized pathname and return value; `null` means missing content |
| Static build rejects an output collision | Explicitly map an existing `.md` file if it is the intended source; otherwise remove the conflicting generator |

Preview deployments need particular care: the verifier does not follow cross-origin
redirects or treat another origin as the site under test. Generate links and
canonical metadata for the origin you intend to verify.
