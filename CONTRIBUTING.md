# Contributing

Issues are welcome for bug reports, questions, and suggestions. For bugs, include your agent-readable and Node.js versions and a small example that reproduces the problem. For routing issues, include the hosting platform and relevant response headers. Remove credentials and private site content before sharing. To report a vulnerability, follow the [security policy](SECURITY.md).

Gauge maintains this project and decides which changes to merge. A fork is the preferred place to build and share a customization. If others would benefit from a change in your fork, open an issue describing the use case and link to the change. Maintainers periodically review community work and may bring it upstream.

To build and test a fork, use Node.js 22 or newer and npm. Run `npm ci`, then `npm run check`. The checks include a packed-install test that needs npm registry access. Use `npm run demo` to build the included example.

Contributions are licensed under the [MIT license](LICENSE).
