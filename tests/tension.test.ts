import { describe, expect, it } from 'vitest';
import { shift1 } from '../src/content/shift1';
import { ambientEvents } from '../src/content/shift1/ambient';
import { temperature } from '../src/content/shift1/threat';
import { EventBus } from '../src/core/EventBus';
import { GameSession } from '../src/core/GameSession';
import type { Presenter } from '../src/core/Presenter';
import { createState, parseTime, upgradeState } from '../src/core/state';
import type { WorldState } from '../src/core/types';
import { cautiousPolicy, endingScenarios, randomPolicy, riskyPolicy, simulate } from './sim';
import { batch, runStats } from './tools/tensionReport';

const idlePresenter: Presenter = {
  async line() {},
  async choose(req) {
    return req.timer ? req.timer.defaultIndex : 0;
  },
  async sale() {
    return { outcome: 'sold', askedName: false, overridden: false };
  },
  async wait() {},
  dialogStart() {},
  dialogEnd() {},
};

const flush = () => new Promise<void>((r) => setImmediate(r));

describe('Режиссёр тревоги: данные', () => {
  it('пул событий: 20–25 событий, уникальные id, разная интенсивность, корректные окна', () => {
    expect(ambientEvents.length).toBeGreaterThanOrEqual(20);
    expect(ambientEvents.length).toBeLessThanOrEqual(26);
    expect(new Set(ambientEvents.map((e) => e.id)).size).toBe(ambientEvents.length);
    for (const i of [1, 2, 3]) expect(ambientEvents.some((e) => e.intensity === i)).toBe(true);
    const beatIds = new Set(shift1.timeline.map((b) => b.id));
    for (const e of ambientEvents) {
      if (e.from) parseTime(e.from);
      if (e.to) parseTime(e.to);
      for (const b of e.avoid?.beats ?? []) expect(beatIds.has(b), `${e.id}: нет события ${b}`).toBe(true);
      expect(e.steps.every((st) => ['sfx', 'fx', 'do', 'narr', 'knock'].includes(st.t)), e.id).toBe(true);
    }
  });

  it('фоновые события не меняют скрытые параметры и не трогают сюжетные флаги', () => {
    for (const e of ambientEvents) {
      const s = createState(shift1, 'Тест', 77);
      s.minutes = 250;
      const before = JSON.stringify({ stats: s.stats, flags: s.flags, clues: s.clues, violations: s.violations });
      e.onFire?.(s, () => 0.4);
      for (const st of e.steps) if (st.t === 'do') st.fx.forEach((f) => f(s, { emitToast() {}, emitJournal() {} }));
      expect(JSON.stringify({ stats: s.stats, flags: s.flags, clues: s.clues, violations: s.violations }), e.id).toBe(before);
    }
  });

  it('ключевые сюжетные события не сдвигаются, сдвиг остальных невелик', () => {
    const fixed = ['courier', 'delivery', 'blackout', 'climax_line', 'fusebox', 'knock', 'relief', 'relief2', 'lastreceipt', 'morning'];
    for (const b of shift1.timeline) {
      if (fixed.includes(b.id)) expect(b.jitter, b.id).toBeUndefined();
      if (b.jitter) expect(Math.max(Math.abs(b.jitter[0]), Math.abs(b.jitter[1])), b.id).toBeLessThanOrEqual(8);
    }
  });
});

describe('Режиссёр тревоги: поведение', () => {
  it('одинаковый seed воспроизводит ночь, разные seed — заметно разные', async () => {
    const a = await simulate(shift1, cautiousPolicy(), 1, 20000, 4242);
    const b = await simulate(shift1, cautiousPolicy(), 1, 20000, 4242);
    expect(b.state.ambient.log).toEqual(a.state.ambient.log);
    expect(b.sceneLog).toEqual(a.sceneLog);
    expect(b.temps).toEqual(a.temps);

    // Разные seed: доля совпадающих (событие, минута) мала, сюжет сдвинут.
    const runs = await Promise.all([11, 22, 33, 44, 55, 66].map((seed) => simulate(shift1, cautiousPolicy(), 1, 20000, seed)));
    for (let i = 1; i < runs.length; i++) {
      const prev = new Set(runs[i - 1].state.ambient.log.map(([id, m]) => `${id}@${m}`));
      const cur = runs[i].state.ambient.log.map(([id, m]) => `${id}@${m}`);
      const same = cur.filter((x) => prev.has(x)).length;
      expect(same / cur.length).toBeLessThan(0.25);
      expect(runs[i].sceneLog).not.toEqual(runs[i - 1].sceneLog);
    }
  });

  it('на паузе и после конца смены события не происходят', async () => {
    const bus = new EventBus();
    const session = new GameSession(shift1, bus, idlePresenter);
    session.startNew('Тест', 99);
    for (let i = 0; i < 40; i++) {
      await flush();
      session.update(1300);
    }
    await flush();
    session.setPaused('menu', true);
    const minutes = session.state.minutes;
    const logLen = session.state.ambient.log.length;
    let fx = 0;
    bus.on('ambient', () => fx++);
    for (let i = 0; i < 200; i++) session.update(1300);
    expect(session.state.minutes).toBe(minutes);
    expect(session.state.ambient.log.length).toBe(logLen);
    expect(fx).toBe(0);
    session.setPaused('menu', false);

    // Доводим смену до конца и убеждаемся, что режиссёр замолкает.
    const r = await simulate(shift1, cautiousPolicy(), 2, 20000, 99);
    expect(r.ending).toBe('morning');
    const after = r.state.ambient.log.filter(([, m]) => m >= 360);
    expect(after).toEqual([]);
  });

  it('события не накладываются друг на друга и на сюжетные сцены', async () => {
    for (const seed of [3, 5, 8, 13, 21, 34, 55, 89]) {
      for (const policy of [cautiousPolicy(), riskyPolicy(), randomPolicy]) {
        const r = await simulate(shift1, policy, seed, 20000, seed * 31);
        const log = r.state.ambient.log;
        // не больше одного фонового события в минуту, не одно и то же подряд, не один канал подряд
        const channel = (id: string) => ambientEvents.find((e) => e.id === id)!.channel;
        for (let i = 1; i < log.length; i++) {
          expect(log[i][1]).toBeGreaterThan(log[i - 1][1]);
          expect(log[i][0]).not.toBe(log[i - 1][0]);
          expect(channel(log[i][0])).not.toBe(channel(log[i - 1][0]));
          expect(log[i][1] - log[i - 1][1]).toBeGreaterThanOrEqual(shift1.ambient!.gap[0]);
        }
        // не в первые две минуты после начала сюжетной сцены и не рядом с событием хронологии
        const beatScenes = new Set(shift1.timeline.map((b) => b.scene));
        for (const [id, m] of r.sceneLog) {
          if (!beatScenes.has(id)) continue;
          const near = log.filter(([, am]) => am >= m && am - m < shift1.ambient!.sceneMargin);
          expect(near, `${id}@${m}`).toEqual([]);
        }
      }
    }
  });

  it('частота разумная: ни пустоты, ни шквала', async () => {
    const rs = await batch('cautious', 40, 500);
    for (const r of rs) {
      expect(r.events).toBeGreaterThanOrEqual(12);
      expect(r.events).toBeLessThanOrEqual(40);
      // в среднем не чаще одного события в 4 игровые минуты в самом плотном часу
      expect(Math.max(...r.perHour)).toBeLessThanOrEqual(12);
      // «ничего не происходит» — не дольше ~20 игровых минут
      expect(r.maxGapAny).toBeLessThanOrEqual(22);
      expect(r.errors).toBe(0);
    }
    const avg = (h: number) => rs.reduce((a, r) => a + r.perHour[h], 0) / rs.length;
    // к утру событий больше, чем в начале ночи
    expect(avg(4)).toBeGreaterThan(avg(0));
  });
});

describe('Холод и угроза', () => {
  it('осторожный игрок встречает минус до конца смены; рискованный — раньше', async () => {
    const cautious = await batch('cautious', 40, 700);
    const risky = await batch('risky', 40, 700);
    const firstNeg = (rs: typeof cautious) => rs.map((r) => r.firstNegative ?? 999);
    expect(firstNeg(cautious).every((m) => m < 360)).toBe(true);
    const share = cautious.filter((r) => r.firstNegative !== null && r.firstNegative < 300).length / cautious.length;
    expect(share).toBeGreaterThan(0.7);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    expect(median(firstNeg(risky))).toBeLessThan(median(firstNeg(cautious)));
  });

  it('высокое внимание ускоряет холод, низкое не отменяет его', () => {
    const s = createState(shift1, 'Тест', 5);
    const at = (minutes: number, attention: number) => {
      s.minutes = minutes;
      s.stats.attention = attention;
      return temperature(s);
    };
    // В начале ночи тепло при любом раскладе, кроме совсем безрассудного.
    expect(at(20, 0)).toBeGreaterThan(2);
    // При нулевом внимании к 04:50 всё равно около нуля или ниже.
    expect(at(290, 0)).toBeLessThanOrEqual(1);
    for (const m of [60, 150, 240]) expect(at(m, 6)).toBeLessThan(at(m, 0));
  });

  it('сохранение без seed (старый формат) загружается и получает стабильный seed', () => {
    const old = createState(shift1, 'Алекс', 1) as Partial<WorldState>;
    delete old.seed;
    delete old.ambient;
    const a = upgradeState(JSON.parse(JSON.stringify(old)) as WorldState);
    const b = upgradeState(JSON.parse(JSON.stringify(old)) as WorldState);
    expect(a.seed).toBeGreaterThan(0);
    expect(a.seed).toBe(b.seed);
    expect(a.ambient.log).toEqual([]);
  });

  it('все шесть концовок достижимы при разных seed', async () => {
    const expected: Record<string, string> = {
      morning: 'morning',
      fired: 'fired',
      swap: 'swap',
      door: 'door',
      lastsale: 'lastsale',
      released: 'released',
    };
    for (const [name, make] of Object.entries(endingScenarios)) {
      let hits = 0;
      const seeds = Array.from({ length: 25 }, (_, i) => 1000 + i * 37);
      for (const seed of seeds) {
        const r = await simulate(shift1, make(), seed, 20000, seed);
        expect(r.errors).toEqual([]);
        if (r.ending === expected[name]) hits++;
      }
      expect(hits, `${name}: ${hits}/${seeds.length}`).toBe(seeds.length);
    }
  });

  it('новая случайность не делает плохую концовку неизбежной для осторожного игрока', async () => {
    const rs = await batch('cautious', 60, 900);
    expect(rs.every((r) => r.ending === 'morning')).toBe(true);
    // Фоновые события сами по себе не поднимают «внимание».
    expect(Math.max(...rs.map((r) => r.attention))).toBeLessThanOrEqual(2);
  });

  it('runStats считает первый минус по журналу температур', async () => {
    const r = await simulate(shift1, cautiousPolicy(), 1, 20000, 12345);
    const st = runStats(r);
    if (st.firstNegative !== null) expect(r.temps[st.firstNegative]).toBeLessThan(0);
  });
});
