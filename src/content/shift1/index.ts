/**
 * Смена 1 «Пятнадцатое ноября»: хронология, реакции на действия игрока,
 * задачи, концовки и правила вычисления температуры.
 */
import { add, clue, door, fx, hasItem, hint, narr, set, violate, when } from '../../core/dsl';
import type { Beat, CameraEvent, ContactDef, EndingDef, ShiftDef, TaskDef, Trigger, WorldState } from '../../core/types';
import { ambient } from './ambient';
import { anomalies } from './anomalies';
import { scenes } from './scenes';
import { cold, dread, temperature } from './threat';
import { characters, clues, journal, papers, products, speakers } from './world';

const hourOf = (s: WorldState) => Math.floor(s.minutes / 60);

/**
 * Хронология. jitter — допустимый сдвиг некритичных событий (выбирается по seed прохождения):
 * ночь от раза к разу звучит иначе, а обучение, стук в 03:40 и весь финал стоят на месте.
 */
const timeline: Beat[] = [
  { id: 'courier', at: '00:04', scene: 'courier' },
  { id: 'rustam', at: '00:16', scene: 'rustam', jitter: [-3, 3] },
  { id: 'bell', at: '00:26', scene: 'bell_nobody', ambient: true, jitter: [-4, 4] },
  { id: 'grey1', at: '00:33', scene: 'grey1', jitter: [-3, 4] },
  { id: 'h1', at: '01:00', scene: 'hour_tick', ambient: true },
  { id: 'liza', at: '01:05', scene: 'liza', jitter: [-4, 4] },
  { id: 'receipt', at: '01:26', scene: 'receipt_phantom', jitter: [-8, 8] },
  { id: 'misha', at: '01:42', scene: 'misha', jitter: [-5, 5] },
  { id: 'h2', at: '02:00', scene: 'hour_tick_round', ambient: true },
  { id: 'gp_call', at: '02:02', scene: 'gp_call', jitter: [0, 4] },
  { id: 'grey2', at: '02:22', scene: 'grey2', jitter: [0, 5] },
  { id: 'line2', at: '02:44', scene: 'line2_single', jitter: [-6, 6] },
  { id: 'h3', at: '03:00', scene: 'relay_click', ambient: true },
  { id: 'kostya1', at: '03:08', scene: 'kostya_call1', jitter: [-2, 2] },
  { id: 'kostya_note', at: '03:10', scene: 'kostya_note_hint', ambient: true, when: (s) => !!s.flags.kostyaIgnored },
  { id: 'order', at: '03:20', scene: 'fake_order', jitter: [-3, 3] },
  { id: 'liza2', at: '03:29', scene: 'liza_return', when: (s) => !!s.flags.lizaOk && !s.flags.lizaCold, window: 10, jitter: [-3, 3] },
  { id: 'delivery', at: '03:40', scene: 'delivery', window: 40 },
  { id: 'h4', at: '04:00', scene: 'hour_tick_round', ambient: true },
  { id: 'kostya2', at: '04:06', scene: 'kostya_call2', when: (s) => !!s.flags.kostyaCall1, jitter: [-3, 4] },
  { id: 'grey3', at: '04:36', scene: 'grey3', window: 20, jitter: [-4, 4] },
  { id: 'blackout', at: '05:00', scene: 'blackout', window: 60 },
  { id: 'climax_line', at: '05:06', scene: 'climax_line', when: (s) => !!s.flags.kostyaCall1 && !!s.flags.blackout, window: 10 },
  { id: 'fusebox', at: '05:12', scene: 'climax_fusebox', when: (s) => !!s.flags.blackout, window: 12 },
  { id: 'knock', at: '05:20', scene: 'climax_knock', when: (s) => !!s.flags.blackout, window: 10 },
  { id: 'relief', at: '05:30', scene: 'relief', when: (s) => !!s.flags.blackout, window: 20 },
  { id: 'relief2', at: '05:46', scene: 'relief_again', when: (s) => !!s.flags.reliefWaiting, window: 8 },
  {
    id: 'lastreceipt',
    at: '05:58',
    scene: 'last_receipt',
    when: (s) => !!s.flags.greyCompleted && !s.flags.greyDismissed,
    window: 2,
  },
  { id: 'morning', at: '06:00', scene: 'morning', window: 100000 },
];

/** Аномалии, которые видно только на камерах. Награда за внимательность — и приманка для тех, кто смотрит слишком часто. */
const cameraEvents: CameraEvent[] = [
  {
    id: 'vest',
    cam: 1,
    from: '00:38',
    to: '00:56',
    when: (s) => s.camViews >= 2,
    visual: 'vest_figure',
    onSeen: [
      narr('В проходе между стеллажами кто-то стоит. В такой же зелёной жилетке, как у вас.'),
      fx(clue('vest_cam1'), add('attention', 1), set('vestSeen')),
    ],
  },
  {
    id: 'grey_parking',
    cam: 2,
    from: '02:08',
    to: '02:21',
    visual: 'grey_parking',
    onSeen: [
      narr('На стоянке под фонарём стоит человек в сером пальто. Смотрит на магазин. Не двигается.'),
      fx(clue('grey_parking')),
      when((s) => s.camViews >= 6, [narr('Он медленно поднимает голову. Прямо в камеру.'), fx(add('attention', 1))]),
    ],
  },
  {
    id: 'empty_counter',
    cam: 3,
    from: '04:12',
    to: '04:32',
    visual: 'no_clerk',
    onSeen: [
      narr('Камера над кассой. Прилавок, касса, журнал. За прилавком — никого. Но вы же здесь.'),
      fx(clue('cam3_empty'), add('attention', 1)),
    ],
  },
  {
    id: 'waving',
    cam: 4,
    from: '03:08',
    to: '03:40',
    when: (s) => !!s.flags.kostyaLook4 && s.cam4On,
    visual: 'waving',
    onSeen: [
      narr('У самого объектива кто-то стоит и медленно машет рукой. Как будто прощается.'),
      fx(clue('cam4_kostya')),
    ],
  },
];

const triggers: Trigger[] = [
  {
    id: 'bell_cam',
    on: 'camera:2',
    when: (s) => !!s.flags.bellNobody && s.minutes <= 40,
    steps: [narr('У входа никого. По асфальту катится пустой пакет.')],
  },
  {
    id: 'dry_street',
    on: 'camera:2',
    when: (s) => s.flags.customer === 'grey:v2',
    steps: [narr('На камере у входа асфальт сухой. Ни лужицы.'), fx(clue('dry_street'))],
  },
  {
    id: 'vest_follow',
    on: 'cameras:close',
    when: (s) => !!s.flags.vestSeen && !s.flags.vestFollow,
    steps: [narr('Вы поднимаете глаза от монитора. В проходе никого.'), fx(set('vestFollow'))],
  },
  {
    id: 'cam4_cold',
    on: 'camera:4',
    when: (s) => cold(s) && s.cam4On && !s.flags.blackout,
    cooldown: 12,
    steps: [
      fx(add('attention', 1), (s) => {
        s.flags.cam4Cold = Number(s.flags.cam4Cold ?? 0) + 1;
      }),
      when(
        (s) => Number(s.flags.cam4Cold) === 1,
        [narr('На складе кто-то стоит. Далеко, у стеллажей. Помехи съедают лицо.')],
        [
          when(
            (s) => Number(s.flags.cam4Cold) === 2,
            [narr('Фигура на складе ближе, чем в прошлый раз.')],
            [narr('Он стоит прямо под камерой. Смотрит вверх. На вас.')],
          ),
        ],
      ),
    ],
  },
  {
    id: 'cam4_off',
    on: 'cam4:off',
    cooldown: 0,
    steps: [
      fx(violate('cam4_off'), set('cam4WasOff'), add('attention', 2), (s) => {
        if (!s.flags.cam4PenaltyApplied) {
          s.stats.trustManager -= 2;
          s.flags.cam4PenaltyApplied = true;
        }
      }),
      narr('Экран камеры 4 гаснет. Где-то за служебной дверью что-то с грохотом падает.'),
    ],
  },
  { id: 'cam4_on', on: 'cam4:on', cooldown: 0, steps: [narr('Камера 4 снова показывает склад.')] },
  { id: 'fridge_hint_off', on: 'fridge:record', cooldown: 0, steps: [hint(null)] },
  {
    id: 'fridge_cold',
    on: 'fridge:record',
    when: cold,
    steps: [narr('Минус. Холодильник гудит как обычно — а внутри мороз. Бутылки с водой помутнели.')],
  },
  {
    id: 'photo',
    on: 'inspect:photo',
    cooldown: 0,
    steps: [
      narr('«Сотрудник месяца — октябрь 2022. Ершов К.» Парень в зелёной жилетке улыбается так, будто знает что-то смешное.'),
      fx(clue('kostya_photo')),
    ],
  },
  {
    id: 'calendar',
    on: 'inspect:calendar',
    cooldown: 0,
    steps: [narr('Календарь за 2022 год. Его так и не сменили. Ноябрь. Пятнадцатое обведено ручкой.')],
  },
  {
    id: 'window_early',
    on: 'inspect:window',
    cooldown: 0,
    when: (s) => s.minutes < 120,
    steps: [narr('Стоянка пустая. Фонарь гудит и иногда моргает. Дальше — тёмные пятиэтажки.')],
  },
  {
    id: 'window_late',
    on: 'inspect:window',
    cooldown: 0,
    when: (s) => s.minutes >= 120 && !s.flags.blackout,
    steps: [narr('Стоянка пустая. От фонаря к двери магазина тянется цепочка мокрых следов. Дождя не было.')],
  },
  {
    id: 'window_dark',
    on: 'inspect:window',
    cooldown: 0,
    when: (s) => !!s.flags.blackout,
    steps: [narr('Фонарь на стоянке горит. Дома напротив светятся окнами. Тёмный только «Колосок».')],
  },
  {
    id: 'door_listen_early',
    on: 'door:listen',
    cooldown: 0,
    when: (s) => s.minutes < 180,
    steps: [narr('За дверью тихо. Гудит холодильная камера.')],
  },
  {
    id: 'door_listen_late',
    on: 'door:listen',
    cooldown: 0,
    when: (s) => s.minutes >= 180,
    steps: [narr('За дверью тишина. Слишком ровная. Как будто кто-то по ту сторону тоже прислушивается.')],
  },
  { id: 'door_open', on: 'door:open', cooldown: 0, blocking: true, steps: scenes.door_open_free },
  {
    id: 'door_close',
    on: 'door:close',
    cooldown: 0,
    when: (s) => s.serviceDoor === 'open',
    steps: [door('closed'), fx(set('doorLeftOpen', false)), narr('Вы закрываете служебную дверь и поворачиваете ключ.')],
  },
  {
    id: 'old_page',
    on: 'journal:old',
    steps: [fx(clue('temp_2022'))],
  },
  {
    id: 'kostya_note',
    on: 'journal:back',
    when: (s) => s.journal.includes('kostya_why'),
    steps: [narr('На обороте — новая строчка. Чернила ещё не высохли.'), fx(clue('kostya_note'))],
  },
  {
    id: 'register',
    on: 'inspect:register',
    cooldown: 0,
    steps: [narr('Касса «Меркурий». Лента заправлена. Под прилавком — ящик с разменом и фонарик.')],
  },
];

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

const tasks: TaskDef[] = [
  ...[0, 1, 2, 3, 4, 5].map(
    (h): TaskDef => ({
      id: `temp${h}`,
      text: `Записать температуру холодильника (${hh(h)})`,
      visible: (s) => !!s.flags.rulesAccepted && hourOf(s) === h && s.minutes < 360,
      done: (s) => s.tempLog[String(h)] !== undefined,
    }),
  ),
  ...[2, 4].map(
    (h): TaskDef => ({
      id: `round${h}`,
      text: (s) => `Обход: просмотреть камеры 1–4 (${(s.camRounds[String(h)] ?? []).length}/4)`,
      visible: (s) => hourOf(s) === h,
      done: (s) => (s.camRounds[String(h)] ?? []).length >= 4,
    }),
  ),
  {
    id: 'serve',
    text: 'Обслужить покупателя',
    visible: (s) => !!s.flags.saleActive,
    done: () => false,
  },
  {
    id: 'order',
    text: 'Служебка: «в 03:40 открыть служебную дверь»?',
    visible: (s) => !!s.flags.orderPrinted && !s.flags.deliveryResolved,
    done: () => false,
  },
  {
    id: 'door_open',
    text: 'Служебная дверь открыта',
    visible: (s) => s.serviceDoor === 'open' && !s.flags.blackout,
    done: () => false,
  },
  {
    id: 'survive',
    text: 'Дождаться 06:00',
    visible: (s) => !!s.flags.blackout,
    done: (s) => s.minutes >= 360,
  },
];

const contacts: ContactDef[] = [
  {
    id: 'gp',
    name: 'Галина Петровна (управляющая)',
    number: '8 (9••) •••-12-07',
    visible: () => true,
    scene: (s) => {
      if (s.flags.blackout) return s.flags.gpKnowsBlackout ? 'call_gp_noanswer' : 'call_gp_home';
      if (s.flags.orderPrinted && !s.flags.deliveryResolved && !s.flags.gpVerified) return 'call_gp_verify';
      if (s.flags.gpCalledIdle) return 'call_gp_noanswer';
      return 'call_gp_idle';
    },
  },
  {
    id: 'rustam',
    name: 'Такси «Рустам»',
    number: '8 (9••) •••-40-40',
    visible: hasItem('rustam_card'),
    scene: (s) => {
      if (s.flags.blackout && !s.flags.rustamComing) return 'call_rustam_blackout';
      if (s.flags.rustamCalled) return 'call_rustam_again';
      return 'call_rustam';
    },
  },
  {
    id: 'police',
    name: 'Полиция',
    number: '102',
    visible: () => true,
    scene: (s) => (s.flags.policeCalled ? 'call_police_again' : 'call_police'),
  },
  {
    id: 'line2',
    name: 'Склад (внутренний)',
    number: 'Линия 2',
    visible: () => true,
    scene: () => 'call_line2',
  },
];

const endings: Record<string, EndingDef> = {
  morning: {
    id: 'morning',
    title: 'Утро',
    kind: 'good',
    text: (s) =>
      'Галина Петровна пересчитывает кассу, не глядя на вас. За окном серый ноябрьский рассвет. ' +
      'На стоянке под погасшим фонарём лежит мокрый серый зонт.' +
      (s.flags.rustamComing ? ' У входа сигналит такси. Рустам опускает стекло: «Смена всё? Садись, довезу».' : '') +
      (s.flags.gpConfessed ? ' Уже в дверях Галина Петровна говорит вам в спину: «Если он позвонит снова — скажи, что я жду».' : '') +
      (s.flags.gpTookTape ? ' Кассету с ночной записью она так и не вернула в видеомагнитофон.' : ''),
    hook: (s) =>
      `В кармане куртки шуршит бумага. Кассовый чек: 15.11.25, 05:58. Свеча, спички, батарейки. Кассир — ${s.playerName}.`,
  },
  fired: {
    id: 'fired',
    title: 'Последняя смена',
    kind: 'neutral',
    text:
      '«Ключи на стол». Галина Петровна говорит это без злости — устало, как человек, который повторял это много раз. ' +
      'Уже в дверях вы слышите, как она снимает трубку внутреннего телефона. Линии 2. И тихо говорит в неё: «Нет. Опять не тот».',
    hook: 'Кому она звонит по линии, на которую запрещено отвечать?',
  },
  swap: {
    id: 'swap',
    title: 'Подмена',
    kind: 'bad',
    text:
      'На улице тихо. Небо не светлеет. Часы на телефоне показывают 05:58. Через минуту — снова 05:58. ' +
      'Вы оборачиваетесь: за стеклом «Колоска» горит свет, и за кассой кто-то стоит. В зелёной жилетке. С вашим лицом.',
    hook: 'Где-то в магазине звонит внутренний телефон. Три раза подряд. Теперь — вам.',
  },
  door: {
    id: 'door',
    title: 'Открытая дверь',
    kind: 'bad',
    text:
      'Утром Галина Петровна найдёт магазин открытым, кассу — нетронутой, а куртку — на стуле. ' +
      'На записи камеры № 4 будет видно, как в 05:58 у щитка кто-то стоит. Лицом к стене.',
    hook: 'К обеду на двери «Колоска» появится объявление: «Требуется ночной продавец».',
  },
  lastsale: {
    id: 'lastsale',
    title: 'Последний покупатель',
    kind: 'bad',
    text:
      'Свет не возвращается — ни в шесть, ни в семь. Утром Галина Петровна найдёт за кассой только ровную стопку чеков. ' +
      'Все — от 15 ноября. Все — на 05:58.',
    hook: (s) => `Кассир на всех чеках — ${s.playerName}.`,
  },
  released: {
    id: 'released',
    title: 'Запись в журнале',
    kind: 'secret',
    text:
      'Линия 2 молчит. Впервые за три года. Галина Петровна долго сидит на ящике с водой, прижимая журнал к груди. ' +
      'Потом встаёт, снимает со стены фото «Сотрудник месяца» и убирает в сумку. «Завтра в полночь», — говорит она. ' +
      'И впервые добавляет: «Пожалуйста».',
    hook: 'Но если Костя ушёл со склада — кто теперь остался там вместо него?',
  },
};

function cameraVisuals(cam: 1 | 2 | 3 | 4, s: WorldState, customer: string | null): string[] {
  const v: string[] = [];
  const dark = !!s.flags.blackout;
  if (dark) v.push('dark');
  if (cam === 1) {
    v.push('clerk');
    if (customer) v.push(`customer:${customer}`);
    if (s.flags.reliefWaiting) v.push('relief_aisle');
  }
  if (cam === 2) {
    if (s.flags.rustamComing && s.minutes >= 350) v.push('taxi');
  }
  if (cam === 3) {
    v.push('clerk');
    if (customer && customer !== 'relief') v.push(`customer:${customer}`);
  }
  if (cam === 4) {
    if (!s.cam4On) return ['off'];
    if (s.serviceDoor === 'open') v.push('door_open');
    if (cold(s)) {
      v.push('frost');
      const stage = Number(s.flags.cam4Cold ?? 0);
      if (stage > 0 && !dark) v.push(`figure${Math.min(3, stage)}`);
    }
    if (dark && !s.flags.reliefWaiting && s.minutes < 330) v.push('figure2');
  }
  return v;
}

export const shift1: ShiftDef = {
  id: 'shift1',
  number: 1,
  title: 'Смена 1. Пятнадцатое ноября',
  secondsPerMinute: 1.3,
  startScene: 'intro',
  scenes,
  timeline,
  cameraEvents,
  triggers,
  tasks,
  products,
  characters,
  speakers,
  papers,
  clues,
  endings,
  contacts,
  journal,
  initialStats: { attention: 0, trustManager: 6, trustKostya: 0, neglect: 0 },
  temperature,
  dread,
  ambient,
  anomalies,
  finalBeat: 'morning',
  cameraVisuals,
  onHourEnd(s, hour, ctx) {
    if (hour < 0 || hour > 5) return;
    if (s.tempLog[String(hour)] === undefined) {
      s.flags.tempMissed = Number(s.flags.tempMissed ?? 0) + 1;
      if (!s.violations.includes('temp_log')) s.violations.push('temp_log');
      ctx.emitToast(`${hh(hour)} — температура не записана.`);
    }
    if ((hour === 2 || hour === 4) && (s.camRounds[String(hour)] ?? []).length < 4) {
      s.flags.roundsMissed = Number(s.flags.roundsMissed ?? 0) + 1;
    }
    if (!s.cam4On) s.stats.attention += 1;
  },
};

