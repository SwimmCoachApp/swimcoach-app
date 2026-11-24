import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

// Téléphone : l'app installée doit se comporter comme une app native, pas comme une page web
// (jamais de glissement sur les côtés, pas de rebond de la page, pas de zoom au pincement).
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const PW = 'motdepasse-long';
const TA = '55555555-5555-4555-8555-555555555555';
const GA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LONG = 'Un nom de groupe vraiment très long pour tester le débordement sur petit écran';

async function open(page) {
  await installFakeSupabase(page, {
    users: [{ email: 'a@toac.fr', password: PW, activated: true }],
    teams: [{ id: TA, name: LONG, owner: 'a@toac.fr' }],
    members: [{ team_id: TA, email: 'a@toac.fr' }],
    tables: {
      groups: [{ id: GA, team_id: TA, name: 'Benjamins', sort_order: 0 }],
      swimmers: [
        { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01', team_id: TA, firstname: 'Anne-Charlotte-Marie', lastname: 'De la Fontaine-Beauregard', dob: '2013-05-02', group_id: GA, phone: '', email: 'anne.charlotte.marie.de.la.fontaine.beauregard@exemple-de-messagerie.fr', photo_path: null, joined_season: 2026, left_season: null },
        { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02', team_id: TA, firstname: 'Léa', lastname: 'Martin', dob: null, group_id: GA, phone: '', email: '', photo_path: null, joined_season: 2026, left_season: null },
      ],
    },
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('a@toac.fr');
  await page.getByLabel('Mot de passe').fill(PW);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
}

const SCREENS = [['Calendrier', 'calendar'], ['Nageurs', 'contacts'], ['Stats', 'stats'], ['Perfs', 'perfs'], ['Planif.', 'planning']];

/** Largeur du contenu de chaque conteneur de la coque moins sa largeur visible (0 = rien ne dépasse) et éléments qui sortent de l'écran. */
function measure(page) {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const over = (el) => (el ? Math.max(0, el.scrollWidth - el.clientWidth) : 0);
    const containers = {
      html: over(document.documentElement),
      body: over(document.body),
      app: over(document.querySelector('#app')),
      shell: over(document.querySelector('.shell')),
      views: over(document.querySelector('#views')),
      view: over(document.querySelector('.view.active')),
    };
    // éléments dont le bord droit dépasse l'écran, hors zones volontairement défilantes
    const scrollsX = (el) => { for (let p = el; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true; } return false; };
    // les vagues décoratives (SVG) de la barre du haut sont coupées par elle : elles ne comptent pas ; les boutons, eux, doivent rester entièrement visibles
    const clipped = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; const r = p.getBoundingClientRect(); if (o !== 'visible' && r.right <= w + 1 && r.left >= -1) return true; } return false; };
    const outside = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.position !== 'fixed' && (r.right > w + 1 || r.left < -1) && !scrollsX(el) && !(el.closest('svg') && clipped(el));
      })
      .slice(0, 6)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} (${Math.round(el.getBoundingClientRect().left)}→${Math.round(el.getBoundingClientRect().right)} / ${w})`);
    return { containers, outside };
  });
}

test('aucun écran ne dépasse la largeur du téléphone', async ({ page }) => {
  await open(page);
  for (const [label, name] of SCREENS) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator(`[data-screen="${name}"]`)).toBeVisible();
    const m = await measure(page);
    expect(m, `écran ${name}`).toEqual({ containers: { html: 0, body: 0, app: 0, shell: 0, views: 0, view: 0 }, outside: [] });
  }
  await page.getByRole('button', { name: 'Réglages' }).click();
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  expect(await measure(page), 'écran settings').toEqual({ containers: { html: 0, body: 0, app: 0, shell: 0, views: 0, view: 0 }, outside: [] });
});

test('la page est verrouillée : ni rebond, ni zoom, ni glissement', async ({ page }) => {
  await open(page);
  const lock = await page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const root = cs(document.documentElement);
    const body = cs(document.body);
    const app = cs(document.querySelector('#app'));
    return {
      viewport: document.querySelector('meta[name="viewport"]').getAttribute('content'),
      rootBounce: root.overscrollBehaviorX + '/' + root.overscrollBehaviorY,
      bodyBounce: body.overscrollBehaviorX + '/' + body.overscrollBehaviorY,
      appBounce: app.overscrollBehaviorX + '/' + app.overscrollBehaviorY,
      rootTouch: root.touchAction,
      bodyPosition: body.position,
      navSelect: cs(document.querySelector('.bottom-nav')).userSelect,
      viewBounce: cs(document.querySelector('.view.active')).overscrollBehaviorY,
    };
  });
  expect(lock.viewport).toContain('user-scalable=no');
  expect(lock.viewport).toContain('maximum-scale=1');
  expect(lock.rootBounce).toBe('none/none');
  expect(lock.bodyBounce).toBe('none/none');
  expect(lock.appBounce).toBe('none/none');
  expect(lock.rootTouch).toBe('pan-x pan-y');
  expect(lock.bodyPosition).toBe('fixed');
  expect(lock.navSelect).toBe('none'); // les commandes ne se sélectionnent pas
  expect(lock.viewBounce).toBe('contain'); // la liste défile, mais ne tire pas la page avec elle
});

test('petit téléphone (320 px) et nom de groupe court : la barre du haut reste dans l’écran', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installFakeSupabase(page, {
    users: [{ email: 'a@toac.fr', password: PW, activated: true }],
    teams: [{ id: TA, name: 'Benjamin U13', owner: 'a@toac.fr' }],
    members: [{ team_id: TA, email: 'a@toac.fr' }],
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('a@toac.fr');
  await page.getByLabel('Mot de passe').fill(PW);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  expect(await measure(page)).toEqual({ containers: { html: 0, body: 0, app: 0, shell: 0, views: 0, view: 0 }, outside: [] });
  for (const name of ['Changer de groupe', 'Changer de thème', 'Réglages']) await expect(page.getByRole('button', { name })).toBeInViewport({ ratio: 1 });
});
