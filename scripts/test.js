import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Enumerate files explicitly: Windows and Node 20 do not require shell glob expansion.
const root = new URL('../', import.meta.url);
const tests = readdirSync(new URL('../tests/', import.meta.url)).filter((file) => file.endsWith('.test.js')).sort().map((file) => fileURLToPath(new URL(`../tests/${file}`, import.meta.url)));
const result = spawnSync(process.execPath, ['--import', new URL('../tests/env.js', import.meta.url).href, '--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
