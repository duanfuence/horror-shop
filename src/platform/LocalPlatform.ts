import type { KeyValueStorage } from '../core/SaveManager';
import { MemoryStorage } from '../core/SaveManager';
import type { Platform } from './Platform';

/** localStorage с защитой от исключений (приватный режим, запрет cookies). */
export class SafeLocalStorage implements KeyValueStorage {
  private fallback = new MemoryStorage();
  private store: Storage | null;

  constructor(store?: Storage | null) {
    let s: Storage | null = null;
    try {
      s = store ?? window.localStorage;
      const probe = '__ns_probe__';
      s.setItem(probe, '1');
      s.removeItem(probe);
    } catch {
      s = null;
    }
    this.store = s;
  }

  async get(key: string) {
    try {
      return this.store ? this.store.getItem(key) : await this.fallback.get(key);
    } catch {
      return this.fallback.get(key);
    }
  }

  async set(key: string, value: string) {
    try {
      if (this.store) this.store.setItem(key, value);
      else await this.fallback.set(key, value);
    } catch {
      await this.fallback.set(key, value);
    }
  }

  async remove(key: string) {
    try {
      this.store?.removeItem(key);
    } catch {
      /* ignore */
    }
    await this.fallback.remove(key);
  }
}

/** Обычный браузер без SDK: реклама не показывается, сохранения — в localStorage. */
export class LocalPlatform implements Platform {
  readonly name = 'local' as const;
  readonly storage = new SafeLocalStorage();
  readonly lang = (navigator.language || 'ru').slice(0, 2);
  gameReady(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async showInterstitial(): Promise<void> {}
  async showRewarded(): Promise<boolean> {
    return false;
  }
  onPauseChange(): void {}
}
