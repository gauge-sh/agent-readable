import { patterns } from '@mintlify/agent-traffic';
import { readFile, writeFile } from 'node:fs/promises';
// Regenerate when updating the pinned dataset. Plain JS keeps middleware compatible
// with older Next.js/Babel parsers that cannot parse JSON import attributes.
const selected = Object.fromEntries(['agent', 'ai-crawler'].map(key => [key, { source: patterns[key].source, flags: patterns[key].flags }]));
await writeFile(new URL('../src/agent-patterns.js', import.meta.url), `// Generated from @mintlify/agent-traffic 0.1.0 (MIT). See agent-patterns.LICENSE.\n// Regenerate with: node scripts/generate-agent-patterns.js\nexport const patterns = Object.fromEntries(Object.entries(${JSON.stringify(selected, null, 2)}).map(([key, { source, flags }]) => [key, new RegExp(source, flags)]));\n`);
await writeFile(new URL('../src/agent-patterns.LICENSE', import.meta.url), await readFile(new URL('../node_modules/@mintlify/agent-traffic/LICENSE', import.meta.url)));
