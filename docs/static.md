# Static sites on Vercel

[Overview](https://github.com/gauge-sh/agent-readable/blob/main/README.md) · [Custom Markdown](https://github.com/gauge-sh/agent-readable/blob/main/docs/custom-markdown.md) · [Verification](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md)

Use this integration when your framework exports complete HTML files at build time
and you deploy those files to Vercel. It converts those files into Markdown and
creates a Vercel Build Output API artifact containing both formats.

**Do not use this deployment setup for an app that needs SSR, API routes, or
server functions.** Use the [runtime integration](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md) if you control
the request server. Managed SSR hosting needs a host-specific adapter.

## 1. Install and configure

[Install the package as a development dependency](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md), then run
this from your site's root. Replace the origin and export directory:

```sh
npx --no-install agent-readable init --site https://example.com --input out
```

This writes `agent-readable.json`. `site` is the canonical HTTP(S) origin; `input`
is the directory containing the framework's exported HTML.

| Framework/export | Typical input | Validation |
| --- | --- | --- |
| Next.js with `output: 'export'` | `out` | Tested with a real export |
| Eleventy | `_site` | Tested with a real export |
| Astro static output | `dist` | Example configuration; validate your build |
| Hugo | `public` | Example configuration; validate your build |

The tool reads HTML files, not framework source files. A client-only app shell
will not become a complete article: the tool does not execute JavaScript.

## 2. Build the website, then its Markdown

Assuming `npm run build` is your existing website-only build command:

```sh
npm run build
npx --no-install agent-readable build
```

The second command reads the exported HTML. It does not run your framework build.
It leaves the original export in place and writes:

```text
.vercel/output/
  config.json          # Hosting rules for HTML and Markdown
  static/              # Copied website, generated .md files, llms.txt
  .agent-readable       # Manifest used by the verifier
```

Each eligible page gets a Markdown URL: `/pricing` becomes `/pricing.md`, and `/`
becomes `/index.md`. Copied HTML gets an alternate-format link. Extracted Markdown
preserves headings, links, images, lists, code, and tables, with absolute links
based on `site`.

## 3. Configure the Vercel build

```sh
npx --no-install agent-readable setup-vercel --build-command "npm run build"
```

Pass the **website-only** command, without the Markdown build appended. The setup
command writes these Vercel settings:

```json
{
  "framework": null,
  "buildCommand": "(npm run build) && npx --no-install agent-readable build",
  "outputDirectory": null
}
```

These settings make Vercel deploy `.vercel/output` instead of picking the original
export and dropping the Markdown routes. Review and commit `vercel.json` along
with the package files and `agent-readable.json`, then deploy through your normal
Vercel Git workflow. You can also deploy an already-built artifact with
`vercel deploy --prebuilt`.

The setup command preserves unrelated settings, along with `redirects`, `headers`,
and `trailingSlash` in `vercel.json`, compiling them into `.vercel/output/config.json`
during `agent-readable build` (with redirects evaluated ahead of Markdown negotiation).
It still rejects incompatible `routes`, `rewrites`, `cleanUrls`, `builds`, and
`functions` settings instead of attempting to merge them. A build running with
`VERCEL=1` validates the required configuration too.

## 4. Verify the deployment

After deployment, use its origin and the manifest from the matching build:

```sh
npx --no-install agent-readable check https://example.com \
  --manifest .vercel/output/.agent-readable
```

See [verification](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md) for individual routes, preview origins,
and troubleshooting. A successful local build alone does not verify hosting rules.

## Configuration reference

All paths below are relative to the project root. Unknown configuration fields fail
validation so misspelled options cannot silently change behavior.

```json
{
  "site": "https://example.com",
  "input": "out",
  "contentSelector": "main, article, [role=\"main\"]",
  "excludeSelectors": [],
  "exclude": [],
  "markdown": {},
  "llms": true,
  "attribution": true,
  "trailingSlash": false
}
```

| Field | Default | Use it for |
| --- | --- | --- |
| `site` | Required | Canonical origin for generated links |
| `input` | `out` | Directory containing the static HTML export |
| `contentSelector` | `main, article, [role="main"]` | Select the content to convert |
| `excludeSelectors` | `[]` | Remove site-specific elements from converted content |
| `exclude` | `[]` | Exclude additional URL prefixes from Markdown generation |
| `markdown` | `{}` | Map existing page routes to [custom Markdown files](https://github.com/gauge-sh/agent-readable/blob/main/docs/custom-markdown.md) |
| `llms` | `true` | Generate an `llms.txt` index; `false` preserves an existing exported file |
| `attribution` | `true` | Add the Gauge attribution to the generated index |
| `trailingSlash` | `false` | Emit 308 trailing-slash redirects for HTML URLs (or inherit from `vercel.json`) |

Scripts, styles, navigation within the selected content, hidden elements,
`data-agent-hidden`, and `data-agent-readable="exclude"` elements are removed during
conversion. Elements marked `data-agent-only` (such as `<div data-agent-only hidden>`)
are included in the generated Markdown and stripped from the shipped HTML; React /
Next.js apps can import `AgentOnly` from `agent-readable/react` to avoid hydration
mismatches. Pages marked `noindex` or `none`, error pages, and built-in internal
prefixes such as `/_next`, `/preview`, `/admin`, and `/api` are excluded from
Markdown generation. Exported HTML and assets are still copied: these settings are
not access control.

The input must stay inside the project and outside `.vercel`. Symlinked inputs,
unsafe filenames, conflicting output files, and an unowned `.vercel/output`
directory cause a build error. Do not run concurrent builds into the same output.

## Static-mode boundaries

Static rules accept explicit `text/markdown` and reject `q=0`. They do not perform
the runtime handler's full quality ranking against HTML, accept `text/x-markdown`,
or provide `/.md` and `/lm.txt` aliases. Query parameters do not produce different
Markdown bodies. Choose runtime when those behaviors are required.

There is currently no generated deployment adapter for other static hosts.
The `.vercel/output` artifact requires Vercel's routing behavior; copying only its
files to another host does not reproduce content negotiation.

## Optional user-agent routing

Routing by user agent is disabled by default. Set `userAgents: true` to serve
Markdown automatically for Mintlify’s `agent` and `ai-crawler` user-agent patterns.
The default also matches `curl/` because coding agents often fetch pages through the shell.
Matching is case-insensitive and uses only the User-Agent header.
Use an array such as `userAgents: ["MyAgent/"]` to replace these defaults with literal
substring tokens. `false` or an empty array disables automatic routing.

For static builds, add `"userAgents": true` to `agent-readable.json`. For runtime
handlers, pass `userAgents: true` in the handler options. With the Next.js proxy
and route integration, pass the same option to **both** factories.

Automatic routing applies only to GET/HEAD page requests; existing exclusions and
asset handling still apply. Browsers without a matching token continue to receive
HTML. Matching agents receive Markdown even with `Accept: text/html`, but an
explicit Markdown `q=0` rejection disables this fallback. Direct `.md` URLs remain
available. Responses that vary by this option use `Vary: Accept, User-Agent`;
custom Web adapters must also merge User-Agent into their HTML response's Vary.
User-agent matching is a representation preference, not authentication.
