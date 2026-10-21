/// <reference types="ysdk" />
import type { KeyValueStorage } from '../core/SaveManager';
import type { SDK, Player } from 'ysdk';
import { SafeLocalStorage } from './LocalPlatform';
import type { Platform } from './Platform';

/**
 * Хранилище поверх облачных данных игрока Яндекс Игр (player.getData / setData)
 * с локальной копией. Запись в облако — не чаще раза в несколько секунд.
 */
class YandexStorage implements KeyValueStorage {
  private cache: Record<string, string> = {};
  private timer: number | null = null;

  constructor(
    private player: Player | null,
    private local: KeyValueStorage,
  ) {}

  async load(keys: string[]): Promise<void> {
    if (!this.player) return;
    try {
      const data = (await this.player.getData()) as Record<string, unknown>;
      for (const k of keys) if (typeof data[k] === 'string') this.cache[k] = data[k] as string;
    } catch (err) {
      console.warn('[ysdk] getData failed', err);
    }
  }

  async get(key: string) {
    return this.cache[key] ?? (await this.local.get(key));
  }

  async set(key: string, value: string) {
    this.cache[key] = value;
    await this.local.set(key, value);
    this.schedule();
  }

  async remove(key: string) {
    delete this.cache[key];
    await this.local.remove(key);
    this.schedule();
  }

  private schedule(): void {
    if (!this.player || this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.player?.setData({ ...this.cache }, false).catch((err: unknown) => console.warn('[ysdk] setData failed', err));
    }, 5000);
  }
}

export class YandexPlatform implements Platform {
  readonly name = 'yandex' as const;
  readonly storage: KeyValueStorage;
  readonly lang: string;
  private pauseCbs: ((paused: boolean) => void)[] = [];
  private adShowing = false;

  private constructor(
    private ysdk: SDK,
    storage: KeyValueStorage,
  ) {
    this.storage = storage;
    let lang = 'ru';
    try {
      lang = ysdk.environment.i18n.lang;
    } catch {
      /* ignore */
    }
    this.lang = lang;
    ysdk.on('game_api_pause', () => this.pauseCbs.forEach((cb) => cb(true)));
    ysdk.on('game_api_resume', () => this.pauseCbs.forEach((cb) => cb(false)));
  }

  static async create(saveKeys: string[]): Promise<YandexPlatform> {
    const ysdk = await YaGames.init();
    let player: Player | null = null;
    try {
      player = await ysdk.getPlayer();
    } catch (err) {
      console.warn('[ysdk] getPlayer failed, сохранения только локально', err);
    }
    let localStore: Storage | null = null;
    try {
      localStore = (await ysdk.getStorage()) as Storage;
    } catch {
      localStore = null;
    }
    const storage = new YandexStorage(player, new SafeLocalStorage(localStore));
    await storage.load(saveKeys);
    return new YandexPlatform(ysdk, storage);
  }

  gameReady(): void {
    this.ysdk.features.LoadingAPI?.ready();
  }

  gameplayStart(): void {
    this.ysdk.features.GameplayAPI?.start();
  }

  gameplayStop(): void {
    this.ysdk.features.GameplayAPI?.stop();
  }

  showInterstitial(): Promise<void> {
    if (this.adShowing) return Promise.resolve();
    return new Promise((resolve) => {
      this.adShowing = true;
      const done = () => {
        this.adShowing = false;
        this.pauseCbs.forEach((cb) => cb(false));
        resolve();
      };
      try {
        this.ysdk.adv.showFullscreenAdv({
          callbacks: {
            onOpen: () => this.pauseCbs.forEach((cb) => cb(true)),
            onClose: () => done(),
            onError: () => done(),
            onOffline: () => done(),
          },
        });
      } catch {
        done();
      }
    });
  }

  showRewarded(): Promise<boolean> {
    return new Promise((resolve) => {
      let rewarded = false;
      try {
        this.ysdk.adv.showRewardedVideo({
          callbacks: {
            onOpen: () => this.pauseCbs.forEach((cb) => cb(true)),
            onRewarded: () => (rewarded = true),
            onClose: () => {
              this.pauseCbs.forEach((cb) => cb(false));
              resolve(rewarded);
            },
            onError: () => {
              this.pauseCbs.forEach((cb) => cb(false));
              resolve(false);
            },
          },
        });
      } catch {
        resolve(false);
      }
    });
  }

  onPauseChange(cb: (paused: boolean) => void): void {
    this.pauseCbs.push(cb);
  }
}
