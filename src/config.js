import path from 'node:path';
import { userAgentMatchers } from './user-agents.js';
import { lstat } from 'node:fs/promises';

export function validateConfig(config, cwd) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('agent-readable.json must contain an object.');
  const allowed = ['site', 'input', 'contentSelector', 'excludeSelectors', 'exclude', 'llms', 'llmsFull', 'markdown', 'attribution', 'userAgents', 'trailingSlash'];
  for (const key of Object.keys(config)) if (!allowed.includes(key)) throw new Error(`Unknown configuration option: ${key}`);
  userAgentMatchers(config.userAgents);
  if (config.trailingSlash !== undefined && typeof config.trailingSlash !== 'boolean') throw new Error('trailingSlash must be a boolean.');
  const site = new URL(config.site);
  if (!['http:', 'https:'].includes(site.protocol) || site.pathname !== '/' || site.search || site.hash || site.username || site.password) throw new Error('site must be an HTTP(S) origin.');
  const input = config.input ?? 'out';
  if (typeof input !== 'string' || !input.trim()) throw new Error('input must be a nonempty project subdirectory.');
  const resolved = path.resolve(cwd, input);
  const relative = path.relative(cwd, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.split(path.sep)[0] === '.vercel') throw new Error('input must be a project subdirectory outside .vercel.');
  if (config.contentSelector !== undefined && (typeof config.contentSelector !== 'string' || !config.contentSelector.trim())) throw new Error('contentSelector must be a nonempty CSS selector.');
  for (const key of ['exclude', 'excludeSelectors']) {
    if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key].some(v => typeof v !== 'string' || !v.trim()))) throw new Error(`${key} must be an array of nonempty strings.`);
  }
  if (config.exclude?.some(v => !v.startsWith('/') || v.startsWith('//') || /[?#]/.test(v))) throw new Error('exclude entries must be absolute URL paths without queries or fragments.');
  if (config.llms !== undefined && typeof config.llms !== 'boolean') throw new Error('llms must be a boolean.');
  if (config.llmsFull !== undefined && typeof config.llmsFull !== 'boolean') throw new Error('llmsFull must be a boolean.');
  if (config.attribution !== undefined && typeof config.attribution !== 'boolean') throw new Error('attribution must be a boolean.');
  const markdown = new Map();
  if (config.markdown !== undefined) {
    if (!config.markdown || typeof config.markdown !== 'object' || Array.isArray(config.markdown)) throw new Error('markdown must map page URL paths to project-relative Markdown files.');
    for (const [route, file] of Object.entries(config.markdown)) {
      if (!route.startsWith('/') || route.includes('//') || /[?#%\\<>\s]/.test(route) || route.split('/').some(segment => ['.', '..'].includes(segment))) throw new Error(`Invalid Markdown page route: ${route}`);
      const normalized = route === '/' ? '/' : route.replace(/\/$/, '');
      if (markdown.has(normalized)) throw new Error(`Duplicate Markdown page route: ${normalized}`);
      if (typeof file !== 'string' || !file.trim() || path.isAbsolute(file) || !/\.md$/i.test(file)) throw new Error(`Markdown source for ${route} must be a project-relative .md file.`);
      const source = path.resolve(cwd, file);
      const relativeSource = path.relative(cwd, source);
      if (relativeSource === '..' || relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource) || relativeSource.split(path.sep)[0] === '.vercel') throw new Error(`Markdown source must stay inside the project and outside .vercel: ${file}`);
      markdown.set(normalized, { path: source, file: relativeSource.split(path.sep).join('/') });
    }
  }
  return { site, input: resolved, markdown };
}

// Check every existing path component, including the export root and .vercel.
// Walking the files alone does not catch symlinked parent directories.
export async function rejectSymlinks(cwd, target) {
  let current = cwd;
  for (const component of path.relative(cwd, target).split(path.sep)) {
    current = path.join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlinks are not supported: ${current}`);
    } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
}
