/**
 * E2E-проверка правила выбора цели врагом (в реальном браузере):
 * охотник (hunter) должен идти бить кристалл, если кристалл ближе игрока,
 * и преследовать игрока, если игрок ближе.
 *
 * Требует запущенного dev-сервера на порту 5199.
 * Запуск: node tests/e2e-enemy-crystal.mjs
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath:
    '/Users/stepan2/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });

const problems = [];
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`[console.error] ${m.text()}`);
});

let failed = 0;
function check(name, condition, extra = '') {
  if (condition) {
    console.log(`  ✓ ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`);
  }
}

await page.goto('http://localhost:5199', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.evaluate(() => window.__game.scene.getScene('Start').scene.start('Game'));
await page.waitForTimeout(1200);

// Изолируем сцену: отключаем волны, чтобы штатный спавн не мешал измерениям
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.waveSystem.update = () => {};
});

// ---------- Сценарий 1: игрок далеко, кристалл близко → цель «кристалл» ----------
console.log('\nСценарий 1: охотник рядом с кристаллом, игрок далеко');
const setup = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.player.body.reset(200, 200); // игрок в дальнем углу карты (жив)
  gs.enemies.forEach((e) => e.destroy());
  gs.enemies.length = 0;

  gs.spawnEnemy('slime');
  const e = gs.enemies[gs.enemies.length - 1];
  e.role = 'hunter'; // принудительно охотник (обычно роль случайна)
  e.body.reset(gs.crystal.x, gs.crystal.y - 180);
  return {
    crystalHp: gs.crystal.hp,
    playerHp: gs.player.hp,
    distToCrystal: Math.round(Math.hypot(e.x - gs.crystal.x, e.y - gs.crystal.y)),
    distToPlayer: Math.round(Math.hypot(e.x - gs.player.x, e.y - gs.player.y)),
  };
});
console.log(
  `  старт: HP кристалла ${setup.crystalHp}, до кристалла ${setup.distToCrystal}, до игрока ${setup.distToPlayer}`,
);

await page.waitForTimeout(4000); // враг доходит и бьёт кристалл

const s1 = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  const e = gs.enemies[0];
  return {
    crystalHp: gs.crystal.hp,
    playerHp: gs.player.hp,
    target: e ? e.target : null,
    distToCrystal: e ? Math.round(Math.hypot(e.x - gs.crystal.x, e.y - gs.crystal.y)) : null,
  };
});
check('враг выбрал целью кристалл (он ближе игрока)', s1.target === 'crystal', `target=${s1.target}`);
check(
  'враг подошёл к кристаллу',
  s1.distToCrystal !== null && s1.distToCrystal < setup.distToCrystal,
  `${setup.distToCrystal} → ${s1.distToCrystal}`,
);
check('враг нанёс урон кристаллу', s1.crystalHp < setup.crystalHp, `${setup.crystalHp} → ${s1.crystalHp}`);
check('игрок не пострадал', s1.playerHp === setup.playerHp, `${setup.playerHp} → ${s1.playerHp}`);

// ---------- Сценарий 2: игрок ближе кристалла → цель «игрок» ----------
console.log('\nСценарий 2: охотник, игрок ближе кристалла');
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.enemies.forEach((e) => e.destroy());
  gs.enemies.length = 0;

  gs.spawnEnemy('slime');
  const e = gs.enemies[gs.enemies.length - 1];
  e.role = 'hunter';
  e.body.reset(gs.crystal.x, gs.crystal.y - 700);
  gs.player.body.reset(gs.crystal.x, gs.crystal.y - 900); // ближе к врагу, чем кристалл
});
await page.waitForTimeout(500);

const s2 = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  const e = gs.enemies[0];
  return {
    target: e ? e.target : null,
    distToCrystal: Math.round(Math.hypot(e.x - gs.crystal.x, e.y - gs.crystal.y)),
    distToPlayer: Math.round(Math.hypot(e.x - gs.player.x, e.y - gs.player.y)),
  };
});
check('враг выбрал целью игрока (он ближе)', s2.target === 'player', `target=${s2.target}`);
check(
  'условие теста выполнено: игрок ближе кристалла',
  s2.distToPlayer < s2.distToCrystal,
  `до игрока ${s2.distToPlayer}, до кристалла ${s2.distToCrystal}`,
);

// ---------- Сценарий 3: игрок мёртв → цель «кристалл» ----------
console.log('\nСценарий 3: игрок мёртв (идёт возрождение)');
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  gs.enemies.forEach((e) => e.destroy());
  gs.enemies.length = 0;

  // Игрок далеко от кристалла и убит настоящим путём сцены
  gs.player.body.reset(400, 400);
  gs.killPlayer();

  gs.spawnEnemy('slime');
  const e = gs.enemies[gs.enemies.length - 1];
  e.role = 'hunter';
  e.body.reset(gs.player.x + 60, gs.player.y + 60); // враг прямо рядом с мёртвым игроком
});
await page.waitForTimeout(400);

const s3 = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('Game');
  const e = gs.enemies[0];
  return {
    playerDead: gs.player.isDead,
    target: e.target,
    distToPlayer: Math.round(Math.hypot(e.x - gs.player.x, e.y - gs.player.y)),
    distToCrystal: Math.round(Math.hypot(e.x - gs.crystal.x, e.y - gs.crystal.y)),
  };
});
check('игрок действительно мёртв', s3.playerDead);
check(
  'игрок ближе кристалла (правило работает вопреки близости)',
  s3.distToPlayer < s3.distToCrystal,
  `до игрока ${s3.distToPlayer}, до кристалла ${s3.distToCrystal}`,
);
check('при мёртвом игроке враг идёт к кристаллу', s3.target === 'crystal', `target=${s3.target}`);

await page.screenshot({ path: '/tmp/degame-targeting.png' });
console.log(`\nОшибки в консоли: ${problems.length ? problems.join('\n') : '(нет)'}`);
console.log(failed === 0 ? '\n✅ E2E: все проверки пройдены' : `\n ПРОВАЛЕНО: ${failed}`);
process.exitCode = failed === 0 ? 0 : 1;

await browser.close();