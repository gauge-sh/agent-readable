import { load } from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export const markdownPath = route => route === '/' ? '/index.md' : `${route.replace(/\/$/, '')}.md`;

export function convert(html, url, selector = 'main, article, [role="main"]', excludeSelectors = []) {
  const $ = load(html);
  const title = $('title').first().text().trim() || $('h1').first().text().trim() || new URL(url).pathname;
  const noindex = $('meta[name="robots"], meta[name="googlebot"]').toArray().some(el => /\b(noindex|none)\b/i.test($(el).attr('content') || ''));
  const root = $(selector).first();
  if (!root.length) throw new Error(`${url}: no content matching ${JSON.stringify(selector)}. Set contentSelector explicitly; body extraction is opt-in.`);
  if (!Array.isArray(excludeSelectors) || excludeSelectors.some(value => typeof value !== 'string' || !value.trim())) throw new Error('excludeSelectors must be an array of nonempty CSS selectors.');
  for (const selector of excludeSelectors) root.find(selector).remove();
  root.find('script, style, noscript, nav, [hidden], [aria-hidden="true"], [data-agent-readable="exclude"]').remove();
  root.find('a[href], img[src]').each((_, el) => {
    const attr = el.name === 'a' ? 'href' : 'src';
    const value = $(el).attr(attr);
    try {
      const resolved = new URL(value, url);
      const protocols = attr === 'href' ? ['http:', 'https:', 'mailto:', 'tel:'] : ['http:', 'https:'];
      if (protocols.includes(resolved.protocol)) $(el).attr(attr, resolved.href);
      else $(el).removeAttr(attr);
    } catch { $(el).removeAttr(attr); }
  });
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  td.use(gfm);
  let body = td.turndown(root.is('h1') ? $.html(root) : root.html()).trim();
  if (!body) throw new Error(`${url}: extracted content is empty.`);
  if (!root.is('h1') && !root.find('h1').length) body = `# ${title}\n\n${body}`;
  const description = $('meta[name="description"]').attr('content');
  const metadata = Object.entries({ title, url, description }).filter(([, v]) => v).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  return { title, noindex, markdown: `---\n${metadata}\n---\n\n${body}\n` };
}

export function addDiscovery(html, href) {
  const $ = load(html);
  $('link[rel="alternate"][type="text/markdown"]').remove();
  $('head').append($('<link>').attr({ rel: 'alternate', type: 'text/markdown', href }));
  return $.html();
}
