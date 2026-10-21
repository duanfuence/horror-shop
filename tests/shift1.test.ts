import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shift1 } from '../src/content/shift1';
import { collectGotoTargets } from '../src/content/shift1/scenes';
import type { Step } from '../src/core/types';
import { endingScenarios, randomPolicy, rulesPolicy, simulate, type Policy } from './sim';

describe('Смена 1: целостность данных', () => {
  it('все goto ведут на существующие сцены', () => {
    const targets = new Set<string>();
    for (const steps of Object.values(shift1.scenes)) collectGotoTargets(steps, targets);
    for (const t of shift1.triggers) collectGotoTargets(t.steps, targets);
    for (const t of targets) expect(shift1.scenes[t], `сцена ${t}`).toBeDefined();
  });

  it('все события хронологии ссылаются на существующие сцены, id уникальны', () => {
    const ids = new Set<string>();
    for (const b of shift1.timeline) {
      expect(shift1.scenes[b.scene], b.scene).toBeDefined();
      expect(ids.has(b.id), `дубликат ${b.id}`).toBe(false);
      ids.add(b.id);
    }
  });

  it('контакты ведут на существующие сцены', () => {
    const s = { flags: {}, inventory: [] } as never;
    for (const c of shift1.contacts) expect(shift1.scenes[c.scene(s)]).toBeDefined();
  });

  it('все упомянутые товары, документы, говорящие, улики и концовки существуют', () => {
    const walk = (steps: Step[], visit: (st: Step) => void) => {
      for (const st of steps) {
        visit(st);
        if (st.t === 'if') {
          walk(st.then, visit);
          walk(st.else ?? [], visit);
        }
        if (st.t === 'choice') st.options.forEach((o) => walk(o.next ?? [], visit));
        if (st.t === 'sale') [st.onSold, st.onRefused, st.onTimeout].forEach((b) => walk(b ?? [], visit));
      }
    };
    const all = [...Object.values(shift1.scenes), ...shift1.triggers.map((t) => t.steps)];
    for (const steps of all) {
      walk(steps, (st) => {
        if (st.t === 'sale') st.items.forEach((i) => expect(shift1.products[i.product], i.product).toBeDefined());
        if (st.t === 'paper' && st.id) expect(shift1.papers[st.id], st.id).toBeDefined();
        if (st.t === 'say') expect(shift1.speakers[st.who], st.who).toBeDefined();
        if (st.t === 'end') expect(shift1.endings[st.ending], st.ending).toBeDefined();
        if (st.t === 'enter') expect(shift1.characters[st.who], st.who).toBeDefined();
      });
    }
  });

  it('каждая улика журнала заметок где-то выдаётся (нет «мёртвых» улик)', () => {
    const src = ['scenes.ts', 'index.ts', 'world.ts', 'anomalies.ts']
      .map((f) => readFileSync(`src/content/shift1/${f}`, 'utf8'))
      .join('\n');
    for (const id of Object.keys(shift1.clues)) expect(src.includes(`clue('${id}')`), `улика ${id} нигде не выдаётся`).toBe(true);
  });

  it('дату на распоряжении 03:20 можно заметить — улика fax_order', async () => {
    const r = await simulate(shift1, rulesPolicy(['Присмотреться к дате']), 12);
    expect(r.errors).toEqual([]);
    expect(r.state.clues).toContain('fax_order');
    expect(r.state.inventory).toContain('order');
    expect(r.ending).toBe('morning');
  });

  it('улики, которые выдают сцены, описаны в журнале заметок', async () => {
    // Прогоняем много случайных партий и проверяем, что каждая полученная улика описана.
    for (let seed = 1; seed <= 40; seed++) {
      const r = await simulate(shift1, randomPolicy, seed);
      for (const c of r.state.clues) expect(shift1.clues[c], `улика ${c}`).toBeDefined();
    }
  });
});

describe('Смена 1: прохождение', () => {
  it('случайные партии всегда доходят до концовки без ошибок и повторных событий', async () => {
    const endings = new Map<string, number>();
    for (let seed = 1; seed <= 300; seed++) {
      const r = await simulate(shift1, randomPolicy, seed);
      expect(r.errors, `seed ${seed}: ${JSON.stringify(r.errors)}`).toEqual([]);
      expect(r.ending, `seed ${seed} не дошёл до конца`).not.toBeNull();
      expect(new Set(r.state.fired).size).toBe(r.state.fired.length);
      endings.set(r.ending!, (endings.get(r.ending!) ?? 0) + 1);
    }
    // Случайная игра должна встречать разные исходы.
    expect(endings.size).toBeGreaterThanOrEqual(3);
  });

  it('добросовестный продавец доживает до утра и остаётся на работе', async () => {
    const r = await simulate(shift1, rulesPolicy(), 7);
    expect(r.errors).toEqual([]);
    expect(r.ending).toBe('morning');
    expect(r.state.violations).toEqual([]);
    expect(Object.keys(r.state.tempLog).length).toBe(6);
    // Первая подозрительная ситуация — в первые минуты.
    expect(r.state.fired).toContain('bell');
  });

  it('продажа алкоголя и открытая дверь приводят к увольнению', async () => {
    const r = await simulate(shift1, endingScenarios.fired(), 3);
    expect(r.ending).toBe('fired');
    expect(r.state.violations).toEqual(expect.arrayContaining(['alcohol', 'door_open']));
  });

  it('отдать ключи сменщику — концовка «Подмена»', async () => {
    const r = await simulate(shift1, endingScenarios.swap(), 4);
    expect(r.ending).toBe('swap');
  });

  it('открыть дверь «Галине Петровне» в темноте — концовка «Открытая дверь»', async () => {
    const r = await simulate(shift1, endingScenarios.door(), 5);
    expect(r.ending).toBe('door');
  });

  it('продать третий раз мужчине в сером и бездействовать в 05:58 — «Последний покупатель»', async () => {
    const r = await simulate(shift1, endingScenarios.lastsale(), 6);
    expect(r.state.flags.greyCompleted).toBe(true);
    expect(r.ending).toBe('lastsale');
  });

  it('чек № 0317 прогоняет мужчину в сером', async () => {
    const r = await simulate(shift1, rulesPolicy(['Показать ему чек']), 8);
    expect(r.state.flags.greyDismissed).toBe(true);
    expect(r.ending).toBe('morning');
  });

  it('внимательный игрок, доверившийся Косте, открывает тайную концовку', async () => {
    const r = await simulate(shift1, endingScenarios.released(), 9);
    expect(r.errors).toEqual([]);
    expect(r.state.clues.length).toBeGreaterThanOrEqual(7);
    expect(r.ending).toBe('released');
  });

  it('бездействующий игрок тоже доходит до конца смены', async () => {
    const afk: Policy = {
      choose: (req) => (req.timer ? req.timer.defaultIndex : 0),
      sale: () => ({ outcome: 'timeout', askedName: false, overridden: false }),
    };
    const r = await simulate(shift1, afk, 10);
    expect(r.errors).toEqual([]);
    expect(r.ending).not.toBeNull();
  });
});
