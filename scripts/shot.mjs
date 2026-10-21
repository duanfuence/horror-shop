// Скриншот страницы через Chromium (Playwright из окружения).
// Использование: node scripts/shot.mjs <url> <out.png> [width] [height]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const [url, out, w = '1000', h = '600'] = process.argv.slice(2);
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 }).catch(() => {});
await page.screenshot({ path: out, fullPage: true });
await browser.close();
if (errors.length) { console.error('ERRORS:', errors.join('\n')); process.exitCode = 1; }
console.log('saved', out);
