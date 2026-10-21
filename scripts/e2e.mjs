// Сквозная проверка в настоящем браузере (Chromium через Playwright).
// Запуск: сначала `npm run dev` (или `npm run preview`), затем
//   node scripts/e2e.mjs [baseUrl] [profile]
// profile: desktop | phone-landscape | phone-portrait | all (по умолчанию all)
// Результат: скриншоты в e2e-output/, ошибки консоли — в выводе. Код выхода 1 при ошибках.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node22/lib/node_modules/playwright');
}

const base = process.argv[2] ?? 'http://localhost:5173/';
const which = process.argv[3] ?? 'all';
const OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });

const PROFILES = {
  desktop: { viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false },
  'phone-landscape': { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'phone-portrait': { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

const failures = [];

async function run(name, profile) {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const shot = (label) => page.screenshot({ path: `${OUT}/${name}-${label}.png` });
  const ns = (fn, arg) => page.evaluate(fn, arg);
  const tap = async (sel) => {
    const el = page.locator(sel).first();
    await el.waitFor({ state: 'visible', timeout: 8000 });
    if (profile.hasTouch) await el.tap();
    else await el.click();
  };
  /**
   * Пролистывать реплики, пока не появится выбор, касса или пока сцена не закончится.
   * Возвращает 'choice' | 'register' | 'idle'.
   */
  const advance = async (timeout = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const st = await page.evaluate(() => ({
        choice: document.querySelectorAll('.dialog.show .choice').length > 0,
        register: !!document.querySelector('.register.show'),
        dialog: !!document.querySelector('.dialog.show'),
        busy: window.__ns.session.isBusy,
        ended: window.__ns.session.status !== 'running',
      }));
      if (st.choice) return 'choice';
      if (st.register) return 'register';
      if (st.ended) return 'idle';
      if (!st.busy && !st.dialog) return 'idle';
      if (st.dialog) await page.keyboard.press('Space');
      await page.waitForTimeout(60);
    }
    throw new Error('advance: сцена не завершилась вовремя');
  };
  const choose = async (text) => {
    if ((await advance()) !== 'choice') throw new Error(`нет выбора «${text}»`);
    const opt = page.locator('.dialog.show .choice', { hasText: text }).first();
    await opt.waitFor({ timeout: 8000 });
    if (profile.hasTouch) await opt.tap();
    else await opt.click();
    await page.waitForTimeout(80);
  };

  try {
    await page.goto(`${base}?debug=1&speed=1`);
    await page.waitForSelector('.menu-card', { timeout: 20000 });
    await page.waitForTimeout(600);
    await shot('01-menu');

    await tap('text=Новая смена');
    await page.waitForSelector('input[type=text]');
    await shot('02-name');
    await page.fill('input[type=text]', 'Саша');
    await tap('text=Выйти на смену');
    await page.waitForSelector('.dialog.show', { timeout: 8000 });
    await page.waitForTimeout(300);
    await shot('03-intro');
    await advance();
    await shot('04-rules');
    await choose('Принять смену');
    await advance();
    await page.waitForTimeout(300);
    await shot('05-store');

    // курьер: обучение кассе
    await page.waitForSelector('.dialog.show', { timeout: 20000 });
    await advance();
    await page.waitForSelector('.register.show', { timeout: 10000 });
    await page.waitForTimeout(700);
    await shot('07-courier-register');
    while (await page.locator('.register.show .item').count()) {
      await tap('.register.show .item');
      await page.waitForTimeout(80);
    }
    await shot('08-scanned');
    await tap('.register.show .btn.primary');
    await advance();
    // дисплей кассы после продажи возвращается в режим ожидания
    await page.waitForTimeout(4000);
    const vfd = await ns(() => window.__ns.stage.game.scene.getScene('store')['lastVfd']);
    if (!String(vfd).startsWith('КАССА|')) errors.push(`дисплей кассы не вернулся в ожидание: «${vfd}»`);

    // записать температуру
    await advance();
    await ns(() => window.__ns.ui.tool('fridge'));
    await page.waitForSelector('.thermo');
    await shot('06-fridge');
    await tap('.thermo .btn');

    // камеры
    await advance();
    await ns(() => window.__ns.ui.tool('cameras'));
    await page.waitForTimeout(400);
    await shot('09-cam1');
    await page.keyboard.press('Digit4');
    await page.waitForTimeout(400);
    await shot('10-cam4');
    await page.keyboard.press('Escape');

    // журнал
    await ns(() => window.__ns.ui.tool('journal'));
    await page.waitForTimeout(200);
    await shot('11-journal');
    await tap('text=Перевернуть лист');
    await page.waitForTimeout(200);
    await shot('12-journal-back');
    await page.keyboard.press('Escape');

    // Рустам: диалог с выбором
    await page.waitForFunction(() => window.__ns.session.customer?.id === 'rustam', null, { timeout: 45000 });
    await page.waitForTimeout(900);
    await shot('13-rustam');
    await advance();
    await page.waitForSelector('.register.show');
    while (await page.locator('.register.show .item').count()) await tap('.register.show .item');
    await tap('.register.show .btn.primary');
    await choose('Да, первая');
    await advance();
    await shot('14-rustam-choice');
    await choose('Что значит');
    await advance();

    // перемотка к темноте: проверить аварийный свет и фонарик
    await ns(() => {
      const s = window.__ns.session;
      s.state.flags.blackout = true;
      s.state.lights = 'emergency';
      s.state.flags.flashlight = true;
      window.__ns.bus.emit('lights', { mode: 'emergency' });
      window.__ns.bus.emit('state:changed');
    });
    await page.mouse.move(profile.viewport.width * 0.6, profile.viewport.height * 0.45);
    await page.waitForTimeout(300);
    await shot('15-blackout');

    // звук: контекст Web Audio создан и работает после действий игрока
    const audioState = await ns(() => window.__ns.audio['ctx']?.state ?? 'нет');
    if (audioState !== 'running') errors.push(`звук: AudioContext в состоянии «${audioState}»`);

    // пауза
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await shot('16-pause');
  } catch (err) {
    errors.push(`step failed: ${err.message}`);
    await shot('zz-failure').catch(() => undefined);
  }
  await browser.close();
  if (errors.length) failures.push(`[${name}]\n  ${errors.join('\n  ')}`);
  console.log(`${name}: ${errors.length ? 'ОШИБКИ' : 'ok'}`);
}

for (const [name, profile] of Object.entries(PROFILES)) {
  if (which !== 'all' && which !== name) continue;
  await run(name, profile);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
