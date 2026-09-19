import { chromium, webkit } from 'playwright-core';

const useWebkit = process.env.ENGINE === 'webkit';
const browser = useWebkit
  ? await webkit.launch({
      executablePath:
        '/Users/stepan2/Library/Caches/ms-playwright/webkit-2359/pw_run.sh',
    })
  : await chromium.launch({
      executablePath:
        '/Users/stepan2/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      args: ['--no-sandbox'],
    });
// Телефонный вьюпорт (iPhone 12/13/14)
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });

const problems = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') problems.push(`[console.${t}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

await page.goto('http://localhost:5199', { waitUntil: 'load' });
await page.waitForTimeout(2500);

// Стартуем игровой сценарий (в обход кнопки меню)
await page.evaluate(() => {
  window.__game.scene.getScene('Start').scene.start('Game');
});
await page.waitForTimeout(1500);

// Игрок у лавки, золото есть — как в реальной игре
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.run.gold = 500;
  gs.player.body.reset(gs.shop.x + 70, gs.shop.y);
});

// Реальный путь: удерживаем кнопку АТАКА (справа внизу), атака откроет лавку
const btn = await page.evaluate(() => {
  const ui = window.__game.scene.getScene('UI');
  return { x: ui.attackX, y: ui.attackY };
});
console.log('attack button at', btn);
await page.mouse.move(btn.x, btn.y);
await page.mouse.down();
await page.waitForTimeout(900); // ждём кулдаун атаки (450 мс) и открытие лавки

const state = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  const ui = window.__game.scene.getScene('UI');
  const containers = ui.children.list.filter((o) => o.type === 'Container' && o.depth >= 400);
  return {
    paused: gs.paused,
    offerCount: gs.shopOffers.length,
    panelOpen: ui.shopPanel?.isOpen,
    containers: containers.map((c) => ({ depth: c.depth, size: c.list.length, visible: c.visible })),
  };
});
console.log('STATE:', JSON.stringify(state, null, 2));

await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/degame-shop-engine.png' });
console.log('PROBLEMS:', problems.length ? problems.join('\n---\n') : '(none)');

await browser.close();
