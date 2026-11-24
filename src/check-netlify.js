import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { check } from './check.js';
import { netlifyOutput } from './netlify.js';

// Local routing check only: Netlify redirects, plugins and CDN behavior require deployment testing.
export async function checkNetlifyLocal(cwd, { paths, skipHeadingCheck, headers } = {}) {
  const output = path.resolve(cwd, netlifyOutput);
  const root = path.join(output, 'static');
  let artifact;
  try { artifact = await readFile(path.join(output, '.agent-readable'), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('No Netlify static artifact found. Run agent-readable build --target netlify first. For runtime Next.js, start the app and pass its running server URL: agent-readable check http://localhost:3000');
    throw error;
  }
  const manifest = JSON.parse(artifact);
  const source = await readFile(path.join(cwd, '.netlify/v1/edge-functions/agent-readable.js'), 'utf8');
  const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const server = createServer(async (req, res) => {
    try {
      const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, { method: req.method, headers: req.headers });
      const next = async () => {
        const pathname = decodeURIComponent(new URL(request.url).pathname);
        const rel = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
        for (const candidate of rel ? [rel, `${rel}/index.html`, `${rel}.html`] : ['index.html']) {
          const file = path.resolve(root, candidate);
          if (!file.startsWith(root + path.sep)) continue;
          try {
            const body = await readFile(file);
            const type = file.endsWith('.md') ? 'text/markdown' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
            return new Response(req.method === 'HEAD' ? null : body, { headers: { 'Content-Type': type } });
          } catch { /* next candidate */ }
        }
        return new Response('Not found', { status: 404 });
      };
      const response = await handler(request, { next }) || await next();
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await check(`http://127.0.0.1:${server.address().port}`, paths || manifest.pages.map(p => p.route), { manifest, skipHeadingCheck, headers });
  } finally { server.closeAllConnections(); server.close(); }
}
