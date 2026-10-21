/**
 * Общие типы игры. Содержимое смен (сюжет, персонажи, правила) описывается
 * данными этих типов в src/content, а ядро (src/core) их исполняет.
 */

export type CharacterId = string;
export type SpeakerId = string;
export type SceneId = string;
export type ClueId = string;

export type LightsMode = 'normal' | 'flicker' | 'emergency';
export type DoorState = 'closed' | 'open';
export type FlagValue = boolean | number | string;

export type SfxId =
  | 'bell'
  | 'beep'
  | 'beep_error'
  | 'printer'
  | 'cash'
  | 'ring1'
  | 'ring2'
  | 'knock'
  | 'knock_soft'
  | 'click'
  | 'static'
  | 'power_down'
  | 'power_up'
  | 'door_open'
  | 'door_slam'
  | 'wind'
  | 'whisper'
  | 'thermo_beep'
  | 'pickup'
  | 'hangup'
  | 'tear'
  | 'steps'
  | 'sting'
  | 'page'
  | 'drip';

/** Скрытые числовые параметры мира. Игроку напрямую не показываются. */
export interface Stats {
  /** «Внимание той стороны»: растёт от рискованных действий, определяет холод, аномалии и сложность финала. */
  attention: number;
  /** Доверие управляющей (Г. П.). От него зависит, оставят ли игрока на работе. */
  trustManager: number;
  /** Доверие Кости — голоса с внутренней линии. */
  trustKostya: number;
  /** Сколько покупателей проигнорировано. */
  neglect: number;
}
export type StatKey = keyof Stats;

export interface SaleRecord {
  minutes: number;
  customer: CharacterId;
  items: string[];
  total: number;
  outcome: SaleOutcome;
  overridden: boolean;
}

export interface WorldState {
  v: number;
  shiftId: string;
  playerName: string;
  /** Игровые минуты от 00:00. */
  minutes: number;
  stats: Stats;
  flags: Record<string, FlagValue>;
  clues: ClueId[];
  violations: string[];
  /** Сработавшие (или пропущенные) события хронологии — защита от повторного запуска. */
  fired: string[];
  inventory: string[];
  sales: SaleRecord[];
  /** Записанная температура по часам: '0'..'5'. */
  tempLog: Record<string, number>;
  /** Сколько раз игрок включал просмотр камер. */
  camViews: number;
  /** Обходы по камерам: id обхода → номера просмотренных камер. */
  camRounds: Record<string, number[]>;
  cam4On: boolean;
  serviceDoor: DoorState;
  lights: LightsMode;
  /** Записи, появившиеся в журнале (в т. ч. рукописные). */
  journal: string[];
  /** Сработавшие одноразовые триггеры и их последние минуты (для «перезарядки»). */
  triggerLog: Record<string, number>;
  endingId: string | null;
}

export type Cond = (s: WorldState) => boolean;

export interface EffectContext {
  emitToast(text: string): void;
  emitJournal(tab: string): void;
}
export type Effect = (s: WorldState, ctx: EffectContext) => void;

/** Текст может зависеть от состояния (например, имени игрока). Плейсхолдер {name} подставляется автоматически. */
export type Text = string | ((s: WorldState) => string);

export type LineKind = 'speech' | 'narration' | 'phone' | 'voice' | 'system';

export type ChoiceTone = 'normal' | 'danger' | 'insight' | 'quiet';

export interface ChoiceOption {
  text: Text;
  /** Показывать вариант только при выполнении условия. */
  if?: Cond;
  tone?: ChoiceTone;
  /** Вариант исчезает после того, как его выбрали (для «вопросов»), и выбор повторяется. */
  repeatable?: false | 'loop';
  next?: Step[];
}

export interface SaleItemSpec {
  product: string;
  qty?: number;
}

export type SaleOutcome = 'sold' | 'refused' | 'timeout';

export interface SaleResult {
  outcome: SaleOutcome;
  askedName: boolean;
  overridden: boolean;
}

export type Step =
  | { t: 'say'; who: SpeakerId; text: Text; kind?: LineKind }
  | { t: 'narr'; text: Text; kind?: LineKind }
  | {
      t: 'choice';
      prompt?: Text;
      options: ChoiceOption[];
      timer?: { seconds: number; defaultIndex: number };
      /** Как выглядит выбор: обычный диалог, звонок телефона, стук. */
      style?: 'dialog' | 'phone' | 'door';
      /** Повторять выбор, пока не выбран вариант без repeatable:'loop'. */
      loop?: boolean;
    }
  | { t: 'do'; fx: Effect[] }
  | { t: 'if'; cond: Cond; then: Step[]; else?: Step[] }
  | { t: 'enter'; who: CharacterId; variant?: string; bell?: boolean }
  | { t: 'leave'; bell?: boolean }
  | {
      t: 'sale';
      items: SaleItemSpec[];
      patience: number;
      /** Ответ покупателя на вопрос о фамилии (правило 4). */
      nameAnswer?: Text;
      tutorial?: boolean;
      onSold?: Step[];
      onRefused?: Step[];
      onTimeout?: Step[];
      /** Вызывается после продажи с результатом — для учёта нарушений. */
      after?: (s: WorldState, r: SaleResult) => void;
    }
  | { t: 'sfx'; id: SfxId }
  | { t: 'wait'; ms: number }
  | { t: 'paper'; id: string | null }
  | { t: 'ring'; line: 1 | 2; ringing: boolean }
  | { t: 'lights'; mode: LightsMode }
  | { t: 'door'; state: DoorState }
  | { t: 'knock'; strength?: number }
  | { t: 'flashlight'; on: boolean }
  | { t: 'hint'; target: string | null }
  | { t: 'goto'; scene: SceneId }
  | { t: 'end'; ending: string }
  | { t: 'clear' };

/** Событие хронологии: в заданное время (и при условии) запускается сцена. */
export interface Beat {
  id: string;
  /** Время запуска 'HH:MM'. */
  at: string;
  scene: SceneId;
  when?: Cond;
  /** Сколько игровых минут событие может ждать, пока игрок занят другой сценой. */
  window?: number;
  /** Фоновые события не останавливают часы и могут идти параллельно сцене. */
  ambient?: boolean;
}

/** Аномалия, видимая только на камере в определённое окно времени. */
export interface CameraEvent {
  id: string;
  cam: 1 | 2 | 3 | 4;
  from: string;
  to: string;
  when?: Cond;
  /** Что рисует сцена камеры (ключ спрайта/сцены). */
  visual: string;
  /** Срабатывает, когда игрок впервые видит аномалию. */
  onSeen?: Step[];
}

/** Реакция на действие игрока (просмотр камеры, звонок, осмотр и т. п.). */
export interface Trigger {
  id: string;
  on: string;
  when?: Cond;
  /** null — сработать один раз; число — минимальный интервал в игровых минутах. */
  cooldown?: number | null;
  steps: Step[];
  /** Блокирующий триггер запускается как сцена (останавливает часы); иначе эффекты применяются сразу. */
  blocking?: boolean;
}

export interface TaskDef {
  id: string;
  text: Text;
  /** Задача видна, пока выполняется условие. */
  visible: Cond;
  done: Cond;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  /** Иконка (ключ пиксельного рисунка). */
  icon: string;
  inCatalog: boolean;
  alcohol?: boolean;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  /** Описание для «рассмотреть» по вариантам внешности. */
  inspect?: Record<string, { text: Text; fx?: Effect[] }>;
}

export interface SpeakerDef {
  name: Text;
  color: string;
}

export interface PaperDef {
  id: string;
  /** rules — особый документ: памятка с рукописным оборотом (берётся из journal). */
  kind: 'receipt' | 'sms' | 'note' | 'rules';
  text: Text;
}

/** Содержимое рабочего журнала. */
export interface JournalContent {
  rulesTitle: string;
  rules: string[];
  rulesFooter: string;
  /** Рукописный оборот памятки. Строки с entry появляются, когда запись добавлена в state.journal. */
  backside: { text: Text; entry?: string }[];
  regulars: { name: string; note: string; struck?: boolean; pencil?: string }[];
  oldTempPage: { title: string; rows: [string, string][]; footer: string };
  items: Record<string, { name: string; desc: Text }>;
}

export interface PaperView {
  id: string;
  kind: PaperDef['kind'];
  text: string;
}

export interface EndingDef {
  id: string;
  title: string;
  kind: 'good' | 'neutral' | 'bad' | 'secret';
  text: Text;
  hook: Text;
}

export interface ContactDef {
  id: string;
  name: Text;
  number: string;
  visible: Cond;
  scene: (s: WorldState) => SceneId;
}

export interface ClueDef {
  id: ClueId;
  /** Запись игрока в журнале («Заметки»). */
  note: Text;
}

export interface Hotspot {
  id: string;
  label: string;
}

export interface ShiftDef {
  id: string;
  number: number;
  title: string;
  /** Сколько реальных секунд длится игровая минута. */
  secondsPerMinute: number;
  startScene: SceneId;
  scenes: Record<SceneId, Step[]>;
  timeline: Beat[];
  cameraEvents: CameraEvent[];
  triggers: Trigger[];
  tasks: TaskDef[];
  products: Record<string, Product>;
  characters: Record<CharacterId, CharacterDef>;
  speakers: Record<SpeakerId, SpeakerDef>;
  papers: Record<string, PaperDef>;
  clues: Record<ClueId, ClueDef>;
  endings: Record<string, EndingDef>;
  contacts: ContactDef[];
  /** Начальные значения параметров. */
  initialStats: Stats;
  /** Температура в холодильнике в текущий момент. */
  temperature(s: WorldState): number;
  /** Сцена финала, которая гарантированно запускается в 06:00. */
  finalBeat: string;
  journal: JournalContent;
  /**
   * Что видно на камере, исходя из состояния мира (кроме событий cameraEvents):
   * продавец за кассой, покупатель, открытая дверь, фигура на складе и т. п.
   */
  cameraVisuals(cam: 1 | 2 | 3 | 4, s: WorldState, customer: string | null): string[];
  /** Вызывается в конце каждого часа (для учёта невыполненных задач). */
  onHourEnd?(s: WorldState, hour: number, ctx: EffectContext): void;
}
