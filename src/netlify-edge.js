// This factory is embedded in the generated edge function; keep it self-contained.
export function createNetlifyHandler(pages, patterns, excludedPatterns, rejection, prefersMarkdown, llms) {
  const byRoute = new Map(pages.map(page => [page.route, page]));
  const byMarkdown = new Map(pages.map(page => [page.markdown, page]));
  const agents = patterns.map(([source, flags]) => new RegExp(source, flags));
  const excludedAgents = (excludedPatterns || []).map(([source, flags]) => new RegExp(source, flags));
  const rejects = new RegExp(rejection);
  return async function handler(request, context) {
    if (!['GET', 'HEAD'].includes(request.method)) return;
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const routePage = byRoute.get(route);
    const directPage = byMarkdown.get(url.pathname);
    const alternate = routePage?.markdown;
    const direct = Boolean(directPage);
    if (!alternate && !direct) return;
    // Let Netlify apply existing redirects and headers first.
    let response = await context.next();
    if (!response.ok) return response;
    const accept = request.headers.get('accept') || '';
    const ua = request.headers.get('user-agent') || '';
    const matchesAgent = agents.some(re => re.test(ua)) && !excludedAgents.some(re => re.test(ua));
    const negotiated = alternate && (prefersMarkdown(accept) || (!rejects.test(accept) && matchesAgent));
    if (negotiated) {
      await response.body?.cancel();
      const destination = new URL(alternate, url);
      destination.search = url.search;
      response = await fetch(destination, { method: request.method, redirect: 'manual', headers: { Accept: 'text/markdown' } });
    }
    const headers = new Headers(response.headers);
    const vary = new Set((headers.get('vary') || '').split(',').map(v => v.trim()).filter(Boolean));
    vary.add('Accept');
    if (agents.length) vary.add('User-Agent');
    headers.set('Vary', [...vary].join(', '));
    // Netlify's CDN must not reuse one negotiated representation for another.
    if (alternate) headers.set('Cache-Control', 'private, no-store');
    if ((direct || negotiated) && response.ok) {
      headers.set('Content-Type', 'text/markdown; charset=utf-8');
      headers.set('X-Content-Type-Options', 'nosniff');
      const page = directPage || routePage;
      const canonical = page.canonical || new URL(page.route, url.origin).href;
      const link = `<${canonical}>; rel="canonical"`;
      const existing = headers.get('link');
      if (!existing?.includes(link)) headers.set('Link', [existing, link].filter(Boolean).join(', '));
    } else if (!direct && !negotiated) {
      const link = `<${alternate}>; rel="alternate"; type="text/markdown"${llms ? ', </llms.txt>; rel="describedby"; type="text/plain"' : ''}`;
      headers.set('Link', [headers.get('link'), link].filter(Boolean).join(', '));
    }
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
