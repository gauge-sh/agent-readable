export interface UserAgentsConfig {
  /** Include the built-in Mintlify agent/crawler patterns and curl/. Defaults to true when using an object. */
  defaults?: boolean;
  /** Additional literal User-Agent substring tokens to match (case-insensitive). */
  include?: readonly string[];
  /** Literal User-Agent substring tokens to exclude from matching (case-insensitive). */
  exclude?: readonly string[];
}

export type UserAgentsOption = boolean | readonly string[] | UserAgentsConfig;

export type MarkdownMatch = (pathname: string) => boolean;

export interface MarkdownTarget {
  pathname: string;
  searchParams: URLSearchParams;
  index: boolean;
}

export interface MarkdownContext extends MarkdownTarget {
  request: Request;
}

export interface MarkdownHeaderOptions {
  exclude?: readonly string[];
  userAgents?: UserAgentsOption;
  match?: MarkdownMatch;
}

export interface MarkdownRoutingOptions extends MarkdownHeaderOptions {
  index?: boolean;
}

export type MarkdownResolver = (
  context: MarkdownContext,
) => string | null | undefined | Promise<string | null | undefined>;

export type MarkdownCacheControl =
  | string
  | ((context: MarkdownContext) => string | null | undefined | Promise<string | null | undefined>);

export type MarkdownNotFound =
  | string
  | ((context: MarkdownContext) => string | Promise<string>);

export interface MarkdownHandlerOptions extends MarkdownHeaderOptions {
  resolve: MarkdownResolver;
  index?: MarkdownResolver | false;
  attribution?: boolean;
  /** Optional trusted HTTP(S) origin for absolute canonical Link headers on Markdown responses. */
  origin?: string;
  cacheControl?: MarkdownCacheControl;
  notFound?: MarkdownNotFound;
}

export interface ResponseLike {
  headers: Headers;
  status?: number;
}

/** Explicit Markdown opt-in, with exact media types overriding wildcard ranges. */
export function prefersMarkdown(accept?: string): boolean;

/** Returns a page target, or null when the request belongs to the existing app. */
export function resolveMarkdownRequest(
  request: Request,
  options?: MarkdownRoutingOptions,
): MarkdownTarget | null;

/** HTTP discovery header value, retaining query-dependent page variants. */
export function markdownDiscovery(url: string | URL): string;

/** Merge Vary and alternate Markdown Link discovery headers onto an eligible HTML response. */
export function applyMarkdownHeaders<TResponse extends ResponseLike | null | undefined>(
  request: Request,
  response: TResponse,
  options?: MarkdownHeaderOptions,
): TResponse;

/** Create a framework-independent Web Request/Response Markdown handler. */
export function createMarkdownHandler(
  options: MarkdownHandlerOptions,
): (request: Request) => Promise<Response | null>;
