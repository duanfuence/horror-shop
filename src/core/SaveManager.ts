import { cloneState, isValidState } from './state';
import type { WorldState } from './types';

/** Абстрактное хранилище ключ-значение (localStorage или облачные данные платформы). */
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Settings {
  master: number;
  ambience: number;
  sfx: number;
  muted: boolean;
  /** Эффекты экрана: шум, мерцание, виньетка. */
  effects: boolean;
  /** Скорость появления текста: 0 — сразу целиком. */
  textSpeed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  ambience: 0.7,
  sfx: 0.8,
  muted: false,
  effects: true,
  textSpeed: 1,
};

export interface MetaProgress {
  endings: string[];
  runs: number;
  bestClues: number;
  lastName: string;
}

const DEFAULT_META: MetaProgress = { endings: [], runs: 0, bestClues: 0, lastName: '' };

const KEY_RUN = 'nightshift.run.v1';
const KEY_META = 'nightshift.meta.v1';
const KEY_SETTINGS = 'nightshift.settings.v1';

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Сохранения: текущая смена (контрольные точки), общий прогресс (концовки) и настройки.
 * Любая ошибка хранилища не должна мешать игре — поэтому всё обёрнуто в try/catch.
 */
export class SaveManager {
  meta: MetaProgress = { ...DEFAULT_META };
  settings: Settings = { ...DEFAULT_SETTINGS };
  private pendingRun: string | null = null;
  private writing = false;

  constructor(private storage: KeyValueStorage) {}

  async init(): Promise<void> {
    const meta = safeParse<Partial<MetaProgress>>(await this.read(KEY_META));
    if (meta) this.meta = { ...DEFAULT_META, ...meta, endings: Array.isArray(meta.endings) ? meta.endings : [] };
    const settings = safeParse<Partial<Settings>>(await this.read(KEY_SETTINGS));
    if (settings) this.settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...settings });
  }

  async loadRun(knownShifts: string[]): Promise<WorldState | null> {
    const data = safeParse<unknown>(await this.read(KEY_RUN));
    if (!isValidState(data)) return null;
    if (!knownShifts.includes(data.shiftId) || data.endingId) return null;
    return data;
  }

  /** Сохранение контрольной точки. Записи не накладываются друг на друга. */
  saveRun(state: WorldState): void {
    this.pendingRun = JSON.stringify(cloneState(state));
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.pendingRun !== null) {
        const value = this.pendingRun;
        this.pendingRun = null;
        await this.write(KEY_RUN, value);
      }
    } finally {
      this.writing = false;
    }
  }

  async clearRun(): Promise<void> {
    this.pendingRun = null;
    try {
      await this.storage.remove(KEY_RUN);
    } catch (err) {
      console.warn('[save] remove failed', err);
    }
  }

  async recordEnding(endingId: string, clues: number, name: string): Promise<void> {
    if (!this.meta.endings.includes(endingId)) this.meta.endings.push(endingId);
    this.meta.runs += 1;
    this.meta.bestClues = Math.max(this.meta.bestClues, clues);
    this.meta.lastName = name;
    await this.write(KEY_META, JSON.stringify(this.meta));
    await this.clearRun();
  }

  async saveName(name: string): Promise<void> {
    this.meta.lastName = name;
    await this.write(KEY_META, JSON.stringify(this.meta));
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.settings = sanitizeSettings(settings);
    await this.write(KEY_SETTINGS, JSON.stringify(this.settings));
  }

  private async read(key: string): Promise<string | null> {
    try {
      return await this.storage.get(key);
    } catch (err) {
      console.warn('[save] read failed', key, err);
      return null;
    }
  }

  private async write(key: string, value: string): Promise<void> {
    try {
      await this.storage.set(key, value);
    } catch (err) {
      console.warn('[save] write failed', key, err);
    }
  }
}

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function sanitizeSettings(s: Settings): Settings {
  return {
    master: clamp01(s.master, DEFAULT_SETTINGS.master),
    ambience: clamp01(s.ambience, DEFAULT_SETTINGS.ambience),
    sfx: clamp01(s.sfx, DEFAULT_SETTINGS.sfx),
    muted: Boolean(s.muted),
    effects: s.effects !== false,
    textSpeed: typeof s.textSpeed === 'number' && s.textSpeed >= 0 && s.textSpeed <= 2 ? s.textSpeed : 1,
  };
}

/** Хранилище в памяти — для тестов и как запасной вариант. */
export class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}
