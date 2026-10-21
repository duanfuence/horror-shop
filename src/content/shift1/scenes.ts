/**
 * Сцены первой смены. Каждая сцена — список шагов (см. src/core/dsl.ts).
 * Все реплики, обращённые к игроку, написаны без указания рода.
 */
import {
  add,
  after,
  all,
  any,
  before,
  choice,
  clear,
  clue,
  door,
  doorOpen,
  end,
  enter,
  flag,
  flashlight,
  fx,
  give,
  goto,
  hasClue,
  hasItem,
  hint,
  journal,
  knock,
  leave,
  lights,
  narr,
  not,
  opt,
  paper,
  phone,
  ring,
  sale,
  say,
  set,
  sfx,
  stat,
  sys,
  take,
  unset,
  violate,
  voice,
  wait,
  when,
} from '../../core/dsl';
import { formatTime } from '../../core/state';
import type { SaleResult, Step, WorldState } from '../../core/types';

/** Обычный покупатель: отказ без причины и игнорирование портят репутацию. */
function normalAfter(s: WorldState, r: SaleResult): void {
  if (r.outcome === 'refused') {
    s.stats.trustManager -= 1;
    s.flags.refusedNormal = true;
  }
  if (r.outcome === 'timeout') {
    s.stats.neglect += 1;
    s.stats.trustManager -= 1;
  }
}

/** Серьёзные нарушения: два любых — увольнение, как бы хорошо ни прошла остальная смена. */
export const SERIOUS_VIOLATIONS = ['alcohol', 'door_open', 'cam4_off'];
export const seriousViolations = (s: WorldState): number =>
  s.violations.filter((v) => SERIOUS_VIOLATIONS.includes(v)).length;

function pushViolation(s: WorldState, id: string): void {
  if (!s.violations.includes(id)) s.violations.push(id);
}

const tripleRing = (line: 1 | 2): Step[] => [
  ring(line, true),
  sfx('ring2'),
  wait(1300),
  sfx('ring2'),
  wait(1300),
  sfx('ring2'),
];

const releaseReady = (s: WorldState): boolean =>
  Boolean(s.flags.kostyaCall1) &&
  Boolean(s.flags.kostyaCall2) &&
  s.stats.trustKostya >= 3 &&
  s.clues.length >= 7 &&
  s.cam4On &&
  !s.flags.cam4WasOff &&
  !s.flags.doorOpened;

export const scenes: Record<string, Step[]> = {
  // ═════════════ 00:00 — начало ═════════════
  intro: [
    paper('sms'),
    narr('Продукты 24 «Колосок». Окраина Тихоборска. Ночь с 14 на 15 ноября.'),
    narr('Гудят холодильники. За стеклом — пустая стоянка и один фонарь.'),
    paper('rules'),
    narr('На стойке — заламинированная памятка. На обороте кто-то писал ручкой.'),
    choice([opt('Принять смену', [fx(set('rulesAccepted'), give('keys'))])], {
      prompt: 'Памятку можно перечитать в журнале в любой момент.',
    }),
    paper(null),
    sys('Нажимайте на предметы: холодильник, телефон, монитор камер, журнал, служебную дверь. На покупателя — чтобы рассмотреть.'),
    sys('Первое дело — записать температуру холодильника № 2. Он справа, у стены.'),
    hint('fridge'),
  ],

  hour_tick: [
    sfx('thermo_beep'),
    narr((s) => `${formatTime(s.minutes)}. Пора записать температуру.`),
    hint('fridge'),
  ],

  hour_tick_round: [
    sfx('thermo_beep'),
    narr((s) => `${formatTime(s.minutes)}. Температура — и обход по всем четырём камерам.`),
    hint('fridge'),
  ],

  // ═════════════ 00:04 — курьер (обучение кассе) ═════════════
  courier: [
    enter('courier'),
    say('courier', 'Здрасьте. Мне вот это… и жвачку.'),
    sys('Нажимайте на товары, чтобы пробить их. Затем — «Продать».'),
    sale({
      items: ['energy', 'gum'],
      patience: 120,
      tutorial: true,
      sold: [
        say('courier', 'Спасибо. Говорят, ночка будет тихая.'),
        say('courier', 'Хотя у вас тут всегда тихо. Даже слишком.'),
        leave(),
      ],
      refused: [say('courier', 'Э-э… Ладно. На заправке возьму.'), leave()],
      timeout: [say('courier', 'Алло, я тут вообще-то… Ладно, проехали.'), leave()],
      after: normalAfter,
    }),
    sys('Монитор слева — камеры наблюдения. Журнал на прилавке — памятка, каталог и записи.'),
  ],

  // ═════════════ 00:16 — Рустам ═════════════
  rustam: [
    enter('rustam'),
    say('rustam', 'О, новое лицо. Доброй ночи.'),
    say('rustam', 'Два кофе, как обычно… А, ты ж не знаешь, как обычно. Два «три в одном» и «Стрелу».'),
    sale({
      items: [{ product: 'coffee', qty: 2 }, 'cigs'],
      patience: 60,
      sold: [
        say('rustam', 'Первая смена?'),
        choice([
          opt('Да, первая.', [
            say('rustam', 'Первая — самая длинная. Я Рустам, таксую по ночам. Вот визитка — если что, звони.'),
            fx(give('rustam_card'), set('rustamFriendly'), set('heardKostya')),
            say('rustam', 'Прошлый ваш, Костя, тоже первое время всё в монитор смотрел. Потом уволился. Ну, так говорят.'),
            choice([
              opt(
                'Что значит «так говорят»?',
                [
                  say(
                    'rustam',
                    'Я его в шесть утра забирать должен был. Приехал — магазин открыт, касса открыта, куртка на стуле. А его нет.',
                  ),
                  say('rustam', 'Галина сказала — уволился. Ну, ей виднее.'),
                  fx(clue('rustam_kostya')),
                ],
                { tone: 'insight' },
              ),
              opt('Понятно. Хорошей дороги.', [say('rustam', 'И тебе спокойной.')]),
            ]),
          ]),
          opt('Без комментариев.', [say('rustam', 'Понял, не мешаю.'), fx(set('rustamCold'))], { tone: 'quiet' }),
        ]),
        leave(),
      ],
      refused: [say('rustam', 'Серьёзно? Ну, бывает. На заправке возьму.'), leave()],
      timeout: [say('rustam', 'Ладно, на заправке возьму. Удачи.'), leave()],
      after: normalAfter,
    }),
  ],

  // ═════════════ 00:26 — первая странность (её легко списать на случайность) ═════════════
  bell_nobody: [
    sfx('bell'),
    narr('Над дверью звякнул колокольчик. Дверь закрыта. Сквозняк?'),
    fx(set('bellNobody')),
  ],

  // ═════════════ 00:33 — мужчина в сером, первый визит ═════════════
  grey1: [
    enter('grey', 'v1'),
    say('grey', 'Доброй ночи.'),
    say('grey', 'Хлеб и молоко, пожалуйста.'),
    sale({
      items: ['bread', 'milk'],
      patience: 60,
      sold: [say('grey', 'Тут всегда так тихо в это время.'), say('grey', 'Потом будет шумнее.'), leave()],
      refused: [say('grey', 'Понимаю. Я зайду позже.'), leave()],
      timeout: [say('grey', 'Я зайду позже. Я всегда захожу.'), leave()],
      after: (s, r) => {
        if (r.outcome === 'timeout') s.stats.neglect += 1;
      },
    }),
  ],

  // ═════════════ 01:05 — Лиза ═════════════
  liza: [
    enter('liza'),
    say('liza', 'Ой, здрасьте. А Кости нет?.. А, вы вместо него. Понятно.'),
    fx(set('heardKostya')),
    sale({
      items: ['noodles', 'energy', 'plaster'],
      patience: 50,
      sold: [
        choice([
          opt('Поздно со смены?', [
            say('liza', 'С практики. В больнице, в ночную. Ваш магазин — единственное место на улице, где горит свет.'),
            fx(set('lizaOk')),
            choice([
              opt(
                'Вы знали Костю?',
                [
                  say('liza', 'Немножко. Он всё время смотрел в монитор.'),
                  say(
                    'liza',
                    'Один раз я шла мимо чёрного хода и видела его в окне склада. А когда зашла — он стоял за кассой.',
                  ),
                  say('liza', 'Ну, мне показалось. Я тогда сутки не спала.'),
                  fx(clue('liza_window')),
                ],
                { tone: 'insight' },
              ),
              opt('Берегите себя.', [say('liza', 'Вы тоже. Спокойной ночи!')]),
            ]),
          ]),
          opt('Спокойной ночи.', [say('liza', 'И вам.'), fx(set('lizaOk'))]),
          opt('(Молча отдать сдачу)', [say('liza', '…Ладно. Спасибо.'), fx(set('lizaCold'))], { tone: 'quiet' }),
        ]),
        leave(),
      ],
      refused: [say('liza', 'Что? Почему?.. Ладно.'), fx(set('lizaCold')), leave()],
      timeout: [say('liza', 'Эм… Я, наверное, пойду.'), fx(set('lizaCold')), leave()],
      after: normalAfter,
    }),
  ],

  // ═════════════ 01:26 — касса печатает чек сама ═════════════
  receipt_phantom: [
    sfx('printer'),
    narr('Касса вдруг зажужжала и выплюнула чек. Вы ничего не пробивали.'),
    paper('receipt0317'),
    fx(set('receiptEvent')),
    choice([
      opt('Оставить чек себе', [
        fx(give('receipt0317'), clue('receipt_0317')),
        narr('Вы складываете чек вчетверо и убираете в карман.'),
      ]),
      opt(
        'Выбросить в урну',
        [fx(set('receiptTrashed')), narr('Бумага мягкая, влажная, будто полежала в сырости. Урна глухо шуршит.')],
        { tone: 'quiet' },
      ),
    ]),
    paper(null),
  ],

  // ═════════════ 01:42 — дядя Миша и алкоголь ═════════════
  misha: [
    enter('misha'),
    say('misha', 'Доброй ночи, начальник! Мне это… беленькой. Одну. Маленькую.'),
    sale({
      items: ['vodka'],
      patience: 60,
      sold: [say('misha', 'Вот! Человек! Не то что некоторые.'), say('misha', 'Ты это… Ты хороший. Ну, бывай.'), leave()],
      refused: [
        choice([
          opt('Извините, ночью нельзя. Закон такой.', [
            say('misha', 'Закон… Костя тоже всё «закон, закон». Хороший был парень.'),
            say('misha', 'Ты это… На склад после трёх не ходи. Там холодно. Не по-нашему холодно.'),
            fx(clue('misha_cold'), set('mishaPolite'), set('heardKostya')),
          ]),
          opt('Иди проспись.', [say('misha', 'Ишь ты… Костя хоть человеком был.'), fx(set('mishaRude'), set('heardKostya'))], {
            tone: 'quiet',
          }),
        ]),
        leave(),
      ],
      timeout: [say('misha', 'Да ну вас всех.'), leave()],
      after: (s, r) => {
        if (r.outcome === 'sold') {
          s.flags.soldAlcohol = true;
          s.stats.trustManager -= 2;
          pushViolation(s, 'alcohol');
        }
        if (r.outcome === 'timeout') s.stats.neglect += 1;
      },
    }),
  ],

  // ═════════════ 02:02 — звонок управляющей ═════════════
  gp_call: [
    ring(1, true),
    sfx('ring1'),
    choice(
      [
        opt('Ответить (линия 1)', [
          ring(1, false),
          sfx('pickup'),
          phone('gp', 'Это Галина Петровна. Ну? Как?'),
          choice(
            [
              opt(
                'Касса сама напечатала чек.',
                [
                  phone('gp', '…'),
                  phone('gp', 'Бумага старая, глючит. Выброси.'),
                  when(hasItem('receipt0317'), [fx(clue('gp_lie'))]),
                ],
                { if: flag('receiptEvent'), loop: true, tone: 'insight' },
              ),
              opt(
                'Кто такой Костя?',
                [phone('gp', 'Работал тут. Уволился.'), phone('gp', 'Тебя это не касается.'), fx(set('askedGpKostya'))],
                { if: flag('heardKostya'), loop: true, tone: 'insight' },
              ),
              opt('Всё спокойно.', []),
            ],
            { loop: true },
          ),
          phone('gp', 'Хорошо. Камеру четыре не трогай. На вторую линию не отвечай.'),
          phone('gp', 'Всё. Без дела не звони.'),
          sfx('hangup'),
        ]),
        opt(
          'Не отвечать',
          [
            ring(1, false),
            narr('Телефон звонит ещё четыре раза и замолкает.'),
            fx(add('trustManager', -1), set('missedGpCall')),
          ],
          { tone: 'quiet' },
        ),
      ],
      { style: 'phone', timer: { seconds: 14, defaultIndex: 1 }, prompt: 'Звонит телефон. Линия 1 — городская.' },
    ),
  ],

  // ═════════════ 02:22 — мужчина в сером, второй визит ═════════════
  grey2: [
    enter('grey', 'v2'),
    say('grey', 'Доброй ночи.'),
    say('grey', 'Хлеб и молоко. Как всегда.'),
    choice(
      [
        opt('Вы уже заходили сегодня.', [say('grey', 'Разве? Я всегда прихожу в это время.')], { loop: true }),
        opt('На улице дождь?', [say('grey', 'Всегда, когда я иду сюда.'), fx(set('greyRainAsked'))], { loop: true }),
        opt(
          'Пальто у вас застёгнуто на другую сторону.',
          [
            say('grey', '…'),
            narr('Он медленно опускает взгляд на пуговицы.'),
            say('grey', 'Значит, уже скоро.'),
            fx(add('attention', 1), set('greyConfronted')),
          ],
          { if: hasClue('grey_mirror'), loop: true, tone: 'insight' },
        ),
        opt('Пробить покупку', []),
      ],
      { loop: true },
    ),
    sale({
      items: ['bread_z', 'milk'],
      patience: 60,
      nameAnswer: 'Семёнов. Аркадий Ильич. Я у вас всегда беру.',
      sold: [say('grey', 'Спасибо. До скорого.'), narr('Колокольчик над дверью не звякнул.'), leave(false)],
      refused: [say('grey', 'Странно. Раньше продавали.'), narr('Колокольчик над дверью не звякнул.'), leave(false)],
      timeout: [say('grey', 'Я подожду. Я умею ждать.'), narr('Он уходит. Колокольчик над дверью не звякнул.'), leave(false)],
      after: (s, r) => {
        if (r.outcome === 'sold') {
          s.flags.grey2Sold = true;
          s.stats.attention += 1;
          if (!r.askedName) {
            pushViolation(s, 'rule4');
            s.stats.trustManager -= 1;
          }
        }
        if (r.outcome === 'refused') s.flags.grey2Refused = true;
        if (r.outcome === 'timeout') s.stats.neglect += 1;
      },
    }),
  ],

  // ═════════════ 02:44 — линия 2, один звонок (ловушка) ═════════════
  line2_single: [
    ring(2, true),
    sfx('ring2'),
    choice(
      [
        opt(
          'Ответить (линия 2)',
          [
            ring(2, false),
            sfx('pickup'),
            narr('В трубке тишина. Потом — долгий, ровный выдох. Как будто кто-то очень долго не дышал.'),
            narr('Пластик трубки становится ледяным.'),
            sfx('hangup'),
            fx(add('attention', 2), set('answeredLine2'), violate('line2'), set('line2Single')),
          ],
          { tone: 'danger' },
        ),
        opt('Не отвечать', [ring(2, false), narr('Один звонок. Тишина.')], { tone: 'quiet' }),
      ],
      {
        style: 'phone',
        timer: { seconds: 8, defaultIndex: 1 },
        prompt: 'Звонит внутренний телефон. Линия 2. Один звонок.',
      },
    ),
  ],

  relay_click: [sfx('click'), narr('03:00. В подсобке что-то щёлкнуло. Как реле. Или замок.'), hint('fridge')],

  // ═════════════ 03:08 — линия 2, три звонка подряд (противоречие правил) ═════════════
  kostya_call1: [
    ...tripleRing(2),
    choice(
      [
        opt(
          'Ответить (линия 2)',
          [
            ring(2, false),
            sfx('pickup'),
            fx(
              set('kostyaCall1'),
              set('answeredLine2'),
              violate('line2'),
              add('trustKostya', 2),
              add('attention', 1),
              set('heardKostya'),
              clue('kostya_call'),
            ),
            phone('kostya', 'Алло? Алло, слышишь? Не клади трубку.'),
            phone('kostya', 'Я Костя. Работал тут до тебя. Я не увольнялся.'),
            choice(
              [
                opt(
                  'Где ты?',
                  [phone('kostya', 'На складе. Наверное. Тут всегда пятнадцатое ноября. И всегда без двух шесть.')],
                  { loop: true },
                ),
                opt(
                  'Это розыгрыш?',
                  [phone('kostya', 'Посмотри в четвёртую камеру. Сейчас, пока тепло.'), fx(set('kostyaLook4'))],
                  { loop: true },
                ),
                opt('Что мне делать?', []),
              ],
              { loop: true },
            ),
            phone('kostya', 'Слушай. Скоро тебе велят открыть служебную дверь. Не открывай. Кто бы ни просил. Даже если я.'),
            phone('kostya', 'И если под утро кто-то придёт тебя сменить раньше времени — это не сменщик.'),
            choice([
              opt('Как тебе помочь?', [phone('kostya', 'Не знаю. Просто доживи до шести. Я позвоню.')]),
              opt('С чего мне тебе верить?', [
                phone('kostya', 'Ни с чего. Делай как в памятке — и как я говорю. Где не сходится — решай.'),
              ]),
            ]),
            narr('Гудки.'),
            sfx('hangup'),
          ],
          { tone: 'insight' },
        ),
        opt(
          'Не отвечать',
          [
            ring(2, false),
            narr('Третий звонок обрывается на середине.'),
            fx(set('kostyaIgnored'), add('trustKostya', -1), journal('kostya_why', 'rules')),
          ],
          { tone: 'quiet' },
        ),
      ],
      { style: 'phone', timer: { seconds: 15, defaultIndex: 1 }, prompt: 'Линия 2. Звонит третий раз подряд.' },
    ),
  ],

  kostya_note_hint: [narr('Журнал на прилавке лежит раскрытым на памятке. Вы его не открывали.')],

  // ═════════════ 03:20 — распоряжение, противоречащее памятке ═════════════
  fake_order: [
    sfx('printer'),
    narr('Касса снова печатает. Длинная лента ползёт на прилавок.'),
    paper('order'),
    fx(set('orderPrinted'), give('order')),
    choice([opt('Оторвать ленту', [narr('Вы отрываете ленту и кладёте рядом с кассой.')])]),
    paper(null),
  ],

  // ═════════════ 03:29 — Лиза возвращается (если с ней обошлись по-человечески) ═════════════
  liza_return: [
    enter('liza', 'v2'),
    say('liza', 'Это опять я. Простите. Можно я минутку тут постою?'),
    say('liza', 'Там, у чёрного хода, стоит хлебовозка. Мотор работает, фары горят. А в кабине никого.'),
    say('liza', 'Я подошла — а стекло изнутри всё в инее. Изнутри, понимаете?'),
    fx(clue('liza_truck')),
    choice([
      opt('Спасибо, что сказали.', [say('liza', 'Вы только дверь им не открывайте, ладно? Мало ли.')]),
      opt('Ночью тут бывает всякое.', [say('liza', 'Ага… Ладно. Побегу, пока фонари горят.')]),
    ]),
    leave(),
  ],

  // ═════════════ 03:40 — стук в служебную дверь ═════════════
  delivery: [
    knock(1),
    wait(500),
    knock(1),
    wait(500),
    knock(1),
    voice('door', 'Хлеб! Открывайте, руки отваливаются!'),
    choice(
      [
        opt('Открыть дверь', [goto('door_open_delivery')], { tone: 'danger' }),
        opt(
          'Спросить, кто там',
          [voice('door', 'Хлебозавод «Заречный»! Заказ на без двадцати четыре! Открывайте, холодно!'), fx(set('askedDriver'))],
          { loop: true },
        ),
        opt(
          'Посмотреть на камеру 4',
          [
            sfx('static'),
            when(
              stat('attention', '>=', 5),
              [
                narr('На мониторе — склад. У служебной двери, спиной к камере, стоит человек в зелёной жилетке. Он не стучит. Руки опущены.'),
                narr('А стук продолжается.'),
              ],
              [narr('На мониторе — склад. У служебной двери никого нет.'), narr('А стук продолжается.')],
            ),
            fx(clue('door_nobody'), add('attention', 1)),
          ],
          { loop: true, if: (s) => s.cam4On, tone: 'insight' },
        ),
        opt(
          'Ночью поставок не бывает.',
          [
            voice('door', '…'),
            narr('Пауза. Потом — тихо, вашим собственным голосом, с вашей интонацией:'),
            voice('door', 'Ночью поставок не бывает.'),
            narr('Стук обрывается на середине.'),
            fx(set('deliveryRefused'), add('attention', -1)),
          ],
          {
            tone: 'insight',
            if: any(hasClue('gp_verified'), hasClue('liza_truck'), hasClue('door_nobody'), hasClue('truck_cam')),
          },
        ),
        opt('Не открывать', [
          knock(2),
          voice('door', 'Эй! Я же слышу, что там кто-то есть!'),
          wait(800),
          knock(1),
          narr('Ещё три удара. Потом — тишина, будто стучавший замер с поднятой рукой.'),
          fx(set('deliveryRefused')),
        ]),
      ],
      { loop: true, style: 'door', prompt: 'Стучат в служебную дверь. 03:40.' },
    ),
    fx(set('deliveryResolved')),
  ],

  door_open_delivery: [
    sfx('door_open'),
    door('open'),
    fx(set('doorOpened'), violate('door_open'), add('attention', 3), add('trustManager', -2), set('deliveryResolved')),
    narr('Вы открываете дверь. За ней — тёмный склад. Никого нет.'),
    narr('Пахнет снегом. Стук прекратился. На холодильнике коротко пискнул термометр.'),
    sfx('thermo_beep'),
    choice([
      opt('Закрыть дверь', [sfx('door_slam'), door('closed'), narr('Вы закрываете дверь и поворачиваете ключ. С той стороны тихо.')]),
      opt('Оставить открытой', [narr('Дверь остаётся приоткрытой. Из темноты тянет холодом.'), fx(set('doorLeftOpen'))], {
        tone: 'danger',
      }),
    ]),
  ],

  // ═════════════ 04:06 — второй звонок Кости ═════════════
  kostya_call2: [
    ...tripleRing(2),
    choice(
      [
        opt(
          'Ответить (линия 2)',
          [
            ring(2, false),
            sfx('pickup'),
            fx(set('kostyaCall2'), add('trustKostya', 1)),
            when(
              flag('doorOpened'),
              [
                phone('kostya', 'Дверь открывали. Я слышал. Теперь он знает, где касса.'),
                when(doorOpen, [phone('kostya', 'Она ещё открыта? Закрой. Сейчас же.')]),
              ],
              [phone('kostya', 'Дверь не открыли? Хорошо. Хорошо…')],
            ),
            phone('kostya', 'В пять погаснет свет. Так всегда. Не ходи к щитку — он здесь, у меня. Кто бы ни звонил.'),
            phone('kostya', 'В половине шестого придёт он. Он будет похож на меня. Не отдавай ему ключи.'),
            choice([
              opt(
                'Кто — он?',
                [
                  phone('kostya', 'Тот, кто остаётся. Каждую ночь кто-то должен остаться в магазине. Три года это я.'),
                  fx(clue('kostya_truth')),
                ],
                { tone: 'insight' },
              ),
              opt(
                'Как тебя вытащить?',
                [
                  phone('kostya', 'Не знаю. Может, никак.'),
                  phone('kostya', 'Может, если утром смену сдать правильно… Я позвоню в шесть. Если смогу.'),
                  fx(set('kostyaPlan')),
                ],
                { tone: 'insight' },
              ),
            ]),
            sfx('hangup'),
          ],
          { tone: 'insight' },
        ),
        opt('Не отвечать', [ring(2, false), fx(add('trustKostya', -1)), narr('Телефон замолкает.')], { tone: 'quiet' }),
      ],
      { style: 'phone', timer: { seconds: 15, defaultIndex: 1 }, prompt: 'Линия 2. Снова три звонка подряд.' },
    ),
  ],

  // ═════════════ 04:36 — мужчина в сером, третий визит ═════════════
  grey3: [
    narr('Колокольчик молчит. Но у прилавка уже кто-то стоит.'),
    enter('grey', 'v3', false),
    sfx('drip'),
    say('grey', 'Доброй ночи, {name}.'),
    narr('Вы не называли ему своего имени.'),
    say('grey', 'Мне как в прошлый раз. Свечу, спички. И батарейки — четыре штуки.'),
    choice(
      [
        opt(
          'Вы приходите третий раз за ночь.',
          [say('grey', 'Третий — последний.'), say('grey', 'Кто-то же должен быть последним покупателем.'), fx(clue('grey_last'))],
          {
            loop: true,
            tone: 'insight',
            if: any(hasClue('grey_mirror'), hasClue('grey_parking'), hasClue('dry_street'), flag('greyRainAsked')),
          },
        ),
        opt(
          'Показать ему чек № 0317',
          [
            narr('Он долго смотрит на чек. С рукава на бумагу капает вода.'),
            say('grey', 'Значит, уже пробили.'),
            say('grey', 'Тогда мне здесь нечего делать.'),
            narr('Он поворачивается и уходит. Дверь не открывается — но его уже нет.'),
            fx(set('greyDismissed'), add('attention', -2), clue('grey_receipt')),
            leave(false),
          ],
          { if: hasItem('receipt0317'), tone: 'insight' },
        ),
        opt('Пробить покупку', [goto('grey3_sale')]),
      ],
      { loop: true },
    ),
  ],

  grey3_sale: [
    sale({
      items: ['candle', 'matches', { product: 'battery', qty: 4 }],
      patience: 50,
      nameAnswer: '{name}.',
      sold: [
        narr('Он берёт свечу двумя пальцами, как берут что-то очень горячее.'),
        say('grey', 'Спасибо. Теперь всё сходится.'),
        leave(false),
      ],
      refused: [
        narr('Он не уходит. Стоит и смотрит. Секунду. Десять. Минуту.'),
        say('grey', 'Хорошо. Тогда в другой раз.'),
        narr('Вы моргаете — у прилавка никого. На полу лужа.'),
        leave(false),
      ],
      timeout: [say('grey', 'Я подожду, {name}. Я умею ждать.'), narr('Вы моргаете — у прилавка никого.'), leave(false)],
      after: (s, r) => {
        if (r.outcome === 'sold') {
          s.flags.greyCompleted = true;
          s.stats.attention += 3;
          s.stats.trustManager -= 1;
          pushViolation(s, 'rule4');
        } else {
          s.stats.attention += 1;
          s.flags.greyRefused = true;
        }
      },
    }),
  ],

  // ═════════════ 05:00 — финал: темнота ═════════════
  blackout: [
    fx(set('blackout'), set('climax'), set('noSave')),
    sfx('power_down'),
    lights('emergency'),
    narr('Свет гаснет. Холодильники замолкают на полуслове.'),
    narr('Горит только красная аварийная лампа над входом. И экран кассы.'),
    narr('Вы нащупываете под прилавком фонарик.'),
    flashlight(true),
    fx(give('flashlight')),
    sys('Фонарик светит туда, куда вы указываете. Задача — дождаться 06:00.'),
  ],

  climax_line: [
    ...tripleRing(2),
    choice(
      [
        opt(
          'Ответить (линия 2)',
          [
            ring(2, false),
            sfx('pickup'),
            phone('kostya', 'Свет погас? Слушай меня. Сейчас тебе позвонят и попросят пойти к щитку.'),
            phone('kostya', 'Не ходи. Он у щитка ждёт.'),
            fx(set('kostyaWarnedFuse'), add('trustKostya', 1)),
            sfx('hangup'),
          ],
          { tone: 'insight' },
        ),
        opt('Не отвечать', [ring(2, false)], { tone: 'quiet' }),
      ],
      { style: 'phone', timer: { seconds: 12, defaultIndex: 1 }, prompt: 'Линия 2. Три звонка в темноте.' },
    ),
  ],

  climax_fusebox: [
    ring(1, true),
    sfx('ring1'),
    choice(
      [
        opt('Ответить (линия 1)', [
          ring(1, false),
          sfx('pickup'),
          phone('fake_gp', '{name}? Это я. Свет погас?'),
          phone('fake_gp', 'Щиток на складе, справа от двери. Подними рубильник, а то холодильники потекут. Быстро.'),
          fx(set('fakeGpHeard')),
          choice(
            [
              opt(
                'Вы же сами писали: после трёх дверь не открывать.',
                [
                  phone('fake_gp', 'Я разрешаю.'),
                  narr('На секунду голос в трубке становится ниже. Потом — снова её.'),
                  fx(clue('fake_gp_voice')),
                ],
                { loop: true, tone: 'insight' },
              ),
              opt('Перезвоню вам на домашний.', [sfx('hangup'), goto('call_gp_home')], { tone: 'insight' }),
              opt('Иду к щитку.', [sfx('hangup'), goto('fuse_go')], { tone: 'danger' }),
              opt(
                'Положить трубку',
                [sfx('hangup'), narr('Гудков нет. Тишина в трубке ещё долго не кончается.')],
                { tone: 'quiet' },
              ),
            ],
            { loop: true },
          ),
        ]),
        opt(
          'Не отвечать',
          [ring(1, false), narr('Телефон замолкает. Потом звонит снова. Потом перестаёт.')],
          { tone: 'quiet' },
        ),
      ],
      { style: 'phone', timer: { seconds: 14, defaultIndex: 1 }, prompt: 'Звонит линия 1. В темноте.' },
    ),
  ],

  fuse_go: [
    when(any(doorOpen, stat('attention', '>=', 9)), [
      narr('Вы делаете шаг на склад. Дверь за спиной закрывается сама — мягко, без щелчка.'),
      goto('ending_door'),
    ]),
    sfx('door_open'),
    door('open'),
    narr('Вы открываете служебную дверь. Луч фонарика упирается в стеллажи. Щиток — справа. До него шесть шагов.'),
    narr('Из темноты пахнет снегом. Где-то в глубине склада капает вода.'),
    choice(
      [
        opt('Идти к щитку', [goto('ending_door')], { tone: 'danger' }),
        opt('Вернуться и закрыть дверь', [
          sfx('door_slam'),
          door('closed'),
          fx(add('attention', 2), set('doorOpened'), violate('door_open'), add('trustManager', -1)),
          narr('Вы захлопываете дверь. С той стороны в неё что-то мягко упирается. И отходит.'),
        ]),
      ],
      { timer: { seconds: 10, defaultIndex: 1 } },
    ),
  ],

  call_gp_home: [
    narr('Вы набираете домашний номер Галины Петровны. Долгие гудки. Щелчок.'),
    phone('gp', '…Алло? {name}? Ты время видишь?'),
    phone('gp', 'Я не звонила. Я сплю. Какой щиток?.. Свет погас?'),
    phone('gp', 'Сиди за кассой. Никуда не ходи. Слышишь? Я приеду к шести.'),
    sfx('hangup'),
    fx(clue('gp_home'), add('trustManager', 1), set('gpKnowsBlackout')),
  ],

  ending_door: [
    narr('Склад оказывается длиннее, чем должен быть. Луч фонарика не достаёт до стены.'),
    narr('Где-то впереди звонит телефон. Три раза подряд.'),
    narr('Вы идёте на звук.'),
    end('door'),
  ],

  climax_knock: [
    when(
      doorOpen,
      [
        narr('Служебная дверь открыта настежь. Из темноты склада тянет холодом.'),
        narr('Там что-то движется. Медленно. В вашу сторону.'),
        choice(
          [
            opt(
              'Захлопнуть дверь!',
              [
                sfx('door_slam'),
                door('closed'),
                narr('Дверь захлопывается. С той стороны в неё бьют — один раз, тяжело. Потом тишина.'),
                fx(add('attention', 1)),
              ],
              { tone: 'danger' },
            ),
            opt('Замереть', [narr('Вы не успеваете. Холод касается затылка, как ладонь.'), goto('ending_door')], {
              tone: 'quiet',
            }),
          ],
          { timer: { seconds: 6, defaultIndex: 1 }, style: 'door', prompt: 'Быстрее!' },
        ),
      ],
      [
        knock(1),
        wait(700),
        knock(1),
        wait(700),
        knock(1),
        voice('door', '{name}, открой. Это Галина Петровна. Я с проверкой.'),
        choice(
          [
            opt(
              'Открыть',
              [
                sfx('door_open'),
                door('open'),
                narr('Вы поворачиваете ключ. За дверью никого нет. Только темнота — и она длиннее, чем склад.'),
                goto('ending_door'),
              ],
              { tone: 'danger' },
            ),
            opt(
              'Позвонить Галине Петровне на домашний',
              [
                narr('Вы набираете домашний номер. Стук не прекращается.'),
                phone('gp', 'Алло?.. {name}? Какая проверка? Я дома.'),
                phone('gp', 'Не открывай. Слышишь? Я приеду к шести.'),
                narr('За служебной дверью снова стучат. Ровно. Терпеливо.'),
                fx(clue('gp_home'), set('gpKnowsBlackout'), add('trustManager', 1)),
              ],
              { loop: true, tone: 'insight', if: not(flag('gpKnowsBlackout')) },
            ),
            opt(
              'Галина Петровна сейчас дома. Кто вы?',
              [
                narr('Стук прекращается.'),
                narr('Потом из-за двери доносится тихий смех. Не женский.'),
                narr('И шаги — вглубь склада. Долго. Гораздо дольше, чем длится склад.'),
                fx(add('attention', -1), set('knockExposed')),
              ],
              { tone: 'insight', if: any(flag('gpKnowsBlackout'), hasClue('gp_verified')) },
            ),
            opt('Не открывать', [
              narr('Вы не двигаетесь. Стук продолжается ещё минуту.'),
              voice('door', 'Правильно.'),
              narr('Это слово сказано мужским голосом. Стук прекращается.'),
            ]),
          ],
          { loop: true, style: 'door', prompt: 'Стучат в служебную дверь.' },
        ),
      ],
    ),
  ],

  // ═════════════ 05:30 — сменщик ═════════════
  relief: [
    narr('Вы не слышали, как он вошёл.'),
    enter('relief', 'v1', false),
    say('relief', 'Привет. Я на смену.'),
    say('relief', 'Галина Петровна сказала — можно пораньше. Ночь была длинная, да? Давай ключи — и иди домой.'),
    choice(
      [
        opt('Отдать ключи', [goto('ending_swap')], { tone: 'danger' }),
        opt(
          'Смену сдаю только Галине Петровне. В шесть.',
          [say('relief', 'Галина Петровна сама меня прислала.'), fx(set('reliefRefused'))],
          { loop: true },
        ),
        opt('Как тебя зовут?', [say('relief', 'Костя. Вон, на бейдже написано.'), fx(set('reliefNamed'), set('heardKostya'))], {
          loop: true,
        }),
        opt(
          'Костя звонил мне со склада. Ты — не он.',
          [
            say('relief', '…'),
            narr('Его лицо не двигается. Совсем. Как фотография.'),
            say('relief', 'Он много чего говорит. Он устал. Я тоже устал.'),
            fx(clue('relief_not_kostya'), set('reliefExposed')),
          ],
          { loop: true, tone: 'insight', if: all(flag('kostyaCall1'), flag('reliefNamed')) },
        ),
        opt(
          'Посмотреть на камеру над кассой',
          [
            sfx('static'),
            narr('На мониторе — касса сверху. За прилавком — вы. Перед прилавком никого нет.'),
            fx(clue('relief_no_cam'), set('reliefExposed')),
          ],
          { loop: true, tone: 'insight', if: any(hasClue('cam3_empty'), hasClue('vest_cam1')) },
        ),
        opt('Нет. Ключи останутся у меня.', [goto('relief_wait')]),
      ],
      { loop: true },
    ),
  ],

  relief_wait: [
    when(
      flag('reliefExposed'),
      [say('relief', 'Ладно. Тогда я просто постою. До шести недолго.')],
      [say('relief', 'Как хочешь. Я подожду. Мне не трудно.')],
    ),
    narr('Он отходит в темноту между стеллажами и замирает.'),
    fx(set('reliefWaiting')),
    leave(false),
  ],

  relief_again: [
    narr('Из темноты между стеллажами — голос. Совсем близко.'),
    voice('relief', 'Ну что? Передумали? Ключи — и домой. Там тепло.'),
    choice(
      [
        opt('Отдать ключи', [goto('ending_swap')], { tone: 'danger' }),
        opt('Нет.', [narr('Тишина. Только где-то в зале капает вода.')]),
      ],
      { timer: { seconds: 10, defaultIndex: 1 } },
    ),
  ],

  ending_swap: [
    when(flag('reliefWaiting'), [enter('relief', 'v1', false)]),
    narr('Вы кладёте ключи на прилавок. Он накрывает их ладонью.'),
    narr('По стеклу витрины от его пальцев ползёт иней.'),
    say('relief', 'Спасибо. Иди. Тебя там уже заждались.'),
    fx(take('keys')),
    end('swap'),
  ],

  // ═════════════ 05:58 — если третья покупка состоялась ═════════════
  last_receipt: [
    sfx('printer'),
    narr('В темноте оживает касса. 05:58. Она печатает сама.'),
    paper('receiptToday'),
    when(flag('reliefWaiting'), [voice('relief', 'Ну вот. Всё сходится.')]),
    choice(
      [
        opt(
          'Оторвать чек и порвать',
          [sfx('tear'), narr('Бумага рвётся с мокрым звуком. Касса замолкает.'), fx(add('attention', -2), set('tornReceipt'))],
          { tone: 'insight' },
        ),
        opt('Ничего не делать', [paper(null), goto('ending_lastsale')], { tone: 'quiet' }),
      ],
      { timer: { seconds: 8, defaultIndex: 1 }, prompt: 'Касса печатает чек. Кассир — вы.' },
    ),
    paper(null),
  ],

  ending_lastsale: [
    narr('Чек обрывается сам. На экране кассы: «ПРОДАЖА ЗАВЕРШЕНА».'),
    narr('Свет так и не возвращается. Где-то далеко звенит колокольчик — как будто кто-то наконец ушёл.'),
    end('lastsale'),
  ],

  // ═════════════ 06:00 — утро и разбор смены ═════════════
  morning: [
    sfx('power_up'),
    lights('normal'),
    flashlight(false),
    fx(unset('blackout')),
    narr('Ровно в шесть свет возвращается. Холодильники вздрагивают и снова гудят.'),
    when(flag('reliefWaiting'), [narr('Там, где стоял сменщик, на полу — лужица талой воды.')]),
    when(releaseReady, [
      ...tripleRing(2),
      choice(
        [
          opt(
            'Ответить (линия 2)',
            [
              ring(2, false),
              sfx('pickup'),
              phone('kostya', 'Утро. Слышишь? Уже утро.'),
              phone('kostya', 'Запиши в журнал: «05:59. Смену сдал — Ершов К.» Пожалуйста. Сам я не могу.'),
              choice([
                opt(
                  'Записать',
                  [
                    sfx('page'),
                    narr('Вы пишете. Почерк выходит не ваш — с наклоном влево, с длинными хвостами у «д» и «у».'),
                    fx(set('kostyaReleased')),
                  ],
                  { tone: 'insight' },
                ),
                opt('Не записывать', [phone('kostya', 'Понятно. Ничего. Я ещё позвоню.'), fx(set('kostyaRefusedRelease'))], {
                  tone: 'quiet',
                }),
              ]),
              sfx('hangup'),
            ],
            { tone: 'insight' },
          ),
          opt('Не отвечать', [ring(2, false)], { tone: 'quiet' }),
        ],
        { style: 'phone', timer: { seconds: 15, defaultIndex: 1 }, prompt: 'Линия 2. Три звонка. Уже светает.' },
      ),
    ]),
    clear(),
    wait(700),
    enter('gp'),
    say('gp', 'Ну. Как ночь?'),
    choice([
      opt('Тихо.', [say('gp', 'Тихо у неё…'), narr('Галина Петровна смотрит на монитор камер дольше, чем нужно.')]),
      opt('Странная.', [say('gp', 'Здесь все ночи странные. Привыкнешь. Или нет.')]),
      opt(
        'Свет выключался. И кто-то приходил меня сменить.',
        [say('gp', '…'), say('gp', 'Ключи у тебя?'), when(hasItem('keys'), [say('gp', 'Хорошо. Хорошо.')])],
        { if: flag('reliefWaiting'), tone: 'insight' },
      ),
    ]),
    when(flag('soldAlcohol'), [
      say('gp', 'В час сорок — «минеральная вода» за четыреста двадцать. Миша мне уже с утра спасибо передал. Ещё раз — и до свидания.'),
    ]),
    when(flag('doorOpened'), [say('gp', 'Камера четыре: ночью открывали служебную дверь. Я же писала. Чёрным по белому.')]),
    when(flag('cam4WasOff'), [say('gp', 'И камеру четыре кто-то выключал. Я её три года не выключаю.')]),
    when((s) => Number(s.flags.tempMissed ?? 0) >= 2, [
      say('gp', 'В журнале температуры дыры. Это не для галочки.'),
      fx(add('trustManager', -1)),
    ]),
    when((s) => Number(s.flags.roundsMissed ?? 0) >= 1, [say('gp', 'Обход по камерам — тоже не для галочки.')]),
    when(stat('neglect', '>=', 1), [say('gp', 'Люди уходили без покупок. Это магазин, а не музей.')]),
    // Журнал видеонаблюдения: Г. П. его читает, но за него не наказывает.
    when((s) => s.anomalies.log.filter((e) => e.result === 'correct').length >= 4, [
      narr('Галина Петровна листает журнал видеонаблюдения. На одной странице задерживается дольше, чем на остальных.'),
      say('gp', 'Это… Ладно. Костя тоже всё записывал.'),
    ]),
    when((s) => s.anomalies.log.filter((e) => e.result !== 'correct').length >= 4, [
      say('gp', 'И журнал камер — не дневник. Половина записей — собачники и пакеты.'),
    ]),
    when(flag('answeredLine2'), [
      say('gp', 'Вторая линия. Входящие — приняты.'),
      narr('Она долго смотрит на вас.'),
      fx(add('trustManager', -1)),
      when(flag('kostyaCall1'), [
        say('gp', 'Он… что-нибудь говорил?'),
        choice([
          opt(
            'Сказал, что не увольнялся.',
            [
              narr('Галина Петровна отворачивается к окну и долго молчит.'),
              say('gp', 'Три года. Три года одно и то же.'),
              fx(set('gpConfessed')),
            ],
            { tone: 'insight' },
          ),
          opt('Нет. Тишина в трубке.', [say('gp', 'Хорошо. Так лучше.')], { tone: 'quiet' }),
        ]),
      ]),
    ]),
    when(any(hasClue('gp_verified'), hasClue('gp_home')), [say('gp', 'А за звонок ночью — спасибо. Правильно, что спросили.')]),
    when(flag('kostyaReleased'), [goto('final_released')]),
    when((s) => seriousViolations(s) >= 2 || s.stats.trustManager <= 2, [say('gp', 'Ключи на стол.'), end('fired')]),
    say('gp', 'Завтра в полночь. Не опаздывай.'),
    end('morning'),
  ],

  final_released: [
    narr('Галина Петровна открывает журнал, чтобы расписаться, — и замирает над последней строкой.'),
    say('gp', 'Это кто написал?'),
    narr('Она садится прямо на ящик с минеральной водой.'),
    say('gp', 'Это его почерк. Это Костин почерк.'),
    end('released'),
  ],

  // ═════════════ сцены по инициативе игрока ═════════════
  door_open_free: [
    when(flag('blackout'), [goto('fuse_go')]),
    when(
      before('03:00'),
      [
        sfx('door_open'),
        door('open'),
        narr('Склад: стеллажи с коробками, ящики с водой, щиток на стене справа. Пахнет картоном и холодом.'),
        narr('В углу — стул. На спинке висит чужая куртка.'),
        fx(add('attention', 1), set('sawStorage')),
        choice([opt('Закрыть дверь', [sfx('door_slam'), door('closed')])]),
      ],
      [
        narr('Памятка: «После 03:00 служебную дверь не открывать».'),
        choice([
          opt(
            'Всё равно открыть',
            [
              sfx('door_open'),
              door('open'),
              fx(set('doorOpened'), violate('door_open'), add('attention', 3), add('trustManager', -2)),
              narr('Темнота за дверью плотная, как вода. Свет из зала в неё не заходит.'),
              narr('Из темноты пахнет снегом.'),
              choice([
                opt('Закрыть дверь', [
                  sfx('door_slam'),
                  door('closed'),
                  narr('Вы закрываете дверь. С той стороны кто-то шумно втягивает воздух.'),
                ]),
                opt('Оставить открытой', [fx(set('doorLeftOpen'))], { tone: 'danger' }),
              ]),
            ],
            { tone: 'danger' },
          ),
          opt('Не открывать', []),
        ]),
      ],
    ),
  ],

  call_gp_idle: [
    narr('Гудки. Долго. Наконец щелчок.'),
    phone('gp', 'Да? Что случилось?'),
    choice([
      opt('Ничего. Проверка связи.', [phone('gp', 'Не звони без дела. Спокойной.'), fx(add('trustManager', -1))], {
        tone: 'quiet',
      }),
      opt('Здесь происходят странные вещи.', [
        phone('gp', 'Какие?.. Хотя не надо. Делай всё по памятке. Всё по памятке. Утром поговорим.'),
        fx(set('gpWarned')),
      ]),
    ]),
    sfx('hangup'),
    fx(set('gpCalledIdle')),
  ],

  call_gp_noanswer: [narr('Длинные гудки. Никто не берёт.')],

  call_gp_verify: [
    narr('Гудки. Долго. Наконец щелчок.'),
    phone('gp', '…Алло. Ты время видишь?'),
    choice([
      opt(
        'Касса напечатала: в 03:40 привезут хлеб, надо открыть служебную дверь.',
        [
          phone('gp', '…'),
          phone('gp', 'Ночью поставок нет. Я же написала.'),
          phone('gp', 'Не открывай. Слышишь? Ни в коем случае. Кто бы там ни был.'),
          phone('gp', 'А ленту эту не выбрасывай. Утром покажешь.'),
          fx(clue('gp_verified'), add('trustManager', 1), set('gpVerified')),
        ],
        { tone: 'insight' },
      ),
      opt('Извините. Ничего.', [phone('gp', 'Тогда спи… то есть работай.')], { tone: 'quiet' }),
    ]),
    sfx('hangup'),
  ],

  call_rustam: [
    narr('Гудок. Второй.'),
    phone('rustam', 'Да? А, магазин. Что, подвезти?'),
    choice([
      opt('Нет, просто проверка связи.', [phone('rustam', 'Понял. Если что — звони, я на линии до семи.')]),
      opt(
        'Когда пропал Костя?',
        [
          phone('rustam', 'Пятнадцатого ноября. Три года назад. Как сегодня, да…'),
          phone('rustam', 'Слушай, ты там аккуратнее.'),
          fx(clue('rustam_date')),
        ],
        { if: flag('heardKostya'), tone: 'insight' },
      ),
      opt('Можешь приехать к шести?', [phone('rustam', 'К шести? Могу. Постою у входа, посигналю.'), fx(set('rustamComing'))]),
    ]),
    sfx('hangup'),
    fx(set('rustamCalled')),
  ],

  call_rustam_again: [phone('rustam', 'Да-да, помню. Если что — звони.'), sfx('hangup')],

  call_rustam_blackout: [
    phone('rustam', 'Алло? У вас свет погас? Я мимо проезжал — весь район со светом. Только ваш магазин тёмный.'),
    phone('rustam', 'Хочешь, к шести подъеду? Постою у входа.'),
    fx(set('rustamComing'), set('rustamCalled')),
    sfx('hangup'),
  ],

  call_police: [
    narr('Гудки. Щелчок.'),
    phone('police', 'Дежурная часть, слушаю.'),
    choice([
      opt('У нас в магазине происходит что-то странное.', [
        phone('police', 'Какой магазин?'),
        phone('police', '«Колосок», на Заводской?.. Опять?'),
        phone('police', 'Выезжать не будем. У нас с «Колоском» договорённость. Утром Галине Петровне всё расскажете.'),
        fx(clue('police_kolosok')),
      ]),
      opt('Извините, не туда.', [phone('police', 'Бывает.')], { tone: 'quiet' }),
    ]),
    sfx('hangup'),
    fx(set('policeCalled')),
  ],

  call_police_again: [narr('Занято. Всё время занято.')],

  call_line2: [
    when(
      after('03:08'),
      [
        when(
          flag('kostyaCall1'),
          [
            narr('Где-то за служебной дверью звонит телефон. Раз. Два. Щелчок.'),
            phone('kostya', 'Не звони сюда. Отсюда — можно, сюда — нельзя. Оно слышит.'),
            phone('kostya', 'Я сам позвоню.'),
            fx(add('attention', 1)),
          ],
          [
            narr('За служебной дверью звонит телефон. Долго. Никто не берёт.'),
            narr('Потом звонок обрывается — будто трубку сняли. Но в вашей трубке тишина. И чьё-то дыхание.'),
            fx(add('attention', 1)),
          ],
        ),
      ],
      [
        narr('За служебной дверью звонит телефон. Долго. Никто не берёт.'),
        narr('Конечно, никто. В подсобке никого нет.'),
      ],
    ),
    sfx('hangup'),
  ],
};

/** Проверка, что все переходы goto ведут на существующие сцены (используется в тестах). */
export function collectGotoTargets(steps: Step[], out: Set<string> = new Set()): Set<string> {
  for (const st of steps) {
    if (st.t === 'goto') out.add(st.scene);
    if (st.t === 'if') {
      collectGotoTargets(st.then, out);
      if (st.else) collectGotoTargets(st.else, out);
    }
    if (st.t === 'choice') for (const o of st.options) collectGotoTargets(o.next ?? [], out);
    if (st.t === 'sale') {
      collectGotoTargets(st.onSold ?? [], out);
      collectGotoTargets(st.onRefused ?? [], out);
      collectGotoTargets(st.onTimeout ?? [], out);
    }
  }
  return out;
}

