import { createServer } from 'node:http';
import { createNodeMarkdownHandler } from './node.js';

/** Prepare a Next application and return an unbound Node HTTP server. */
export async function createNextMarkdownServer(app, options) {
  if (typeof app?.prepare !== 'function' || typeof app?.getRequestHandler !== 'function') throw new TypeError('Pass the application returned by next().');
  const handle = createNodeMarkdownHandler(options, app.getRequestHandler());
  await app.prepare();
  return createServer((req, res) => {
    handle(req, res).catch(error => {
      console.error(error);
      if (res.headersSent) { res.destroy(error); return; }
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Internal server error');
    });
  });
}
