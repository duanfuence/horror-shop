import '@fontsource/pt-sans/cyrillic-400.css';
import '@fontsource/pt-sans/cyrillic-700.css';
import '@fontsource/pt-sans/latin-400.css';
import '@fontsource/pt-mono/cyrillic-400.css';
import '@fontsource/pt-mono/latin-400.css';
import '@fontsource/caveat/cyrillic-400.css';
import '@fontsource/caveat/latin-400.css';
import './styles/main.css';

import { AudioEngine } from './audio/AudioEngine';
import { FIRST_SHIFT, SHIFTS } from './content/shifts';
import { EventBus } from './core/EventBus';
import { GameSession } from './core/GameSession';
import { SaveManager } from './core/SaveManager';
import { createGame } from './game/createGame';
import { createPlatform } from './platform';
import { isLocalHostname } from './platform/hosts';
import { UI } from './ui/UI';

async function boot(): Promise<void> {
  const loading = document.getElementById('loading');
  const params = new URLSearchParams(location.search);
  // Режим отладки (?debug=1) работает только при разработке и в локальной сети — не у игроков на платформе.
  const debug = params.has('debug') && (import.meta.env.DEV || isLocalHostname(location.hostname));

  const platform = await createPlatform();
  const save = new SaveManager(platform.storage);
  await save.init();

  const bus = new EventBus();
  const shift = SHIFTS[FIRST_SHIFT];
  // Отладка: ?speed=N ускоряет игровое время в N раз.
  const rawSpeed = Number(params.get('speed') ?? 1);
  // Не больше ×15: шаг кадра в ядре ограничен 250 мс, большее ускорение всё равно не сработает.
  const speed = debug && Number.isFinite(rawSpeed) ? Math.min(15, Math.max(1, rawSpeed)) : 1;
  let session!: GameSession;
  const audio = new AudioEngine(bus, () => session);
  const ui = new UI(bus, save, audio, platform);
  session = new GameSession(shift, bus, ui);
  session.onCheckpoint = (state) => save.saveRun(state);

  document.body.appendChild(ui.app);
  const stageWrap = document.getElementById('stage-wrap')!;
  ui.layout();

  const stage = await createGame({
    parent: ui.stageEl,
    wrap: stageWrap,
    bus,
    session: () => session,
    onHotspot: (id, x, y) => ui.onHotspot(id, x, y),
    onHover: (label, x, y) => ui.onHover(label, x, y),
    onStep: (delta) => session.update(delta * speed),
  });
  ui.attach(session, stage);

  // Пауза при сворачивании вкладки и по запросу платформы — со звуком.
  document.addEventListener('visibilitychange', () => ui.setExternalPause('hidden', document.hidden));
  window.addEventListener('blur', () => ui.setExternalPause('blur', true));
  window.addEventListener('focus', () => ui.setExternalPause('blur', false));
  platform.onPauseChange((paused) => ui.setExternalPause('platform', paused));

  await ui.showMenu();
  loading?.remove();
  platform.gameReady();

  if (debug) {
    (window as unknown as Record<string, unknown>).__ns = { session, ui, bus, save, stage, platform, audio };
  }
}

boot().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Не удалось запустить игру. Обновите страницу.';
});
