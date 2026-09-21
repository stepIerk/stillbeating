/**
 * Скриншоты визуала мира (шаги 2–3): сердце, паразиты, лейкоцит-игрок, лут,
 * кислота и лавка-меняла. Кадры складываются в /tmp/entity-visual для
 * ручного просмотра — автотестов тут нет, только съёмка.
 * Требует dev-сервера на порту 5199: npx vite --port 5199
 * Запуск: node tests/visual-entities.mjs
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const EXEC =
  '/Users/stepan2/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const OUT = '/tmp/entity-visual';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  deviceScaleFactor: 2,
});

const problems = [];
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`[console.error] ${m.text()}`);
});

await page.goto('http://localhost:5199', { waitUntil: 'load' });
await page.waitForTimeout(1800);
// Кадр заставки — до старта игры
await page.screenshot({ path: `${OUT}/00-menu.png` });
console.log('снято: 00-menu');
await page.evaluate(() => window.__game.scene.getScene('Start').scene.start('Game'));
await page.waitForTimeout(1200);

// Волны отключаем: штатный спавн мешал бы кадру
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.waveSystem.update = () => {};
});

/** Кадр с заданным зумом вокруг точки мира */
async function shot(name, zoom, x, y, settle = 450) {
  await page.evaluate(
    ({ zoom, x, y }) => {
      const cam = window.__game.scene.getScene('Game').cameras.main;
      cam.stopFollow();
      cam.setZoom(zoom);
      cam.centerOn(x, y);
    },
    { zoom, x, y },
  );
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`снято: ${name}`);
}

// ---------- Сердце ----------
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.enemies.forEach((e) => e.destroy());
  gs.enemies.length = 0;
  gs.player.body.reset(gs.crystal.x - 120, gs.crystal.y - 260);
  window.__heart = { x: gs.crystal.x, y: gs.crystal.y };
  gs.crystal.takeDamage(170); // брызги крови + пульс частит
});
await shot('10-heart-hit', 1.1, 900, 1642, 220);
await shot('11-heart-quiet', 0.4, 900, 1560, 900);

// ---------- Парад паразитов ----------
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  const baseX = 900;
  const baseY = 760;
  const small = ['slime', 'runner', 'shooter'];
  const big = ['tank', 'boss'];

  small.forEach((id, i) => {
    gs.spawnEnemy(id);
    const e = gs.enemies[gs.enemies.length - 1];
    e.speed = 0;
    e.body.reset(baseX + (i - 1) * 110, baseY);
  });
  big.forEach((id, i) => {
    gs.spawnEnemy(id);
    const e = gs.enemies[gs.enemies.length - 1];
    e.speed = 0;
    e.body.reset(baseX + (i - 0.5) * 170, baseY + 190);
  });

  gs.player.body.reset(baseX, baseY + 420);
});

await shot('12-parade-wide', 0.45, 900, 860, 700);
await shot('13-parade-small', 1.5, 900, 760, 400);
await shot('14-parade-big', 1.1, 900, 950, 400);

// ---------- Лейкоцит и лут ----------
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.enemies.forEach((e) => e.destroy());
  gs.enemies.length = 0;
  const px = 900;
  const py = 700;
  gs.player.body.reset(px, py);

  gs.spawnCoins(px - 70, py + 190, 9);
  gs.spawnPickup(px - 10, py + 190, 'loot-point', () => {});
  gs.spawnPickup(px + 45, py + 190, 'loot-weapon', () => {});
  gs.spawnPickup(px + 95, py + 190, 'loot-skill', () => {});
  // Магнит не должен утащить лут во время съёмки
  gs.coins.forEach((c) => c.setData('spawnedAt', gs.time.now + 600000));
});

await shot('15-cell-drops', 1.6, 900, 800, 800);
await shot('16-cell-drops-wide', 0.5, 900, 800, 300);

// ---------- Летящая кислота ----------
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.spawnEnemy('shooter');
  const e = gs.enemies[gs.enemies.length - 1];
  e.speed = 0;
  e.role = 'hunter';
  e.target = 'player';
  e.body.reset(gs.player.x + 260, gs.player.y - 40);
  gs.spawnEnemyShot(e, gs.time.now);
  gs.spawnEnemyShot(e, gs.time.now);
});
await shot('17-acid-shot', 1.5, 1000, 730, 260);

// ---------- Лавка-меняла ----------
const shopPos = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.enemies.forEach((e) => e.destroy());
  gs.enemies.length = 0;
  gs.player.body.reset(gs.shop.x, gs.shop.y + 190);
  return { x: gs.shop.x, y: gs.shop.y - 40 };
});
await shot('18-shop', 1.5, shopPos.x, shopPos.y, 700);
await shot('19-shop-wide', 0.5, shopPos.x, shopPos.y, 300);

// ---------- Окно лавки: новые надписи (ЩИТ СЕРДЦА, ЗОЛОТО) ----------
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.run.gold = 500;
  gs.player.body.reset(gs.shop.x + 70, gs.shop.y);
  gs.cameras.main.setZoom(1).centerOn(gs.player.x, gs.player.y);
  gs.openShop();
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/20-shop-panel.png` });
console.log('снято: 20-shop-panel');
await page.evaluate(() => window.__game.scene.getScene('Game').closeShop());

console.log(`\nОшибки в консоли: ${problems.length ? problems.join('\n') : '(нет)'}`);
await browser.close();
