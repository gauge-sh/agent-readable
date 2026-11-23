# Serve custom Markdown

[Overview](https://github.com/gauge-sh/agent-readable/blob/main/README.md) · [Static sites](https://github.com/gauge-sh/agent-readable/blob/main/docs/static.md) · [Existing servers](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md)

Use custom Markdown when agents need a separately written version of a page:
product facts, a pricing explanation, API examples, or a concise description of an
interactive experience. It can differ from the HTML; it does not have to be a clone.

## Static sites: map a page to a file

Create `agent-content/pricing.md` in your project:

```markdown
# Pricing

Plans are billed per workspace. Contact sales for annual billing and volume pricing.

See https://example.com/pricing for current plans.
```

Add a mapping to `agent-readable.json`:

```json
{
  "site": "https://example.com",
  "input": "out",
  "markdown": {
    "/pricing": "agent-content/pricing.md"
  }
}
```

After the website and Markdown builds, browser requests to `/pricing` still get
the HTML page. `/pricing.md` and Markdown requests to `/pricing` get the file's
contents verbatim. Other pages continue to use automatic HTML conversion.

Use `"/"` as the mapping key to override homepage Markdown at `/index.md`.

### Mapping rules

- Keys identify **HTML page routes**, such as `/pricing`, not `/pricing.md`.
- The page must exist in the export and be eligible for Markdown generation.
  Mappings cannot create standalone routes or override an excluded/noindex page.
- Source files must be nonempty `.md` files inside the project and outside
  `.vercel`. Missing files, symlinks, and full HTML documents are rejected.
- The text is copied without added frontmatter, link rewriting, or HTML extraction.
  Write links that will work at the served URL; absolute URLs are easiest to reuse.
- To preserve an existing exported Markdown file, map it explicitly, for example
  `"/pricing": "out/pricing.md"`. Unmapped output collisions fail the build.

The generated index still uses the HTML page's title. The build manifest records
which pages use custom content, allowing the verifier to skip HTML-heading
comparison for those pages while retaining its HTTP checks.

A runnable mixed-content example is included in the repository:

```sh
node src/cli.js build --cwd examples/custom
```

## Runtime apps: return your own text

Runtime handlers always use content supplied by your application. The static
`markdown` mapping and `agent-readable.json` are not read at runtime.

```js
import { createMarkdownHandler } from 'agent-readable/runtime';

const handleMarkdown = createMarkdownHandler({
  resolve: ({ pathname }) => {
    if (pathname === '/pricing') return '# Pricing\n\nPlans are billed per workspace.\n';
    return null;
  },
});
```

This defines the Markdown handler; it still needs the [server integration](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md).
Your resolver can load files or CMS records and use query parameters. It must also
apply any authorization rules. Return `null` or `undefined` for a missing page;
return a string to serve it verbatim. Returning `null` from the resolver produces
a Markdown 404; it does not fall back to converting HTML.

Use [verification's runtime checks](https://github.com/gauge-sh/agent-readable/blob/main/docs/verification.md#runtime-content) when the
Markdown intentionally has different headings from the HTML.
