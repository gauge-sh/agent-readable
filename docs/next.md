# Next.js integration

[Overview](https://github.com/gauge-sh/agent-readable/blob/main/README.md) · [Installation](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md) · [Verification](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md)

Use the Next.js adapter for an App Router application that supplies its own
Markdown. The package owns content negotiation, Markdown routing, query
preservation, index aliases, and HTTP response construction. Your app owns its
content, access rules, and HTML metadata.

**Choose the response path before deploying.** Proxy and route handlers work with
Next.js routing, but Next.js 16.4.6 overwrites HTML `Vary: Accept` after Proxy runs.
The custom-server helper fixes this at the final HTTP response step. Managed
Vercel/serverless behavior is not validated; the helper needs a persistent Node
server. This adapter does not turn an SSR app into a static export.

## 1. Define your content callbacks

[Install the candidate as a production dependency](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md).
Create `lib/markdown-options.js`:

```js
import { pageMarkdown, machineIndex } from './markdown.js';

export const markdownOptions = {
  resolve: ({ pathname, searchParams, request }) =>
    pageMarkdown({ pathname, searchParams, request }),
  index: () => machineIndex(),
};
```

`pageMarkdown` and `machineIndex` are **your functions**, not package exports.
Return a Markdown string, or `null`/`undefined` for a missing page. Apply access
rules in your resolver. See the [runtime contract](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md#resolver-contract)
for query parameters, attribution, exclusions, and response behavior.

## 2. Connect Next.js routing

Create `proxy.js` at the app root:

```js
import { NextResponse } from 'next/server';
import { createNextMarkdownProxy } from 'agent-readable/next';

export const proxy = createNextMarkdownProxy(NextResponse);
export const config = { matcher: ['/((?!_next/|favicon\\.).*)'] };
```

Create `app/api/markdown/route.js`:

```js
import { createNextMarkdownRoute } from 'agent-readable/next';
import { markdownOptions } from '../../../lib/markdown-options.js';

export const GET = createNextMarkdownRoute(markdownOptions);
export const HEAD = GET;
```

The proxy delegates matching requests to the route. The package carries the
original pathname and query string together in an internal rewrite parameter,
then restores both before invoking the resolver. Repeated keys and even keys with
the same name as the internal parameter are preserved without collisions.
Direct calls to the internal route without a valid target return 404; this is not
an authorization boundary. Your resolver must still enforce access rules.

Supply `NextResponse` from your installed Next.js version. Other frameworks can
use agent-readable without installing Next.js. Keep content imports in the route,
not in the proxy.

If your app already has a Proxy, compose this handler with it explicitly. Do not
overwrite existing authentication or redirects. For a different endpoint, pass
`{ route: '/api/agent-content' }` as the proxy factory's second argument and place
the route file there. `exclude` replaces the default `['/api', '/_next']` prefixes;
use the same exclusions in the proxy options and content options. The proxy always
excludes its own endpoint to prevent rewrite loops.

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
import { markdownOptions } from './lib/markdown-options.js';

const hostname = '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const server = await createNextMarkdownServer(next({ dev: false, hostname, port }), {
  ...markdownOptions,
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

Run the [HTTP verifier](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md)
against the server you intend to deploy, plus your existing application tests.
Do not infer managed-host support from a local custom-server result.

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
handlers, pass `userAgents: true` in the handler options. With the Next.js proxy
and route integration, pass the same option to **both** factories.

Automatic routing applies only to GET/HEAD page requests; existing exclusions and
asset handling still apply. Browsers without a matching token continue to receive
HTML. Matching agents receive Markdown even with `Accept: text/html`, but an
explicit Markdown `q=0` rejection disables this fallback. Direct `.md` URLs remain
available. Responses that vary by this option use `Vary: Accept, User-Agent`;
custom Web adapters must also merge User-Agent into their HTML response's Vary.
User-agent matching is a representation preference, not authentication.
