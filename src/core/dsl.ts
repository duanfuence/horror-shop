/**
 * Небольшой язык описания сцен. Сюжет пишется как последовательность шагов:
 *
 *   enter('grey', 'v1'),
 *   say('grey', 'Доброй ночи.'),
 *   choice([
 *     opt('Ответить', [fx(add('trustKostya', 1))]),
 *     opt('Промолчать'),
 *   ]),
 *
 * Условия (Cond) и эффекты (Effect) — маленькие функции, собранные из готовых блоков.
 */
import { parseTime } from './state';
import type {
  ChoiceOption,
  ChoiceTone,
  Cond,
  Effect,
  LightsMode,
  DoorState,
  SfxId,
  StatKey,
  Step,
  Text,
  WorldState,
  SaleItemSpec,
  SaleResult,
  LineKind,
} from './types';

// ───────────── условия ─────────────

export const flag =
  (name: string): Cond =>
  (s) =>
    Boolean(s.flags[name]);

export const not =
  (c: Cond): Cond =>
  (s) =>
    !c(s);

export const all =
  (...cs: Cond[]): Cond =>
  (s) =>
    cs.every((c) => c(s));

export const any =
  (...cs: Cond[]): Cond =>
  (s) =>
    cs.some((c) => c(s));

type Op = '>=' | '<=' | '>' | '<' | '==';
function compare(a: number, op: Op, b: number): boolean {
  switch (op) {
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '==':
      return a === b;
  }
}

export const stat =
  (key: StatKey, op: Op, value: number): Cond =>
  (s) =>
    compare(s.stats[key], op, value);

export const hasClue =
  (id: string): Cond =>
  (s) =>
    s.clues.includes(id);

export const hasItem =
  (id: string): Cond =>
  (s) =>
    s.inventory.includes(id);

export const aware =
  (op: Op, value: number): Cond =>
  (s) =>
    compare(s.clues.length, op, value);

export const after =
  (hhmm: string): Cond =>
  (s) =>
    s.minutes >= parseTime(hhmm);

export const before =
  (hhmm: string): Cond =>
  (s) =>
    s.minutes < parseTime(hhmm);

export const doorOpen: Cond = (s) => s.serviceDoor === 'open';

// ───────────── эффекты ─────────────

export const add =
  (key: StatKey, delta: number): Effect =>
  (s) => {
    s.stats[key] += delta;
    if (key === 'attention') s.stats.attention = Math.max(0, s.stats.attention);
  };

export const set =
  (name: string, value: boolean | number | string = true): Effect =>
  (s) => {
    s.flags[name] = value;
  };

export const unset =
  (name: string): Effect =>
  (s) => {
    delete s.flags[name];
  };

export const clue =
  (id: string): Effect =>
  (s, ctx) => {
    if (s.clues.includes(id)) return;
    s.clues.push(id);
    ctx.emitJournal('notes');
  };

export const violate =
  (id: string): Effect =>
  (s) => {
    if (!s.violations.includes(id)) s.violations.push(id);
  };

export const give =
  (item: string): Effect =>
  (s) => {
    if (!s.inventory.includes(item)) s.inventory.push(item);
  };

export const take =
  (item: string): Effect =>
  (s) => {
    s.inventory = s.inventory.filter((i) => i !== item);
  };

/** Новая запись в журнале (например, новая рукописная строка на обороте правил). */
export const journal =
  (entry: string, tab = 'rules'): Effect =>
  (s, ctx) => {
    if (s.journal.includes(entry)) return;
    s.journal.push(entry);
    ctx.emitJournal(tab);
  };

export const toast =
  (text: string): Effect =>
  (_s, ctx) =>
    ctx.emitToast(text);

export const custom = (fn: (s: WorldState) => void): Effect => fn;

// ───────────── шаги ─────────────

export const say = (who: string, text: Text, kind: LineKind = 'speech'): Step => ({ t: 'say', who, text, kind });
export const phone = (who: string, text: Text): Step => ({ t: 'say', who, text, kind: 'phone' });
export const voice = (who: string, text: Text): Step => ({ t: 'say', who, text, kind: 'voice' });
export const narr = (text: Text): Step => ({ t: 'narr', text, kind: 'narration' });
export const sys = (text: Text): Step => ({ t: 'narr', text, kind: 'system' });

export function opt(
  text: Text,
  next: Step[] = [],
  extra: { if?: Cond; tone?: ChoiceTone; loop?: boolean } = {},
): ChoiceOption {
  return { text, next, if: extra.if, tone: extra.tone, repeatable: extra.loop ? 'loop' : false };
}

export function choice(
  options: ChoiceOption[],
  extra: {
    prompt?: Text;
    timer?: { seconds: number; defaultIndex: number };
    style?: 'dialog' | 'phone' | 'door';
    loop?: boolean;
  } = {},
): Step {
  return { t: 'choice', options, ...extra };
}

export const fx = (...effects: Effect[]): Step => ({ t: 'do', fx: effects });
export const when = (cond: Cond, then: Step[], otherwise?: Step[]): Step => ({
  t: 'if',
  cond,
  then,
  else: otherwise,
});
export const enter = (who: string, variant = 'v1', bell = true): Step => ({ t: 'enter', who, variant, bell });
export const leave = (bell = true): Step => ({ t: 'leave', bell });
export const sfx = (id: SfxId): Step => ({ t: 'sfx', id });
export const wait = (ms: number): Step => ({ t: 'wait', ms });
export const paper = (id: string | null): Step => ({ t: 'paper', id });
export const ring = (line: 1 | 2, ringing: boolean): Step => ({ t: 'ring', line, ringing });
export const lights = (mode: LightsMode): Step => ({ t: 'lights', mode });
export const door = (state: DoorState): Step => ({ t: 'door', state });
export const knock = (strength = 1): Step => ({ t: 'knock', strength });
export const flashlight = (on: boolean): Step => ({ t: 'flashlight', on });
export const hint = (target: string | null): Step => ({ t: 'hint', target });
export const goto = (scene: string): Step => ({ t: 'goto', scene });
export const end = (ending: string): Step => ({ t: 'end', ending });
export const clear = (): Step => ({ t: 'clear' });

export function sale(spec: {
  items: (string | SaleItemSpec)[];
  patience?: number;
  nameAnswer?: Text;
  tutorial?: boolean;
  sold?: Step[];
  refused?: Step[];
  timeout?: Step[];
  after?: (s: WorldState, r: SaleResult) => void;
}): Step {
  return {
    t: 'sale',
    items: spec.items.map((i) => (typeof i === 'string' ? { product: i } : i)),
    patience: spec.patience ?? 45,
    nameAnswer: spec.nameAnswer,
    tutorial: spec.tutorial,
    onSold: spec.sold,
    onRefused: spec.refused,
    onTimeout: spec.timeout,
    after: spec.after,
  };
}
