import { isLocalHostname } from './hosts';
import { LocalPlatform } from './LocalPlatform';
import type { Platform } from './Platform';

const SAVE_KEYS = ['nightshift.run.v1', 'nightshift.meta.v1', 'nightshift.settings.v1'];

function isLocalHost(): boolean {
  return location.protocol === 'file:' || isLocalHostname(location.hostname);
}

function loadScript(src: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    const timer = window.setTimeout(() => resolve(false), timeoutMs);
    s.onload = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    s.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    document.head.appendChild(s);
  });
}

/**
 * Выбор платформы. На Яндекс Играх SDK отдаётся по адресу /sdk.js;
 * на этом компьютере и в локальной сети (телефон в той же Wi-Fi) SDK не загружается,
 * если не указан параметр ?sdk=1 (для проверки через @yandex-games/sdk-dev-proxy).
 */
export async function createPlatform(): Promise<Platform> {
  const params = new URLSearchParams(location.search);
  const wantSdk = params.get('sdk') === '1' || (!isLocalHost() && params.get('sdk') !== '0');
  if (wantSdk) {
    const hasGlobal = typeof (window as unknown as { YaGames?: unknown }).YaGames !== 'undefined';
    const ok = hasGlobal || (await loadScript('/sdk.js', 6000));
    if (ok && typeof (window as unknown as { YaGames?: unknown }).YaGames !== 'undefined') {
      try {
        const { YandexPlatform } = await import('./YandexPlatform');
        return await YandexPlatform.create(SAVE_KEYS);
      } catch (err) {
        console.warn('[platform] Yandex SDK не инициализирован, работаем локально', err);
      }
    }
  }
  return new LocalPlatform();
}

export type { Platform };
