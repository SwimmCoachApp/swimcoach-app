import { defineConfig } from '@playwright/test';

const ci = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: ci,
  reporter: ci ? 'github' : 'list',
  use: {
    // Le service worker de l'app est bloqué en e2e : il contournerait page.route (faux Supabase).
    // Les tests hors ligne (tâche 18) l'autorisent explicitement avec `vite preview`.
    serviceWorkers: 'block',
    baseURL: 'http://localhost:4173',
    // En local : Chrome système (les navigateurs Playwright ne sont pas téléchargeables).
    // En CI : chromium fourni par `npx playwright install --with-deps chromium`.
    ...(ci ? {} : { channel: 'chrome' }),
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !ci,
    timeout: 120000,
  },
});
