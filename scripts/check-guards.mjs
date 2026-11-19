// Garde-fous du dépôt : projets Supabase interdits, localStorage brut, secrets, handlers en ligne.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_PROJECT = /aijgczmszymfjkeegbjz|vijexmmydvgfpkyzkgls/;
const SECRET_SRC = /service_role|sb_secret_/;
const SECRET_DIST = /sb_secret_/;
const INLINE_HANDLER = /\son[a-z]+=/;
const STORAGE_FILE = 'src/core/storage.js';

const norm = (p) => p.replace(/\\/g, '/');

/**
 * @param {{path:string,text:string}[]} files
 * @param {{mode?: 'src'|'dist'}} [opts] mode 'dist' : seulement forbidden-project et sb_secret_
 * @returns {{path:string,rule:string,line:number}[]}
 */
export function checkGuards(files, { mode = 'src' } = {}) {
  const dist = mode === 'dist';
  const out = [];
  for (const f of files) {
    const path = norm(f.path);
    if (path.startsWith('docs/') || path === 'scripts/check-guards.mjs') continue;
    const inSrc = path.startsWith('src/') || path === 'index.html';
    f.text.split('\n').forEach((line, i) => {
      const n = i + 1;
      if (FORBIDDEN_PROJECT.test(line)) out.push({ path, rule: 'forbidden-project', line: n });
      if (!dist && path !== STORAGE_FILE && /localStorage/.test(line)) {
        out.push({ path, rule: 'raw-localstorage', line: n });
      }
      if ((dist ? SECRET_DIST : SECRET_SRC).test(line)) out.push({ path, rule: 'secret-key', line: n });
      if (!dist && inSrc && INLINE_HANDLER.test(line)) out.push({ path, rule: 'inline-handler', line: n });
    });
  }
  return out;
}

function walk(target, root, acc) {
  if (!existsSync(target)) return acc;
  const st = statSync(target);
  if (st.isDirectory()) {
    for (const e of readdirSync(target)) walk(join(target, e), root, acc);
  } else if (/\.(m?js|html|css|json|webmanifest|svg|sql|toml|txt)$/.test(target)) {
    acc.push({ path: norm(relative(root, target)), text: readFileSync(target, 'utf8') });
  }
  return acc;
}

function main() {
  const root = process.cwd();
  const dist = process.argv[2] === 'dist';
  const targets = dist ? ['dist'] : ['src', 'public', 'supabase', 'index.html'];
  const files = targets.flatMap((t) => walk(resolve(root, t), root, []));
  const violations = checkGuards(files, { mode: dist ? 'dist' : 'src' });
  for (const v of violations) console.error(`${v.path}:${v.line}  [${v.rule}]`);
  if (violations.length) {
    console.error(`${violations.length} violation(s)`);
    process.exit(1);
  }
  console.log(`check-guards (${dist ? 'dist' : 'src'}) : OK, ${files.length} fichier(s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
