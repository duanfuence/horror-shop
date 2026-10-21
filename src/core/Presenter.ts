import type { ChoiceTone, LineKind, SaleResult } from './types';

/**
 * Presenter — всё, что ядру нужно от интерфейса. В браузере его реализует DOM-интерфейс,
 * в тестах — «бот», который мгновенно отвечает. Благодаря этому сюжет можно прогонять
 * автоматически и проверять, что любая ветка доходит до конца смены.
 */

export interface LineRequest {
  speaker: string | null;
  speakerName: string | null;
  color: string | null;
  text: string;
  kind: LineKind;
}

export interface ChoiceRequest {
  prompt: string | null;
  options: { text: string; tone: ChoiceTone }[];
  timer: { seconds: number; defaultIndex: number } | null;
  style: 'dialog' | 'phone' | 'door';
}

export interface SaleItemView {
  key: string;
  productId: string;
  name: string;
  price: number;
  icon: string;
  inCatalog: boolean;
  alcohol: boolean;
}

export interface SaleRequest {
  customerId: string;
  customerName: string;
  items: SaleItemView[];
  patienceSec: number;
  nameAnswer: string | null;
  tutorial: boolean;
}

export interface Presenter {
  /** Показать реплику; промис завершается, когда игрок её пролистал. */
  line(req: LineRequest): Promise<void>;
  /** Показать выбор; возвращает индекс выбранного варианта. */
  choose(req: ChoiceRequest): Promise<number>;
  /** Мини-игра кассы. */
  sale(req: SaleRequest): Promise<SaleResult>;
  /** Пауза в реальном времени (учитывает паузу игры). */
  wait(ms: number): Promise<void>;
  /** Сцена закончилась: убрать диалоговую панель. */
  dialogEnd(): void;
  /** Сцена началась. */
  dialogStart(): void;
}
