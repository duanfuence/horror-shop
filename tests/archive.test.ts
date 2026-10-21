import { describe, expect, it } from 'vitest';
import { shift1 } from '../src/content/shift1';
import { anomalyDefs } from '../src/content/shift1/anomalies';
import { ARCHIVE_DEPTH, MAX_FRAMES, archiveRange, archiveSize, frameAt, recordFrame } from '../src/core/Archive';
import { EventBus } from '../src/core/EventBus';
import { GameSession } from '../src/core/GameSession';
import type { Presenter } from '../src/core/Presenter';
import { cloneState, createState, emptyArchive, upgradeState } from '../src/core/state';
import type { CamId, Step, WorldState } from '../src/core/types';
import { archivistPolicy, cautiousPolicy, endingScenarios, randomPolicy, simulate } from './sim';

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

async function sessionAt(minute: number, seed = 7): Promise<GameSession> {
  const session = new GameSession(shift1, new EventBus(), presenter);
  session.startNew('Тест', seed);
  for (let i = 0; i < 5000 && (session.state.minutes < minute || session.isBusy); i++) {
    await flush();
    session.update(1300);
  }
  await flush();
  session.state.anomalies.active = [];
  session.state.anomalies.traces = [];
  return session;
}

/** Перемотка ровно на n минут без новых аномалий; сцены по дороге доигрываются ботом. */
async function skipQuiet(session: GameSession, n: number): Promise<void> {
  const target = session.state.minutes + n;
  for (let i = 0; i < 5000 && session.state.minutes < target && session.status === 'running'; i++) {
    session.state.anomalies.quietUntil = session.state.minutes + 5;
    // архивные — своим броском; на время теста их тоже не должно появляться
    const archiveIds = anomalyDefs.filter((d) => d.archiveOnly).map((d) => d.id);
    for (const id of archiveIds) session.state.anomalies.count[id] = 99;
    if (session.isBusy) {
      await flush();
      session.update(100);
    } else session.skipMinutes(1);
  }
}

function force(session: GameSession, id: string, cam: CamId): void {
  session.state.anomalies.active.push({ id, cam, at: session.state.minutes, stage: 0, seen: false });
}

/** Состояние мира без отметок просмотра архива — то, что просмотр не должен менять. */
const worldSnapshot = (s: WorldState) => JSON.stringify({ ...s, archive: { ...s.archive, viewed: [] } });

describe('Архив: хранение', () => {
  it('кадр записывается только при изменении и находится по минуте', () => {
    const ar = emptyArchive();
    recordFrame(ar, 1, 10, ['clerk'], []);
    recordFrame(ar, 1, 11, ['clerk'], []);
    recordFrame(ar, 1, 12, ['clerk', 'amb_aisle'], ['far_figure']);
    recordFrame(ar, 1, 15, ['clerk'], []);
    expect(ar.tracks['1']).toHaveLength(3);
    expect(frameAt(ar, 1, 11)?.[1]).toEqual(['clerk']);
    expect(frameAt(ar, 1, 13)?.[1]).toEqual(['clerk', 'amb_aisle']);
    expect(frameAt(ar, 1, 13)?.[2]).toEqual(['far_figure']);
    expect(frameAt(ar, 1, 20)?.[1]).toEqual(['clerk']);
    expect(frameAt(ar, 1, 5)).toBeNull();
  });

  it('глубина ограничена часом, число кадров на камеру — MAX_FRAMES', () => {
    const ar = emptyArchive();
    for (let m = 0; m < 400; m++) recordFrame(ar, 2, m, [`v${m % 2}`], []);
    const track = ar.tracks['2'];
    expect(track.length).toBeLessThanOrEqual(MAX_FRAMES);
    // не старше окна, кроме одного «опорного» кадра в его начале
    expect(track.filter((f) => f[0] < 399 - ARCHIVE_DEPTH).length).toBeLessThanOrEqual(1);
    expect(archiveRange(ar, 400)).toEqual([400 - ARCHIVE_DEPTH, 399]);
  });

  it('за целую смену архив остаётся маленьким', async () => {
    for (const seed of [3, 4, 5]) {
      const r = await simulate(shift1, randomPolicy, seed, 20000, seed * 17);
      const s = r.state;
      for (const t of Object.values(s.archive.tracks)) expect(t.length).toBeLessThanOrEqual(MAX_FRAMES);
      expect(archiveSize(s)).toBeLessThanOrEqual(4 * MAX_FRAMES);
      // в сохранении — считанные килобайты
      expect(JSON.stringify(s.archive).length).toBeLessThan(24000);
    }
  });
});

describe('Архив: просмотр', () => {
  it('показывает выбранное время, а не текущее', async () => {
    const session = await sessionAt(100);
    const t0 = session.state.minutes;
    force(session, 'extra_box', 4);
    await skipQuiet(session, 1);
    const tBox1 = session.state.minutes;
    await skipQuiet(session, 9);
    expect(session.anomalyVisuals(4)).toEqual(['ov:cam4_box2']);
    expect(session.archiveVisuals(4, tBox1)).toContain('ov:cam4_box1');
    expect(session.archiveVisuals(4, t0 - 1)).not.toContain('ov:cam4_box1');
    expect(session.archiveVisuals(4, session.state.minutes - 1)).toContain('ov:cam4_box2');
    expect(session.archiveOsd(4, tBox1)).toMatch(/^\d\d:\d\d$/);
  });

  it('просмотр архива не меняет мир, возврат показывает текущее состояние', async () => {
    const session = await sessionAt(100);
    force(session, 'chair_moved', 4);
    await skipQuiet(session, 12);
    const live = session.anomalyVisuals(4);
    const before = worldSnapshot(session.state);
    const range = session.archiveRange()!;
    for (let m = range[0]; m <= range[1]; m++) for (const cam of [1, 2, 3, 4] as const) session.viewArchive(cam, m);
    expect(worldSnapshot(session.state)).toBe(before);
    // ни обхода, ни триггеров камер, ни взглядов на камеру
    expect(session.state.anomalies.active[0].seen).toBe(false);
    expect(session.anomalyVisuals(4)).toEqual(live);
    expect(session.state.archive.viewed.length).toBeLessThanOrEqual(40);
  });

  it('архивные аномалии в эфире не видны, на записи видны', async () => {
    const session = await sessionAt(100);
    force(session, 'rec_door', 4);
    await skipQuiet(session, 1);
    const t = session.state.minutes;
    expect(session.anomalyVisuals(4)).toEqual([]);
    expect(session.archiveVisuals(4, t)).toEqual(expect.arrayContaining(['door_open', 'door_figure']));
    // в эфире зафиксировать нельзя — это «ничего такого»
    session.openCameras();
    session.viewCamera(4);
    expect(session.reportAnomaly(4, 'door').result).toBe('false');
  });
});

describe('Архив: фиксация', () => {
  it('архивная аномалия фиксируется по записи и даёт улику', async () => {
    const session = await sessionAt(100);
    force(session, 'rec_door', 4);
    await skipQuiet(session, 1);
    const t = session.state.minutes;
    await skipQuiet(session, 3);
    session.state.anomalies.reportUntil = 0;
    session.viewArchive(4, t);
    const res = session.reportArchive(4, t, 'door');
    expect(res.result).toBe('correct');
    expect(session.state.clues).toContain('archive_door');
    expect(session.state.anomalies.log.at(-1)).toMatchObject({ archive: t, ref: 'rec_door', result: 'correct' });
    await skipQuiet(session, 3);
    expect(session.reportArchive(4, t, 'door').result).toBe('duplicate');
  });

  it('неполное наблюдение: без сверки с камерой 1 — запись без улики, после сверки — улика', async () => {
    const session = await sessionAt(100);
    force(session, 'rec_entry', 2);
    await skipQuiet(session, 1);
    const t = session.state.minutes;
    await skipQuiet(session, 2);
    session.viewArchive(2, t);
    const partial = session.reportArchive(2, t, 'person');
    expect(partial.result).toBe('correct');
    expect(session.state.clues).not.toContain('archive_entry');
    await skipQuiet(session, 3);
    session.viewArchive(1, t);
    const full = session.reportArchive(2, t, 'person');
    expect(full.result).toBe('correct');
    expect(full.text).toMatch(/Камера 1/);
    expect(session.state.clues).toContain('archive_entry');
    await skipQuiet(session, 3);
    expect(session.reportArchive(2, t, 'person').result).toBe('duplicate');
  });

  it('дефект кассеты: полоса на всех камерах, «силуэт» — ложная тревога с объяснением', async () => {
    const session = await sessionAt(100);
    force(session, 'rec_glitch', 4);
    await skipQuiet(session, 1);
    const t = session.state.minutes;
    for (const cam of [1, 2, 3, 4] as const) expect(session.archiveVisuals(cam, t)).toContain('ov:tape_band');
    expect(session.archiveVisuals(4, t)).toContain('ov:tape_smear');
    const res = session.reportArchive(4, t, 'person');
    expect(res.result).toBe('mundane');
    expect(res.text).toMatch(/кассета/);
    expect(session.state.clues).toEqual(expect.not.arrayContaining(['archive_door', 'archive_figure', 'archive_entry']));
  });

  it('пропущенную в эфире аномалию можно найти и записать по архиву', async () => {
    const session = await sessionAt(185);
    force(session, 'truck', 2);
    await skipQuiet(session, 1);
    const t = session.state.minutes;
    session.state.anomalies.active = [];
    session.state.anomalies.outcomes.push(['truck', 'missed', t + 1]);
    await skipQuiet(session, 2);
    const res = session.reportArchive(2, t, 'object');
    expect(res.result).toBe('correct');
    expect(res.text).toMatch(/^Запись/);
    expect(session.state.clues).toContain('truck_cam');
  });

  it('ошибочная фиксация по архиву ничего не ломает', async () => {
    const session = await sessionAt(100);
    const stats = JSON.stringify(session.state.stats);
    const range = session.archiveRange()!;
    const res = session.reportArchive(3, range[0], 'door');
    expect(res.result).toBe('false');
    expect(JSON.stringify(session.state.stats)).toBe(stats);
    expect(session.canReport()).toBe(false);
    expect(session.status).toBe('running');
  });
});

describe('Архив: расписание, сохранение, сюжет', () => {
  it('одинаковый seed — одинаковая запись, разные seed — разная', async () => {
    const a = await simulate(shift1, archivistPolicy(), 5, 20000, 4242);
    const b = await simulate(shift1, archivistPolicy(), 5, 20000, 4242);
    expect(b.state.archive).toEqual(a.state.archive);
    expect(b.state.anomalies.log).toEqual(a.state.anomalies.log);
    const runs = await Promise.all([31, 32, 33, 34].map((seed) => simulate(shift1, cautiousPolicy(), 1, 20000, seed)));
    const archiveSpawns = runs.map((r) =>
      r.state.anomalies.spawned.filter(([id]) => anomalyDefs.find((d) => d.id === id)?.archiveOnly).map(([id, cam, m]) => `${id}/${cam}@${m}`),
    );
    for (let i = 1; i < archiveSpawns.length; i++) expect(archiveSpawns[i]).not.toEqual(archiveSpawns[i - 1]);
    expect(archiveSpawns.some((x) => x.length > 0)).toBe(true);
  });

  it('на паузе запись не идёт; после конца смены новых кадров и событий нет', async () => {
    const session = await sessionAt(120, 31);
    session.setPaused('menu', true);
    const snap = JSON.stringify(session.state.archive) + JSON.stringify(session.state.anomalies);
    for (let i = 0; i < 300; i++) session.update(1300);
    expect(JSON.stringify(session.state.archive) + JSON.stringify(session.state.anomalies)).toBe(snap);
    const r = await simulate(shift1, archivistPolicy(), 2, 20000, 99);
    expect(r.ending).toBe('morning');
    const last = Math.max(...Object.values(r.state.archive.tracks).flatMap((t) => t.map((f) => f[0])));
    expect(last).toBeLessThanOrEqual(360);
    expect(r.state.anomalies.spawned.every(([, , m]) => m < 300)).toBe(true);
  });

  it('архив переживает сохранение и загрузку; старое сохранение получает пустую кассету', async () => {
    const session = await sessionAt(110, 41);
    force(session, 'rec_figure', 1);
    await skipQuiet(session, 2);
    const t = session.state.minutes - 1;
    const saved = JSON.parse(JSON.stringify(cloneState(session.state))) as WorldState;
    const restored = new GameSession(shift1, new EventBus(), presenter);
    restored.resume(saved);
    expect(restored.archiveVisuals(1, t)).toEqual(session.archiveVisuals(1, t));
    expect(restored.archiveRange()).toEqual(session.archiveRange());

    const old = createState(shift1, 'Алекс', 1) as Partial<WorldState>;
    old.minutes = 200;
    delete old.archive;
    const up = upgradeState(JSON.parse(JSON.stringify(old)) as WorldState);
    expect(up.archive.since).toBe(200);
    expect(Object.values(up.archive.tracks).every((tr) => tr.length === 0)).toBe(true);
  });

  it('архивные улики открывают реплики, но не нужны для хорошей концовки', () => {
    const findOpt = (steps: Step[], text: string): { if?: (s: WorldState) => boolean } | null => {
      for (const st of steps) {
        if (st.t === 'choice')
          for (const o of st.options) {
            if (typeof o.text === 'string' && o.text.startsWith(text)) return o;
            const inner = findOpt(o.next ?? [], text);
            if (inner) return inner;
          }
        if (st.t === 'if') {
          const r = findOpt(st.then, text) ?? findOpt(st.else ?? [], text);
          if (r) return r;
        }
      }
      return null;
    };
    const s = createState(shift1, 'Т', 1);
    const relief = findOpt(shift1.scenes.relief, 'Посмотреть на камеру над кассой')!;
    const morning = findOpt(shift1.scenes.morning, 'На записи камер')!;
    expect(relief.if!(s)).toBe(false);
    expect(morning.if!(s)).toBe(false);
    s.clues.push('archive_entry');
    expect(relief.if!(s)).toBe(true);
    expect(morning.if!(s)).toBe(true);
  });

  it('все шесть концовок достижимы; архивист доживает до утра', async () => {
    for (const [name, make] of Object.entries(endingScenarios)) {
      const r = await simulate(shift1, make(), 3, 20000, 8642);
      expect(r.ending, name).toBe(name);
    }
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = await simulate(shift1, archivistPolicy(), seed, 20000, seed * 313);
      expect(r.errors).toEqual([]);
      expect(r.ending).toBe('morning');
      expect(r.maxActiveAnomalies).toBeLessThanOrEqual(shift1.anomalies!.maxActive);
      expect(r.maxArchiveAnomalies).toBeLessThanOrEqual(shift1.anomalies!.maxArchive ?? 1);
    }
  });
});
