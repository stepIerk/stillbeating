import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// base: './' — относительные пути, чтобы работало и локально,
// и на GitHub Pages (https://<user>.github.io/<repo>/ без доп. настроек).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
  plugins: [
    // PWA: генерирует manifest.webmanifest (+ <link> в index.html) и
    // service worker (Workbox, precache всех билд-ассетов).
    //
    // Зачем это игре-«standalone PWA»:
    //  - оффлайн-запуск из иконки на iOS/Android без сети (кэш браузера сам
    //    по себе этого не гарантирует, особенно на iOS);
    //  - мгновенный повторный запуск: всё отдаётся из precache;
    //  - авто-обновление: новая версия подхватывается после перезагрузки
    //    страницы (registerType: 'autoUpdate');
    //  - раньше manifest добавлялся в dist вручную и терялся при каждой
    //    пересборке — теперь генерируется из этой конфигурации.
    // На installability iOS «Добавить на экран “Домой”» service worker не
    // влияет (нужны только apple-*-meta теги в index.html), SW нужен прежде
    // всего для оффлайна и для install-промпта на Android/Chrome.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'degame',
        short_name: 'degame',
        description: 'Defend the crystal against endless waves of enemies.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#14141b',
        theme_color: '#14141b',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
          {
            src: 'icons.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        // Игра грузит только код и svg-иконки — внешних png/аудио нет.
        globPatterns: ['**/*.{js,css,html,svg,webmanifest,ico}'],
      },
    }),
  ],
});

