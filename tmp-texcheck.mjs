/** Проверка: как выглядит текстура menu-heart сама по себе (1:1, без сцены) */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath:
    '/Users/stepan2/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 620, height: 300 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:5199', { waitUntil: 'load' });
await page.waitForTimeout(1800);
const info = await page.evaluate(() => {
  const start = window.__game.scene.getScene('Start');
  const tex = start.textures.get('menu-heart').getSourceImage();
  const c = start.add.container(0, 0).setDepth(9999);
  c.add(start.add.image(150, 150, 'menu-heart'));
  c.add(start.add.image(440, 150, 'crystal').setScale(2));
  return { w: tex.width, h: tex.height };
});
console.log('menu-heart size', JSON.stringify(info));
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/entity-visual/zz-texture-alone.png' });
console.log('снято: zz-texture-alone');
await browser.close();
