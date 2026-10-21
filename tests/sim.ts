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
}

const flush = () => new Promise<void>((r) => setImmediate(r));

export async function simulate(shift: ShiftDef, policy: Policy, seed = 1, maxSteps = 20000): Promise<SimResult> {
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
  try {
    session = new GameSession(shift, bus, presenter);
    session.startNew('Тест');
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
  return { ending: session.state.endingId, state: session.state, lines, choices, errors, scenesStarted };
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
