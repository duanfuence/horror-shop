/**
 * Безголовая симуляция смены: «бот» играет вместо человека.
 * Используется в тестах, чтобы проверить все ветки сюжета без браузера.
 */
import { EventBus } from '../src/core/EventBus';
import { GameSession } from '../src/core/GameSession';
import type { ChoiceRequest, LineRequest, Presenter, SaleRequest } from '../src/core/Presenter';
import type { SaleResult, ShiftDef, WorldState } from '../src/core/types';

export interface Policy {
  /** Возвращает индекс варианта. */
  choose(req: ChoiceRequest, s: WorldState, rng: () => number): number;
  sale(req: SaleRequest, s: WorldState, rng: () => number): SaleResult;
  /** Действия в свободное время (раз в игровую минуту). */
  idle?(session: GameSession, rng: () => number): void;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimResult {
  ending: string | null;
  state: WorldState;
  lines: LineRequest[];
  choices: { prompt: string | null; options: string[]; picked: string }[];
  errors: unknown[];
  scenesStarted: string[];
  /** Начала сюжетных сцен и фоновых сюжетных событий хронологии: [id, игровая минута]. */
  sceneLog: [string, number][];
  /** Температура в начале каждой игровой минуты (индекс — минута). */
  temps: number[];
  /** События шины 'fx' и 'ambient', как их видят сцена и звук. */
  fxLog: [string, number][];
  /** Наибольшее число одновременно активных аномалий за смену. */
  maxActiveAnomalies: number;
  /** Сколько раз на одной камере оказывалось больше одной аномалии (должно быть 0). */
  sameCamAnomalies: number;
}

const flush = () => new Promise<void>((r) => setImmediate(r));

export async function simulate(
  shift: ShiftDef,
  policy: Policy,
  seed = 1,
  maxSteps = 20000,
  runSeed: number = seed,
): Promise<SimResult> {
  const rng = mulberry32(seed);
  const bus = new EventBus();
  const lines: LineRequest[] = [];
  const choices: SimResult['choices'] = [];
  const errors: unknown[] = [];
  let session!: GameSession;

  const presenter: Presenter = {
    async line(req) {
      lines.push(req);
    },
    async choose(req) {
      const idx = policy.choose(req, session.state, rng);
      if (idx < 0 || idx >= req.options.length) throw new Error(`Бот выбрал несуществующий вариант ${idx}`);
      choices.push({ prompt: req.prompt, options: req.options.map((o) => o.text), picked: req.options[idx].text });
      return idx;
    },
    async sale(req) {
      // Покупка занимает немного игрового времени, как у живого игрока.
      return policy.sale(req, session.state, rng);
    },
    async wait() {},
    dialogStart() {},
    dialogEnd() {},
  };

  const origError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const scenesStarted: string[] = [];
  const sceneLog: [string, number][] = [];
  const temps: number[] = [];
  const fxLog: [string, number][] = [];
  bus.on('fx', ({ id }) => fxLog.push([id, session.state.minutes]));
  let seenScene: string | null = null;
  let firedSeen = 0;
  const ambientBeats = new Map(shift.timeline.filter((b) => b.ambient).map((b) => [b.id, b.scene]));
  bus.on('state:changed', () => {
    if (!session) return;
    const id = session.sceneId;
    if (id && id !== seenScene) sceneLog.push([id, session.state.minutes]);
    seenScene = id;
    const fired = session.state.fired;
    for (; firedSeen < fired.length; firedSeen++) {
      const scene = ambientBeats.get(fired[firedSeen]);
      const at = session.beatMinute(fired[firedSeen]);
      const beat = shift.timeline.find((b) => b.id === fired[firedSeen]);
      // пропущенные по окну события не считаются
      if (scene && at !== undefined && session.state.minutes <= at + (beat?.window ?? 30)) {
        sceneLog.push([scene, session.state.minutes]);
      }
    }
  });
  let maxActiveAnomalies = 0;
  bus.on('clock:minute', ({ minutes }) => {
    temps[minutes] = session.temperature();
  });
  let sameCamAnomalies = 0;
  bus.on('state:changed', () => {
    if (!session) return;
    const active = session.state.anomalies.active;
    maxActiveAnomalies = Math.max(maxActiveAnomalies, active.length);
    if (new Set(active.map((a) => a.cam)).size !== active.length) sameCamAnomalies++;
  });
  try {
    session = new GameSession(shift, bus, presenter);
    session.startNew('Тест', runSeed);
    const msPerMinute = shift.secondsPerMinute * 1000;
    let lastScene: string | null = null;
    for (let i = 0; i < maxSteps && session.status === 'running'; i++) {
      await flush();
      if (session.sceneId && session.sceneId !== lastScene) scenesStarted.push(session.sceneId);
      lastScene = session.sceneId;
      if (!session.isBusy) policy.idle?.(session, rng);
      session.update(msPerMinute);
      await flush();
    }
  } finally {
    console.error = origError;
  }
  return {
    ending: session.state.endingId,
    state: session.state,
    lines,
    choices,
    errors,
    scenesStarted,
    sceneLog,
    temps,
    fxLog,
    maxActiveAnomalies,
    sameCamAnomalies,
  };
}

// ───────────── готовые стратегии ─────────────

/** Выбрать первый вариант, содержащий одну из подстрок (в порядке приоритета). */
export function prefer(req: ChoiceRequest, wants: string[], fallback: 'first' | 'last' | 'default' = 'default'): number {
  for (const w of wants) {
    const i = req.options.findIndex((o) => o.text.toLowerCase().includes(w.toLowerCase()));
    if (i >= 0) return i;
  }
  if (fallback === 'default' && req.timer) return req.timer.defaultIndex;
  return fallback === 'last' ? req.options.length - 1 : 0;
}

export const randomPolicy: Policy = {
  choose(req, _s, rng) {
    return Math.floor(rng() * req.options.length);
  },
  sale(_req, _s, rng) {
    const r = rng();
    return {
      outcome: r < 0.6 ? 'sold' : r < 0.85 ? 'refused' : 'timeout',
      askedName: rng() < 0.5,
      overridden: rng() < 0.3,
    };
  },
  idle(session, rng) {
    const r = rng();
    if (r < 0.05) session.recordTemperature();
    else if (r < 0.1) {
      session.openCameras();
      session.viewCamera((1 + Math.floor(rng() * 4)) as 1 | 2 | 3 | 4);
      session.closeCameras();
    } else if (r < 0.11) session.inspectCustomer();
    else if (r < 0.115) session.act('door:open');
    else if (r < 0.12) session.act('door:close');
    else if (r < 0.125) session.setCam4(rng() < 0.5);
    else if (r < 0.13) {
      const visible = session.shift.contacts.filter((c) => c.visible(session.state));
      const c = visible[Math.floor(rng() * visible.length)];
      if (c) session.playScene(c.scene(session.state));
    } else if (r < 0.135) session.act('journal:old');
    else if (r < 0.14) session.act('journal:back');
    else if (r < 0.145) session.act('inspect:photo');
    else if (r < 0.155) {
      // случайная фиксация «наугад» — проверяет, что ложные записи ничего не ломают
      const cats = ['person', 'object', 'door', 'image'] as const;
      const cam = (1 + Math.floor(rng() * 4)) as 1 | 2 | 3 | 4;
      session.openCameras();
      session.viewCamera(cam);
      session.reportAnomaly(cam, cats[Math.floor(rng() * cats.length)]);
      session.closeCameras();
    }
  },
};

/** Добросовестный продавец: всё по памятке, никакой самодеятельности. */
export function rulesPolicy(extraWants: string[] = []): Policy {
  return {
    choose(req) {
      return prefer(req, [
        ...extraWants,
        'Принять смену',
        'Да, первая',
        'Что значит',
        'Поздно со смены',
        'Берегите',
        'Оставить чек',
        'Ночью нельзя',
        'Ответить (линия 1)',
        'Всё спокойно',
        'Пробить покупку',
        'Не отвечать',
        'Оторвать ленту',
        'Спасибо, что сказали',
        'Ночью поставок не бывает',
        'Не открывать',
        'Закрыть дверь',
        'Перезвоню вам',
        'Положить трубку',
        'Захлопнуть',
        'Галина Петровна сейчас дома',
        'Нет. Ключи останутся',
        'Нет.',
        'Оторвать чек',
        'Тихо.',
        'Нет. Тишина',
      ]);
    },
    sale(req) {
      const hasUnknown = req.items.some((i) => !i.inCatalog);
      const hasAlcohol = req.items.some((i) => i.alcohol);
      if (hasAlcohol) return { outcome: 'refused', askedName: false, overridden: false };
      if (hasUnknown) {
        // Спросили фамилию; продаём только если она есть в журнале.
        const inJournal = req.nameAnswer?.startsWith('Семёнов') ?? false;
        return { outcome: inJournal ? 'sold' : 'refused', askedName: true, overridden: false };
      }
      return { outcome: 'sold', askedName: false, overridden: false };
    },
    idle(session) {
      const s = session.state;
      const hour = String(Math.min(5, Math.floor(s.minutes / 60)));
      if (s.flags.rulesAccepted && s.tempLog[hour] === undefined && s.minutes % 60 >= 2) session.recordTemperature();
      const round = session.currentRound();
      if (round && (s.camRounds[round] ?? []).length < 4) {
        session.openCameras();
        for (const cam of [1, 2, 3, 4] as const) session.viewCamera(cam);
        session.closeCameras();
      }
    },
  };
}

/**
 * Осторожный продавец: всё по памятке и по обороту памятки.
 * «Ниже нуля — не смотри в четвёртую»: при минусе на термометре камеру 4 не открывает,
 * даже если из-за этого обход останется неполным.
 */
export function cautiousPolicy(extraWants: string[] = []): Policy {
  const base = rulesPolicy(extraWants);
  return {
    ...base,
    idle(session) {
      const s = session.state;
      const hour = String(Math.min(5, Math.floor(s.minutes / 60)));
      if (s.flags.rulesAccepted && s.tempLog[hour] === undefined && s.minutes % 60 >= 2) session.recordTemperature();
      const round = session.currentRound();
      if (round && (s.camRounds[round] ?? []).length < 3) {
        session.openCameras();
        for (const cam of [1, 2, 3, 4] as const) {
          if (cam === 4 && session.temperature() < 0) continue;
          session.viewCamera(cam);
        }
        session.closeCameras();
      }
    },
  };
}

/**
 * Рискованный, любопытный игрок: отвечает на линию 2, часто смотрит все камеры
 * (в том числе четвёртую на морозе), прислушивается к служебной двери. Дверь не открывает.
 */
export function riskyPolicy(): Policy {
  const base = rulesPolicy(['Ответить (линия 2)', 'Где ты', 'Это розыгрыш', 'Кто — он', 'Как тебя зовут']);
  return {
    ...base,
    idle(session, rng) {
      base.idle?.(session, rng);
      const s = session.state;
      if (s.minutes % 6 === 0) {
        session.openCameras();
        for (const cam of [1, 2, 3, 4] as const) session.viewCamera(cam);
        session.closeCameras();
      }
      if (s.minutes % 15 === 0) session.act('door:listen');
    },
  };
}

/** Стратегии, ведущие к каждой из шести концовок (используются в тестах прохождения). */
export const endingScenarios: Record<string, () => Policy> = {
  morning: () => rulesPolicy(),
  fired: () => {
    const policy = rulesPolicy(['Открыть дверь', 'Закрыть дверь']);
    const base = policy.sale;
    policy.sale = (req, s, rng) =>
      req.items.some((i) => i.alcohol) ? { outcome: 'sold', askedName: false, overridden: true } : base(req, s, rng);
    return policy;
  },
  swap: () => rulesPolicy(['Отдать ключи']),
  door: () => ({
    ...rulesPolicy(),
    choose(req, s, rng) {
      if (req.prompt === 'Стучат в служебную дверь.') return prefer(req, ['Открыть']);
      return rulesPolicy().choose(req, s, rng);
    },
  }),
  lastsale: () => {
    const base = rulesPolicy(['Ничего не делать']);
    return {
      ...base,
      choose(req, s, rng) {
        if (req.options.some((o) => o.text.startsWith('Показать ему чек'))) return prefer(req, ['Пробить покупку']);
        return base.choose(req, s, rng);
      },
      sale(req, s, rng) {
        if (req.items.some((i) => i.productId === 'candle')) return { outcome: 'sold', askedName: true, overridden: false };
        return base.sale(req, s, rng);
      },
    };
  },
  released: () => {
    const base = rulesPolicy([
      'Ответить (линия 2)',
      'Где ты',
      'Это розыгрыш',
      'Как тебе помочь',
      'Кто — он',
      'Как тебя зовут',
      'Костя звонил мне',
      'Посмотреть на камеру над кассой',
      'Посмотреть на камеру 4',
      'Записать',
      'Сказал, что не увольнялся',
    ]);
    return {
      ...base,
      idle(session, rng) {
        base.idle?.(session, rng);
        const s = session.state;
        session.act('inspect:photo');
        if (!s.clues.includes('temp_2022')) session.act('journal:old');
        if (s.minutes >= 190 && s.minutes <= 215 && !s.clues.includes('cam4_kostya')) {
          session.openCameras();
          session.viewCamera(4);
          session.closeCameras();
        }
        if (s.minutes >= 255 && s.minutes <= 265 && !s.clues.includes('cam3_empty')) {
          session.openCameras();
          session.viewCamera(3);
          session.closeCameras();
        }
      },
    };
  },
};

/**
 * Добросовестный, но не знающий про оборот памятки: всё по правилам,
 * плюс каждые 20 минут проверяет все камеры — в том числе четвёртую на морозе.
 */
export function watcherPolicy(): Policy {
  const base = rulesPolicy();
  return {
    ...base,
    idle(session, rng) {
      base.idle?.(session, rng);
      if (session.state.minutes % 20 === 10) {
        session.openCameras();
        for (const cam of [1, 2, 3, 4] as const) session.viewCamera(cam);
        session.closeCameras();
      }
    },
  };
}

/**
 * Наблюдатель: работает по правилам и каждые `every` минут просматривает камеры.
 * Замеченную аномалию фиксирует, верно определяя, что не так, с вероятностью `accuracy`.
 * respectCold — соблюдать правило Кости и не смотреть в камеру 4 на морозе.
 */
export function observerPolicy(opts: { every?: number; accuracy?: number; respectCold?: boolean; extraWants?: string[] } = {}): Policy {
  const every = opts.every ?? 8;
  const accuracy = opts.accuracy ?? 0.85;
  const base = opts.respectCold === false ? rulesPolicy(opts.extraWants) : cautiousPolicy(opts.extraWants);
  const cats = ['person', 'object', 'door', 'image'] as const;
  return {
    ...base,
    idle(session, rng) {
      base.idle?.(session, rng);
      const s = session.state;
      if (s.minutes % every !== 0 || !session.anomalies) return;
      session.openCameras();
      for (const cam of [1, 2, 3, 4] as const) {
        if (cam === 4 && opts.respectCold !== false && session.temperature() < 0) continue;
        session.viewCamera(cam);
        const a = s.anomalies.active.find((x) => x.cam === cam);
        const def = a && session.anomalies.def(a.id);
        if (!def || !session.canReport()) continue;
        // обычные вещи наблюдатель иногда тоже принимает за странность
        if (def.danger === 0 && rng() < 0.5) continue;
        const right = rng() < accuracy;
        const cat = right ? def.categories[0] : cats[Math.floor(rng() * cats.length)];
        session.reportAnomaly(cam, cat);
      }
      session.closeCameras();
    },
  };
}
