/**
 * Délégation d'événements : un seul écouteur par type sur `document`.
 * Le balisage porte `data-action="nom"` (click) ; `data-on="change"` ou `data-on="input"` change l'événement.
 * Les valeurs passent par `data-id`, `data-key`, etc.
 */
const handlers = { click: new Map(), change: new Map(), input: new Map() };

function dispatch(ev) {
  const map = handlers[ev.type];
  for (let el = ev.target instanceof Element ? ev.target.closest('[data-action]') : null; el; el = el.parentElement?.closest('[data-action]')) {
    const wanted = el.dataset.on || 'click';
    if (wanted === ev.type) {
      const fn = map.get(el.dataset.action);
      if (fn) {
        fn(el, ev);
        return;
      }
    } else if (el.dataset.on) {
      return; // un champ change/input ne laisse pas son clic remonter vers l'action d'un parent
    }
  }
}

for (const type of Object.keys(handlers)) document.addEventListener(type, dispatch);

/**
 * Enregistre le handler d'une action (un seul par nom : le dernier enregistré remplace le précédent).
 * @param {string} action valeur de data-action
 * @param {(el: HTMLElement, ev: Event) => void} handler
 * @param {'click'|'change'|'input'} [type] événement écouté (par défaut : click)
 */
export function on(action, handler, type = 'click') {
  handlers[type].set(action, handler);
}
