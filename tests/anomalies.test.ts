import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shift1 } from '../src/content/shift1';
import { anomalyDefs } from '../src/content/shift1/anomalies';
import { temperature } from '../src/content/shift1/threat';
import { EventBus } from '../src/core/EventBus';
import { AnomalySystem } from '../src/core/Anomalies';
import { GameSession } from '../src/core/GameSession';
import type { Presenter } from '../src/core/Presenter';
import { cloneState, createState, parseTime, upgradeState } from '../src/core/state';
import type { CamId, Step, WorldState } from '../src/core/types';
import { cautiousPolicy, endingScenarios, observerPolicy, randomPolicy, simulate } from './sim';

const presenter: Presenter = {
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

/** Сессия, доведённая до минуты `minute` в свободной от сцен точке. */
async function sessionAt(minute: number, seed = 7): Promise<{ session: GameSession; bus: EventBus }> {
  const bus = new EventBus();
  const session = new GameSession(shift1, bus, presenter);
  session.startNew('Тест', seed);
  for (let i = 0; i < 5000 && (session.state.minutes < minute || session.isBusy); i++) {
    await flush();
    session.update(1300);
  }
  await flush();
  // для предсказуемости — без случайных аномалий этого seed
  session.state.anomalies.active = [];
  session.state.anomalies.traces = [];
  return { session, bus };
}

function force(session: GameSession, id: string, cam: CamId, at = session.state.minutes): void {
  session.state.anomalies.active.push({ id, cam, at, stage: 0, seen: false });
}

/**
 * Перемотка ровно на n минут, при которой новые аномалии не появляются (чтобы следить за одной).
 * Сюжетные сцены по дороге доигрываются ботом.
 */
async function skipQuiet(session: GameSession, n: number): Promise<void> {
  const target = session.state.minutes + n;
  for (let i = 0; i < 5000 && session.state.minutes < target && session.status === 'running'; i++) {
    session.state.anomalies.quietUntil = session.state.minutes + 5;
    if (session.isBusy) {
      await flush();
      session.update(100);
    } else session.skipMinutes(1);
  }
}

describe('Аномалии: данные', () => {
  const textures = readFileSync('src/game/textures.ts', 'utf8');
  const cctvScene = readFileSync('src/game/scenes/CctvScene.ts', 'utf8');

  it('12–15 различающихся аномалий в эфире и не меньше четырёх архивных', () => {
    const live = anomalyDefs.filter((d) => !d.archiveOnly);
    expect(live.length).toBeGreaterThanOrEqual(12);
    expect(live.length).toBeLessThanOrEqual(15);
    expect(anomalyDefs.filter((d) => d.archiveOnly).length).toBeGreaterThanOrEqual(4);
    expect(new Set(anomalyDefs.map((d) => d.id)).size).toBe(anomalyDefs.length);
    // есть и обычные вещи-обманки, и опасные аномалии, и аномалии со стадиями
    expect(anomalyDefs.some((d) => d.danger === 0)).toBe(true);
    expect(anomalyDefs.some((d) => d.danger === 3)).toBe(true);
    expect(anomalyDefs.filter((d) => d.stages.length >= 2).length).toBeGreaterThanOrEqual(4);
    // все четыре камеры и все категории используются
    for (const cam of [1, 2, 3, 4]) expect(anomalyDefs.some((d) => d.cams.includes(cam as CamId)), `камера ${cam}`).toBe(true);
    for (const c of ['person', 'object', 'door', 'image']) expect(anomalyDefs.some((d) => d.categories.includes(c as never)), c).toBe(true);
    for (const d of anomalyDefs) {
      expect(d.categories.length, d.id).toBeGreaterThan(0);
      expect(d.stages[0].at, d.id).toBe(0);
      for (let i = 1; i < d.stages.length; i++) expect(d.stages[i].at).toBeGreaterThan(d.stages[i - 1].at);
      expect(d.duration, d.id).toBeGreaterThan(d.stages[d.stages.length - 1].at);
      if (d.from) parseTime(d.from);
      if (d.to) parseTime(d.to);
    }
  });

  it('каждый визуальный ключ аномалий умеет рисовать экран камеры', () => {
    for (const d of anomalyDefs) {
      const keys = [...d.stages.flatMap((s) => s.visuals), ...(d.miss?.trace ?? [])];
      for (const v of keys) {
        if (v.startsWith('ov:')) expect(textures, v).toContain(`'ov_${v.slice(3)}'`);
        else if (v.startsWith('base:')) expect(textures, v).toContain(`'${v.slice(5)}'`);
        else if (v.startsWith('osd:')) expect(v).toMatch(/^osd:\d\d:\d\d$/);
        else if (v === 'frost' || v === 'door_open') continue;
        else expect(d.cams.some((cam) => cctvScene.includes(`'${cam}:${v}'`)), `${d.id}: ${v}`).toBe(true);
      }
    }
  });

  it('улики аномалий описаны в журнале', () => {
    const walk = (steps: Step[] | undefined, out: string[]) => {
      for (const st of steps ?? []) if (st.t === 'do') for (const f of st.fx) {
        const s = createState(shift1, 'Т', 1);
        f(s, { emitToast() {}, emitJournal() {} });
        out.push(...s.clues);
      }
    };
    const clues: string[] = [];
    for (const d of anomalyDefs) walk(d.report.steps, clues);
    expect(clues.length).toBeGreaterThanOrEqual(3);
    for (const c of clues) expect(shift1.clues[c], c).toBeDefined();
  });

  it('скрытые параметры меняет только пропущенная «фигура за спиной»', () => {
    const run = (steps: Step[] | undefined, s: WorldState) => {
      for (const st of steps ?? []) if (st.t === 'do') st.fx.forEach((f) => f(s, { emitToast() {}, emitJournal() {} }));
    };
    for (const d of anomalyDefs) {
      const s = createState(shift1, 'Т', 3);
      s.minutes = 200;
      const before = JSON.stringify(s.stats);
      for (const st of d.stages) run(st.steps, s);
      run(d.report.steps, s);
      expect(JSON.stringify(s.stats), `${d.id}: стадии и фиксация`).toBe(before);
      run(d.miss?.steps, s);
      if (d.id === 'behind_clerk') expect(s.stats.attention).toBe(1);
      else expect(JSON.stringify(s.stats), `${d.id}: пропуск`).toBe(before);
    }
  });
});

describe('Аномалии: фиксация', () => {
  it('верная фиксация регистрируется, даёт улику и убирает аномалию', async () => {
    const { session } = await sessionAt(185);
    force(session, 'truck', 2);
    session.openCameras();
    session.viewCamera(2);
    expect(session.anomalyVisuals(2)).toContain('ov:cam2_truck1');
    const res = session.reportAnomaly(2, 'object');
    expect(res.result).toBe('correct');
    expect(session.state.anomalies.active).toEqual([]);
    expect(session.state.clues).toContain('truck_cam');
    const entry = session.state.anomalies.log.at(-1)!;
    expect(entry).toMatchObject({ cam: 2, category: 'object', result: 'correct', ref: 'truck' });
    expect(session.state.anomalies.outcomes.at(-1)).toEqual(['truck', 'reported', session.state.minutes]);
  });

  it('ошибочная фиксация ничего не ломает: журнал занят на несколько минут, затем снова доступен', async () => {
    const { session } = await sessionAt(100);
    force(session, 'extra_box', 4);
    session.openCameras();
    session.viewCamera(4);
    const statsBefore = JSON.stringify(session.state.stats);
    // не та категория: аномалия остаётся, ответ не подсказывает, что на камере что-то есть
    const wrong = session.reportAnomaly(4, 'person');
    expect(wrong.result).toBe('false');
    expect(shift1.anomalies!.falseTexts).toContain(wrong.text);
    expect(session.state.anomalies.active.map((a) => a.id)).toEqual(['extra_box']);
    expect(JSON.stringify(session.state.stats)).toBe(statsBefore);
    expect(session.canReport()).toBe(false);
    expect(session.reportAnomaly(4, 'object').result).toBe('busy');
    session.closeCameras();
    await skipQuiet(session, shift1.anomalies!.reportCooldown.wrong);
    session.openCameras();
    session.viewCamera(4);
    expect(session.canReport()).toBe(true);
    expect(session.reportAnomaly(4, 'object').result).toBe('correct');
    expect(session.status).toBe('running');
  });

  it('обычные вещи — ложная тревога с объяснением; сюжетные странности засчитываются один раз', async () => {
    const { session } = await sessionAt(60);
    force(session, 'dog_walker', 2);
    session.openCameras();
    session.viewCamera(2);
    const res = session.reportAnomaly(2, 'person');
    expect(res.result).toBe('mundane');
    expect(res.text).toMatch(/собак/);
    // продавец на камере 1 — это сам игрок
    await skipQuiet(session, 6);
    session.viewCamera(1);
    expect(session.reportAnomaly(1, 'person').result).toBe('mundane');
  });

  it('камера 4 выключена — зафиксировать на ней нечего', async () => {
    const { session } = await sessionAt(100);
    force(session, 'extra_box', 4);
    session.state.cam4On = false;
    expect(session.anomalyVisuals(4)).toEqual([]);
    expect(session.reportAnomaly(4, 'object').result).toBe('false');
  });
});

describe('Аномалии: развитие', () => {
  it('пропущенная аномалия проходит стадии, оставляет след; след можно записать с опозданием', async () => {
    const { session } = await sessionAt(100);
    force(session, 'extra_box', 4);
    const visuals = () => session.anomalyVisuals(4);
    expect(visuals()).toEqual(['ov:cam4_box1']);
    await skipQuiet(session, 8);
    expect(visuals()).toEqual(['ov:cam4_box2']);
    await skipQuiet(session, 8);
    expect(visuals()).toEqual(['ov:cam4_box3']);
    await skipQuiet(session, 8);
    expect(session.state.anomalies.active).toEqual([]);
    expect(session.state.anomalies.outcomes.at(-1)?.[1]).toBe('missed');
    // коробка осталась под потолком
    expect(visuals()).toEqual(['ov:cam4_box3']);
    session.openCameras();
    session.viewCamera(4);
    const late = session.reportAnomaly(4, 'object');
    expect(late.result).toBe('correct');
    expect(late.text).toMatch(/С опозданием/);
    await skipQuiet(session, 3);
    expect(session.reportAnomaly(4, 'object').result).toBe('duplicate');
  });

  it('стадия не меняется, пока игрок смотрит на эту камеру', async () => {
    const { session } = await sessionAt(100);
    force(session, 'chair_moved', 4);
    session.openCameras();
    session.viewCamera(4);
    await skipQuiet(session, 14);
    expect(session.state.anomalies.active[0].stage).toBe(0);
    session.viewCamera(1);
    await skipQuiet(session, 1);
    expect(session.state.anomalies.active[0].stage).toBe(1);
  });

  it('пропущенная опасная аномалия усиливает угрозу, безобидные — просто исчезают', () => {
    const system = new AnomalySystem(shift1.anomalies!);
    const s = createState(shift1, 'Т', 5);
    s.minutes = 200;
    s.anomalies.active.push({ id: 'behind_clerk', cam: 3, at: 200, stage: 0, seen: false });
    s.anomalies.active.push({ id: 'floor_shadow', cam: 1, at: 200, stage: 0, seen: false });
    const host = {
      state: s,
      busy: false,
      inSale: false,
      minutesToNextScene: () => Infinity,
      viewingCam: () => null,
      camAvailable: () => true,
      run: (steps: Step[]) => {
        for (const st of steps) if (st.t === 'do') st.fx.forEach((f) => f(s, { emitToast() {}, emitJournal() {} }));
      },
    };
    for (let i = 0; i < 13; i++) {
      s.minutes++;
      system.update(host);
    }
    expect(s.anomalies.active).toEqual([]);
    expect(s.stats.attention).toBe(1);
    expect(s.anomalies.traces).toEqual([]);
    expect(s.anomalies.outcomes.map(([id, o]) => `${id}:${o}`).sort()).toEqual(['behind_clerk:missed', 'floor_shadow:missed']);
  });

  it('силуэт исчезает, если его увидеть и переключить камеру', async () => {
    const { session } = await sessionAt(70);
    force(session, 'far_figure', 2);
    session.openCameras();
    session.viewCamera(2);
    expect(session.anomalyVisuals(2)).toContain('amb_lot');
    session.viewCamera(3);
    expect(session.state.anomalies.active).toEqual([]);
    expect(session.state.anomalies.outcomes.at(-1)?.[1]).toBe('vanished');
  });

  it('в темноте все аномалии растворяются', async () => {
    const { session } = await sessionAt(200);
    force(session, 'cam3_clock', 3);
    session.state.flags.blackout = true;
    await skipQuiet(session, 1);
    expect(session.state.anomalies.active).toEqual([]);
  });
});

describe('Аномалии: расписание', () => {
  it('одинаковый seed — та же последовательность, разные seed — разные', async () => {
    const a = await simulate(shift1, observerPolicy(), 5, 20000, 777);
    const b = await simulate(shift1, observerPolicy(), 5, 20000, 777);
    expect(b.state.anomalies.spawned).toEqual(a.state.anomalies.spawned);
    expect(b.state.anomalies.log).toEqual(a.state.anomalies.log);
    const seqs = await Promise.all([101, 202, 303, 404, 505].map((seed) => simulate(shift1, cautiousPolicy(), 1, 20000, seed)));
    const keys = seqs.map((r) => r.state.anomalies.spawned.map(([id, cam, m]) => `${id}/${cam}@${m}`));
    for (let i = 1; i < keys.length; i++) {
      const prev = new Set(keys[i - 1]);
      const same = keys[i].filter((k) => prev.has(k)).length;
      expect(same / keys[i].length).toBeLessThan(0.25);
      // и порядок аномалий другой
      expect(seqs[i].state.anomalies.spawned.map(([id]) => id)).not.toEqual(seqs[i - 1].state.anomalies.spawned.map(([id]) => id));
    }
  });

  it('лимиты: не больше двух одновременно, не больше одной на камере, повторы — с перезарядкой', async () => {
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
      for (const policy of [cautiousPolicy(), observerPolicy(), randomPolicy]) {
        const r = await simulate(shift1, policy, seed, 20000, seed * 97);
        expect(r.errors).toEqual([]);
        expect(r.maxActiveAnomalies).toBeLessThanOrEqual(shift1.anomalies!.maxActive);
        expect(r.maxArchiveAnomalies).toBeLessThanOrEqual(shift1.anomalies!.maxArchive ?? 1);
        expect(r.sameCamAnomalies).toBe(0);
        const byId = new Map<string, number[]>();
        for (const [id, , m] of r.state.anomalies.spawned) byId.set(id, [...(byId.get(id) ?? []), m]);
        for (const [id, ms] of byId) {
          const d = anomalyDefs.find((x) => x.id === id)!;
          if (d.max !== undefined) expect(ms.length, id).toBeLessThanOrEqual(d.max);
          for (let i = 1; i < ms.length; i++) expect(ms[i] - ms[i - 1], id).toBeGreaterThanOrEqual(d.cooldown);
        }
      }
    }
  });

  it('появляются только в свободные минуты: не в сцене, не рядом со стартом сюжета, не в темноте и не после 06:00', async () => {
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const r = await simulate(shift1, observerPolicy(), seed, 20000, seed * 13);
      const margin = shift1.ambient!.sceneMargin;
      const beatScenes = new Set(shift1.timeline.map((b) => b.scene));
      for (const [id, cam, m] of r.state.anomalies.spawned) {
        expect(m, id).toBeGreaterThanOrEqual(parseTime(shift1.anomalies!.firstAt));
        expect(m, id).toBeLessThanOrEqual(parseTime(shift1.anomalies!.lastAt));
        expect(m).toBeLessThan(300);
        for (const [scene, sm] of r.sceneLog) {
          if (!beatScenes.has(scene)) continue;
          expect(m >= sm && m - sm < margin, `${id}/${cam}@${m} рядом с ${scene}@${sm}`).toBe(false);
        }
        // не в ту же минуту, что фоновое событие режиссёра
        expect(r.state.ambient.log.some(([, am]) => am === m), `${id}@${m}`).toBe(false);
      }
      expect(r.state.anomalies.active).toEqual([]);
    }
  });

  it('на паузе ничего не появляется и не развивается', async () => {
    const { session } = await sessionAt(120, 31);
    force(session, 'extra_box', 4);
    session.setPaused('menu', true);
    const snapshot = JSON.stringify(session.state.anomalies);
    for (let i = 0; i < 300; i++) session.update(1300);
    expect(JSON.stringify(session.state.anomalies)).toBe(snapshot);
  });

  it('правило Кости: на складе в тепле — обычные аномалии, на морозе — только приманка', () => {
    const s = createState(shift1, 'Т', 9);
    s.minutes = 200;
    const cold = { ...s, stats: { ...s.stats, attention: 8 } };
    expect(temperature(s)).toBeGreaterThanOrEqual(1);
    expect(temperature(cold)).toBeLessThan(0);
    for (const d of anomalyDefs.filter((x) => x.cams.includes(4) && x.danger > 0)) {
      if (d.id === 'lens_frost') {
        expect(d.when!(s, 4)).toBe(false);
        expect(d.when!(cold, 4)).toBe(true);
      } else {
        expect(d.when!(cold, 4), d.id).toBe(false);
      }
    }
  });
});

describe('Аномалии: сохранение и концовки', () => {
  it('активная аномалия переживает сохранение и загрузку и продолжает развиваться', async () => {
    const { session } = await sessionAt(100, 41);
    force(session, 'extra_box', 4);
    await skipQuiet(session, 9);
    session.state.anomalies.log.push({ m: 105, cam: 2, category: 'person', result: 'false', ref: null, text: 'x' });
    const saved = JSON.parse(JSON.stringify(cloneState(session.state))) as WorldState;
    const bus = new EventBus();
    const restored = new GameSession(shift1, bus, presenter);
    restored.resume(saved);
    expect(restored.state.anomalies.active).toEqual(session.state.anomalies.active);
    expect(restored.anomalyVisuals(4)).toEqual(['ov:cam4_box2']);
    expect(restored.state.anomalies.log).toHaveLength(1);
    await skipQuiet(restored, 8);
    expect(restored.anomalyVisuals(4)).toEqual(['ov:cam4_box3']);
  });

  it('старое сохранение без аномалий загружается', () => {
    const old = createState(shift1, 'Алекс', 1) as Partial<WorldState>;
    delete old.anomalies;
    const s = upgradeState(JSON.parse(JSON.stringify(old)) as WorldState);
    expect(s.anomalies.active).toEqual([]);
    expect(s.anomalies.log).toEqual([]);
  });

  it('все шесть концовок по-прежнему достижимы; наблюдатель доживает до утра', async () => {
    for (const [name, make] of Object.entries(endingScenarios)) {
      const r = await simulate(shift1, make(), 3, 20000, 4321);
      expect(r.ending, name).toBe(name);
    }
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const r = await simulate(shift1, observerPolicy({ accuracy: 0.6 }), seed, 20000, seed * 1009);
      expect(r.errors).toEqual([]);
      expect(r.ending).toBe('morning');
    }
  });

  it('фургон на камере 2 открывает ответ в сцене 03:40', () => {
    const findOpt = (steps: Step[]): { if?: (s: WorldState) => boolean } | null => {
      for (const st of steps) {
        if (st.t === 'choice') {
          for (const o of st.options) {
            if (o.text === 'Ночью поставок не бывает.') return o;
            const inner = findOpt(o.next ?? []);
            if (inner) return inner;
          }
        }
        if (st.t === 'if') return findOpt(st.then) ?? findOpt(st.else ?? []);
      }
      return null;
    };
    const opt = findOpt(shift1.scenes.delivery);
    expect(opt?.if).toBeDefined();
    const s = createState(shift1, 'Т', 1);
    expect(opt!.if!(s)).toBe(false);
    s.clues.push('truck_cam');
    expect(opt!.if!(s)).toBe(true);
  });

  it('наблюдатель с точной фиксацией получает улику с фургона в большинстве ночей', async () => {
    let got = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = await simulate(shift1, observerPolicy({ accuracy: 1 }), seed, 20000, seed * 211);
      if (r.state.clues.includes('truck_cam')) got++;
    }
    expect(got).toBeGreaterThanOrEqual(8);
  });
});
