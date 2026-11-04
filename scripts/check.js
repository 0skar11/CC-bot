import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
async function walk(dir) {
    const files = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (['node_modules', '.git'].includes(entry.name)) continue;
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) files.push(...await walk(path));
        else if (entry.name.endsWith('.js')) files.push(path);
    }
    return files;
}
const files = await walk(root);
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status) throw new Error(`${file}: ${result.stderr}`);
    const source = await readFile(file, 'utf8');
    const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/gu);
    for (const [, specifier] of imports) {
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(root) || !(await stat(target).catch(() => null))?.isFile()) throw new Error(`Broken relative import in ${file}: ${specifier}`);
    }
}
console.log(`PASS: ${files.length} JavaScript files checked; all static relative imports resolve.`);
