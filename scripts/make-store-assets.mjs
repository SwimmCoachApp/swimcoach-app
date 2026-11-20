// Fabrique public/icons/icon-1024.png (icône source des stores) et public/splash.png (écran de démarrage).
//
// Usage : node scripts/make-store-assets.mjs
// Source : le nageur blanc de src/app/scene.js (SCENE_SVG, repris de club4), posé sur le marine du thème
// Club (#0A1F44) avec soleil et vagues, comme les icônes PWA existantes. Le rendu passe par Chromium
// (Playwright, déjà en dépendance de développement) : en local le Chrome système, en CI le chromium
// installé par `npx playwright install chromium`. Aucune dépendance de plus.
// Les icônes PWA (192, 512, maskable, apple-touch) existent déjà et ne sont pas régénérées.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { SCENE_SVG } from '../src/app/scene.js';

const NAVY = '#0A1F44';
const out = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));

// Le groupe du nageur : <g transform="translate(152, 41) scale(1.8)" fill="#ffffff"> … </g>
const start = SCENE_SVG.indexOf('<g transform="translate(152, 41) scale(1.8)"');
const end = SCENE_SVG.indexOf('<path d="M0,100 C60,90');
if (start < 0 || end < 0) throw new Error('scene.js : groupe du nageur introuvable');
const DIVER = SCENE_SVG.slice(start, end).trim();

/** Le nageur blanc, posé selon `box` ({x, y, s} : translation et échelle). */
const diver = (box) => `<g transform="translate(${box.x} ${box.y}) scale(${box.s})">${DIVER.replace(/^<g[^>]*>/, '<g fill="#ffffff">')}</g>`;

async function render(page, size, body, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:${NAVY}}svg{display:block}</style>
    <svg id="s" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${NAVY}"/>${body}</svg>`);
  await page.screenshot({ path: out(file), clip: { x: 0, y: 0, width: size, height: size } });
}

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
try {
  const page = await browser.newPage();
  // Mesure du nageur pour le centrer exactement
  await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g id="d">${DIVER.replace(/^<g[^>]*>/, '<g fill="#fff">')}</g></svg>`);
  const b = await page.evaluate(() => { const r = document.getElementById('d').getBBox(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const place = (width, cx, cy) => {
    const s = width / b.w;
    return { s, x: cx - (b.x + b.w / 2) * s, y: cy - (b.y + b.h / 2) * s };
  };

  // Icône : nageur, soleil, ligne d'eau et deux bandes de vagues
  const icon = `<circle cx="800" cy="240" r="68" fill="#FF5A36"/>
    ${diver(place(640, 470, 400))}
    <path d="M0,650 C150,600 300,690 520,640 C720,596 880,650 1024,610 L1024,1024 L0,1024 Z" fill="#1B5E80"/>
    <path d="M0,760 C200,720 380,780 600,750 C800,722 920,760 1024,730 L1024,1024 L0,1024 Z" fill="#2A9FC4"/>`;
  await render(page, 1024, icon, 'icons/icon-1024.png');

  // Écran de démarrage : 2732 px, nageur seul au centre (zone sûre des tablettes)
  await render(page, 2732, diver(place(380, 512, 512)), 'splash.png');
} finally {
  await browser.close();
}
console.log('public/icons/icon-1024.png et public/splash.png écrits');
