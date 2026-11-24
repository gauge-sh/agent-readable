import type { MarkdownContext, MarkdownResolver } from './runtime.js';
export interface HtmlMarkdownOptions {
  /** Fixed, trusted application origin. Never populate from an untrusted Host header. */
  origin?: string;
  /** Alternative to origin: read HTML through your own authorized application integration. */
  fetchHtml?: (context: MarkdownContext & { url: URL }) => Response | Promise<Response>;
  contentSelector?: string;
  excludeSelectors?: readonly string[];
}
/** Node-only resolver using existing page HTML and inline agent controls. Defaults to uncached fetches. */
export function createHtmlMarkdownResolver(options: HtmlMarkdownOptions): MarkdownResolver;
