// Грубая проверка производительности: частота кадров при искусственно замедленном процессоре
// (имитация слабого телефона). Запуск: node scripts/perf-check.mjs http://localhost:4173/
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node22/lib/node_modules/playwright');
}
const base = process.argv[2] ?? 'http://localhost:4173/';
const browser = await pw.chromium.launch();

async function measure(page, ms = 4000) {
  return page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const t0 = last;
        const loop = (t) => {
          times.push(t - last);
          last = t;
          if (t - t0 < dur) requestAnimationFrame(loop);
          else {
            times.sort((a, b) => a - b);
            const avg = times.reduce((s, x) => s + x, 0) / times.length;
            resolve({ fps: Math.round(1000 / avg), p95: Math.round(times[Math.floor(times.length * 0.95)]) });
          }
        };
        requestAnimationFrame(loop);
      }),
    ms,
  );
}

for (const rate of [1, 4, 6]) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}?debug=1`);
  await page.waitForSelector('.menu-card');
  await page.click('text=Новая смена');
  await page.click('text=Выйти на смену');
  await page.waitForSelector('.dialog.show');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const normal = await measure(page);
  await page.evaluate(() => {
    const ns = window.__ns;
    const s = ns.session.state;
    s.flags.blackout = true;
    s.flags.flashlight = true;
    s.lights = 'emergency';
    s.stats.attention = 8;
    ns.bus.emit('lights', { mode: 'emergency' });
  });
  const dark = await measure(page);
  await page.evaluate(() => window.__ns.stage.openCctv(4));
  const cctv = await measure(page);
  console.log(
    `CPU ×${rate}: обычный свет ${normal.fps} к/с (p95 ${normal.p95} мс), темнота ${dark.fps} к/с (p95 ${dark.p95} мс), камеры ${cctv.fps} к/с (p95 ${cctv.p95} мс)`,
  );
  await ctx.close();
}
await browser.close();
