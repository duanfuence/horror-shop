/**
 * Сюжетные последствия (docs/story-audit.md, раздел C): реплики появляются только при нужных уликах
 * и не меняют условий концовок.
 */
import { describe, expect, it } from 'vitest';
import { shift1, morningReceipt } from '../src/content/shift1';
import { RECORD_CONTRADICTIONS } from '../src/content/shift1/scenes';
import { EventBus } from '../src/core/EventBus';
import { GameSession } from '../src/core/GameSession';
import type { LineRequest, Presenter } from '../src/core/Presenter';
import { cloneState, createState } from '../src/core/state';
import type { WorldState } from '../src/core/types';
import { endingScenarios, rulesPolicy, simulate } from './sim';

const flush = () => new Promise<void>((r) => setImmediate(r));

/** Сыграть одну сцену на подготовленном состоянии. Бот выбирает варианты по списку подстрок. */
async function play(scene: string, prep: (s: WorldState) => void, wants: string[] = []) {
  const lines: LineRequest[] = [];
  const options: string[][] = [];
  const presenter: Presenter = {
    async line(req) {
      lines.push(req);
    },
    async choose(req) {
      options.push(req.options.map((o) => o.text));
      for (const w of wants) {
        const i = req.options.findIndex((o) => o.text.includes(w));
        if (i >= 0) return i;
      }
      return req.timer ? req.timer.defaultIndex : req.options.length - 1;
    },
    async sale() {
      return { outcome: 'sold', askedName: false, overridden: false };
    },
    async wait() {},
    dialogStart() {},
    dialogEnd() {},
  };
  const session = new GameSession(shift1, new EventBus(), presenter);
  const s = createState(shift1, 'Тест', 5);
  // без сюжета по хронологии: играем ровно одну сцену
  for (const b of shift1.timeline) s.fired.push(b.id);
  s.minutes = 200;
  prep(s);
  session.resume(s);
  expect(session.playScene(scene)).toBe(true);
  for (let i = 0; i < 2000 && session.isBusy && session.status === 'running'; i++) await flush();
  return { lines: lines.map((l) => l.text), options, state: session.state };
}

describe('Сюжетные последствия', () => {
  it('03:40: дата на ленте даёт основание ответить «Ночью поставок не бывает» — и игрок видит, почему', async () => {
    const without = await play('delivery', () => {}, ['Не открывать']);
    expect(without.options[0]).not.toContain('Ночью поставок не бывает.');
    const r = await play('delivery', (s) => s.clues.push('fax_order'), ['Ночью поставок не бывает']);
    expect(r.options[0]).toContain('Ночью поставок не бывает.');
    expect(r.lines.some((t) => t.includes('с датой трёхлетней давности'))).toBe(true);
    expect(r.state.flags.deliveryRefused).toBe(true);
    // если есть другие основания — пояснение про дату не повторяется
    const other = await play('delivery', (s) => s.clues.push('fax_order', 'gp_verified'), ['Ночью поставок не бывает']);
    expect(other.lines.some((t) => t.includes('с датой трёхлетней давности'))).toBe(false);
  });

  it('03:29: Лиза и фургон на камере — только если игрок записал фургон', async () => {
    const without = await play('liza_return', () => {}, []);
    expect(without.options[0].some((o) => o.startsWith('Фургон стоит у входа'))).toBe(false);
    const r = await play('liza_return', (s) => s.clues.push('truck_cam'), ['Фургон стоит у входа']);
    expect(r.lines).toContain('Тогда что стоит у входа?');
    expect(r.lines.some((t) => t.includes('Как тогда с Костей'))).toBe(false);
    expect(r.state.flags.lizaTruckTwice).toBe(true);
    const both = await play('liza_return', (s) => s.clues.push('truck_cam', 'liza_window'), ['Фургон стоит у входа']);
    expect(both.lines.some((t) => t.includes('Как тогда с Костей'))).toBe(true);
  });

  it('утро: Г. П. забирает ленту, только если сама велела её сохранить и лента у игрока', async () => {
    const r = await play('morning', (s) => {
      s.flags.gpVerified = true;
      s.inventory.push('order');
    }, ['Тихо.']);
    expect(r.lines).toContain('Ленту давай. Ту, что касса ночью напечатала.');
    expect(r.state.inventory).not.toContain('order');
    expect(r.state.flags.gpTookOrder).toBe(true);
    expect(r.lines.some((t) => t.includes('туда же, где кассета'))).toBe(false);

    const tape = await play('morning', (s) => {
      s.flags.gpVerified = true;
      s.inventory.push('order');
      s.clues.push('archive_door', 'fax_order');
    }, ['На записи камер']);
    expect(tape.state.flags.gpTookTape).toBe(true);
    expect(tape.lines.some((t) => t.includes('туда же, где кассета'))).toBe(true);
    expect(tape.lines.some((t) => t.includes('На дату она смотрит'))).toBe(true);

    const notAsked = await play('morning', (s) => s.inventory.push('order'), ['Тихо.']);
    expect(notAsked.lines.some((t) => t.startsWith('Ленту давай'))).toBe(false);
    expect(notAsked.state.inventory).toContain('order');
  });

  it('утро: «Записи врут» — только при двух и более противоречащих записях', async () => {
    const one = await play('morning', (s) => s.clues.push('cam1_self'), ['Тихо.']);
    expect(one.lines).not.toContain('Записи врут. Запомни это.');
    const two = await play('morning', (s) => s.clues.push('cam1_self', 'archive_figure'), ['Тихо.']);
    expect(two.lines).toContain('Записи врут. Запомни это.');
    expect(two.state.flags.gpRecordsLie).toBe(true);
    // обычные аномалии и улики без противоречия записи не считаются
    const unrelated = await play('morning', (s) => s.clues.push('cam4_hand', 'truck_cam', 'grey_face'), ['Тихо.']);
    expect(unrelated.lines).not.toContain('Записи врут. Запомни это.');
    expect(RECORD_CONTRADICTIONS.every((c) => shift1.clues[c])).toBe(true);
  });

  it('утро: про открытую дверь Г. П. не ссылается на запись камеры 4', async () => {
    const r = await play('morning', (s) => (s.flags.doorOpened = true), ['Тихо.']);
    const line = r.lines.find((t) => t.includes('открывали служебную дверь'));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/[Кк]амера четыре/);
  });
});

describe('Чек в «Утре» помнит решения игрока', () => {
  const base = () => createState(shift1, 'Саша', 3);
  const saleToGrey = (s: WorldState, minute: number) =>
    s.sales.push({ minutes: minute, customer: 'grey', items: ['candle', 'matches', 'battery'], total: 179, outcome: 'sold', overridden: false });

  it('пять вариантов по реальным флагам и журналу продаж', () => {
    const plain = base();
    expect(morningReceipt(plain)).toBe('В кармане куртки шуршит бумага. Кассовый чек: 15.11.25, 05:58. Свеча, спички, батарейки. Кассир — Саша.');

    const refused = base();
    refused.flags.greyRefused = true;
    expect(morningReceipt(refused)).toMatch(/Вы ему не продавали\. Строка «ОПЛАЧЕНО» пустая\.$/);

    const sold = base();
    sold.flags.greyCompleted = true;
    saleToGrey(sold, 279);
    expect(morningReceipt(sold)).toMatch(/Вы пробили эту покупку в 04:39\.$/);

    const torn = base();
    torn.flags.greyCompleted = true;
    torn.flags.tornReceipt = true;
    saleToGrey(torn, 279);
    expect(morningReceipt(torn)).toMatch(/обрывки чека.*КАССИР: САША/);

    const dismissed = base();
    dismissed.flags.greyDismissed = true;
    dismissed.inventory.push('receipt0317');
    expect(morningReceipt(dismissed)).toMatch(/Чек № 0317.*не «Ершов К\.», а Саша\.$/);
  });

  it('вариант определяется сохранённым состоянием (переживает сохранение и загрузку)', () => {
    const s = base();
    s.flags.greyRefused = true;
    const restored = JSON.parse(JSON.stringify(cloneState(s))) as WorldState;
    expect(morningReceipt(restored)).toBe(morningReceipt(s));
    expect(shift1.endings.morning.hook).toBeTypeOf('function');
  });

  it('в настоящих прохождениях вариант соответствует тому, что сделал игрок', async () => {
    // отказ серому — стандартная стратегия по памятке (свечи нет в базе, фамилия не из журнала)
    const refused = await simulate(shift1, rulesPolicy(), 7);
    expect(refused.ending).toBe('morning');
    expect(refused.state.flags.greyRefused).toBe(true);
    expect(morningReceipt(refused.state)).toMatch(/Вы ему не продавали/);
    // прогнали чеком 0317
    const dismissed = await simulate(shift1, rulesPolicy(['Показать ему чек']), 8);
    expect(dismissed.ending).toBe('morning');
    expect(morningReceipt(dismissed.state)).toMatch(/Чек № 0317/);
    // продали и порвали чек в 05:58
    const policy = endingScenarios.lastsale();
    const tearing = { ...policy, choose: (req: Parameters<typeof policy.choose>[0], s: WorldState, rng: () => number) =>
      req.options.some((o) => o.text === 'Оторвать чек и порвать') ? req.options.findIndex((o) => o.text === 'Оторвать чек и порвать') : policy.choose(req, s, rng) };
    const torn = await simulate(shift1, tearing, 6);
    expect(torn.ending).toBe('morning');
    expect(torn.state.flags.tornReceipt).toBe(true);
    expect(morningReceipt(torn.state)).toMatch(/обрывки чека/);
  });
});
