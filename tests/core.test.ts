import { describe, expect, it } from 'vitest';
import { shift1 } from '../src/content/shift1';
import { EventBus } from '../src/core/EventBus';
import { GameSession } from '../src/core/GameSession';
import type { Presenter } from '../src/core/Presenter';
import { MemoryStorage, SaveManager } from '../src/core/SaveManager';
import { createState, formatTime, isValidState, parseTime, resolveText } from '../src/core/state';
import { sanitizeName } from '../src/ui/Screens';

const flush = () => new Promise<void>((r) => setImmediate(r));

function idlePresenter(): Presenter {
  return {
    line: async () => undefined,
    choose: async (req) => (req.timer ? req.timer.defaultIndex : 0),
    sale: async () => ({ outcome: 'sold', askedName: true, overridden: false }),
    wait: async () => undefined,
    dialogStart: () => undefined,
    dialogEnd: () => undefined,
  };
}

describe('время', () => {
  it('parseTime / formatTime', () => {
    expect(parseTime('03:40')).toBe(220);
    expect(formatTime(220)).toBe('03:40');
    expect(formatTime(360)).toBe('06:00');
    expect(() => parseTime('3-40')).toThrow();
  });
});

describe('текст', () => {
  it('подставляет имя игрока', () => {
    const s = createState(shift1, 'Женя');
    expect(resolveText('Доброй ночи, {name}.', s)).toBe('Доброй ночи, Женя.');
  });
  it('имя очищается от лишних символов', () => {
    expect(sanitizeName('  <b>Саша</b>  ')).toBe('bСашаb');
    expect(sanitizeName('Анна-Мария 123')).toBe('Анна-Мария');
    expect(sanitizeName('Очень-очень-длинное-имя')).toHaveLength(14);
  });
});

describe('сохранения', () => {
  it('контрольная точка сохраняется и восстанавливается', async () => {
    const storage = new MemoryStorage();
    const save = new SaveManager(storage);
    await save.init();
    const s = createState(shift1, 'Тест');
    s.minutes = 125;
    s.flags.lizaOk = true;
    save.saveRun(s);
    await flush();
    const loaded = await save.loadRun([shift1.id]);
    expect(loaded?.minutes).toBe(125);
    expect(loaded?.flags.lizaOk).toBe(true);
  });

  it('битые и чужие сохранения игнорируются', async () => {
    const storage = new MemoryStorage();
    await storage.set('nightshift.run.v1', '{не json');
    const save = new SaveManager(storage);
    await save.init();
    expect(await save.loadRun([shift1.id])).toBeNull();
    await storage.set('nightshift.run.v1', JSON.stringify({ v: 1, shiftId: 'nope' }));
    expect(await save.loadRun([shift1.id])).toBeNull();
    expect(isValidState({ ...createState(shift1, 'x'), minutes: 'abc' })).toBe(false);
  });

  it('завершённая смена не предлагается для продолжения; концовки накапливаются', async () => {
    const save = new SaveManager(new MemoryStorage());
    await save.init();
    const s = createState(shift1, 'Тест');
    save.saveRun(s);
    await flush();
    await save.recordEnding('morning', 3, 'Тест');
    await save.recordEnding('morning', 5, 'Тест');
    expect(save.meta.endings).toEqual(['morning']);
    expect(save.meta.runs).toBe(2);
    expect(save.meta.bestClues).toBe(5);
    expect(await save.loadRun([shift1.id])).toBeNull();
  });

  it('настройки проверяются на допустимость', async () => {
    const storage = new MemoryStorage();
    await storage.set('nightshift.settings.v1', JSON.stringify({ master: 7, sfx: 'громко', textSpeed: 9 }));
    const save = new SaveManager(storage);
    await save.init();
    expect(save.settings.master).toBe(1);
    expect(save.settings.sfx).toBe(0.8);
    expect(save.settings.textSpeed).toBe(1);
  });
});

describe('сессия', () => {
  it('часы стоят во время сцены и идут в свободное время', async () => {
    const bus = new EventBus();
    const session = new GameSession(shift1, bus, {
      ...idlePresenter(),
      line: () => new Promise(() => undefined), // реплика не пролистывается
    });
    session.startNew('Тест');
    for (let i = 0; i < 20; i++) session.update(1300);
    await flush();
    expect(session.state.minutes).toBe(0);
    expect(session.isBusy).toBe(true);
  });

  it('контрольные точки не сохраняются посреди сцены', async () => {
    const saves: boolean[] = [];
    const session = new GameSession(shift1, new EventBus(), idlePresenter());
    session.onCheckpoint = () => saves.push(session.isBusy || !!session.customer);
    session.startNew('Тест');
    for (let i = 0; i < 200; i++) {
      await flush();
      session.update(1300);
    }
    expect(saves.length).toBeGreaterThan(0);
    expect(saves.every((busy) => busy === false)).toBe(true);
  });

  it('одноразовый триггер срабатывает один раз, с перезарядкой — повторно', async () => {
    const session = new GameSession(shift1, new EventBus(), idlePresenter());
    session.startNew('Тест');
    await flush();
    session.act('journal:old');
    session.act('journal:old');
    expect(session.state.clues.filter((c) => c === 'temp_2022')).toHaveLength(1);
    session.act('inspect:photo');
    session.act('inspect:photo');
    expect(session.state.clues.filter((c) => c === 'kostya_photo')).toHaveLength(1);
  });

  it('выключение камеры 4 считается нарушением и штрафует один раз', () => {
    const session = new GameSession(shift1, new EventBus(), idlePresenter());
    session.startNew('Тест');
    const before = session.state.stats.trustManager;
    session.setCam4(false);
    session.setCam4(true);
    session.setCam4(false);
    expect(session.state.violations).toContain('cam4_off');
    expect(session.state.stats.trustManager).toBe(before - 2);
  });

  it('stop() прерывает сцену без ошибок', async () => {
    const session = new GameSession(shift1, new EventBus(), {
      ...idlePresenter(),
      line: () => new Promise(() => undefined),
    });
    session.startNew('Тест');
    await flush();
    session.stop();
    expect(session.status).toBe('idle');
    expect(session.isBusy).toBe(false);
  });
});
