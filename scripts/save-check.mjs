// Проверка сохранений в настоящем браузере.
// Запуск (на собранной версии): npm run build && npm run preview, затем
//   node scripts/save-check.mjs http://localhost:4173/
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node22/lib/node_modules/playwright');
}
const base = process.argv[2] ?? 'http://localhost:4173/';
const url = `${base}?debug=1&speed=10`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const state = () =>
  page.evaluate(() => {
    const s = window.__ns.session;
    return {
      minutes: s.state.minutes,
      busy: s.isBusy,
      status: s.status,
      rules: !!s.state.flags.rulesAccepted,
      scene: s.sceneId,
      customer: s.customer?.id ?? null,
      paper: !!document.querySelector('.paper-wrap'),
    };
  });
const toMenu = async () => {
  await page.reload();
  await page.waitForSelector('.menu-card', { timeout: 20000 });
};
const hasContinue = async () => (await page.locator('text=Продолжить смену').count()) > 0;
const newGame = async () => {
  await page.click('text=Новая смена');
  await page.fill('input[type=text]', 'Проверка');
  await page.click('text=Выйти на смену');
  await page.waitForSelector('.dialog.show');
};
/** Пролистывать реплики и закрывать выбор первым вариантом, пока часы не дойдут до minute. */
const playUntil = async (minute, opts = {}) => {
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const st = await state();
    if (st.minutes >= minute && !st.busy) return st;
    if (opts.stopInDialog && st.busy && st.customer === opts.stopInDialog) return st;
    if (await page.locator('.dialog.show .choice').count()) await page.locator('.dialog.show .choice').first().click();
    else if (await page.locator('.register.show').count()) {
      if (await page.locator('.register.show .item').count()) await page.locator('.register.show .item').first().click();
      else await page.locator('.register.show .btn.primary').click();
    } else if (await page.locator('.dialog.show').count()) await page.keyboard.press('Space');
    else await page.waitForTimeout(50);
  }
  throw new Error(`не дошли до минуты ${minute}`);
};

try {
  await page.goto(url);
  await page.waitForSelector('.menu-card');
  await page.evaluate(() => localStorage.clear());
  await toMenu();
  check('чистый запуск: нет кнопки «Продолжить»', !(await hasContinue()));

  // A. Перезагрузка посреди смены
  await newGame();
  await playUntil(12);
  await page.waitForTimeout(300);
  const before = await state(); // замер непосредственно перед перезагрузкой
  await toMenu();
  check('после перезагрузки есть «Продолжить смену»', await hasContinue());
  await page.click('text=Продолжить смену');
  await page.waitForTimeout(400);
  const after = await state();
  check(
    'время восстановлено (не позже, не более 5 мин раньше)',
    after.minutes <= before.minutes + 1 && before.minutes - after.minutes <= 5,
    `${before.minutes} → ${after.minutes}`,
  );
  check('вступление не повторяется', after.rules && !after.paper && after.scene !== 'intro');

  // B. Перезагрузка во время разговора с покупателем
  const mid = await playUntil(9999, { stopInDialog: 'rustam' });
  await toMenu();
  await page.click('text=Продолжить смену');
  await page.waitForTimeout(300);
  const resumed = await state();
  check('перезагрузка во время диалога: смена продолжается', resumed.status === 'running' && resumed.minutes <= mid.minutes, `${mid.minutes} → ${resumed.minutes}`);
  await playUntil(resumed.minutes + 20);
  const again = await page.evaluate(() => window.__ns.session.state.fired.filter((f) => f === 'rustam').length);
  check('событие не дублируется после восстановления', again === 1);

  // C. Пауза → выход в меню → новая смена поверх сохранения
  await page.keyboard.press('Escape');
  await page.click('text=Выйти в меню');
  await page.waitForSelector('.menu-card');
  check('после выхода в меню можно продолжить', await hasContinue());
  await newGame();
  const fresh = await state();
  check('новая смена начинается с 00:00 и вступления', fresh.minutes === 0 && fresh.paper);
  await toMenu();
  check('старое сохранение удалено при новой смене', !(await hasContinue()));

  // D. Концовка: сохранение очищается, концовка запоминается
  await newGame();
  await playUntil(6);
  await page.evaluate(() => window.__ns.session['finish']('swap'));
  await page.waitForSelector('.results-card', { timeout: 8000 });
  check('экран итогов показан', true);
  await toMenu();
  check('после концовки «Продолжить» нет', !(await hasContinue()));
  await page.click('text=Концовки');
  check('открытая концовка сохранена', (await page.locator('.modal >> text=Подмена').count()) > 0);
  await page.keyboard.press('Escape');

  // E. Повреждённое сохранение
  await page.evaluate(() => localStorage.setItem('nightshift.run.v1', '{битые данные'));
  await toMenu();
  check('битое сохранение не ломает запуск', !(await hasContinue()));

  // F. Настройки сохраняются
  await page.click('text=Настройки');
  await page.click('.segmented >> text=Сразу');
  await page.click('.segmented >> text=Выкл >> nth=0');
  await page.keyboard.press('Escape');
  await toMenu();
  const settings = await page.evaluate(() => window.__ns.save.settings);
  check('настройки пережили перезагрузку', settings.textSpeed === 0 && settings.muted === true);
} catch (err) {
  check('сценарий выполнен без сбоев', false, err.message.split('\n')[0]);
}
check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\nПровалено проверок: ${failed}` : `\nВсе ${results.length} проверок пройдены`);
if (failed) process.exitCode = 1;
