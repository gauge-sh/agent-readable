import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const incompatible = ['routes', 'rewrites', 'cleanUrls', 'builds', 'functions'];
const validStatuses = new Set([301, 302, 303, 307, 308]);
const validConditionTypes = new Set(['header', 'cookie', 'host', 'query']);
const escapeChar = ch => (/[.+*?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch);
async function exists(file) { try { await access(file); return true; } catch { return false; } }

function scanGroup(source, start) {
  let depth = 0;
  let inClass = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[' && !inClass) { inClass = true; continue; }
    if (ch === ']' && inClass) { inClass = false; continue; }
    if (inClass) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error(`Unclosed group in vercel.json source pattern: ${source}`);
}

function countCaptures(pattern) {
  let count = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[' && !inClass) { inClass = true; continue; }
    if (ch === ']' && inClass) { inClass = false; continue; }
    if (inClass) continue;
    if (ch === '(' && pattern[i + 1] !== '?') count++;
    else if (ch === '(' && pattern[i + 1] === '?' && pattern[i + 2] === '<' && !['=', '!'].includes(pattern[i + 3])) count++;
  }
  return count;
}

export function compileVercelSource(source) {
  if (typeof source !== 'string' || !source.startsWith('/') || /[\r\n]/.test(source)) {
    throw new Error(`Invalid vercel.json source path: ${source}`);
  }
  let out = '';
  let groupIndex = 0;
  const params = [];
  for (let i = 0; i < source.length;) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length) {
      out += ch + source[i + 1];
      i += 2;
    } else if (ch === '(') {
      const end = scanGroup(source, i);
      const group = source.slice(i, end);
      out += group;
      groupIndex += countCaptures(group);
      i = end;
    } else if (ch === ':' && /[A-Za-z_]/.test(source[i + 1] || '')) {
      const match = /^:([A-Za-z_][A-Za-z0-9_]*)/.exec(source.slice(i));
      const name = match[1];
      groupIndex += 1;
      params.push({ name, index: groupIndex });
      i += match[0].length;
      if (source[i] === '(') {
        const end = scanGroup(source, i);
        const inner = source.slice(i + 1, end - 1);
        out += `(${inner})`;
        groupIndex += countCaptures(inner);
        i = end;
      } else if (source[i] === '*') {
        if (out.endsWith('/')) out = `${out.slice(0, -1)}(?:/(.*))?`;
        else out += '(.*)';
        i++;
      } else if (source[i] === '+') {
        out += '(.+)';
        i++;
      } else if (source[i] === '?') {
        if (out.endsWith('/')) out = `${out.slice(0, -1)}(?:/([^/]+))?`;
        else out += '([^/]+)?';
        i++;
      } else {
        out += '([^/]+)';
      }
    } else {
      out += escapeChar(ch);
      i++;
    }
  }
  const src = `^${out}$`;
  try { new RegExp(src); } catch (error) { throw new Error(`Invalid vercel.json source pattern ${source}: ${error.message}`); }
  return { src, params };
}

function validateConditions(conditions, field) {
  if (conditions === undefined) return undefined;
  if (!Array.isArray(conditions)) throw new Error(`vercel.json ${field} must be an array.`);
  return conditions.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid vercel.json ${field} condition.`);
    if (!validConditionTypes.has(item.type)) throw new Error(`Unsupported vercel.json ${field} condition type: ${item.type}`);
    if (typeof item.key !== 'string' || !item.key.trim() || /[\r\n]/.test(item.key)) throw new Error(`Invalid vercel.json ${field} condition key.`);
    if (item.value !== undefined) {
      if (typeof item.value !== 'string' || /[\r\n]/.test(item.value)) throw new Error(`Invalid vercel.json ${field} condition value.`);
      try { new RegExp(item.value); } catch (error) { throw new Error(`Invalid vercel.json ${field} regex: ${error.message}`); }
    }
    return { type: item.type, key: item.key, ...(item.value !== undefined ? { value: item.value } : {}) };
  });
}

function applyDestinationParams(destination, params) {
  let result = destination;
  for (const { name, index } of params) {
    result = result.replace(new RegExp(`:${name}[*+?]?(?![A-Za-z0-9_])`, 'g'), `$${index}`);
  }
  return result;
}

export function compileVercelRoutes(config = {}) {
  const redirects = [];
  if (config.redirects !== undefined) {
    if (!Array.isArray(config.redirects)) throw new Error('vercel.json redirects must be an array.');
    for (const rule of config.redirects) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('Each vercel.json redirect must be an object.');
      const { src, params } = compileVercelSource(rule.source);
      if (typeof rule.destination !== 'string' || !rule.destination.trim() || /[\r\n]/.test(rule.destination)) {
        throw new Error(`Invalid vercel.json redirect destination for ${rule.source}.`);
      }
      const isRootRelative = rule.destination.startsWith('/') && !rule.destination.startsWith('//');
      const isHttpUrl = /^https?:\/\//i.test(rule.destination);
      if (!isRootRelative && !isHttpUrl) {
        throw new Error(`vercel.json redirect destination must be a root-relative path or HTTP(S) URL: ${rule.destination}`);
      }
      if (rule.statusCode !== undefined && !validStatuses.has(rule.statusCode)) {
        throw new Error(`Unsupported vercel.json redirect statusCode: ${rule.statusCode}`);
      }
      if (rule.permanent !== undefined && typeof rule.permanent !== 'boolean') {
        throw new Error(`vercel.json redirect permanent must be a boolean for ${rule.source}.`);
      }
      const status = rule.statusCode ?? (rule.permanent === false ? 307 : 308);
      const has = validateConditions(rule.has, 'has');
      const missing = validateConditions(rule.missing, 'missing');
      redirects.push({
        src,
        ...(has ? { has } : {}),
        ...(missing ? { missing } : {}),
        status,
        headers: { Location: applyDestinationParams(rule.destination, params) },
      });
    }
  }
  const headers = [];
  if (config.headers !== undefined) {
    if (!Array.isArray(config.headers)) throw new Error('vercel.json headers must be an array.');
    for (const rule of config.headers) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('Each vercel.json headers entry must be an object.');
      const { src } = compileVercelSource(rule.source);
      if (!Array.isArray(rule.headers)) throw new Error(`vercel.json headers entry for ${rule.source} must include a headers array.`);
      const headerMap = {};
      for (const entry of rule.headers) {
        if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || !entry.key.trim() || typeof entry.value !== 'string' || /[\r\n]/.test(entry.key) || /[\r\n]/.test(entry.value)) {
          throw new Error(`Invalid header key/value in vercel.json for ${rule.source}.`);
        }
        headerMap[entry.key] = entry.value;
      }
      const has = validateConditions(rule.has, 'has');
      const missing = validateConditions(rule.missing, 'missing');
      headers.push({
        src,
        ...(has ? { has } : {}),
        ...(missing ? { missing } : {}),
        headers: headerMap,
        continue: true,
      });
    }
  }
  return { redirects, headers };
}

export async function readVercelConfig(cwd) {
  if (await exists(path.join(cwd, 'vercel.ts'))) throw new Error('vercel.ts is not supported by this static adapter. Use vercel.json before configuring agent-readable.');
  try {
    const config = JSON.parse(await readFile(path.join(cwd, 'vercel.json'), 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('vercel.json must contain an object.');
    if (incompatible.some(key => key in config)) {
      throw new Error('Existing vercel.json routing or server functions found. This adapter deploys static exports; automatic merging is not supported.');
    }
    if (config.trailingSlash !== undefined && typeof config.trailingSlash !== 'boolean') {
      throw new Error('vercel.json trailingSlash must be a boolean.');
    }
    compileVercelRoutes(config);
    return config;
  } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

export async function validateVercel(cwd, cloud = process.env.VERCEL === '1') {
  const config = await readVercelConfig(cwd);
  if (cloud && (config.framework !== null || typeof config.buildCommand !== 'string' || !config.buildCommand.trim() || config.outputDirectory !== null)) {
    throw new Error('Vercel Git builds require framework: null, an explicit buildCommand, and outputDirectory: null in vercel.json. Run agent-readable setup-vercel --build-command "<static site build command>". Otherwise Vercel can discard the Markdown artifact.');
  }
  return config;
}

export async function setupVercel(cwd, buildCommand) {
  if (typeof buildCommand !== 'string' || !buildCommand.trim()) throw new Error('setup-vercel requires --build-command "<static site build command>".');
  if (/\bagent-readable\b/.test(buildCommand)) throw new Error('Provide only the site build command; setup-vercel appends agent-readable build.');
  // Require an initialized project before changing deployment configuration.
  const readable = JSON.parse(await readFile(path.join(cwd, 'agent-readable.json'), 'utf8'));
  if (readable.target === 'netlify') throw new Error('This project targets Netlify. Set target to vercel in agent-readable.json before setup-vercel.');
  const previous = await readVercelConfig(cwd);
  const config = { ...previous, framework: null, buildCommand: `(${buildCommand.trim()}) && npx --no-install agent-readable build`, outputDirectory: null };
  await writeFile(path.join(cwd, 'vercel.json'), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
