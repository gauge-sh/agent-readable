import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const routing = ['routes', 'redirects', 'rewrites', 'headers', 'cleanUrls', 'trailingSlash'];
async function exists(file) { try { await access(file); return true; } catch { return false; } }

export async function readVercelConfig(cwd) {
  if (await exists(path.join(cwd, 'vercel.ts'))) throw new Error('vercel.ts is not supported by this static adapter. Use vercel.json before configuring agent-readable.');
  try {
    const config = JSON.parse(await readFile(path.join(cwd, 'vercel.json'), 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('vercel.json must contain an object.');
    if (routing.some(key => key in config) || 'builds' in config || 'functions' in config) {
      throw new Error('Existing vercel.json routing or server functions found. This adapter deploys static exports; automatic merging is not supported.');
    }
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
  await readFile(path.join(cwd, 'agent-readable.json'), 'utf8');
  const previous = await readVercelConfig(cwd);
  const config = { ...previous, framework: null, buildCommand: `(${buildCommand.trim()}) && npx --no-install agent-readable build`, outputDirectory: null };
  await writeFile(path.join(cwd, 'vercel.json'), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
