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
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'], navigateFallback: 'index.html' },
    }),
  ],
});
