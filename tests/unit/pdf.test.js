import { vi } from 'vitest';

const toast = vi.fn();
vi.mock('../../src/app/toast.js', () => ({ toast }));
const { fontFaceCss, exportPdf } = await import('../../src/features/pdf/index.js');

afterEach(() => { vi.restoreAllMocks(); toast.mockClear(); });

test('fontFaceCss : chaque src:url( est une URL https absolue, résolue sur la base du document', () => {
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue('https://x/app/');
  const css = fontFaceCss();
  const urls = [...css.matchAll(/src:url\('([^']*)'\)/g)].map((m) => m[1]);
  expect(urls.length).toBe((css.match(/src:url\(/g) ?? []).length);
  expect(urls.length).toBeGreaterThanOrEqual(7);
  for (const u of urls) expect(u).toMatch(/^https:\/\/x\//);
  expect(css).not.toContain('googleapis');
});

test('exportPdf : pop-up bloquée (null) ou fenêtre déjà fermée → message', () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  exportPdf('<html></html>', 'x');
  vi.spyOn(window, 'open').mockReturnValue({ closed: true, document: { write: vi.fn(), close: vi.fn() } });
  exportPdf('<html></html>', 'x');
  expect(toast).toHaveBeenCalledTimes(2);
  expect(toast).toHaveBeenCalledWith('Autorise les fenêtres pop-up pour exporter le PDF');
});

test('exportPdf : le HTML est écrit avec les polices ($ intact), le document fermé, les boutons câblés', () => {
  const listeners = {};
  const el = (id) => ({ addEventListener: (_t, fn) => { listeners[id] = fn; } });
  const doc = { write: vi.fn(), close: vi.fn(), getElementById: el, title: '' };
  const win = { closed: false, document: doc, print: vi.fn(), close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  exportPdf('<html><head><title>t</title></head><body>Prix $& $1</body></html>', 'Bilan');
  const written = doc.write.mock.calls[0][0];
  expect(written).toContain('@font-face');
  expect(written).toContain('Prix $& $1');
  expect(written.indexOf('@font-face')).toBeLessThan(written.indexOf('</head>'));
  expect(doc.close).toHaveBeenCalled();
  expect(doc.title).toBe('Bilan');
  listeners['pdf-print']();
  listeners['pdf-close']();
  expect(win.print).toHaveBeenCalled();
  expect(win.close).toHaveBeenCalled();
});

test('exportPdf : sans </head>, le style est placé en tête', () => {
  const doc = { write: vi.fn(), close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue({ closed: false, document: doc });
  exportPdf('<p>corps</p>', '');
  expect(doc.write.mock.calls[0][0].startsWith('<style>@font-face')).toBe(true);
});
