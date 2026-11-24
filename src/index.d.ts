import type { UserAgentsOption } from './runtime.js';

export {
  prefersMarkdown,
  resolveMarkdownRequest,
  markdownDiscovery,
  applyMarkdownHeaders,
  createMarkdownHandler,
} from './runtime.js';

export type * from './runtime.js';

export interface AgentReadableConfig {
  target?: 'vercel' | 'netlify';
  site: string;
  input: string;
  contentSelector?: string;
  excludeSelectors?: string[];
  exclude?: string[];
  llms?: boolean;
  llmsFull?: boolean;
  attribution?: boolean;
  userAgents?: UserAgentsOption;
  trailingSlash?: boolean;
  markdown?: Record<string, string>;
}

export interface BuildManifestPage {
  route: string;
  file: string;
  markdown: string;
  title: string;
  source: 'html' | 'custom';
  sourceFile?: string;
  bytes: number;
}

export interface BuildManifest {
  target?: 'vercel' | 'netlify';
  version: number;
  site: string;
  pages: BuildManifestPage[];
  skipped: string[];
}

export interface RoutePage {
  route: string;
  file: string;
  markdown?: string;
}

export interface VercelRouteCondition {
  type: 'header' | 'cookie' | 'host' | 'query';
  key: string;
  value?: string;
}

export interface VercelRoute {
  src?: string;
  dest?: string;
  methods?: string[];
  headers?: Record<string, string>;
  status?: number;
  continue?: boolean;
  handle?: string;
  has?: VercelRouteCondition[];
  missing?: VercelRouteCondition[];
}

export interface RoutesForOptions {
  site?: string;
  userAgents?: UserAgentsOption;
  exclude?: readonly string[];
  trailingSlash?: boolean;
  redirects?: readonly VercelRoute[];
  headers?: readonly VercelRoute[];
  llms?: boolean;
  llmsFull?: boolean;
}

export interface ConvertResult {
  title: string;
  noindex: boolean;
  markdown: string;
}

export interface CheckResultItem {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface CheckPageResult {
  url: string;
  ok: boolean;
  checks: CheckResultItem[];
}

export interface CheckResult {
  ok: boolean;
  pages: CheckPageResult[];
}

export interface CheckOptions {
  manifest?: Pick<BuildManifest, 'pages'>;
  skipHeadingCheck?: boolean;
  headers?: Record<string, string>;
}

export interface CheckLocalOptions {
  target?: 'vercel' | 'netlify';
  paths?: readonly string[];
  skipHeadingCheck?: boolean;
  headers?: Record<string, string>;
}

export interface VercelConfig {
  framework?: string | null;
  buildCommand?: string;
  outputDirectory?: string | null;
  trailingSlash?: boolean;
  redirects?: Array<{
    source: string;
    destination: string;
    statusCode?: number;
    permanent?: boolean;
    has?: VercelRouteCondition[];
    missing?: VercelRouteCondition[];
  }>;
  headers?: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
    has?: VercelRouteCondition[];
    missing?: VercelRouteCondition[];
  }>;
  [key: string]: unknown;
}

export function init(cwd: string, site: string, input?: string): Promise<AgentReadableConfig>;

export function build(cwd: string, options?: { target?: 'vercel' | 'netlify' }): Promise<BuildManifest>;

export function routesFor(
  pages: readonly RoutePage[],
  htmlPages?: readonly RoutePage[],
  options?: RoutesForOptions,
): VercelRoute[];

export function convert(
  html: string,
  url: string,
  selector?: string,
  excludeSelectors?: readonly string[],
): ConvertResult;

export function markdownPath(route: string): string;

export function stripAgentOnly(html: string): string;

export function checkPage(
  url: string,
  options?: { skipHeadingCheck?: boolean; headers?: Record<string, string> },
): Promise<CheckPageResult>;

export function check(
  site: string,
  paths?: readonly string[],
  options?: CheckOptions,
): Promise<CheckResult>;

export function checkLocal(
  cwd: string,
  options?: CheckLocalOptions,
): Promise<CheckResult>;

export function setupVercel(cwd: string, buildCommand: string): Promise<VercelConfig>;

export function validateVercel(cwd: string, cloud?: boolean): Promise<VercelConfig>;

export function compileVercelRoutes(config?: VercelConfig): {
  redirects: VercelRoute[];
  headers: VercelRoute[];
};

export function setupNetlify(cwd: string, buildCommand: string): Promise<Record<string, unknown>>;
