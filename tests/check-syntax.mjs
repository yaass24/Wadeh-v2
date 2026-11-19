/* Lint-level check: parses every server and browser JS file with Node (no dependencies). */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = [path.join(root, 'server.js'), ...walk(path.join(root, 'server')), ...walk(path.join(root, 'public'))].filter((f) => /\.(m?js)$/.test(f));
let bad = 0;
for (const f of files) {
  const isModule = f.includes(`${path.sep}js${path.sep}`);
  try { execFileSync(process.execPath, isModule ? ['--input-type=module', '--check'] : ['--check', f], { input: isModule ? fs.readFileSync(f) : undefined, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { bad++; console.error('✗', path.relative(root, f), '\n', String(e.stderr)); }
}
JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
console.log(bad ? `${bad} file(s) failed` : `✓ syntax OK (${files.length} files) + manifest JSON valid`);
process.exit(bad ? 1 : 0);
