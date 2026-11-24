# Static sites on Netlify

Use this adapter for static HTML exports, including Next.js `output: 'export'`.
If the site uses Next's built-in image optimizer, static export also needs
`images: { unoptimized: true }` (or a compatible custom image loader).
Keep SSR projects on the runtime Next.js adapter; this adapter does not replace Netlify's Next.js runtime.

```sh
npm install --save-dev agent-readable
npx --no-install agent-readable init --site https://example.com --input out
npx --no-install agent-readable setup-netlify --build-command "npm run build"
npm run build
npx --no-install agent-readable build
npx --no-install agent-readable check --local
```

Commit `agent-readable.json` and `netlify.toml`. Setup sets `target: "netlify"`,
appends `agent-readable build --target netlify` to the supplied site build command,
and sets `build.publish` to `.netlify/agent-readable/output/static`. It preserves
existing TOML values, including redirects, headers, environment variables and plugins;
TOML formatting and comments are reserialized. Context-specific build overrides and
monorepo base settings require manual configuration and are rejected without writing.

The build copies your export, generates Markdown/discovery/index files, and emits
`.netlify/v1/edge-functions/agent-readable.js` using Netlify's Frameworks API.
Existing `_headers`, `_redirects` and user edge-function directories are preserved.
An existing file with that generated edge-function name is never overwritten unless
it carries the Agent Readable ownership marker. Do not commit generated output.

The edge function handles GET and HEAD, direct `.md` requests, Accept negotiation,
and optional `userAgents`. Explicit `text/markdown;q=0` disables agent detection.
Only generated public pages participate; excluded/noindex pages and assets are left
alone. Existing redirects run before negotiation. Covered HTML and negotiated responses
use `private, no-store` to prevent shared-cache representation mixing. Netlify controls
canonical slash redirects; `trailingSlash` in Agent Readable controls canonical content URLs.

`check --local` executes the generated edge function with a local static origin.
It does not emulate Netlify redirects, plugins, edge-function ordering or CDN caching.
For Netlify's own local production runtime, run `netlify serve --offline` after installing
the Netlify CLI. Use `serve`, not `dev`: `dev` skips framework-generated production edge functions.
Verify those on your Netlify preview before production:

```sh
npx --no-install agent-readable check https://YOUR-PREVIEW.netlify.app \
  --manifest .netlify/agent-readable/output/.agent-readable
```

If another edge function modifies these routes, verify the combined deployed response.
Vercel remains the default target when no target is configured; `build --target vercel`
or `build --target netlify` overrides it for one build.

Adapter format: [Netlify Frameworks API](https://docs.netlify.com/build/frameworks/frameworks-api/).
