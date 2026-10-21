// Проверка аномалий на камерах в настоящем браузере (Chromium через Playwright).
// Запуск (на собранной версии): npm run build && npm run preview, затем
//   node scripts/anomaly-check.mjs [baseUrl] [profile]
// profile: desktop | phone-landscape | phone-portrait | all (по умолчанию all)
// Для каждой аномалии делает скриншот экрана камеры (e2e-output/anomaly-*.png),
// затем проходит фиксацию: верную и ошибочную, и проверяет журнал «Камеры».
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node22/lib/node_modules/playwright');
}
const base = process.argv[2] ?? 'http://localhost:4173/';
const which = process.argv[3] ?? 'all';
const OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });

const PROFILES = {
  desktop: { viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false },
  'phone-landscape': { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'phone-portrait': { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

// [id, камера, стадия] — каждая стадия, которую стоит увидеть глазами
const SHOTS = [
  ['far_figure', 1, 0], ['far_figure', 2, 0], ['floor_shadow', 1, 0], ['clerk_facing', 1, 0],
  ['fridge_open', 1, 0], ['fridge_open', 1, 1], ['truck', 2, 0], ['truck', 2, 1], ['dog_walker', 2, 0], ['dog_walker', 2, 1],
  ['cam3_clock', 3, 0], ['counter_candle', 3, 0], ['counter_candle', 3, 1], ['behind_clerk', 3, 0], ['behind_clerk', 3, 1],
  ['extra_box', 4, 0], ['extra_box', 4, 1], ['extra_box', 4, 2], ['chair_moved', 4, 0], ['chair_moved', 4, 1],
  ['door_ghost', 4, 0], ['door_ghost', 4, 1], ['lens_frost', 4, 0],
];

let failures = 0;
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const browser = await pw.chromium.launch();
for (const [name, profile] of Object.entries(PROFILES)) {
  if (which !== 'all' && which !== name) continue;
  console.log(`── ${name}`);
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const click = async (loc) => {
    try {
      await (profile.hasTouch ? loc.tap({ timeout: 8000 }) : loc.click({ timeout: 8000 }));
    } catch (err) {
      await page.screenshot({ path: `${OUT}/anomaly-fail-${name}.png` });
      throw err;
    }
  };
  await page.goto(`${base}?debug=1&seed=2024`);
  await page.waitForSelector('.menu-card', { timeout: 20000 });
  await click(page.locator('text=Новая смена'));
  await click(page.locator('text=Выйти на смену'));
  await page.waitForSelector('.dialog.show');
  // доиграть вступление и курьера
  for (let i = 0; i < 800; i++) {
    const st = await page.evaluate(() => ({ busy: window.__ns.session.isBusy, m: window.__ns.session.state.minutes }));
    if (!st.busy && st.m >= 6) break;
    if (await page.locator('.dialog.show .choice').count()) await click(page.locator('.dialog.show .choice').first());
    else if (await page.locator('.register.show').count()) {
      if (await page.locator('.register.show .item').count()) await click(page.locator('.register.show .item').first());
      else await click(page.locator('.register.show .btn.primary'));
    } else await page.locator('.dialog.show').click({ position: { x: 20, y: 20 } }).catch(() => {});
    await page.waitForTimeout(40);
  }
  // Сюжет дальше не запускать, случайные аномалии не появляются: смотрим только заданные.
  await page.evaluate(() => {
    const s = window.__ns.session;
    for (const b of s.shift.timeline) if (!s.state.fired.includes(b.id)) s.state.fired.push(b.id);
    s.state.minutes = 130;
    s.state.anomalies.quietUntil = 9999;
  });
  const setAnomaly = (id, cam, stage) =>
    page.evaluate(([id, cam, stage]) => {
      const s = window.__ns.session.state;
      s.anomalies.active = [{ id, cam, at: s.minutes, stage, seen: false }];
      s.anomalies.traces = [];
      if (id === 'lens_frost') s.stats.attention = 8; // мороз для камеры 4
      else s.stats.attention = 0;
    }, [id, cam, stage]);
  await page.keyboard.press('KeyC');
  await page.waitForSelector('.cctv-ui');
  for (const [id, cam, stage] of SHOTS) {
    await setAnomaly(id, cam, stage);
    await click(page.locator(`.cctv-ui .cam-btn >> text=/^${cam} /`));
    await page.waitForTimeout(450);
    if (name === 'desktop') await page.screenshot({ path: `${OUT}/anomaly-${id}-${cam}-${stage}.png` });
  }
  await setAnomaly('cam3_clock', 3, 0);
  await click(page.locator('.cctv-ui .cam-btn >> text=/^3 /'));
  await page.waitForTimeout(400);
  const osdText = await page.locator('.cctv-ui .osd').innerText();
  check(osdText.includes('05:58'), 'часы камеры 3 подменены', osdText.replace(/\n/g, ' '));

  // верная фиксация
  await setAnomaly('extra_box', 4, 0);
  await click(page.locator('.cctv-ui .cam-btn >> text=/^4 /'));
  await page.waitForTimeout(300);
  await click(page.locator('.cctv-ui .cam-btn.report'));
  await page.waitForSelector('.cam-picker .cam-btn');
  await page.screenshot({ path: `${OUT}/anomaly-picker-${name}.png` });
  const pickerBox = await page.locator('.cam-picker').boundingBox();
  check(
    !!pickerBox && pickerBox.x >= 0 && pickerBox.x + pickerBox.width <= profile.viewport.width && pickerBox.y >= 0 && pickerBox.y + pickerBox.height <= profile.viewport.height,
    'выбор категории помещается на экране',
    JSON.stringify(pickerBox),
  );
  await click(page.locator('.cam-picker .cam-btn >> text=Предмет не на месте'));
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__ns.session.state.anomalies);
  check(after.log.at(-1)?.result === 'correct' && after.active.length === 0, 'верная фиксация засчитана');
  const toast = await page.locator('#toasts').innerText().catch(() => '');
  check(/Записано/.test(toast), 'игрок видит результат проверки', toast.slice(0, 80));
  check(await page.locator('.cctv-ui .cam-btn.report').isDisabled(), 'журнал занят сразу после записи');

  // журнал освобождается сам, без переключения камеры
  await page.evaluate(() => {
    const ns = window.__ns.session;
    ns.state.anomalies.active = [];
    ns.state.anomalies.reportUntil = ns.state.minutes + 1;
    ns.skipMinutes(1);
  });
  await page.waitForTimeout(150);
  check(!(await page.locator('.cctv-ui .cam-btn.report').isDisabled()), 'кнопка «Зафиксировать» снова доступна');

  // ошибочная фиксация
  await click(page.locator('.cctv-ui .cam-btn >> text=/^2 /'));
  await click(page.locator('.cctv-ui .cam-btn.report'));
  await click(page.locator('.cam-picker .cam-btn >> text=Открыто то, что закрыто'));
  await page.waitForTimeout(200);
  const wrong = await page.evaluate(() => window.__ns.session.state.anomalies.log.at(-1));
  check(wrong?.result === 'false', 'ошибочная фиксация записана как ложная тревога');
  check(await page.evaluate(() => window.__ns.session.status === 'running'), 'игра продолжается');

  // журнал
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyJ');
  await click(page.locator('.tabs .tab >> text=Камеры'));
  await page.waitForTimeout(200);
  const entries = await page.locator('.cam-log li').count();
  check(entries === 2, 'в журнале «Камеры» две записи', String(entries));
  await page.screenshot({ path: `${OUT}/anomaly-journal-${name}.png` });
  check(errors.length === 0, 'нет ошибок в консоли', errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсе проверки пройдены');
process.exitCode = failures ? 1 : 0;
