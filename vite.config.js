import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'prompt', // la nouvelle version attend le clic sur « Recharger »
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'SwimCoach App',
        short_name: 'SwimCoach',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#071327',
        theme_color: '#0A1F44',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Précache des seuls fichiers de l'application (build). Aucune règle de cache à l'exécution :
        // les réponses de Supabase (/rest/v1/, /auth/v1/, /storage/v1/, /functions/v1/) ne sont jamais
        // mises en cache par le service worker ; les données hors ligne viennent du stockage local.
        globPatterns: ['**/*.{js,css,html,png,svg,webp,woff2}'],
        globIgnores: ['splash.png', 'icons/icon-1024.png'], // sources des stores, inutiles hors ligne
        runtimeCaching: [],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/privacy\.html$/], // page statique précachée, pas l'écran de l'app
      },
    }),
  ],
});
