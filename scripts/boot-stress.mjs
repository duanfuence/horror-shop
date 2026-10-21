// Стресс-тест загрузки: игра должна стабильно доходить до меню без ошибок.
// Запуск: node scripts/boot-stress.mjs [baseUrl] [раз]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node22/lib/node_modules/playwright');
}
const base = process.argv[2] ?? 'http://localhost:4173/';
const times = Number(process.argv[3] ?? 20);
const browser = await pw.chromium.launch();
let failures = 0;
for (let i = 0; i < times; i++) {
  const ctx = await browser.newContext({ viewport: { width: 800 + (i % 5) * 100, height: 500 + (i % 3) * 120 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await page.goto(base);
    await page.waitForSelector('.menu-card', { timeout: 15000 });
  } catch (err) {
    errors.push(String(err.message).split('\n')[0]);
  }
  if (errors.length) {
    failures++;
    console.log(`запуск ${i + 1}: ${errors.join(' | ')}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`${times - failures}/${times} запусков без ошибок`);
if (failures) process.exitCode = 1;
