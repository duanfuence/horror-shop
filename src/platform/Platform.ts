import type { KeyValueStorage } from '../core/SaveManager';

/**
 * Платформа, на которой запущена игра: локальный браузер или Яндекс Игры.
 * Игра обращается только к этому интерфейсу, поэтому SDK можно подключать и отключать,
 * не трогая остальной код.
 */
export interface Platform {
  readonly name: 'local' | 'yandex';
  readonly storage: KeyValueStorage;
  /** Язык интерфейса платформы (ru, en, …). */
  readonly lang: string;
  /** Игра загружена и готова к взаимодействию (Game Ready). */
  gameReady(): void;
  /** Разметка геймплея: игрок управляет игрой / игра на паузе или в меню. */
  gameplayStart(): void;
  gameplayStop(): void;
  /** Межстраничная реклама. Промис завершается после закрытия (или сразу, если реклама недоступна). */
  showInterstitial(): Promise<void>;
  /** Реклама за вознаграждение. true — награду можно выдать. */
  showRewarded(): Promise<boolean>;
  /** Платформа просит поставить игру на паузу (например, при показе своих окон). */
  onPauseChange(cb: (paused: boolean) => void): void;
}
