import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Смоук-тест игровой логики в Node (без браузера): phaser подменяется заглушкой.
// Запуск: npm run test:logic
export default defineConfig({
  resolve: {
    alias: { phaser: resolve(__dirname, 'tests/phaser-stub.ts') },
  },
  build: {
    ssr: 'tests/logic.smoketest.ts',
    outDir: 'tmp-smoketest',
    emptyOutDir: true,
  },
});
