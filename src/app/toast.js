/** Message court en bas de l'écran. */
let el = null;
let timer;

/** @param {string} msg */
export function toast(msg) {
  if (!el || !el.isConnected) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = msg;
  void el.offsetHeight; // relance la transition
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), 2400);
}
