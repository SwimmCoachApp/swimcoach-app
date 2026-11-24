/**
 * Page verrouillée comme une app native : l'écran ne bouge pas, ne se zoome pas, ne rebondit pas.
 *
 * Le gros du travail est dans index.html (viewport sans zoom) et base.css (page fixe, pas de rebond,
 * pas de zoom au double-tape). Reste le pincement sur iPhone, que seul l'événement `gesturestart`
 * permet de bloquer : sans lui, la page se zoome puis se laisse déplacer sur les côtés.
 */

const locked = new WeakSet();

/** @param {Document} [doc] */
export function lockPage(doc = document) {
  if (locked.has(doc)) return;
  locked.add(doc);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    doc.addEventListener(type, (ev) => ev.preventDefault(), { passive: false });
  }
}
