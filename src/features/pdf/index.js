/**
 * Export PDF. Web : une fenêtre imprimable (comportement de club4) ; la version native sera branchée
 * derrière cette même fonction. Les polices sont embarquées (fichiers @fontsource résolus par Vite) :
 * aucune requête vers Google Fonts.
 */
import { toast } from '../../app/toast.js';
import bricolage600 from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-600-normal.woff2?url';
import bricolage700 from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2?url';
import bricolage800 from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2?url';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff2?url';

const FONTS = [
  ['Bricolage Grotesque', 600, bricolage600],
  ['Bricolage Grotesque', 700, bricolage700],
  ['Bricolage Grotesque', 800, bricolage800],
  ['Inter', 500, inter500],
  ['Inter', 600, inter600],
  ['Inter', 700, inter700],
  ['Inter', 800, inter800],
];

/** @returns {string} règles @font-face, en URL absolues (la fenêtre s'ouvre sur about:blank) */
export function fontFaceCss() {
  return FONTS.map(([family, weight, url]) => `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url('${new URL(url, document.baseURI).href}') format('woff2');}`).join('\n');
}

/**
 * Ouvre le document HTML dans une fenêtre imprimable.
 * @param {string} html document complet (déjà échappé par l'appelant)
 * @param {string} name titre de la fenêtre / nom du fichier proposé à l'enregistrement
 */
export function exportPdf(html, name) {
  const win = window.open('', '_blank', 'width=860,height=700,scrollbars=yes');
  if (!win) {
    toast('Autorise les fenêtres pop-up pour exporter le PDF');
    return;
  }
  const doc = String(html).replace('</head>', `<style>${fontFaceCss()}</style></head>`);
  win.document.write(doc);
  win.document.close();
  if (name) win.document.title = name;
}
