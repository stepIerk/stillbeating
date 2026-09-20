import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath:
    '/Users/stepan2/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const logs = [];
page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[VP]') || msg.type() === 'error') logs.push(text);
});
await page.goto('http://localhost:5199/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

const info = await page.evaluate(async () => {
  const app = document.querySelector('#app');
  const canvas = document.querySelector('canvas');
  return {
    appHeight: app?.getBoundingClientRect().height,
    docClientHeight: document.documentElement.clientHeight,
    innerHeight: window.innerHeight,
    canvasHeight: canvas?.getBoundingClientRect().height,
    canvasStyleHeight: canvas?.style.height,
    scaleW: window.__game?.scale.width,
    scaleH: window.__game?.scale.height,
    swRegistered: !!(await navigator.serviceWorker?.getRegistration()),
  };
});
console.log('=== APP/DOC/CANVAS ===');
console.log(JSON.stringify(info, null, 2));
console.log('=== VP LOGS ===');
for (const l of logs.slice(0, 20)) console.log(l);
const errors = logs.filter((l) => !l.includes('[VP]'));
if (errors.length) {
  console.log('=== ERRORS ===');
  console.log(errors.join('\n'));
  process.exitCode = 1;
}
if (Math.abs(info.appHeight - info.innerHeight) > 2 || Math.abs(info.canvasHeight - info.innerHeight) > 2) {
  console.log('FAIL: canvas/app height mismatch');
  process.exitCode = 1;
} else {
  console.log('OK: app/canvas heights match viewport');
}
await browser.close();
