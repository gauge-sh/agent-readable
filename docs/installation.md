# Install agent-readable

[Overview](https://github.com/gauge-sh/agent-readable/blob/main/README.md) · [Static sites](https://github.com/gauge-sh/agent-readable/blob/main/docs/static.md) · [Existing servers](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md)

Use Node.js 22 or newer. For a static site, install agent-readable as a development dependency and include development dependencies in the site build. For a Next.js or Node server that serves Markdown at request time, install it as a production dependency.

## Install from npm

For a static site deployed to Vercel or Netlify, run this in your site directory.

```sh
npm install --save-dev agent-readable
```

For a Next.js or Node runtime integration, install the package alongside your server dependencies.

```sh
npm install agent-readable
```

## Install from source

From a checkout of `gauge-sh/agent-readable`:

```sh
npm ci
npm run check
npm pack
```

This creates `agent-readable-<version>.tgz`. Copy it into your site's `vendor/` directory.
Run the install command from your site's root, choosing the dependency type below.

| Integration | Install command | Why |
| --- | --- | --- |
| Static build | `npm install --save-dev ./vendor/agent-readable-<version>.tgz` | Runs during the website build |
| Runtime server | `npm install ./vendor/agent-readable-<version>.tgz` | Must be installed when the server runs |

Commit the tarball, package manifest, and lockfile to the site repository if the
host builds from Git.

Continue with [static sites](https://github.com/gauge-sh/agent-readable/blob/main/docs/static.md) or [existing servers](https://github.com/gauge-sh/agent-readable/blob/main/docs/runtime.md).
