/**
 * Échappe un texte pour l'insérer dans du HTML (contenu ou valeur d'attribut entre guillemets).
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Fragment HTML de confiance : `html` ne l'échappe pas. */
class Raw {
  constructor(value) {
    this.value = value;
  }
}

/**
 * Marque un fragment HTML déjà sûr (par ex. le résultat d'un autre `html`) pour qu'il ne soit pas échappé.
 * @param {string} str
 * @returns {Raw}
 */
export function raw(str) {
  return new Raw(String(str ?? ''));
}

const part = (v) => (v instanceof Raw ? v.value : Array.isArray(v) ? v.map(part).join('') : esc(v));

/**
 * Gabarit balisé : chaque valeur interpolée est échappée, sauf celles enveloppées par `raw()`.
 * Les tableaux sont concaténés (chaque élément suit la même règle).
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {string}
 */
export function html(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), '');
}

const ALLOWED = new Set(['B', 'I', 'U', 'S', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SPAN']);
/** Balises renommées : `<strike>` (execCommand strikeThrough) devient `<s>`, `<font color>` (foreColor) un `<span>`. */
const RENAMED = { STRIKE: 's', FONT: 'span' };
/** Seules propriétés de style permises (sur `<span>` uniquement). */
const STYLE_PROPS = new Set(['color', 'background-color']);
const BYTE = '\\s*\\d{1,3}\\s*';
const ALPHA = '\\s*(?:0|1|0?\\.\\d+|1\\.0+)\\s*';
/** Valeurs permises : #rgb, #rrggbb, rgb(n, n, n), rgba(n, n, n, a) — arguments numériques seulement. */
const COLOR_VALUE = new RegExp(`^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\\(${BYTE},${BYTE},${BYTE}\\)|rgba\\(${BYTE},${BYTE},${BYTE},${ALPHA}\\))$`, 'i');

/**
 * Style d'un `<span>` réduit à la liste blanche (color, background-color) ; '' si rien ne reste.
 * @param {string|null} style
 * @returns {string}
 */
function cleanStyle(style) {
  const kept = new Map();
  for (const decl of String(style ?? '').split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl.slice(at + 1).trim();
    if (STYLE_PROPS.has(prop) && COLOR_VALUE.test(value)) kept.set(prop, value);
  }
  return [...kept].map(([p, v]) => `${p}: ${v}`).join('; ');
}

/**
 * Nettoie du texte riche : seules b, i, u, s, br, div, p, ul, ol, li et span sont gardées, sans attribut,
 * sauf le style d'un span réduit à `color` / `background-color` en #rgb, #rrggbb, rgb() ou rgba().
 * `<strike>` devient `<s>` ; `<font color="#…">` devient `<span style="color: #…">` (sans couleur valide :
 * seul son texte reste). Les autres balises sont remplacées par leur texte (script, style et similaires
 * sont supprimés avec leur contenu).
 * @param {string} input
 * @returns {string}
 */
export function sanitizeRich(input) {
  const doc = new DOMParser().parseFromString(`<body>${String(input ?? '')}</body>`, 'text/html');
  const out = document.createElement('div');
  const copy = (from, to) => {
    for (const node of from.childNodes) {
      if (node.nodeType === 3) {
        to.append(node.textContent);
      } else if (node.nodeType === 1) {
        const tag = node.localName.toUpperCase();
        const name = RENAMED[tag] ?? (ALLOWED.has(tag) ? tag.toLowerCase() : null);
        if (name) {
          const style = tag === 'FONT' ? cleanStyle(`color:${node.getAttribute('color') ?? ''}`) : tag === 'SPAN' ? cleanStyle(node.getAttribute('style')) : '';
          if (tag === 'FONT' && !style) {
            copy(node, to);
            continue;
          }
          const el = document.createElement(name);
          if (style) el.setAttribute('style', style);
          copy(node, el);
          to.append(el);
        } else if (!/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|IFRAME|OBJECT|EMBED)$/.test(tag)) {
          copy(node, to);
        }
      }
    }
  };
  copy(doc.body, out);
  return out.innerHTML;
}
