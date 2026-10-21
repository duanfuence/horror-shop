/**
 * Аномалии на камерах смены 1. Когда им появляться, решает режиссёр тревоги,
 * как развиваться и чем кончаться — src/core/Anomalies.ts. Здесь только данные.
 *
 * Принципы:
 * - аномалия заметна внимательному глазу, но не кричит: смещение, отражение, лишний предмет;
 * - появляется и меняется на той камере, которую игрок сейчас не смотрит;
 * - есть обычные вещи, похожие на странность (собачник на стоянке, покупатель, такси):
 *   их фиксация — ложная тревога с объяснением;
 * - верная фиксация иногда даёт улику; одна из них открывает ответ в сюжетной сцене 03:40;
 * - скрытые параметры меняет только одна пропущенная опасная аномалия (кто-то за спиной);
 * - правило Кости: аномалии склада в тепле зовут смотреть в камеру 4, а на морозе там ждёт
 *   приманка — отпечаток ладони. Смотреть на него можно, но мороз берёт своё.
 */
import { add, clue, custom, effect, fx, narr, sfx } from '../../core/dsl';
import type { AnomalyConfig, AnomalyDef, WorldState } from '../../core/types';
import { temperature } from './threat';

const noCustomer = (s: WorldState) => !s.flags.customer && !s.flags.saleActive;
const warm = (s: WorldState) => temperature(s) >= 1;

/**
 * Окна сюжетных аномалий: в них на той же камере фоновые не появляются,
 * чтобы не спорить с сюжетом (жилет в проходе, человек на стоянке, пустой прилавок).
 */
const STORY_WINDOWS: Record<number, [number, number][]> = {
  1: [[34, 58]],
  2: [[124, 143]],
  3: [[250, 274]],
};
const clearOfStory = (s: WorldState, cam: number, len: number) =>
  (STORY_WINDOWS[cam] ?? []).every(([a, b]) => s.minutes + len < a || s.minutes > b);

export const anomalyDefs: AnomalyDef[] = [
  // ─────────── камера 1: торговый зал ───────────
  {
    id: 'far_figure',
    cams: [1, 2],
    danger: 1,
    categories: ['person'],
    weight: 1,
    from: '00:40',
    to: '04:50',
    duration: 9,
    cooldown: 50,
    max: 2,
    vanishOnSwitch: true,
    when: (s, cam) => clearOfStory(s, cam, 9),
    stages: [{ at: 0, visuals: ['amb_aisle', 'amb_lot'] }],
    report: { text: 'Записано: в кадре неподвижная фигура. На записи она есть. В магазине и у входа — никого.' },
  },
  {
    id: 'floor_shadow',
    cams: [1],
    danger: 2,
    categories: ['person', 'image'],
    weight: 1,
    from: '01:30',
    to: '04:40',
    duration: 12,
    cooldown: 60,
    max: 2,
    when: (s, cam) => noCustomer(s) && clearOfStory(s, cam, 12),
    stages: [{ at: 0, visuals: ['ov:cam1_shadow'] }],
    report: { text: 'Записано: на полу в проходе тень человека. Того, кто её отбрасывает, в зале нет.' },
  },
  {
    id: 'clerk_facing',
    cams: [1],
    danger: 2,
    categories: ['person', 'image'],
    weight: 0.9,
    from: '02:20',
    to: '04:40',
    duration: 8,
    cooldown: 999,
    max: 1,
    when: noCustomer,
    stages: [{ at: 0, visuals: ['clerk_facing'] }],
    report: {
      text: 'Записано: продавец на камере 1 стоит лицом к объективу и смотрит вверх. А вы всё это время смотрели в монитор.',
      steps: [fx(clue('cam1_self'))],
    },
  },
  {
    id: 'fridge_open',
    cams: [1],
    danger: 2,
    categories: ['door', 'object'],
    weight: 1,
    from: '01:00',
    to: '04:30',
    duration: 20,
    cooldown: 999,
    max: 1,
    stages: [
      { at: 0, visuals: ['ov:cam1_fridge1'] },
      { at: 9, visuals: ['ov:cam1_fridge2'], steps: [sfx('thermo_beep')] },
    ],
    report: { text: 'Записано: на камере 1 открыта дверца холодильника. Вы смотрите на холодильник — закрыт. Стекло ледяное.' },
    // Не заметили — холод уже в зале: несколько минут в холодильнике на пару градусов ниже.
    miss: {
      steps: [
        fx(
          custom((s) => {
            s.ambient.dip = { value: 2, until: s.minutes + 8 };
          }),
        ),
        effect('frost_puff'),
      ],
    },
  },

  // ─────────── камера 2: вход и стоянка ───────────
  {
    id: 'truck',
    cams: [2],
    danger: 2,
    categories: ['object'],
    weight: 4,
    from: '03:00',
    to: '03:30',
    until: '03:40',
    duration: 40,
    cooldown: 999,
    max: 1,
    stages: [
      { at: 0, visuals: ['ov:cam2_truck1'] },
      { at: 8, visuals: ['ov:cam2_truck2'] },
    ],
    report: {
      text: 'Записано: на стоянке фургон хлебозавода. В кабине никого. Стекло изнутри белое от инея.',
      steps: [fx(clue('truck_cam'))],
    },
  },
  {
    id: 'dog_walker',
    cams: [2],
    danger: 0,
    categories: ['person'],
    weight: 1.1,
    from: '00:20',
    to: '02:50',
    duration: 10,
    cooldown: 60,
    max: 2,
    when: (s, cam) => clearOfStory(s, cam, 10),
    stages: [
      { at: 0, visuals: ['walker1', 'dog1'] },
      { at: 5, visuals: ['walker2', 'dog2'] },
    ],
    report: { text: 'Мужчина с собакой из пятиэтажки напротив. Ходит здесь каждую ночь. Запись зачёркнута.' },
  },

  // ─────────── камера 3: касса сверху ───────────
  {
    id: 'cam3_clock',
    cams: [3],
    danger: 1,
    categories: ['image'],
    weight: 0.9,
    from: '01:00',
    to: '04:40',
    duration: 15,
    cooldown: 999,
    max: 1,
    stages: [{ at: 0, visuals: ['osd:05:58'] }],
    report: {
      text: 'Записано: часы камеры 3 показывают 05:58. На остальных камерах время правильное.',
      steps: [fx(clue('cam_0558'))],
    },
  },
  {
    id: 'counter_candle',
    cams: [3],
    danger: 2,
    categories: ['object'],
    weight: 1,
    from: '02:30',
    to: '04:45',
    duration: 18,
    cooldown: 999,
    max: 1,
    when: (s, cam) => noCustomer(s) && clearOfStory(s, cam, 18),
    stages: [
      { at: 0, visuals: ['ov:cam3_candle1'] },
      { at: 9, visuals: ['ov:cam3_candle2'] },
    ],
    report: { text: 'Записано: на записи на прилавке свеча и коробок спичек. На настоящем прилавке пусто.' },
    miss: { steps: [narr('Пахнет воском. Откуда?')] },
  },
  {
    id: 'behind_clerk',
    cams: [3],
    danger: 3,
    categories: ['person'],
    weight: 1,
    from: '03:20',
    to: '04:50',
    duration: 10,
    cooldown: 999,
    max: 1,
    when: (s, cam) => (s.stats.attention >= 3 || temperature(s) < 0) && clearOfStory(s, cam, 10),
    stages: [
      { at: 0, visuals: ['behind1'] },
      { at: 5, visuals: ['behind2'] },
    ],
    report: { text: 'Записано: на камере 3 за спиной продавца кто-то стоит. Вы оборачиваетесь. Никого. На записи — тоже.' },
    // Единственная аномалия, которая сама по себе усиливает угрозу, если её не заметить.
    miss: { steps: [fx(add('attention', 1)), effect('chill'), narr('Холодок по шее. Как будто кто-то только что отошёл от вас.')] },
  },

  // ─────────── камера 4: склад ───────────
  {
    id: 'extra_box',
    cams: [4],
    danger: 1,
    categories: ['object'],
    weight: 1,
    from: '00:50',
    to: '04:20',
    duration: 24,
    cooldown: 999,
    max: 1,
    when: warm,
    stages: [
      { at: 0, visuals: ['ov:cam4_box1'] },
      { at: 8, visuals: ['ov:cam4_box2'] },
      { at: 16, visuals: ['ov:cam4_box3'], steps: [sfx('thud')] },
    ],
    report: { text: 'Записано: на складе лишняя коробка. Её никто не заносил — склад заперт с вечера.' },
    miss: { trace: ['ov:cam4_box3'] },
  },
  {
    id: 'chair_moved',
    cams: [4],
    danger: 2,
    categories: ['object'],
    weight: 1,
    from: '01:30',
    to: '04:20',
    duration: 22,
    cooldown: 999,
    max: 1,
    when: warm,
    stages: [
      { at: 0, visuals: ['base:cam4_chair_door'] },
      { at: 11, visuals: ['base:cam4_chair_facing'] },
    ],
    report: { text: 'Записано: стул с курткой на складе стоит не на своём месте. Его три года никто не трогал.' },
    miss: { trace: ['base:cam4_chair_facing'] },
  },
  {
    id: 'door_ghost',
    cams: [4],
    danger: 2,
    categories: ['door'],
    weight: 1,
    from: '01:00',
    to: '04:20',
    duration: 14,
    cooldown: 999,
    max: 1,
    // Не рядом со стуком в 03:40, чтобы не спорить с сюжетом.
    when: (s) => warm(s) && s.serviceDoor === 'closed' && (s.minutes < 192 || s.minutes > 232),
    stages: [
      { at: 0, visuals: ['door_open'] },
      { at: 7, visuals: ['door_open', 'door_figure'], steps: [sfx('knock_soft')] },
    ],
    report: { text: 'Записано: на камере 4 служебная дверь открыта. Вы смотрите на неё из зала — закрыта, ключ в замке.' },
  },
  {
    id: 'lens_frost',
    cams: [4],
    danger: 3,
    categories: ['image'],
    weight: 1.2,
    from: '02:00',
    to: '04:50',
    duration: 10,
    cooldown: 999,
    max: 1,
    // Приманка для тех, кто смотрит в четвёртую на морозе. Сам взгляд уже стоит «внимания».
    when: (s) => temperature(s) < 0,
    stages: [{ at: 0, visuals: ['frost', 'ov:cam4_hand'] }],
    report: {
      text: 'Записано: на объективе камеры 4 отпечаток ладони в инее. С той стороны стекла.',
      steps: [fx(clue('cam4_hand'))],
    },
  },
];

const strangeFigure = 'Записано: на складе стоит человек. Склад заперт.';

export const anomalies: AnomalyConfig = {
  defs: anomalyDefs,
  maxActive: 2,
  rate: (s) => {
    const h = s.minutes / 60;
    return Math.max(0, Math.min(0.3, 0.09 + h * 0.02 + Math.min(6, s.stats.attention) * 0.01));
  },
  gap: [6, 12],
  firstAt: '00:30',
  lastAt: '04:50',
  reportCooldown: { correct: 2, wrong: 5 },
  reportables: {
    // сюжетные странности засчитываются, но наград сверх сюжетных не дают
    vest_figure: { kind: 'strange', categories: ['person'], text: 'Записано: в проходе на камере 1 человек в такой же жилетке, как у вас.' },
    grey_parking: { kind: 'strange', categories: ['person'], text: 'Записано: на стоянке под фонарём человек в сером пальто. Смотрит на магазин.' },
    no_clerk: { kind: 'strange', categories: ['image', 'person'], text: 'Записано: на камере 3 за прилавком никого. А вы — здесь.' },
    waving: { kind: 'strange', categories: ['person'], text: 'Записано: у объектива камеры 4 кто-то машет рукой.' },
    figure1: { kind: 'strange', categories: ['person'], text: strangeFigure },
    figure2: { kind: 'strange', categories: ['person'], text: strangeFigure },
    figure3: { kind: 'strange', categories: ['person'], text: 'Записано: под камерой 4 стоит человек и смотрит вверх.' },
    relief_aisle: { kind: 'strange', categories: ['person'], text: 'Записано: между стеллажами стоит человек в жилетке.' },
    frost: { kind: 'strange', categories: ['image'], text: 'Записано: объектив камеры 4 затянуло инеем. Изнутри.' },
    // обычные вещи
    clerk: { kind: 'mundane', categories: ['person'], text: 'Продавец за кассой — это вы. На записи все выглядят чужими.' },
    'customer:*': { kind: 'mundane', categories: ['person'], text: 'Покупатель у кассы. Он и в зале стоит. Ничего странного.' },
    taxi: { kind: 'mundane', categories: ['object', 'person'], text: 'Такси Рустама. Приехал, как обещал.' },
    door_open: { kind: 'mundane', categories: ['door'], text: 'Служебная дверь и правда открыта. Её открыли отсюда.' },
  },
  falseTexts: [
    'Вы перематываете запись на минуту назад. Ничего необычного.',
    'Вы всматриваетесь в кадр. Всё на своих местах. Кажется.',
    'Запись как запись. Может, показалось. Строчка зачёркнута.',
    'Ничего такого на этой камере нет.',
  ],
};
