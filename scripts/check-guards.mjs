// Garde-fous du dépôt : projets Supabase interdits, localStorage brut, secrets, handlers en ligne.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_PROJECT = /aijgczmszymfjkeegbjz|vijexmmydvgfpkyzkgls/;
const SECRET_SRC = /service_role|sb_secret_/;
// En dist, supabase-js contient le préfixe nu (contrôle de format) : on ne cherche
// qu'une vraie clé, toujours suivie d'un long suffixe.
const SECRET_DIST = /sb_secret_[A-Za-z0-9_-]{20,}/;
const EVENTS = [
  'click', 'dblclick', 'auxclick', 'contextmenu', 'input', 'change', 'submit', 'reset', 'invalid', 'select',
  'keydown', 'keyup', 'keypress', 'load', 'error', 'abort', 'unload', 'beforeunload', 'resize', 'scroll',
  'focus', 'blur', 'focusin', 'focusout', 'wheel', 'drag', 'dragstart', 'dragend', 'dragenter', 'dragleave',
  'dragover', 'drop', 'copy', 'cut', 'paste', 'toggle', 'play', 'pause', 'ended',
  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
  'touchstart', 'touchend', 'touchmove', 'touchcancel',
  'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
  'pointercancel', 'gotpointercapture', 'lostpointercapture',
].join('|');
const INLINE_HANDLER = new RegExp(`(^|[\\s"'\`<])on(${EVENTS})\\s*=`, 'i');
const LEGACY_KEY = /swimcoach_v2|swimcoach_theme|__app_version__/;
const LS_CLEAR = /localStorage\s*\.\s*clear\s*\(/;
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
      if (!dist && (LS_CLEAR.test(line) || (path !== STORAGE_FILE && /localStorage/.test(line)))) {
        out.push({ path, rule: 'raw-localstorage', line: n });
      }
      if (!dist && LEGACY_KEY.test(line)) out.push({ path, rule: 'legacy-key', line: n });
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

/** Parcourt les cibles ; échoue (error) si l'argument est inconnu ou si une cible manque / 0 fichier. */
export function runGuards(root, args) {
  if (args.length > 1 || (args.length === 1 && args[0] !== 'dist')) {
    return { error: `argument inconnu : ${args.join(' ')} (attendu : aucun ou "dist")`, violations: [], files: [] };
  }
  const dist = args[0] === 'dist';
  const targets = dist ? ['dist'] : ['src', 'public', 'supabase', 'index.html'];
  const missing = targets.filter((t) => !existsSync(resolve(root, t)));
  if (missing.length && dist) {
    return { error: `cible introuvable : ${missing.join(', ')} (lancer "npm run build" d'abord)`, violations: [], files: [] };
  }
  const files = targets.flatMap((t) => walk(resolve(root, t), root, []));
  if (files.length === 0) {
    return { error: `aucun fichier à analyser dans : ${targets.join(' ')}`, violations: [], files };
  }
  return { error: null, violations: checkGuards(files, { mode: dist ? 'dist' : 'src' }), files };
}

function main() {
  const args = process.argv.slice(2);
  const { error, violations, files } = runGuards(process.cwd(), args);
  if (error) {
    console.error(`check-guards : ${error}`);
    process.exit(1);
  }
  for (const v of violations) console.error(`${v.path}:${v.line}  [${v.rule}]`);
  if (violations.length) {
    console.error(`${violations.length} violation(s)`);
    process.exit(1);
  }
  console.log(`check-guards (${args[0] === 'dist' ? 'dist' : 'src'}) : OK, ${files.length} fichier(s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
