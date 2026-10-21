// Скриншоты ключевых визуальных моментов (через отладочный объект __ns).
// Запуск: node scripts/showcase.mjs [baseUrl]
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
mkdirSync('e2e-output', { recursive: true });
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${base}?debug=1&speed=1`);
await page.waitForSelector('.menu-card');
await page.click('text=Новая смена');
await page.click('text=Выйти на смену');
await page.waitForSelector('.dialog.show');
// остановить сюжет, оставив игровой экран
await page.evaluate(() => {
  const ns = window.__ns;
  ns.session.stop();
  ns.session.status = 'running';
  // все события хронологии помечены как прошедшие — сюжет не вмешивается в витрину
  ns.session.state.fired = ns.session.shift.timeline.map((b) => b.id);
  ns.session.state.flags.rulesAccepted = true;
  document.querySelector('.dialog')?.classList.remove('show');
  ns.bus.emit('paper', null);
});

async function moment(name, fn, opts = {}) {
  await page.evaluate(fn);
  await page.waitForTimeout(opts.wait ?? 900);
  if (opts.mouse) await page.mouse.move(opts.mouse[0], opts.mouse[1]);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `e2e-output/show-${name}.png` });
}

await moment('grey-v2', () => window.__ns.bus.emit('customer', { id: 'grey', variant: 'v2' }));
await moment('grey-v3', () => {
  const ns = window.__ns;
  ns.session.state.stats.attention = 6;
  ns.bus.emit('customer', { id: 'grey', variant: 'v3' });
  ns.bus.emit('state:changed');
});
await moment('liza-v2', () => window.__ns.bus.emit('customer', { id: 'liza', variant: 'v2' }));
await moment('misha', () => window.__ns.bus.emit('customer', { id: 'misha', variant: 'v1' }));
await moment(
  'relief-dark',
  () => {
    const ns = window.__ns;
    const s = ns.session.state;
    s.flags.blackout = true;
    s.flags.flashlight = true;
    s.lights = 'emergency';
    ns.bus.emit('lights', { mode: 'emergency' });
    ns.bus.emit('customer', { id: 'relief', variant: 'v1' });
  },
  { mouse: [460, 200] },
);
await moment(
  'aisle-dark',
  () => {
    const ns = window.__ns;
    ns.session.state.flags.reliefWaiting = true;
    ns.bus.emit('customer', null);
  },
  { mouse: [620, 280] },
);
await moment('gp-morning', () => {
  const ns = window.__ns;
  const s = ns.session.state;
  s.flags.blackout = false;
  s.lights = 'normal';
  s.stats.attention = 0;
  ns.bus.emit('lights', { mode: 'normal' });
  ns.bus.emit('customer', { id: 'gp', variant: 'v1' });
});
await moment('door-open', () => {
  const ns = window.__ns;
  ns.bus.emit('customer', null);
  ns.session.state.serviceDoor = 'open';
  ns.bus.emit('door', { door: 'service', state: 'open' });
});
// камеры
await moment('cam4-cold', () => {
  const ns = window.__ns;
  const s = ns.session.state;
  s.minutes = 250;
  s.stats.attention = 5;
  s.flags.cam4Cold = 3;
  ns.ui.tool('cameras');
  ns.stage.openCctv(4);
});
await moment('cam2-grey', () => {
  const ns = window.__ns;
  ns.session.state.minutes = 130;
  ns.session.state.stats.attention = 0;
  ns.stage.openCctv(2);
});
await moment('cam3-empty', () => {
  const ns = window.__ns;
  ns.session.state.minutes = 260;
  ns.stage.openCctv(3);
});
await browser.close();
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'ok');
