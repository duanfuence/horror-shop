// Проверка архива камер в настоящем браузере (Chromium через Playwright).
// Запуск (на собранной версии): npm run build && npm run preview, затем
//   node scripts/archive-check.mjs [baseUrl] [profile]
// profile: desktop | phone-landscape | phone-portrait | all (по умолчанию all)
// Скриншоты: e2e-output/archive-*.png
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
      await page.screenshot({ path: `${OUT}/archive-fail-${name}.png` });
      throw err;
    }
  };
  await page.goto(`${base}?debug=1&seed=2024`);
  await page.waitForSelector('.menu-card', { timeout: 20000 });
  await click(page.locator('text=Новая смена'));
  await click(page.locator('text=Выйти на смену'));
  await page.waitForSelector('.dialog.show');
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
  // Без сюжета и случайных аномалий: на складе «открывается дверь», которую видно только на записи.
  const t = await page.evaluate(() => {
    const s = window.__ns.session;
    for (const b of s.shift.timeline) if (!s.state.fired.includes(b.id)) s.state.fired.push(b.id);
    s.state.anomalies.quietUntil = 9999;
    for (const d of s.anomalies.pool) if (d.archiveOnly) s.state.anomalies.count[d.id] = 99;
    s.skipMinutes(3);
    const at = s.state.minutes;
    s.state.anomalies.active = [{ id: 'rec_door', cam: 4, at, stage: 0, seen: false }];
    s.skipMinutes(1);
    s.state.anomalies.active = [];
    s.skipMinutes(4);
    return at + 1;
  });
  await page.keyboard.press('KeyC');
  await page.waitForSelector('.cctv-ui');
  await click(page.locator('.cctv-ui .cam-btn >> text=/^4 /'));
  check(!(await page.evaluate(() => window.__ns.session.anomalyVisuals(4).includes('door_open'))), 'в эфире дверь склада закрыта');
  await page.screenshot({ path: `${OUT}/archive-${name}-live.png` });

  await click(page.locator('.cctv-ui .cam-btn.archive-btn'));
  await page.waitForSelector('.cctv-ui.archive .cam-range');
  const osd = await page.locator('.cctv-ui .osd').innerText();
  check(/ЗАПИСЬ/.test(osd), 'индикатор режима записи', osd.replace(/\n/g, ' '));
  // перемотка ползунком к нужной минуте
  await page.evaluate((t) => {
    const r = document.querySelector('.cam-range');
    r.value = String(t);
    r.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
  await page.waitForTimeout(400);
  const label = await page.locator('.cam-time').innerText();
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  check(label === hhmm(t), 'показано выбранное время', label);
  await page.screenshot({ path: `${OUT}/archive-${name}-record.png` });
  // шаг кнопками и отметка
  await click(page.locator('.cam-btn.mark'));
  await click(page.locator('.cam-btn.step >> nth=0'));
  check((await page.locator('.cam-time').innerText()) === hhmm(t - 1), 'шаг на минуту назад');
  await click(page.locator('.cam-btn.mark'));
  check((await page.locator('.cam-time').innerText()) === hhmm(t), 'переход к отметке');
  const bar = await page.locator('.cctv-ui .bar').boundingBox();
  check(!!bar && bar.x >= 0 && bar.x + bar.width <= profile.viewport.width + 1, 'панель записи помещается по ширине', JSON.stringify(bar));
  const sliderBox = await page.locator('.cam-range').boundingBox();
  check(!!sliderBox && sliderBox.width >= 120 && sliderBox.height >= 24, 'ползунок достаточно большой для пальца', JSON.stringify(sliderBox));

  // фиксация по записи
  await click(page.locator('.cctv-ui .cam-btn.report'));
  await click(page.locator('.cam-picker .cam-btn >> text=Открыто то, что закрыто'));
  await page.waitForTimeout(200);
  const entry = await page.evaluate(() => window.__ns.session.state.anomalies.log.at(-1));
  check(entry?.result === 'correct' && entry?.archive === t, 'архивная фиксация засчитана', JSON.stringify(entry?.text ?? ''));
  check(await page.evaluate(() => window.__ns.session.state.clues.includes('archive_door')), 'появилась улика');

  // назад в эфир
  await click(page.locator('.cam-btn.live'));
  await page.waitForTimeout(300);
  const osdLive = await page.locator('.cctv-ui .osd').innerText();
  check(/REC/.test(osdLive) && !/ЗАПИСЬ/.test(osdLive), 'возврат в эфир одной кнопкой', osdLive.replace(/\n/g, ' '));
  check(!(await page.locator('.cctv-ui.archive').count()), 'режим записи выключен');
  // кнопка «Запись» возвращает на прошлую позицию
  await click(page.locator('.cctv-ui .cam-btn.archive-btn'));
  check((await page.locator('.cam-time').innerText()) === hhmm(t), 'возврат в запись на ту же минуту');
  if (!profile.hasTouch) {
    // стрелка на сфокусированном ползунке — ровно одна минута, Esc из ползунка тоже работает
    await page.locator('.cam-range').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);
    check((await page.locator('.cam-time').innerText()) === hhmm(t - 1), 'стрелка на ползунке — один шаг');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(!(await page.locator('.cctv-ui.archive').count()) && (await page.locator('.cctv-ui').count()) === 1, 'Esc из записи — в эфир, камеры открыты');
  check(errors.length === 0, 'нет ошибок в консоли', errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсе проверки пройдены');
process.exitCode = failures ? 1 : 0;
