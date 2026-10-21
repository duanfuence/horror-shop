// Полное прохождение смены «ботом» через настоящий интерфейс в Chromium.
// Проверяет: каждая стратегия доходит до экрана итогов с ожидаемой концовкой,
// сохранение и «Продолжить» работают, перезапуск смены работает, нет ошибок консоли.
// Запуск: node scripts/playthrough.mjs [baseUrl]
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
const OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });

const RULES = [
  'Принять смену', 'Да, первая', 'Что значит', 'Поздно со смены', 'Берегите', 'Оставить чек', 'Ночью нельзя',
  'Ответить (линия 1)', 'Всё спокойно', 'Пробить покупку', 'Не отвечать', 'Оторвать ленту', 'Спасибо, что сказали',
  'Ночью поставок не бывает', 'Не открывать', 'Закрыть дверь', 'Перезвоню вам', 'Положить трубку', 'Захлопнуть',
  'Галина Петровна сейчас дома', 'Нет. Ключи останутся', 'Нет.', 'Оторвать чек', 'Тихо.', 'Нет. Тишина',
];

const STRATEGIES = [
  { name: 'rules', prefer: RULES, expect: 'morning', alcohol: 'refuse' },
  { name: 'swap', prefer: ['Отдать ключи', ...RULES], expect: 'swap', alcohol: 'refuse' },
  { name: 'fired', prefer: ['Открыть дверь', ...RULES], expect: 'fired', alcohol: 'sell' },
];

async function play(strategy, opts = {}) {
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  let ending = null;
  try {
    await page.goto(`${base}?debug=1&speed=25`);
    await page.waitForSelector('.menu-card', { timeout: 20000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.menu-card');
    await page.click('text=Новая смена');
    await page.fill('input[type=text]', 'Бот');
    await page.click('text=Выйти на смену');

    let reloaded = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      const st = await page.evaluate(() => {
        const ns = window.__ns;
        return {
          results: !!document.querySelector('.results-card'),
          choice: [...document.querySelectorAll('.dialog.show .choice')].map((b) => b.textContent),
          register: !!document.querySelector('.register.show'),
          items: document.querySelectorAll('.register.show .item').length,
          alcohol: [...document.querySelectorAll('.register.show .btn')].some((b) => b.textContent.includes('Минеральная')),
          askName: [...document.querySelectorAll('.register.show .btn')].some((b) => b.textContent.includes('Спросить фамилию')),
          answer: document.querySelector('.register.show .answer')?.textContent ?? '',
          dialog: !!document.querySelector('.dialog.show'),
          minutes: ns.session.state.minutes,
          busy: ns.session.isBusy,
          temp: ns.session.state.tempLog,
          round: ns.session.currentRound(),
          rounds: ns.session.state.camRounds,
        };
      });
      if (st.results) break;
      if (st.choice.length) {
        let idx = -1;
        for (const w of strategy.prefer) {
          idx = st.choice.findIndex((t) => t.includes(w));
          if (idx >= 0) break;
        }
        if (idx < 0) idx = 0;
        await page.locator('.dialog.show .choice').nth(idx).click();
        continue;
      }
      if (st.register) {
        if (st.items) {
          await page.locator('.register.show .item').first().click();
          continue;
        }
        if (st.alcohol) {
          await page.click(strategy.alcohol === 'sell' ? '.register.show .btn.danger' : '.register.show >> text=Отказать');
          continue;
        }
        if (st.askName) {
          await page.click('.register.show >> text=Спросить фамилию');
          continue;
        }
        const unknownOk = !st.answer || st.answer.includes('Семёнов');
        await page.click(unknownOk ? '.register.show .btn.primary' : '.register.show >> text=Отказать');
        continue;
      }
      if (st.dialog) {
        await page.keyboard.press('Space');
        await page.waitForTimeout(30);
        continue;
      }
      // свободное время: записать температуру и сделать обход камер
      if (!st.busy) {
        const hour = String(Math.min(5, Math.floor(st.minutes / 60)));
        if (st.temp[hour] === undefined && st.minutes % 60 >= 1) {
          await page.evaluate(() => window.__ns.ui.tool('fridge'));
          const btn = page.locator('.thermo .btn:not([disabled])');
          if (await btn.count()) await btn.click().catch(() => undefined);
          continue;
        }
        if (st.round && (st.rounds[st.round] ?? []).length < 4) {
          await page.evaluate(() => window.__ns.ui.tool('cameras'));
          for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) await page.keyboard.press(k);
          const close = page.locator('.cctv-ui .cam-btn', { hasText: 'Закрыть' });
          if (await close.count()) await close.click().catch(() => undefined);
          continue;
        }
      }
      // проверка сохранения: один раз перезагрузить страницу посреди смены
      if (opts.reload && !reloaded && st.minutes >= 130 && !st.busy) {
        reloaded = true;
        const before = st.minutes;
        await page.waitForTimeout(200);
        await page.reload();
        await page.waitForSelector('.menu-card');
        const cont = page.locator('text=Продолжить смену');
        if (!(await cont.count())) throw new Error('После перезагрузки нет кнопки «Продолжить смену»');
        await cont.click();
        const after = await page.evaluate(() => window.__ns.session.state.minutes);
        if (after > before || before - after > 10) throw new Error(`Сохранение: было ${before}, восстановлено ${after}`);
        console.log(`  сохранение: ${before} → ${after} мин — ok`);
        continue;
      }
      await page.waitForTimeout(40);
    }
    ending = await page.evaluate(() => window.__ns.session.state.endingId);
    await page.waitForSelector('.results-card', { timeout: 8000 });
    await page.screenshot({ path: `${OUT}/play-${strategy.name}-results.png` });
    // перезапуск
    await page.click('text=Начать смену заново');
    await page.waitForSelector('input[type=text]');
    await page.click('text=Выйти на смену');
    await page.waitForSelector('.dialog.show', { timeout: 8000 });
    const restarted = await page.evaluate(() => window.__ns.session.state.minutes === 0 && window.__ns.session.status === 'running');
    if (!restarted) throw new Error('Перезапуск смены не сработал');
  } catch (err) {
    errors.push(`failed: ${err.message}`);
    await page.screenshot({ path: `${OUT}/play-${strategy.name}-failure.png` }).catch(() => undefined);
  }
  await browser.close();
  const ok = ending === strategy.expect && errors.length === 0;
  console.log(`${strategy.name}: концовка ${ending} (ожидалась ${strategy.expect}) — ${ok ? 'ok' : 'ОШИБКА'}`);
  if (errors.length) console.log('  ' + errors.join('\n  '));
  return ok;
}

let allOk = true;
for (const [i, s] of STRATEGIES.entries()) allOk = (await play(s, { reload: i === 0 })) && allOk;
if (!allOk) process.exitCode = 1;
