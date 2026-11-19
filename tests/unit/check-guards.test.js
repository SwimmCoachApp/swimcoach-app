import { checkGuards } from '../../scripts/check-guards.mjs';

test('refuse les projets Supabase interdits', () => {
  const v = checkGuards([{ path: 'src/a.js', text: "const u='https://aijgczmszymfjkeegbjz.supabase.co'" },
                         { path: 'src/b.js', text: "x='vijexmmydvgfpkyzkgls'" }]);
  expect(v.map(x => x.rule)).toEqual(['forbidden-project', 'forbidden-project']);
});
test('refuse les clés locales non préfixées et localStorage.clear', () => {
  const v = checkGuards([{ path: 'src/c.js', text: "localStorage.setItem('swimcoach_v2','x')\nlocalStorage.clear()" }]);
  expect(v.map(x => x.rule)).toEqual(['raw-localstorage', 'raw-localstorage']);
});
test('refuse une clé service_role et un onclick en ligne', () => {
  const v = checkGuards([{ path: 'src/d.js', text: "k='sb_secret_abc'\n'<b onclick=\"x()\">'" }]);
  expect(v.map(x => x.rule)).toEqual(['secret-key', 'inline-handler']);
});
test('accepte core/storage.js, seul fichier autorisé à appeler localStorage', () => {
  expect(checkGuards([{ path: 'src/core/storage.js', text: "localStorage.getItem(k)" }])).toEqual([]);
});
test('mode dist : seulement forbidden-project et sb_secret_', () => {
  const bundle = [{ path: 'dist/assets/index.js', text:
    "localStorage.getItem('x');var k='service_role';\n<b onclick=\"x()\">\nvar s='sb_secret_abc'\nvar p='vijexmmydvgfpkyzkgls'" }];
  const v = checkGuards(bundle, { mode: 'dist' });
  expect(v.map(x => [x.rule, x.line])).toEqual([['secret-key', 3], ['forbidden-project', 4]]);
  expect(checkGuards([{ path: 'dist/a.js', text: "localStorage.clear();service_role;onclick=" }], { mode: 'dist' })).toEqual([]);
});
