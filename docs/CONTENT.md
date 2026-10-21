# Как добавлять сюжет

Сюжет — это данные. Ядро (`src/core`) только исполняет их, поэтому новую сцену, персонажа или целую смену
можно добавить, не трогая код игры.

## Где что лежит (смена 1)

| Файл | Содержимое |
| --- | --- |
| `src/content/shift1/world.ts` | товары, персонажи (тексты «рассмотреть»), имена говорящих, документы (чеки, СМС), журнал (памятка, постоянные покупатели, старые записи), улики |
| `src/content/shift1/scenes.ts` | все сцены: реплики, выборы, продажи, эффекты |
| `src/content/shift1/index.ts` | хронология (когда какая сцена), аномалии на камерах, реакции на действия игрока, задачи, концовки, телефонные контакты, формула температуры |
| `src/game/art/characters.ts` | внешность персонажей (`CHARACTER_SPECS`, ключ `id:вариант`) |

## Шаги сцены

```ts
import { enter, say, narr, sys, choice, opt, fx, add, set, clue, when, flag, sale, leave } from '../../core/dsl';

my_scene: [
  enter('liza', 'v1'),                          // покупатель подходит (со звоном колокольчика)
  say('liza', 'Здравствуйте!'),                 // реплика персонажа
  narr('Она прячет руки в рукава.'),            // наблюдение (курсивом)
  sys('Подсказка для игрока.'),                 // системная подсказка
  choice([
    opt('Добрый вечер.', [fx(add('trustManager', 1))]),
    opt('Что-то случилось?', [say('liza', 'Нет… ничего.'), fx(clue('liza_nervous'))], { tone: 'insight' }),
    opt('Уличить её', [...], { if: flag('sawLiza'), tone: 'danger' }),   // вариант только при условии
  ]),
  sale({ items: ['noodles', { product: 'battery', qty: 2 }], patience: 50,
         sold: [...], refused: [...], timeout: [...] }),
  when(flag('lizaOk'), [say('liza', 'Спасибо!')], [say('liza', '…')]),
  leave(),
],
```

Другие шаги: `phone(кто, текст)` — реплика в трубке; `voice(кто, текст)` — голос без лица;
`paper('id')` / `paper(null)` — показать/убрать документ; `ring(1|2, true|false)` — звонок;
`knock()`, `door('open'|'closed')`, `lights('normal'|'emergency')`, `flashlight(true)`, `hint('fridge')`,
`sfx('bell')`, `wait(мс)`, `goto('другая_сцена')`, `end('id_концовки')`.

Выбор-«меню вопросов»: `choice([...], { loop: true })`, у вопросов `{ loop: true }` — после ответа меню
возвращается без заданного вопроса; вариант без `loop` завершает разговор.
Выбор на время: `{ timer: { seconds: 8, defaultIndex: 1 } }` — если игрок не успел, выбирается `defaultIndex`.

## Условия и эффекты

- Условия: `flag('x')`, `not(...)`, `all(...)`, `any(...)`, `stat('attention', '>=', 5)`, `hasClue('id')`,
  `hasItem('id')`, `aware('>=', 7)` (число улик), `before('03:00')`, `after('03:00')`, `doorOpen`,
  или любая функция `(s) => boolean`.
- Эффекты: `add('attention', 2)`, `set('flag')`, `unset('flag')`, `clue('id')`, `violate('id')`,
  `give('item')`, `take('item')`, `journal('entry')` (новая рукописная строка), `toast('текст')`.

Скрытые параметры: `attention`, `trustManager`, `trustKostya`, `neglect` (см. docs/GDD.md).

## Хронология и реакции

```ts
{ id: 'liza2', at: '03:29', scene: 'liza_return', when: (s) => !!s.flags.lizaOk, window: 10 }
```

`at` — игровое время, `when` — условие, `window` — сколько игровых минут событие может ждать, пока игрок занят.
`ambient: true` — фоновое событие (звук и короткое наблюдение), не останавливает часы.

Аномалия на камере видна только в окне времени и только тому, кто смотрит:

```ts
{ id: 'vest', cam: 1, from: '00:38', to: '00:56', visual: 'vest_figure', onSeen: [narr('...'), fx(clue('vest_cam1'))] }
```

Реакция на действие игрока (`camera:1..4`, `cameras:open/close`, `fridge:record`, `inspect:photo`,
`journal:back`, `door:open` и т. д.):

```ts
{ id: 'photo', on: 'inspect:photo', cooldown: 0, steps: [narr('...'), fx(clue('kostya_photo'))] }
```

Некритичному событию можно разрешить небольшой сдвиг по seed прохождения: `jitter: [-4, 4]` (минуты).
Обучение, ключевые проверки и финал не сдвигайте.

## Фоновые события (режиссёр тревоги)

Пул лежит в `src/content/shift1/ambient.ts`, правила частоты — там же (`ambient.rate`, паузы, отступ от сцен).
Событие — данные, без кода в сценах:

```ts
{
  id: 'storage_knock', weight: 1, intensity: 2, channel: 'service_door',
  from: '01:00', cooldown: 35, max: 3,
  avoid: { beats: ['delivery'], radius: 10 },     // не рядом с сюжетным стуком
  steps: [sfx('knock_soft'), effect('door_shake')],
  texts: ['За служебной дверью что-то глухо стукнуло.'], textChance: 0.5,
}
```

`effect('id')` — визуальный/звуковой эффект: его рисуют `StoreScene`, `CctvScene` и `AudioEngine`
(незнакомый id просто игнорируется). Фоновые события **не должны менять** `stats`, флаги, улики и нарушения —
это проверяет tests/tension.test.ts. Сводка по 200 прогонам на стратегию: `npm run report:tension`.

## Аномалии на камерах

Данные — `src/content/shift1/anomalies.ts`, логика — `src/core/Anomalies.ts`, появление решает режиссёр тревоги.

```ts
{
  id: 'extra_box', cams: [4], danger: 1, categories: ['object'], weight: 1,
  from: '00:50', to: '04:20', duration: 24, cooldown: 999, max: 1,
  when: warm,                                        // (s, cam) => boolean
  stages: [
    { at: 0, visuals: ['ov:cam4_box1'] },             // минуты от появления → что видно
    { at: 8, visuals: ['ov:cam4_box2'] },
    { at: 16, visuals: ['ov:cam4_box3'], steps: [sfx('thud')] },
  ],
  report: { text: 'Записано: …', steps: [fx(clue('…'))] },   // верная фиксация
  miss: { trace: ['ov:cam4_box3'] },                          // не заметили: след до утра
}
```

Визуальные ключи: `ov:КЛЮЧ` — полноэкранный слой (текстура `ov_КЛЮЧ` в src/game/textures.ts, рисуется
в src/game/art/cctv.ts), `base:КЛЮЧ` — другая основа кадра, `osd:05:58` — время в углу экрана, остальное —
фигуры (см. `placementFor` в CctvScene). `danger: 0` — обычная вещь, её фиксация — ложная тревога.
Что ещё на камерах засчитывается при фиксации (сюжетные аномалии) и что считается обычным
(покупатель, продавец) — `anomalies.reportables`. Тесты: tests/anomalies.test.ts; в браузере —
`npm run e2e:anomalies` (скриншоты каждой стадии в e2e-output/).

## Новая смена

1. Скопировать `src/content/shift1` в `src/content/shift2` и изменить данные.
2. Добавить смену в `src/content/shifts.ts`.
3. Запустить `npm test`: тесты проверят, что все переходы ведут на существующие сцены, все товары, документы и
   концовки описаны, а случайные прохождения всегда доходят до конца без ошибок.

## Проверка

`npm test` прогоняет 300 случайных партий и сценарии всех концовок (tests/shift1.test.ts) — при добавлении
сцен расширяйте эти тесты по образцу. Реплики, обращённые к игроку, пишутся без указания рода
(«Ты время видишь?», а не «Ты проснулся?»).
