import { patterns } from './agent-patterns.js';

const defaults = [new RegExp(`${patterns.agent.source}|curl/`, 'i'), patterns['ai-crawler']];
const allowedKeys = new Set(['defaults', 'include', 'exclude']);
const invalidMessage = 'userAgents must be a boolean, an array of nonempty user-agent tokens, or an object with defaults/include/exclude.';

function validateTokenList(list, label = 'userAgents') {
  if (!Array.isArray(list) || list.some(token => typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token))) {
    throw new TypeError(`${label} must be an array of nonempty user-agent tokens.`);
  }
}

function compileLiterals(tokens) {
  if (!tokens.length) return [];
  const literals = tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return [new RegExp(literals.join('|'), 'i')];
}

export function parseUserAgents(value = false) {
  if (value === true) return { include: defaults, exclude: [] };
  if (value === false) return { include: [], exclude: [] };
  if (Array.isArray(value)) {
    validateTokenList(value);
    return { include: compileLiterals(value), exclude: [] };
  }
  if (!value || typeof value !== 'object') {
    throw new TypeError(invalidMessage);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new TypeError(`Unknown userAgents option: ${key}`);
  }
  if (value.defaults !== undefined && typeof value.defaults !== 'boolean') {
    throw new TypeError('userAgents.defaults must be a boolean.');
  }
  if (value.include !== undefined) validateTokenList(value.include, 'userAgents.include');
  if (value.exclude !== undefined) validateTokenList(value.exclude, 'userAgents.exclude');
  const include = [
    ...(value.defaults === false ? [] : defaults),
    ...compileLiterals(value.include || []),
  ];
  const exclude = compileLiterals(value.exclude || []);
  return { include, exclude };
}

export function userAgentMatchers(value = false) {
  return parseUserAgents(value).include;
}

// An automatic fallback must not override an explicit Markdown rejection.
export const markdownRejection = '[tT][eE][xX][tT]/(?:[xX]-)?[mM][aA][rR][kK][dD][oO][wW][nN][^,]*;\\s*[qQ]\\s*=\\s*0(?:\\.0*)?(?:\\s*[,;]|\\s*$)';
const rejectsMarkdown = new RegExp(markdownRejection);

export function matchesUserAgent(request, value) {
  if (rejectsMarkdown.test(request.headers.get('accept') || '')) return false;
  const { include, exclude } = parseUserAgents(value);
  if (!include.length) return false;
  const ua = request.headers.get('user-agent') || '';
  return include.some(matcher => matcher.test(ua))
    && !exclude.some(matcher => matcher.test(ua));
}
