// Prépare un fichier pgTAP pour une exécution en une seule requête (outil execute_sql
// sur le projet hébergé, qui ne renvoie que le dernier résultat) :
//  - injecte la section helpers:start/helpers:end de 00_helpers.sql à la place de
//    « -- helpers:include » ;
//  - recopie chaque ligne TAP (assertion en début de ligne) dans pg_temp.tap_out ;
//  - renvoie toute la sortie TAP en une ligne (string_agg) juste avant le rollback final.
// Un « commit; » final (00_helpers.sql) est remplacé par « rollback; » : rien ne reste.
// Usage : node scripts/db-test-bundle.mjs <fichier.sql> [--count]
import { readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

const TAP_LINE = /^select\s+(\*\s+from\s+)?(plan|finish|ok|is|isnt|pass|fail|throws_ok|lives_ok|is_empty|isnt_empty|results_eq|set_eq|bag_eq|has_\w+|hasnt_\w+|col_\w+|policies_are|function_privs_are|table_privs_are)\s*\(/i;

export function bundle(file) {
  const text = readFileSync(file, 'utf8');
  const helpersFile = join(dirname(file), '00_helpers.sql');
  let helpers = '';
  if (text.includes('-- helpers:include')) {
    const h = readFileSync(helpersFile, 'utf8');
    const m = h.match(/-- helpers:start\n([\s\S]*?)-- helpers:end/);
    if (!m) throw new Error('section helpers introuvable dans 00_helpers.sql');
    helpers = m[1];
  }
  const capture = [
    'create temp table tap_out (n int generated always as identity, line text);',
    'grant all on table pg_temp.tap_out to public;',
  ].join('\n');
  const lines = text.split('\n');
  let injected = false;
  let assertions = 0;
  let lastEnd = -1;
  lines.forEach((l, i) => { if (/^(rollback|commit);\s*$/.test(l)) lastEnd = i; });
  if (lastEnd < 0) throw new Error('rollback/commit final introuvable');
  const out = lines.map((l, i) => {
    if (l.trim() === '-- helpers:include') { injected = true; return `${helpers}\n${capture}`; }
    if (TAP_LINE.test(l)) {
      if (!/^select\s+(\*\s+from\s+)?(plan|finish)\s*\(/i.test(l)) assertions += 1;
      return `insert into pg_temp.tap_out(line) ${l}`;
    }
    if (i === lastEnd) {
      return "select string_agg(line, E'\\n' order by n) as tap from pg_temp.tap_out;\nrollback;";
    }
    return l;
  });
  if (!injected) {
    // fichier sans helpers (00_helpers.sql) : la table de capture va juste après « begin; »
    const b = out.findIndex((l) => /^begin;\s*$/.test(l));
    out.splice(b + 1, 0, capture);
  }
  return { sql: out.join('\n'), assertions };
}

const isMain = process.argv[1] && basename(process.argv[1]) === 'db-test-bundle.mjs';
if (isMain) {
  const [file, flag] = process.argv.slice(2);
  if (!file) { console.error('usage : node scripts/db-test-bundle.mjs <fichier.sql> [--count]'); process.exit(2); }
  const { sql, assertions } = bundle(file);
  if (flag === '--count') console.log(assertions);
  else process.stdout.write(sql);
}
