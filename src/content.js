import { load } from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export const markdownPath = route => route === '/' ? '/index.md' : `${route.replace(/\/$/, '')}.md`;

const tableBlockTags = 'div, p, li, h1, h2, h3, h4, h5, h6, ul, ol';

export function convert(html, url, selector = 'main, article, [role="main"]', excludeSelectors = []) {
  const $ = load(html);
  const title = $('title').first().text().trim() || $('h1').first().text().trim() || new URL(url).pathname;
  const noindex = $('meta[name="robots"], meta[name="googlebot"]').toArray().some(el => /\b(noindex|none)\b/i.test($(el).attr('content') || ''));
  const root = $(selector).first();
  if (!root.length) throw new Error(`${url}: no content matching ${JSON.stringify(selector)}. Set contentSelector explicitly; body extraction is opt-in.`);
  if (!Array.isArray(excludeSelectors) || excludeSelectors.some(value => typeof value !== 'string' || !value.trim())) throw new Error('excludeSelectors must be an array of nonempty CSS selectors.');
  for (const selector of excludeSelectors) root.find(selector).remove();
  // Remove agent-hidden regions first, then reveal data-agent-only regions before
  // generic [hidden]/[aria-hidden] stripping removes hidden UI elements.
  root.find('[data-agent-hidden], [data-agent-readable="exclude"]').remove();
  const agentOnly = root.find('[data-agent-only]');
  if (root.is('[data-agent-only]')) root.removeAttr('hidden').removeAttr('aria-hidden').removeAttr('data-agent-only');
  agentOnly.removeAttr('hidden').removeAttr('aria-hidden').removeAttr('data-agent-only');
  root.find('script, style, noscript, nav, [hidden], [aria-hidden="true"]').remove();
  // Drop explicitly decorative images (alt="").
  root.find('img[alt=""]').remove();
  // Preserve accessible names on animated headings (whose inner spans were aria-hidden)
  // and accessible icon SVGs (such as check/cross marks in comparison tables).
  const headings = root.is('h1, h2, h3, h4, h5, h6') ? root.add(root.find('h1, h2, h3, h4, h5, h6')) : root.find('h1, h2, h3, h4, h5, h6');
  headings.each((_, el) => {
    const node = $(el);
    const label = node.attr('aria-label')?.trim();
    if (!node.text().trim() && label) node.text(label);
  });
  root.find('svg[role="img"][aria-label], td svg[aria-label], th svg[aria-label]').each((_, el) => {
    const node = $(el);
    const label = node.attr('aria-label')?.trim();
    if (label && !node.text().trim()) node.replaceWith(label);
  });
  // Keep GFM pipe-table cells single-line when HTML uses stacked divs/paragraphs inside <th> or <td>.
  root.find('th, td').each((_, cell) => {
    const node = $(cell);
    node.find('br').replaceWith(' ');
    for (const block of node.find(tableBlockTags).toArray().reverse()) {
      const wrapped = $(block);
      const inner = wrapped.html();
      wrapped.replaceWith(inner ? ` ${inner} ` : ' ');
    }
  });
  // Insert a space between adjacent links/buttons separated only by flex/grid gap.
  root.find('a, button').each((_, el) => {
    const next = el.next;
    if (next?.type === 'tag' && (next.name === 'a' || next.name === 'button')) {
      $(el).after(' ');
    }
  });
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
  const metadata = Object.entries({ title, url, description }).filter(([, v]) => v).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  return { title, noindex, markdown: `---\n${metadata}\n---\n\n${body}\n` };
}

export function stripAgentOnly(html) {
  if (!html.includes('data-agent-only')) return html;
  const $ = load(html);
  $('[data-agent-only]').remove();
  return $.html();
}

export function addDiscovery(html, href) {
  const $ = load(html);
  $('[data-agent-only]').remove();
  $('link[rel="alternate"][type="text/markdown"]').remove();
  $('head').append($('<link>').attr({ rel: 'alternate', type: 'text/markdown', href }));
  return $.html();
}
