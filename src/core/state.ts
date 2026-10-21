import { newSeed, seedFrom } from './random';
import type { AmbientState, AnomalyState, ArchiveState, ShiftDef, Text, WorldState } from './types';

export const SAVE_VERSION = 1;
export const SHIFT_END_MINUTES = 360;

export function parseTime(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Неверный формат времени: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatTime(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function emptyAmbient(): AmbientState {
  return { last: {}, count: {}, log: [], quietUntil: 0, lastAt: 0, lastScene: 0, dip: null, floorItem: false };
}

export function emptyAnomalies(): AnomalyState {
  return { active: [], last: {}, count: {}, spawned: [], outcomes: [], traces: [], log: [], quietUntil: 0, reportUntil: 0 };
}

export function emptyArchive(since = 0): ArchiveState {
  return { since, tracks: { '1': [], '2': [], '3': [], '4': [] }, viewed: [] };
}

export function createState(shift: ShiftDef, playerName: string, seed: number = newSeed()): WorldState {
  return {
    v: SAVE_VERSION,
    seed: seed >>> 0 || 1,
    ambient: emptyAmbient(),
    anomalies: emptyAnomalies(),
    archive: emptyArchive(),
    shiftId: shift.id,
    playerName,
    minutes: 0,
    stats: { ...shift.initialStats },
    flags: {},
    clues: [],
    violations: [],
    fired: [],
    inventory: [],
    sales: [],
    tempLog: {},
    camViews: 0,
    camRounds: {},
    cam4On: true,
    serviceDoor: 'closed',
    lights: 'normal',
    journal: [],
    triggerLog: {},
    endingId: null,
  };
}

/** Подставляет {name} и вычисляет текст-функцию. */
export function resolveText(text: Text, s: WorldState): string {
  const raw = typeof text === 'function' ? text(s) : text;
  return raw.replace(/\{name\}/g, s.playerName);
}

export function awareness(s: WorldState): number {
  return s.clues.length;
}

export function hasFlag(s: WorldState, flag: string): boolean {
  return Boolean(s.flags[flag]);
}

/** Минимальная проверка структуры сохранения, чтобы битые данные не ломали игру. */
export function isValidState(data: unknown): data is WorldState {
  if (!data || typeof data !== 'object') return false;
  const s = data as Partial<WorldState>;
  return (
    s.v === SAVE_VERSION &&
    typeof s.shiftId === 'string' &&
    typeof s.playerName === 'string' &&
    typeof s.minutes === 'number' &&
    Number.isFinite(s.minutes) &&
    !!s.stats &&
    typeof s.stats.attention === 'number' &&
    Array.isArray(s.fired) &&
    Array.isArray(s.clues) &&
    Array.isArray(s.violations) &&
    Array.isArray(s.inventory) &&
    Array.isArray(s.sales) &&
    Array.isArray(s.journal) &&
    typeof s.flags === 'object' &&
    typeof s.tempLog === 'object' &&
    typeof s.camRounds === 'object' &&
    typeof s.triggerLog === 'object'
  );
}

/** Дополнить сохранение, сделанное до появления режиссёра тревоги (без seed и ambient). */
export function upgradeState(s: WorldState): WorldState {
  if (typeof s.seed !== 'number' || !Number.isFinite(s.seed) || s.seed <= 0) {
    s.seed = seedFrom(`${s.playerName}|${s.shiftId}|${s.sales.length}|${s.clues.join(',')}`);
  }
  const a = (s.ambient ?? {}) as Partial<AmbientState>;
  s.ambient = { ...emptyAmbient(), ...a, log: Array.isArray(a.log) ? a.log : [] };
  const an = (s.anomalies ?? {}) as Partial<AnomalyState>;
  const arr = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  s.anomalies = {
    ...emptyAnomalies(),
    ...an,
    active: arr(an.active),
    spawned: arr(an.spawned),
    outcomes: arr(an.outcomes),
    traces: arr(an.traces),
    log: arr(an.log),
  };
  // Архив старого сохранения начинается с момента загрузки: прошлого на записи нет.
  const ar = s.archive as Partial<ArchiveState> | undefined;
  if (!ar || typeof ar.tracks !== 'object' || !ar.tracks) s.archive = emptyArchive(s.minutes);
  else {
    const tracks = emptyArchive().tracks;
    for (const k of Object.keys(tracks)) tracks[k] = arr(ar.tracks[k]);
    s.archive = { since: typeof ar.since === 'number' ? ar.since : s.minutes, tracks, viewed: arr(ar.viewed) };
  }
  return s;
}

export function cloneState(s: WorldState): WorldState {
  return JSON.parse(JSON.stringify(s)) as WorldState;
}
