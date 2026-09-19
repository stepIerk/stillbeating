import { defineConfig } from 'vite';

// base: './' — относительные пути, чтобы работало и локально,
// и на GitHub Pages (https://<user>.github.io/<repo>/ без доп. настроек).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
});
