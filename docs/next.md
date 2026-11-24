# Next.js integration

[Overview](https://github.com/gauge-sh/agent-readable/blob/main/README.md) · [Installation](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md) · [Verification](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md)

Use the Next.js adapter for an App Router application that supplies its own
Markdown. The package owns content negotiation, Markdown routing, query
preservation, index aliases, and HTTP response construction. Your app owns its
content, access rules, and HTML metadata.

**Choose the response path before deploying.** `defineNextMarkdown()` with `proxy.ts`
and `app/api/markdown/route.ts` works with standard Next.js routing and serverless
deployments. Next.js 16.4.6 overwrites HTML `Vary: Accept` after Proxy runs; if you
deploy on a persistent Node server and need final-response `Vary` merging, use the
optional custom-server helper (`agent-readable/next/server`). This adapter does not
turn an SSR app into a static export.

## 1. Define shared routing config

[Install agent-readable as a production dependency](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md).
Create a lightweight `lib/markdown-config.ts` with **routing options only** (no database, CMS, or filesystem imports, so `proxy.ts` stays lightweight and Edge-safe):

```ts
import { defineNextMarkdown } from 'agent-readable/next';

export const markdown = defineNextMarkdown({
  match: (pathname) => pathname === '/' || pathname.startsWith('/posts/'),
  userAgents: true,
  // Set index: false if your app already serves its own /llms.txt
  index: false,
});
```

`defineNextMarkdown` keeps your proxy and route handler in sync so both use the
same `match`, `exclude`, `userAgents`, `index`, and internal `route` path:

- **`match(pathname)`**: Optional predicate receiving the normalized page pathname (without `.md` or trailing slash). Only matched pages are rewritten for Markdown or receive HTML `Link`/`Vary` headers. Unmatched pages continue to your app as HTML—even when `userAgents: true` is enabled.
- **`index: false`**: Opts out of `/llms.txt` and `/lm.txt` interception so an existing `public/llms.txt` or App Router `app/llms.txt/route.ts` continues to work.
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

### Markdown route handler

Create `app/api/markdown/route.ts`:

```ts
import { markdown } from '@/lib/markdown-config';
import { pageMarkdown } from '@/lib/markdown';

export const GET = markdown.route({
  resolve: ({ pathname, searchParams, request }) =>
    pageMarkdown({ pathname, searchParams, request }),
  cacheControl: 'public, s-maxage=3600, stale-while-revalidate=86400',
  notFound: '# Page not found\n',
});
export const HEAD = GET;
```

`pageMarkdown` is **your function**, not a package export. Return a Markdown
string, or `null`/`undefined` for a missing page. Apply access rules in your
resolver. See the [runtime contract](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md#resolver-contract)
for `cacheControl`, `notFound`, `index`, `attribution`, and query preservation.

The proxy delegates matching requests to the route. The package carries the
original pathname and query string together in an internal rewrite parameter,
then restores both before invoking the resolver. Repeated keys and even keys with
the same name as the internal parameter are preserved without collisions.
Direct calls to the internal route without a valid target return 404; this is not
an authorization boundary. Your resolver must still enforce access rules.

Supply `NextResponse` from your installed Next.js version. Other frameworks can
use agent-readable without installing Next.js. Keep content imports in the route,
not in `lib/markdown-config.ts` or `proxy.ts`.

If you prefer the lower-level factories directly, `createNextMarkdownProxy`,
`createNextMarkdownRoute`, and `applyMarkdownHeaders` are also exported from
`agent-readable/next`. Pass the same routing options to both factories when using
them directly.

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

You can test your `defineNextMarkdown` config end-to-end without booting Next.js
using a small helper that mocks `NextResponse`:

```ts
const MockNextResponse = {
  rewrite: (url: URL) => ({ rewriteUrl: url, headers: new Headers() }),
  next: () => ({ rewriteUrl: null as URL | null, headers: new Headers() }),
};

async function serve(request: Request) {
  const rewritten = markdown.rewrite(MockNextResponse, request);
  if (!rewritten) return markdown.applyHeaders(request, MockNextResponse.next());
  return GET(new Request(rewritten.rewriteUrl, { method: request.method, headers: request.headers }));
}
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
Use an array such as `userAgents: ["MyAgent/"]` to replace these defaults with literal
substring tokens. `false` or an empty array disables automatic routing.

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
