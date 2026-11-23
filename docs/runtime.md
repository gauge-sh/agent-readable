# Existing servers

[Overview](https://github.com/gauge-sh/agent-readable/blob/main/README.md) · [Installation](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md) · [Verification](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md)

Use runtime handlers when your app already has a Markdown renderer, needs fresh CMS
content, or serves different content based on query parameters. Your application
supplies the Markdown; the package handles Markdown requests and content negotiation.
It does not extract HTML from SSR responses or load content automatically.

## Choose the server adapter

| Integration | Requirement | Responsibility |
| --- | --- | --- |
| `agent-readable/node` | Control over a persistent Node HTTP server | Wrap your existing handler; the adapter adds final HTML discovery and `Vary` headers |
| `agent-readable/runtime` | A server adapter using Web `Request` / `Response` | Call the handler, delegate other requests, and add discovery and `Vary` to final HTML responses |

**Managed Vercel SSR/serverless is not a ready-made integration.** The tested Node
path uses a custom HTTP server. A standard request API alone does not establish
compatibility with a host's routing, middleware, or response lifecycle. Next.js
standalone output also needs a separately supported integration.

Install the package as a **production dependency** using the
[installation guide](https://github.com/gauge-sh/agent-readable/blob/main/docs/installation.md).
Keep your existing framework build. Runtime integrations do not use
`agent-readable build`, `setup-vercel`, or `agent-readable.json`.

## Node HTTP server

This complete example serves HTML and separately authored Markdown for `/pricing`.
Save it as `server.mjs` and run `node server.mjs` after installing the package:

```js
import { createServer } from 'node:http';
import { createNodeMarkdownHandler } from 'agent-readable/node';

const handle = createNodeMarkdownHandler({
  origin: 'http://localhost:3000',
  resolve: ({ pathname }) => pathname === '/pricing'
    ? '# Pricing\n\nPlans are billed per workspace.\n'
    : null,
  index: () => '# Example site\n\n- [Pricing](http://localhost:3000/pricing.md)\n',
}, (req, res) => {
  const pathname = new URL(req.url, 'http://localhost:3000').pathname;
  res.writeHead(pathname === '/pricing' ? 200 : 404, {
    'Content-Type': 'text/html; charset=utf-8',
  });
  res.end(pathname === '/pricing'
    ? '<!doctype html><html><head><link rel="alternate" type="text/markdown" href="/pricing.md"></head><body><main><h1>Pricing</h1><p>Plans are billed per workspace.</p></main></body></html>'
    : '<h1>Not found</h1>');
});

createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  });
}).listen(3000);
```

Try the HTML page and both Markdown request forms:

```sh
curl http://localhost:3000/pricing
curl http://localhost:3000/pricing.md
curl -H 'Accept: text/markdown' http://localhost:3000/pricing
```

In your application, replace the example HTML handler with your existing Node
request handler, and replace `resolve` and `index` with your content functions.
Set `origin` to the externally visible HTTP(S) origin, without a path, query,
credentials, or fragment.

### Next.js apps

Use the [Next.js adapter guide](https://github.com/gauge-sh/agent-readable/blob/main/docs/next.md)
for reusable Proxy/route factories and the custom-server helper. You do not need
to duplicate rewrite logic or server error handling in each application.

Your page template must still include an HTML alternate link, as the Node example
does. Runtime handlers add HTTP headers, not elements inside your HTML. The shared
verifier checks both forms of discovery.

## Resolver contract

```js
createMarkdownHandler({
  resolve: async ({ pathname, searchParams, request }) => {
    // Load your content and apply your access rules here.
    // Return a Markdown string, or null/undefined when unavailable.
  },
});
```

| Option | Purpose |
| --- | --- |
| `resolve` | Required function returning a Markdown string or `null`/`undefined`; promises are supported |
| `index` | Optional function with the same context, providing the index for `/llms.txt` and `/lm.txt` |
| `attribution` | Defaults to `false`; `true` appends Gauge attribution to the supplied index only |
| `exclude` | URL prefixes delegated to the app; defaults to `['/api', '/_next']`. Supplying a list replaces those defaults |
| `origin` | Required by the Node adapter only; the externally visible HTTP(S) origin |

For `/pricing.md?plan=annual`, the resolver receives `pathname: '/pricing'` and
`searchParams.get('plan') === 'annual'`. The `request` includes incoming headers
for your authorization logic. Resolve content only after applying access rules;
wrapping a framework handler does not automatically run that framework's auth
middleware before the Markdown resolver.

Strings are served verbatim. `null` or `undefined` produces a Markdown 404;
omitting `index` makes index requests return 404. Resolver errors propagate to
your server's error handler. Other return types throw a `TypeError`.

## Request behavior

| Request | Behavior |
| --- | --- |
| `/pricing.md` | Resolve `/pricing` directly |
| `/index.md` or `/.md` | Resolve `/` |
| `/pricing` with explicit `text/markdown` or `text/x-markdown` | Resolve Markdown when its quality is at least HTML's quality |
| `Accept: text/markdown;q=0` or wildcard-only Accept | Delegate to the app |
| `/llms.txt` or `/lm.txt` | Use the optional `index` callback |
| `HEAD` | Same status and headers as `GET`, with no body |
| Other methods, excluded routes, ordinary assets | Delegate to the app |

Markdown responses use `Content-Type: text/markdown`; index responses use
`text/plain`. Both include `Cache-Control: no-store`, `Vary: Accept`, and
`X-Content-Type-Options: nosniff`. Successful Markdown responses include a discovery
`Link` retaining the query string. The package does not add application caching.

Quality ranking honors exact media types over wildcards and compares Markdown
against HTML/XHTML. Equal quality favors explicit Markdown. These runtime rules
are more extensive than the static Vercel rules.

## Web Request/Response adapter

Use `createMarkdownHandler` from `agent-readable/runtime` when building your own
server adapter. This subpath uses Web APIs without the build-time filesystem stack.

The handler returns a `Response` for a Markdown request and **`null` when the
request should continue to your application**. This differs from a resolver
returning `null`, which produces a 404 response.

```js
import { createMarkdownHandler } from 'agent-readable/runtime';

const handleMarkdown = createMarkdownHandler({
  resolve: ({ pathname }) => pathname === '/pricing'
    ? '# Pricing\n\nPlans are billed per workspace.\n'
    : null,
});

// Inside your adapter's request function:
// const response = await handleMarkdown(request);
// if (response !== null) return response;
// Otherwise call your existing app and handle its final HTML response below.
```

A complete adapter must also:

1. Delegate unhandled requests to the application.
2. Merge `Accept` into the final page response's `Vary` header, preserving existing
   values and `*`.
3. Add the alternate Markdown `Link` to successful eligible HTML page responses,
   preserving existing links. `markdownDiscovery(request.url)` returns its value.
4. Include an HTML alternate link in your page template, as described above.
5. Preserve cookies, streaming behavior, and framework-specific response headers.
6. Run the [deployed verifier](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md)
   and application tests against the actual host.

The bare handler cannot decorate an HTML response it never receives. Setting
headers in an early middleware layer may be insufficient if the framework later
overwrites them. Prefer the Node adapter when its hosting requirements fit.

Additional exports are `prefersMarkdown(accept)`, `resolveMarkdownRequest(request,
options)`, and `markdownDiscovery(url)` for custom adapters. They are building
blocks, not automatic framework integrations.

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
