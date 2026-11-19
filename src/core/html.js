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

const ALLOWED = new Set(['B', 'I', 'U', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SPAN']);

/**
 * Nettoie du texte riche : seules b, i, u, br, div, p, ul, ol, li et span sont gardées, sans aucun attribut.
 * Les autres balises sont remplacées par leur texte (script, style et similaires sont supprimés avec leur contenu).
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
        if (ALLOWED.has(node.tagName)) {
          const el = document.createElement(node.tagName.toLowerCase());
          copy(node, el);
          to.append(el);
        } else if (!/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|IFRAME|OBJECT|EMBED)$/.test(node.tagName)) {
          copy(node, to);
        }
      }
    }
  };
  copy(doc.body, out);
  return out.innerHTML;
}
