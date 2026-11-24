# Next.js integration

[Overview](https://github.com/gauge-sh/agent-readable/blob/main/README.md) · [Installation](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md) · [Verification](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md)

Use the Next.js adapter for App Router applications. Convert existing HTML automatically,
or supply Markdown from your content source. The adapter handles negotiation, routing,
queries, and HTTP responses; your app owns access rules and HTML metadata.

`defineNextMarkdown()` works with standard Next.js routing and serverless deployments.
Next.js can replace middleware's `Vary` header. Covered HTML responses therefore use
`Cache-Control: private, no-store` by default, preventing shared caches from mixing HTML
and Markdown. This disables browser/CDN storage for these HTML responses; it does not
turn off Next.js's internal rendering cache. The optional persistent Node custom server
below can merge headers on the final response. This adapter does not turn SSR into a static export.

**Next.js 14:** prerendered pages can replace both middleware cache headers and `Vary`.
Set `export const dynamic = 'force-dynamic'` in the layout covering negotiated pages,
or use the custom-server adapter. This trades static rendering for cache correctness.
Do not rely on middleware's no-store header alone on Next.js 14. Run the verifier
against your deployed version; other framework/hosting combinations may override headers.

For older Babel-based Next.js 14 apps, keep the Node-only converter outside the
server bundle with `experimental: { serverComponentsExternalPackages: ['agent-readable'] }`
in `next.config.js`. On Next.js 15+, the corresponding option is `serverExternalPackages`.
The lightweight `agent-readable/next` routing module remains suitable for middleware.
If your site already exports static HTML, prefer the static adapter instead.

**Pages Router projects:** use the static Vercel/Netlify adapter when the site can
export HTML, or the custom Node server adapter for SSR. The App Router `route.ts`
examples below do not belong in a Pages Router `pages/api` directory.

## 1. Define shared routing config

[Install agent-readable as a production dependency](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md).
Create a lightweight `lib/markdown-config.ts` with **routing options only** (no database, CMS, or filesystem imports, so `proxy.ts` stays lightweight and Edge-safe):

```ts
import { defineNextMarkdown } from 'agent-readable/next';

export const markdown = defineNextMarkdown({
  match: (pathname) => pathname === '/' || pathname.startsWith('/posts/'),
  // Keep built-in agent/crawler matching while letting plain `curl` receive HTML:
  userAgents: { exclude: ['curl/'] },
});
```

`defineNextMarkdown` keeps your proxy and route handler in sync so both use the
same `match`, `exclude`, `userAgents`, `index`, and internal `route` path:

- **`match(pathname)`**: Optional predicate receiving the normalized page pathname (without `.md` or trailing slash). Only matched pages are rewritten for Markdown or receive HTML `Link`/`Vary` headers. Unmatched pages continue to your app as HTML—even when `userAgents` is enabled.
- **`index`**: Defaults to `false`, leaving any existing `public/llms.txt` or App Router `app/llms.txt/route.ts` untouched. Set `index: true` to handle `/llms.txt` and `/lm.txt` in `route({ resolve, index })`. `route()` throws immediately if `index: true` lacks an `index` callback or if `index: false` receives one.
- **`exclude`**: Prefixes delegated to your app; defaults to `['/api', '/_next']`. The internal Markdown route is always excluded automatically.

## 2. Connect Next.js proxy and route

### Standalone proxy

If your app has no existing proxy, create `proxy.ts` at the app root:

```ts
import { NextResponse } from 'next/server';
import { markdown } from './lib/markdown-config';

export const proxy = markdown.proxy(NextResponse);
export const config = { matcher: ['/((?!_next/|favicon\\.).*)'] };
```

For Next.js 14/15, name the file `middleware.ts` and export `middleware` instead
of `proxy`. If your app uses `src/app`, put this file alongside `src/app`.

### Composing with an existing proxy (e.g., Clerk or auth middleware)

Use `markdown.rewrite(NextResponse, request)` and `markdown.applyHeaders(request, response)`
so your existing proxy logic and request/response headers stay intact:

```ts
import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { markdown } from './lib/markdown-config';

export default clerkMiddleware(async (auth, request) => {
  const rewritten = markdown.rewrite(NextResponse, request);
  if (rewritten) return rewritten;

  // Existing app proxy logic runs normally.
  const response = NextResponse.next();
  return markdown.applyHeaders(request, response);
});
```

`markdown.rewrite` returns a `NextResponse.rewrite(...)` for Markdown requests and
`null` for everything else. `markdown.applyHeaders` merges `Vary` and alternate
`Link` discovery headers only for covered HTML pages (skipping `Link` on redirects
and error responses).

### Markdown route handler: automatic conversion

Create `app/api/markdown/route.ts`:

```ts
import { markdown } from '@/lib/markdown-config';
import { createHtmlMarkdownResolver } from 'agent-readable/html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = markdown.route({
  resolve: createHtmlMarkdownResolver({
    origin: process.env.SITE_ORIGIN!, // trusted origin, e.g. http://localhost:3000
    // contentSelector: 'main',
    // excludeSelectors: ['.decorative-demo'],
  }),
});
export const HEAD = GET;
```

Set `SITE_ORIGIN` to this deployment's reachable HTTP(S) origin, including the port
locally. Do not derive it from an untrusted Host header. The helper fetches HTML with
Markdown explicitly rejected (preventing recursion), retains query parameters and
forwards Cookie, Authorization and Accept-Language only to that trusted origin.
Cross-origin redirects fail. Missing, unauthorized and noindex pages return no Markdown.
Other source errors propagate. Each Markdown request adds an HTML fetch and conversion;
use a direct CMS resolver when that overhead is undesirable.

The same `data-agent-hidden` and `data-agent-only` controls apply to conversion.
Unlike the static build, this helper does not remove agent-only elements from the
original HTML response. Use ordinary `<div data-agent-only hidden>` for runtime pages;
`AgentOnly`'s static-export stripping behavior is not a runtime HTML filter. Never put
secrets in these elements. The generic checker requires agent-only elements to be absent
from HTML, so that particular check is intended for the static stripping workflow.

Keep the default Markdown `Cache-Control: no-store` for personalized pages. If you
supply `fetchHtml(context)` instead of `origin`, return a Web `Response` from your own
trusted renderer; you own fetching, authorization and redirect handling in that callback.
You can also supply your own `resolve` function returning a Markdown string or `null`.
See the [runtime contract](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md#resolver-contract).

The proxy delegates matching requests to the route. The package carries the
original pathname and query string together in an internal rewrite parameter and forwarded request header,
then restores both before invoking the resolver. Repeated keys and even keys with
the same name as the internal parameter are preserved without collisions.
Direct calls to the internal route without a valid target return 404; this is not
an authorization boundary. Your resolver must still enforce access rules.

Supply `NextResponse` from your installed Next.js version. Other frameworks can
use agent-readable without installing Next.js. Keep content imports in the route,
not in `lib/markdown-config.ts` or `proxy.ts`.

`createNextMarkdownProxy` and `createNextMarkdownRoute` remain exported for
backward compatibility but are **deprecated** and will be removed in a future
release. Use `defineNextMarkdown()` so proxy and route configuration cannot drift.

Your HTML pages still need an alternate link, supplied through Next.js metadata
or a page template:

```html
<link rel="alternate" type="text/markdown" href="/pricing.md">
```

The factories replace handwritten request classification, rewrite plumbing, and
response construction. Remove that duplicated logic from your app. Keep content
renderers and any application-specific authorization.

## 3. Use the custom-server helper for final headers

For a persistent Node deployment, create `server.mjs`:

```js
import next from 'next';
import { createNextMarkdownServer } from 'agent-readable/next/server';
import { markdown } from './lib/markdown-config.js';
import { pageMarkdown } from './lib/markdown.js';

const hostname = '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const server = await createNextMarkdownServer(next({ dev: false, hostname, port }), {
  ...markdown.options,
  resolve: ({ pathname, searchParams, request }) =>
    pageMarkdown({ pathname, searchParams, request }),
  origin: process.env.SITE_URL || `http://${hostname}:${port}`,
});
server.listen(port, hostname);
```

Build Next.js normally, then run `node server.mjs`. Configure the same public
origin for the build's metadata and the server's `origin`. Set the listening
hostname to match your deployment requirements.

The helper prepares the Next app and returns an **unbound Node HTTP server**.
Your app controls listening, shutdown, and deployment. It uses the package's Node
adapter to merge final discovery and `Vary` headers, delegates other requests to
Next.js, logs request failures, and returns a generic 500 when possible. Keep the
Next app reference if your shutdown logic also needs to call `app.close()`.

The proxy and route are useful when running the app through `next dev` or
`next start`. A deployment that always uses the custom server can omit both files;
the server handles Markdown directly. The custom-server helper is not compatible
with Next.js standalone output or a managed host that does not run your server.

## 4. Verify the real response path

### Unit-testing proxy + route together

Use `createNextMarkdownTester` from `agent-readable/next` to run your real `proxy`
and Markdown `route` handler together without reading Next.js's internal
`x-middleware-rewrite` or `x-middleware-request-*` headers directly:

```ts
import { createNextMarkdownTester } from 'agent-readable/next';
import { proxy } from './proxy';
import { GET } from './app/api/markdown/route';

const run = createNextMarkdownTester({
  proxy,
  route: GET,
  // Optional fallback to verify pass-through HTML headers and forwarded request headers:
  fallback: () => new Response('<html>Page</html>', { headers: { 'Content-Type': 'text/html' } }),
});

const md = await run('https://example.com/posts/launch', {
  headers: { Accept: 'text/markdown' },
});
const html = await run('https://example.com/posts/launch', {
  headers: { Accept: 'text/html' },
});
```

### Verifying the deployed server

Run the [HTTP verifier](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md)
against the server you intend to deploy, plus your existing application tests.

The adapters and custom-server helper are exercised against a production Next.js
16.4.6 app. The custom-server path must retain HTML `Vary: Accept`, RSC response headers,
Markdown body parity, query variants, HEAD, 404s, and dynamic image routes.

## Optional user-agent routing

Routing by user agent is disabled by default. Set `userAgents: true` to serve
Markdown automatically for Mintlify’s `agent` and `ai-crawler` user-agent patterns.
The default also matches `curl/` because coding agents often fetch pages through the shell.
Matching is case-insensitive and uses only the User-Agent header.

To customize the list without replacing all defaults, pass an object:
- `userAgents: { exclude: ['curl/'] }` keeps Mintlify's defaults while letting plain `curl` receive HTML.
- `userAgents: { defaults: true, include: ['MyAgent/'], exclude: ['curl/'] }` adds custom tokens and removes unwanted ones (`defaults` defaults to `true` when passing an object).
- `userAgents: ['MyAgent/']` (or `{ defaults: false, include: ['MyAgent/'] }`) replaces the defaults with literal substring tokens. `false` or an empty array disables automatic routing.

For static builds, add `"userAgents": true` to `agent-readable.json`. For runtime
handlers, pass `userAgents: true` in the handler options. With `defineNextMarkdown`,
set `userAgents: true` once in your shared config.

### Sample User-Agent strings for testing

When testing `userAgents: true`, use real strings that match the Mintlify patterns:

| Client | Matching `User-Agent` example |
| --- | --- |
| Claude Code | `claude-code/2.0.0` or `Claude-User (claude-code/2.0.0)` |
| Claude app fetcher | `Claude-User` or `Mozilla/5.0 (compatible; Claude-User/1.0; +https://claude.ai)` *(note: bare `Claude-User/1.0` without `compatible; ` does not match)* |
| Claude crawler | `ClaudeBot/1.0` |
| ChatGPT fetcher | `ChatGPT-User/1.0` |
| OpenAI search | `OAI-SearchBot/1.0` |
| Perplexity | `Perplexity-User/1.0` |
| Shell / curl | `curl/8.7.1` |

Automatic routing applies only to GET/HEAD page requests; existing exclusions,
`match`, and asset handling still apply. Browsers without a matching token continue
to receive HTML. Matching agents receive Markdown even with `Accept: text/html`,
but an explicit Markdown `q=0` rejection disables this fallback. Direct `.md` URLs
remain available. Responses that vary by this option use `Vary: Accept, User-Agent`;
custom Web adapters must also merge User-Agent into their HTML response's Vary.
User-agent matching is a representation preference, not authentication.
