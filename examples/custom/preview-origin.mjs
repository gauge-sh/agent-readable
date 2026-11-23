import { readFile, writeFile } from 'node:fs/promises';

const origin = new URL(`https://${process.env.VERCEL_URL}`);
if (!process.env.VERCEL_URL || origin.host !== process.env.VERCEL_URL) {
  throw new Error('Set VERCEL_URL to the deployment hostname.');
}
const config = JSON.parse(await readFile('agent-readable.json', 'utf8'));
config.site = origin.origin;
await writeFile('agent-readable.json', JSON.stringify(config, null, 2) + '\n');
