import type {
  MarkdownCacheControl,
  MarkdownContext,
  MarkdownHandlerOptions,
  MarkdownHeaderOptions,
  MarkdownMatch,
  MarkdownNotFound,
  MarkdownResolver,
  MarkdownRoutingOptions,
  MarkdownTarget,
  ResponseLike,
  UserAgentsConfig,
  UserAgentsOption,
} from './runtime.js';

export type {
  MarkdownCacheControl,
  MarkdownContext,
  MarkdownHandlerOptions,
  MarkdownHeaderOptions,
  MarkdownMatch,
  MarkdownNotFound,
  MarkdownResolver,
  MarkdownRoutingOptions,
  MarkdownTarget,
  ResponseLike,
  UserAgentsConfig,
  UserAgentsOption,
};

export interface NextResponseRewriteLike<TResponse extends ResponseLike = Response> {
  rewrite(destination: URL, init?: { request?: { headers: Headers } }): TResponse;
}

export interface NextResponseLike<TResponse extends ResponseLike = Response>
  extends NextResponseRewriteLike<TResponse> {
  next(init?: { request?: { headers: Headers } }): TResponse;
}

export interface NextMarkdownOptions extends MarkdownRoutingOptions {
  route?: string;
}

export interface NextMarkdownRouteOptions {
  resolve: MarkdownResolver;
  index?: MarkdownResolver;
  attribution?: boolean;
  cacheControl?: MarkdownCacheControl;
  notFound?: MarkdownNotFound;
}

export interface NextMarkdownTesterOptions {
  /** Next.js proxy/middleware function (standalone or composed). */
  proxy: (request: Request) => Response | null | undefined | Promise<Response | null | undefined>;
  /** Next.js Markdown route handler (e.g., GET from app/api/markdown/route.ts). */
  route: (request: Request) => Response | Promise<Response>;
  /** Optional fallback handler simulating the Next.js app for pass-through requests. */
  fallback?: (request: Request) => Response | Promise<Response>;
  /** Internal Markdown route pathname if different from the default. */
  routePath?: string;
}

export interface NextMarkdownConfig {
  readonly options: Readonly<{
    route: string;
    exclude: readonly string[];
    userAgents: UserAgentsOption;
    match: MarkdownMatch | undefined;
    index: boolean;
  }>;
  /** Rewrite matching Markdown requests to the internal route, or return null for normal app routing. */
  rewrite<TResponse extends ResponseLike>(
    NextResponse: NextResponseRewriteLike<TResponse>,
    request: Request,
  ): TResponse | null;
  /** Apply Vary and alternate Markdown Link headers to an existing response for covered HTML pages. */
  applyHeaders<TResponse extends ResponseLike | null | undefined>(
    request: Request,
    response: TResponse,
  ): TResponse;
  /** Standalone Next.js proxy handler when no other middleware needs to compose with it. */
  proxy<TResponse extends ResponseLike>(
    NextResponse: NextResponseLike<TResponse>,
  ): (request: Request) => TResponse;
  /** GET/HEAD route handler paired with this routing configuration. */
  route(options: NextMarkdownRouteOptions): (request: Request) => Promise<Response>;
}

/**
 * Define shared routing configuration for a Next.js proxy and Markdown route handler.
 * Keep content resolvers out of this module so proxy.ts stays lightweight and Edge-safe.
 */
export function defineNextMarkdown(options?: NextMarkdownOptions): NextMarkdownConfig;

/**
 * Run a Next.js proxy and Markdown route handler together in tests without
 * reading Next.js internal middleware headers directly.
 */
export function createNextMarkdownTester(
  options: NextMarkdownTesterOptions,
): (input: Request | URL | string, init?: RequestInit) => Promise<Response>;

/**
 * NextResponse is supplied by the app so other frameworks do not install Next.js.
 * @deprecated Use defineNextMarkdown().proxy(NextResponse) instead.
 */
export function createNextMarkdownProxy<TResponse extends ResponseLike>(
  NextResponse: NextResponseLike<TResponse>,
  options?: NextMarkdownOptions,
): (request: Request) => TResponse;

/**
 * GET/HEAD route handler paired with createNextMarkdownProxy.
 * @deprecated Use defineNextMarkdown().route(options) instead.
 */
export function createNextMarkdownRoute(
  options: MarkdownHandlerOptions,
): (request: Request) => Promise<Response>;

/** Merge Vary and alternate Markdown Link discovery headers onto an eligible HTML response. */
export function applyMarkdownHeaders<TResponse extends ResponseLike | null | undefined>(
  request: Request,
  response: TResponse,
  options?: MarkdownHeaderOptions,
): TResponse;
