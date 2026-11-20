import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGuards, runGuards } from '../../scripts/check-guards.mjs';

test('refuse les projets Supabase interdits', () => {
  const v = checkGuards([{ path: 'src/a.js', text: "const u='https://aijgczmszymfjkeegbjz.supabase.co'" },
                         { path: 'src/b.js', text: "x='vijexmmydvgfpkyzkgls'" }]);
  expect(v.map(x => x.rule)).toEqual(['forbidden-project', 'forbidden-project']);
});
test('refuse les clés locales non préfixées et localStorage.clear', () => {
  const v = checkGuards([{ path: 'src/c.js', text: "localStorage.setItem('swimcoach_v2','x')\nlocalStorage.clear()" }]);
  expect(v.map(x => x.rule)).toEqual(['raw-localstorage', 'legacy-key', 'raw-localstorage']);
});
test('refuse une clé service_role et un onclick en ligne', () => {
  const v = checkGuards([{ path: 'src/d.js', text: "k='sb_secret_abc'\n'<b onclick=\"x()\">'" }]);
  expect(v.map(x => x.rule)).toEqual(['secret-key', 'inline-handler']);
});
test('accepte core/storage.js, seul fichier autorisé à appeler localStorage', () => {
  expect(checkGuards([{ path: 'src/core/storage.js', text: "localStorage.getItem(k)" }])).toEqual([]);
});
test('mode dist : seulement forbidden-project et une vraie clé sb_secret_', () => {
  const bundle = [{ path: 'dist/assets/index.js', text:
    "localStorage.getItem('x');var k='service_role';\n<b onclick=\"x()\">\nvar s='sb_secret_" + 'a'.repeat(32) + "'\nvar p='vijexmmydvgfpkyzkgls'" }];
  const v = checkGuards(bundle, { mode: 'dist' });
  expect(v.map(x => [x.rule, x.line])).toEqual([['secret-key', 3], ['forbidden-project', 4]]);
  expect(checkGuards([{ path: 'dist/a.js', text: 'if(k.startsWith("sb_secret_"))throw 1' }], { mode: 'dist' })).toEqual([]);
  expect(checkGuards([{ path: 'dist/a.js', text: "localStorage.clear();service_role;onclick=" }], { mode: 'dist' })).toEqual([]);
});

const rules = (path, text, opts) => checkGuards([{ path, text }], opts).map(x => x.rule);

test('inline-handler : attributs réels, espaces autour de =, colonne 0', () => {
  expect(rules('src/e.js', '<b onclick = "x">')).toEqual(['inline-handler']);
  expect(rules('src/e.js', 'onClick="x()"')).toEqual(['inline-handler']);
  expect(rules('src/e.js', "<img onerror='x'>")).toEqual(['inline-handler']);
  expect(rules('index.html', '<b onpointerdown="x">')).toEqual(['inline-handler']);
});
test('inline-handler : pas de faux positifs sur du JS ordinaire', () => {
  expect(rules('src/f.js', 'const online=true')).toEqual([]);
  expect(rules('src/f.js', 'let once=1')).toEqual([]);
  expect(rules('src/f.js', 'oneTime=2')).toEqual([]);
});
test('legacy-key : anciennes clés interdites, y compris dans storage.js', () => {
  expect(rules('src/g.js', "k='swimcoach_theme'")).toEqual(['legacy-key']);
  expect(rules('src/core/storage.js', "x='__app_version__'")).toEqual(['legacy-key']);
  expect(rules('docs/a.md', 'swimcoach_v2')).toEqual([]);
  expect(rules('dist/a.js', 'swimcoach_v2', { mode: 'dist' })).toEqual([]);
});
test('localStorage.clear interdit même dans storage.js', () => {
  expect(rules('src/core/storage.js', 'localStorage.clear()')).toEqual(['raw-localstorage']);
  expect(rules('src/core/storage.js', 'localStorage . clear ( )')).toEqual(['raw-localstorage']);
});

test('runGuards : échoue (fail-closed) si dist/ absent ou vide, ou argument inconnu', () => {
  const root = mkdtempSync(join(tmpdir(), 'guards-'));
  expect(runGuards(root, ['dist']).error).toMatch(/introuvable/);
  mkdirSync(join(root, 'dist'));
  expect(runGuards(root, ['dist']).error).toMatch(/aucun fichier/);
  expect(runGuards(root, []).error).toMatch(/aucun fichier/);
  expect(runGuards(root, ['--foo']).error).toMatch(/argument inconnu/);
  expect(runGuards(root, ['dist', 'x']).error).toMatch(/argument inconnu/);
  writeFileSync(join(root, 'dist', 'a.js'), 'ok');
  expect(runGuards(root, ['dist'])).toMatchObject({ error: null, violations: [] });
});

test('service_role dans un .ts sous supabase/ : signalé, sans tenir compte de la casse', () => {
  const v = checkGuards([{ path: 'supabase/functions/x/index.ts', text: "const k = 'service_role';\nconst j = 'SERVICE_ROLE'" }]);
  expect(v.map(x => [x.rule, x.line])).toEqual([['secret-key', 1], ['secret-key', 2]]);
});
test('noms de variables SUPABASE_SERVICE_ROLE_KEY et SUPABASE_SECRET_KEYS autorisés', () => {
  expect(checkGuards([{ path: 'supabase/functions/x/index.ts', text:
    "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')\nDeno.env.get('SUPABASE_SECRET_KEYS')" }])).toEqual([]);
  // le nom autorisé ne masque pas une vraie occurrence sur la même ligne
  expect(checkGuards([{ path: 'supabase/a.ts', text: "SUPABASE_SERVICE_ROLE_KEY service_role" }]).length).toBe(1);
});
test('runGuards analyse les fichiers .ts', () => {
  const root = mkdtempSync(join(tmpdir(), 'guards-ts-'));
  for (const d of ['src', 'public', 'supabase/functions/f']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<p></p>');
  writeFileSync(join(root, 'supabase/functions/f/index.ts'), "const k = 'service_role';");
  const r = runGuards(root, []);
  expect(r.violations.map(v => [v.path, v.rule])).toEqual([['supabase/functions/f/index.ts', 'secret-key']]);
});
