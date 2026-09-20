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
    // PWA: генерирует service worker (Workbox, precache всех билд-ассетов).
    //
    // Зачем это игре-«standalone PWA»:
    //  - оффлайн-запуск из иконки на iOS/Android без сети (кэш браузера сам
    //    по себе этого не гарантирует, особенно на iOS);
    //  - мгновенный повторный запуск: всё отдаётся из precache;
    //  - авто-обновление: новая версия подхватывается после перезагрузки
    //    страницы (registerType: 'autoUpdate').
    // На installability iOS «Добавить на экран “Домой”» service worker не
    // влияет (нужны только apple-*-meta теги в index.html), SW нужен прежде
    // всего для оффлайна и для install-промпта на Android/Chrome.
    //
    // manifest: false — манифест НЕ генерируем: источник правды —
    // public/manifest.webmanifest (уже стоит <link> в index.html с мержа),
    // иначе плагин и public/ запишут два разных dist/manifest.webmanifest.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        // Игра грузит только код и svg-иконки — внешних png/аудио нет.
        // webmanifest из public/ тоже в precache (нужен при оффлайн-запуске).
        globPatterns: ['**/*.{js,css,html,svg,webmanifest,ico}'],
      },
    }),
  ],
});

