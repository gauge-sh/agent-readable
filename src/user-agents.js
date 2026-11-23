import { patterns } from '@mintlify/agent-traffic';

const defaults = [new RegExp(`${patterns.agent.source}|curl/`, 'i'), patterns['ai-crawler']];

export function userAgentMatchers(value = false) {
  if (value === true) return defaults;
  if (value === false) return [];
  if (!Array.isArray(value) || value.some(token => typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token))) {
    throw new TypeError('userAgents must be a boolean or an array of nonempty user-agent tokens.');
  }
  if (!value.length) return [];
  const literals = value.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return [new RegExp(literals.join('|'), 'i')];
}
// An automatic fallback must not override an explicit Markdown rejection.
export const markdownRejection = '[tT][eE][xX][tT]/(?:[xX]-)?[mM][aA][rR][kK][dD][oO][wW][nN][^,]*;\\s*[qQ]\\s*=\\s*0(?:\\.0*)?(?:\\s*[,;]|\\s*$)';
const rejectsMarkdown = new RegExp(markdownRejection);
export function matchesUserAgent(request, value) {
  return !rejectsMarkdown.test(request.headers.get('accept') || '')
    && userAgentMatchers(value).some(matcher => matcher.test(request.headers.get('user-agent') || ''));
}
