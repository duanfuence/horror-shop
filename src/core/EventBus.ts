import type { CharacterId, SfxId, PaperView, LightsMode, DoorState } from './types';

/**
 * Все события, которыми обмениваются ядро, интерфейс, сцена Phaser и звук.
 * Ядро ничего не знает о получателях: оно только сообщает, что произошло.
 */
export interface GameEvents {
  /** Состояние мира изменилось (перерисовать HUD, задачи и т. п.). */
  'state:changed': void;
  /** Прошла игровая минута. */
  'clock:minute': { minutes: number };
  /** Реальное время кадра (мс) — для таймеров интерфейса. Не приходит во время паузы. */
  'tick': { dt: number };
  /** Покупатель появился у прилавка или ушёл (null). */
  'customer': { id: CharacterId; variant: string } | null;
  'sfx': { id: SfxId };
  'lights': { mode: LightsMode };
  'door': { door: 'service'; state: DoorState };
  /** Телефон звонит / перестал звонить. */
  'phone:ring': { line: 1 | 2; ringing: boolean };
  'printer': void;
  'knock': { strength: number };
  /** Короткое ненавязчивое сообщение внизу экрана. */
  'toast': { text: string };
  /** В журнале появилась новая запись — подсветить кнопку журнала. */
  'journal:new': { tab: string };
  'paper': PaperView | null;
  /** Включить/выключить фонарик (только в темноте). */
  'flashlight': { on: boolean };
  /** Подсветить предмет на сцене (обучение). */
  'hint:object': { target: string | null };
  /** Смена закончилась: показать экран результатов. */
  'shift:end': { endingId: string };
  /** Игра поставлена на паузу/снята с паузы (меню, скрытая вкладка, реклама). */
  'pause': { paused: boolean; reason: string };
  /** Персонаж говорит (анимация рта). */
  'speaking': { who: string | null; on: boolean };
  /** Касса: товары на прилавке, пробитый товар, очистка. */
  'sale:items': { items: { key: string; icon: string }[] };
  'sale:scan': { key: string };
  'sale:clear': void;
  /** Текст на дисплее кассы (две строки). */
  'register:display': { top: string; bottom: string } | null;
  /** Камеры открыты/закрыты, выбрана камера. */
  'cctv': { cam: number | null };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<unknown>);
    return () => set!.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(event: K, ...payload: GameEvents[K] extends void ? [] : [GameEvents[K]]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload[0]);
      } catch (err) {
        // Ошибка в одном подписчике не должна ломать игру целиком.
        console.error(`[bus] handler for "${String(event)}" failed`, err);
      }
    }
  }
}
