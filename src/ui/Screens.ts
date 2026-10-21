/** Экраны вне смены: главное меню, ввод имени, настройки, пауза, концовки, итоги. */
import type { EndingDef, ShiftDef, WorldState } from '../core/types';
import type { MetaProgress, Settings } from '../core/SaveManager';
import { resolveText } from '../core/state';
import { h, plural } from './dom';
import type { ModalHost } from './Panels';

export interface MenuActions {
  newGame(): void;
  continueGame(): void;
  settings(): void;
  endings(): void;
  about(): void;
}

export function menuScreen(opts: { canContinue: boolean; actions: MenuActions; shiftTitle: string }): HTMLElement {
  const a = opts.actions;
  return h(
    'div',
    { class: 'screen menu' },
    h(
      'div',
      { class: 'menu-card' },
      h('h1', { class: 'game-title', text: 'НОЧНАЯ СМЕНА' }),
      h('p', { class: 'subtitle', text: `Продукты 24 «Колосок» · ${opts.shiftTitle}` }),
      opts.canContinue ? h('button', { class: 'btn primary', type: 'button', text: 'Продолжить смену', onclick: () => a.continueGame() }) : null,
      h('button', { class: `btn${opts.canContinue ? '' : ' primary'}`, type: 'button', text: 'Новая смена', onclick: () => a.newGame() }),
      h('button', { class: 'btn', type: 'button', text: 'Настройки', onclick: () => a.settings() }),
      h('button', { class: 'btn', type: 'button', text: 'Концовки', onclick: () => a.endings() }),
      h('button', { class: 'btn', type: 'button', text: 'Об игре', onclick: () => a.about() }),
      h(
        'div',
        { class: 'menu-foot' },
        'Психологический хоррор. Без резких скримеров, но со звуком атмосфернее.',
        h('br'),
        'Мышь, клавиатура или касание.',
      ),
    ),
  );
}

export function askName(host: ModalHost, initial: string, onStart: (name: string) => void): void {
  const input = h('input', { type: 'text', maxlength: 14, value: initial, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Имя' }) as HTMLInputElement;
  const go = () => {
    const name = sanitizeName(input.value) || 'Саша';
    host.close();
    onStart(name);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') go();
  });
  const body = h(
    'div',
    { class: 'settings' },
    h('label', { class: 'field' }, h('span', { text: 'Как вас зовут? Имя будет на бейдже.' }), input),
    h('p', { class: 'muted-note', style: 'margin:0', text: 'Ночь с 14 на 15 ноября. Смена — с 00:00 до 06:00 (около 12–15 минут).' }),
    h('button', { class: 'btn primary', type: 'button', text: 'Выйти на смену', onclick: go }),
  );
  host.open('name', 'Новая смена', body);
  window.setTimeout(() => input.focus(), 50);
}

export function sanitizeName(raw: string): string {
  return raw
    .replace(/[^A-Za-zА-Яа-яЁё\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
}

export function settingsModal(host: ModalHost, settings: Settings, onChange: (s: Settings) => void, onClose?: () => void): void {
  const s = { ...settings };
  const slider = (label: string, key: 'master' | 'ambience' | 'sfx') => {
    const input = h('input', { type: 'range', min: 0, max: 100, value: Math.round(s[key] * 100), 'aria-label': label }) as HTMLInputElement;
    input.addEventListener('input', () => {
      s[key] = Number(input.value) / 100;
      onChange({ ...s });
    });
    return h('div', { class: 'setting' }, h('span', { text: label }), input);
  };
  const segmented = (label: string, options: [string, () => boolean, () => void][]) => {
    const wrap = h('div', { class: 'segmented' });
    const render = () => {
      wrap.replaceChildren(
        ...options.map(([text, isActive, apply]) =>
          h('button', {
            type: 'button',
            class: isActive() ? 'active' : '',
            text,
            onclick: () => {
              apply();
              onChange({ ...s });
              render();
            },
          }),
        ),
      );
    };
    render();
    return h('div', { class: 'setting' }, h('span', { text: label }), wrap);
  };
  const body = h(
    'div',
    { class: 'settings' },
    slider('Общая громкость', 'master'),
    slider('Фон (гул, улица)', 'ambience'),
    slider('Эффекты', 'sfx'),
    segmented('Звук', [
      ['Вкл', () => !s.muted, () => (s.muted = false)],
      ['Выкл', () => s.muted, () => (s.muted = true)],
    ]),
    segmented('Помехи и мерцание', [
      ['Вкл', () => s.effects, () => (s.effects = true)],
      ['Выкл', () => !s.effects, () => (s.effects = false)],
    ]),
    segmented('Текст', [
      ['Сразу', () => s.textSpeed === 0, () => (s.textSpeed = 0)],
      ['Быстро', () => s.textSpeed === 1, () => (s.textSpeed = 1)],
      ['Медленно', () => s.textSpeed === 2, () => (s.textSpeed = 2)],
    ]),
    h('p', { class: 'muted-note', style: 'margin:0', text: 'Отключите помехи и мерцание, если вы чувствительны к мигающему изображению.' }),
  );
  host.open('settings', 'Настройки', body, { onClose });
}

export function pauseModal(host: ModalHost, actions: { resume(): void; settings(): void; menu(): void }): void {
  const body = h(
    'div',
    { class: 'settings' },
    h('button', { class: 'btn primary', type: 'button', text: 'Продолжить', onclick: () => host.close() }),
    h('button', { class: 'btn', type: 'button', text: 'Настройки', onclick: () => actions.settings() }),
    h('button', { class: 'btn', type: 'button', text: 'Выйти в меню', onclick: () => actions.menu() }),
    h('p', { class: 'muted-note', style: 'margin:0', text: 'Прогресс сохраняется автоматически по ходу смены (кроме последнего часа).' }),
  );
  host.open('pause', 'Пауза', body, { onClose: actions.resume });
}

export function endingsModal(host: ModalHost, shift: ShiftDef, meta: MetaProgress): void {
  const list = h('div', { class: 'settings' });
  for (const e of Object.values(shift.endings)) {
    const got = meta.endings.includes(e.id);
    list.append(
      h(
        'div',
        { class: 'stat' },
        h('div', { class: 'v', style: got ? '' : 'color:var(--dim)', text: got ? e.title : '???' }),
        h('div', { class: 'k', text: got ? endingKind(e) : 'Ещё не открыта' }),
      ),
    );
  }
  const body = h(
    'div',
    {},
    h('p', { class: 'muted-note', style: 'margin-top:0', text: `Открыто концовок: ${meta.endings.filter((id) => shift.endings[id]).length} из ${Object.keys(shift.endings).length}. Сыграно смен: ${meta.runs}.` }),
    list,
  );
  host.open('endings', 'Концовки', body);
}

export function aboutModal(host: ModalHost): void {
  const body = h(
    'div',
    { class: 'settings', style: 'line-height:1.5' },
    h('p', { style: 'margin:0', text: '«Ночная смена» — психологический хоррор о ночном продавце круглосуточного магазина на окраине Тихоборска.' }),
    h('p', { style: 'margin:0', text: 'Все события, имена, магазин и город вымышлены. Совпадения случайны.' }),
    h('p', { class: 'muted-note', style: 'margin:0', text: 'Графика и звук сгенерированы кодом игры. Шрифты PT Sans, PT Mono (ParaType) и Caveat распространяются по лицензии SIL Open Font License 1.1. Движок — Phaser 3 (MIT).' }),
    h('p', { class: 'muted-note', style: 'margin:0', text: 'Управление: клик/тап по предметам; Пробел/Enter — далее; 1–9 — выбор; C — камеры, J — журнал, P — телефон, T — термометр; Esc — пауза.' }),
  );
  host.open('about', 'Об игре', body);
}

function endingKind(e: EndingDef): string {
  return e.kind === 'good' ? 'Смена сдана' : e.kind === 'secret' ? 'Тайная концовка' : e.kind === 'bad' ? 'Плохой исход' : 'Без продолжения';
}

export function resultsScreen(opts: {
  shift: ShiftDef;
  state: WorldState;
  meta: MetaProgress;
  totalClues: number;
  realSeconds: number;
  onRestart(): void;
  onMenu(): void;
}): HTMLElement {
  const { shift, state } = opts;
  const ending = shift.endings[state.endingId ?? ''] ?? Object.values(shift.endings)[0];
  const served = state.sales.filter((s) => s.outcome === 'sold').length;
  const realMin = Math.max(1, Math.round(opts.realSeconds / 60));
  const endingsList = h('div', { class: 'endings-list' });
  for (const e of Object.values(shift.endings)) {
    const got = opts.meta.endings.includes(e.id);
    endingsList.append(h('span', { class: `${got ? 'got' : ''}${e.id === ending.id ? ' current' : ''}`, text: got ? e.title : '???' }));
  }
  const titleClass = ending.kind === 'bad' ? 'bad' : ending.kind === 'secret' ? 'secret' : '';
  return h(
    'div',
    { class: 'screen results' },
    h(
      'div',
      { class: 'results-card' },
      h('div', { class: 'kicker', text: `Концовка · ${endingKind(ending)}` }),
      h('h2', { class: titleClass, text: ending.title }),
      h('div', { class: 'story', text: resolveText(ending.text, state) }),
      h('div', { class: 'hook', text: resolveText(ending.hook, state) }),
      h(
        'div',
        { class: 'stats' },
        stat(String(served), plural(served, 'покупатель обслужен', 'покупателя обслужено', 'покупателей обслужено')),
        stat(String(state.violations.length), plural(state.violations.length, 'нарушение памятки', 'нарушения памятки', 'нарушений памятки')),
        stat(`${state.clues.length} / ${opts.totalClues}`, 'замечено странностей'),
        stat(`${realMin} мин`, 'длилась смена'),
      ),
      h('div', { class: 'kicker', text: 'Концовки' }),
      endingsList,
      h('p', { class: 'muted-note', style: 'margin:0', text: 'Смена 2 — скоро. Решения этой ночи будут иметь значение.' }),
      // Код ночи помогает тестировщикам сообщать о прохождении: по нему ночь воспроизводится.
      h('p', { class: 'muted-note run-code', style: 'margin:0', text: `Код ночи: ${state.seed}` }),
      h(
        'div',
        { class: 'row-btns' },
        h('button', { class: 'btn primary', type: 'button', text: 'Начать смену заново', onclick: () => opts.onRestart() }),
        h('button', { class: 'btn', type: 'button', text: 'В главное меню', onclick: () => opts.onMenu() }),
      ),
    ),
  );
}

function stat(v: string, k: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'v', text: v }), h('div', { class: 'k', text: k }));
}
