/**
 * E2E-проверка бага: после проигрыша (кристалл разрушен) и возврата в меню
 * кнопка ИГРАТЬ должна снова запускать игру.
 *
 * Требует dev-сервер на порту 5199. Запуск: node tests/e2e-play-after-gameover.mjs
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath:
    '/Users/stepan2/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });

const problems = [];
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`[console.error] ${m.text()}`);
});

let failed = 0;
function check(name, condition, extra = '') {
  if (condition) {
    console.log(`  + ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    failed++;
    console.log(`  x ${name}${extra ? ` (${extra})` : ''}`);
  }
}

function scenesSnapshot() {
  return window.__game.scene.scenes.map((s) => {
    const st = s.scene.settings;
    return `${s.scene.key}:${s.scene.isActive() ? 'on' : 'off'}`;
  }).join(' ');
}

await page.goto('http://localhost:5199', { waitUntil: 'load' });
await page.waitForTimeout(2500);

console.log('до старта:', await page.evaluate(() => window.__game.scene.scenes.map((s) => `${s.scene.key}:${s.scene.isActive() ? 'on' : 'off'}`).join(' ')));

// Запускаем игру
await page.evaluate(() => window.__game.scene.getScene('Start').scene.start('Game'));
await page.waitForTimeout(1500);
const runState = await page.evaluate(() => window.__game.scene.getScene('Game').scene.isActive());
check('игра запустилась в первый раз', runState === true);

// Гасим кристалл — проигрыш (gameOver вызывается сценой, вызовем напрямую)
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.gameOver();
});
await page.waitForTimeout(5500); // GAME_OVER_DELAY + запас

const menuState = await page.evaluate(() => window.__game.scene.scenes.map((s) => `${s.scene.key}:${s.scene.isActive() ? 'on' : 'off'}`).join(' '));
console.log('после game over:', menuState);
check(
  'вернулись в меню (Start активна, Game и UI выключены)',
  menuState === 'Start:on Game:off UI:off',
  menuState,
);

// Нажимаем ИГРАТЬ настоящим тапом по кнопке (центр X, кнопка на centerY + height*0.12)
await page.touchscreen.tap(195, Math.round(844 / 2 + 844 * 0.12));
await page.waitForTimeout(1500);

const afterClick = await page.evaluate(() => window.__game.scene.scenes.map((s) => `${s.scene.key}:${s.scene.isActive() ? 'on' : 'off'}`).join(' '));
console.log('после тапа по ИГРАТЬ:', afterClick);
check('кнопка ИГРАТЬ снова запускает игру', afterClick.includes('Game:on'), afterClick);

if (problems.length > 0) {
  console.log('\nОшибки страницы:');
  for (const p of problems) console.log('  ' + p);
}

await browser.close();
console.log(failed === 0 ? '\nOK' : `\nПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
