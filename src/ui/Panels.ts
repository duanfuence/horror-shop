/**
 * Модальные окна и оверлеи игрового экрана: журнал, телефон, холодильник,
 * бумаги (чеки, СМС, памятка), меню служебной двери, интерфейс камер.
 */
import type { GameSession } from '../core/GameSession';
import { formatTime, resolveText } from '../core/state';
import type { PaperView } from '../core/types';
import { iconDataUrl } from '../game/art/items';
import { clear, formatRub, h } from './dom';

export class ModalHost {
  private current: { el: HTMLElement; onClose?: () => void; id: string } | null = null;

  constructor(private root: HTMLElement) {}

  get openId(): string | null {
    return this.current?.id ?? null;
  }

  open(id: string, title: string, body: HTMLElement, opts: { onClose?: () => void; head?: HTMLElement; wide?: boolean } = {}): void {
    this.close();
    const modal = h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h(
        'div',
        { class: 'modal-head' },
        h('h2', { text: title }),
        h('button', { class: 'close-x', type: 'button', 'aria-label': 'Закрыть', onclick: () => this.close(), text: '✕' }),
      ),
      opts.head ?? null,
      h('div', { class: 'modal-body' }, body),
    );
    if (opts.wide) modal.style.width = 'min(100%, 52em)';
    const backdrop = h('div', { class: 'modal-backdrop' }, modal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close();
    });
    this.root.append(backdrop);
    this.current = { el: backdrop, onClose: opts.onClose, id };
  }

  close(): void {
    if (!this.current) return;
    const c = this.current;
    this.current = null;
    c.el.remove();
    c.onClose?.();
  }
}

// ═══════════════ журнал ═══════════════

export type JournalTab = 'rules' | 'regulars' | 'catalog' | 'temp' | 'notes' | 'pocket';

const TABS: [JournalTab, string][] = [
  ['rules', 'Памятка'],
  ['regulars', 'Постоянные'],
  ['catalog', 'Каталог'],
  ['temp', 'Температура'],
  ['notes', 'Заметки'],
  ['pocket', 'Карманы'],
];

export class Journal {
  private newTabs = new Set<string>();
  private seenJournalEntries = new Set<string>();
  private tab: JournalTab = 'rules';
  private back = false;
  private oldPage = false;

  constructor(
    private host: ModalHost,
    private session: () => GameSession,
  ) {}

  markNew(tab: string): void {
    this.newTabs.add(tab);
  }

  get hasNew(): boolean {
    return this.newTabs.size > 0;
  }

  reset(): void {
    this.newTabs.clear();
    this.seenJournalEntries.clear();
    this.tab = 'rules';
    this.back = false;
    this.oldPage = false;
  }

  open(tab?: JournalTab): void {
    if (tab) this.tab = tab;
    if (tab === 'rules') this.back = false;
    this.render();
  }

  private render(): void {
    const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
    for (const [id, label] of TABS) {
      const b = h('button', {
        class: `tab${this.tab === id ? ' active' : ''}${this.newTabs.has(id) ? ' new' : ''}`,
        type: 'button',
        role: 'tab',
        text: label,
        onclick: () => {
          this.tab = id;
          this.oldPage = false;
          this.render();
        },
      });
      tabsEl.append(b);
    }
    this.newTabs.delete(this.tab);
    const body = this.body();
    this.host.open('journal', 'Журнал смены', body, { head: tabsEl, wide: true });
  }

  private body(): HTMLElement {
    const s = this.session();
    const st = s.state;
    const j = s.shift.journal;
    switch (this.tab) {
      case 'rules': {
        const wrap = h('div');
        if (!this.back) {
          s.act('journal:rules');
          wrap.append(rulesFront(j.rulesTitle, j.rules, j.rulesFooter));
        } else {
          s.act('journal:back');
          wrap.append(this.rulesBack());
        }
        wrap.append(
          h(
            'div',
            { class: 'flip' },
            h('button', {
              class: 'btn',
              type: 'button',
              text: this.back ? '↺ Лицевая сторона' : '↻ Перевернуть лист',
              onclick: () => {
                this.back = !this.back;
                this.render();
              },
            }),
          ),
        );
        return wrap;
      }
      case 'regulars': {
        s.act('journal:regulars');
        const table = h('table', { class: 'ledger' }, h('tr', {}, h('th', { text: 'Фамилия' }), h('th', { text: 'Обычно берёт' })));
        for (const r of j.regulars) {
          table.append(
            h(
              'tr',
              {},
              h('td', { class: r.struck ? 'struck' : '', text: r.name }),
              h('td', {}, h('span', { class: r.struck ? 'struck' : '', text: r.note }), r.pencil ? h('div', { class: 'pencil', text: r.pencil }) : null),
            ),
          );
        }
        return h(
          'div',
          { class: 'sheet' },
          h('h3', { text: 'Постоянные покупатели' }),
          table,
          h('p', { class: 'muted-note', text: 'Памятка, п. 4: если касса не находит товар — спросить фамилию и сверить с этим списком.' }),
        );
      }
      case 'catalog': {
        s.act('journal:catalog');
        const table = h('table', { class: 'ledger' }, h('tr', {}, h('th', { text: 'Товар' }), h('th', { class: 'num', text: 'Цена' })));
        const items = Object.values(s.shift.products)
          .filter((p) => p.inCatalog)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        for (const p of items) {
          table.append(
            h(
              'tr',
              {},
              h('td', {}, h('img', { src: iconDataUrl(p.icon), alt: '', style: 'width:20px;height:20px;image-rendering:pixelated;vertical-align:middle;margin-right:6px' }), p.name, p.alcohol ? ' *' : ''),
              h('td', { class: 'num', text: formatRub(p.price) }),
            ),
          );
        }
        return h('div', { class: 'sheet' }, h('h3', { text: 'Каталог товаров (база кассы)' }), table, h('p', { class: 'muted-note', text: '* Алкоголь: продажа с 08:00 до 23:00.' }));
      }
      case 'temp': {
        if (this.oldPage) {
          s.act('journal:old');
          const p = j.oldTempPage;
          const table = h('table', { class: 'ledger' });
          for (const [t, v] of p.rows) table.append(h('tr', {}, h('td', { text: t }), h('td', { class: 'pencil', text: v })));
          return h(
            'div',
            {},
            h('div', { class: 'sheet hand' }, h('h3', { text: p.title, style: 'font-family:var(--font-ui);font-size:0.65em;color:#5a5448' }), table, h('p', { class: 'muted-note', style: 'font-family:var(--font-ui);font-size:0.6em', text: p.footer })),
            h('div', { class: 'flip' }, h('button', { class: 'btn', type: 'button', text: '← К текущей смене', onclick: () => ((this.oldPage = false), this.render()) })),
          );
        }
        s.act('journal:temp');
        const table = h('table', { class: 'ledger' }, h('tr', {}, h('th', { text: 'Время' }), h('th', { text: 'Холодильник № 2' })));
        for (let hr = 0; hr < 6; hr++) {
          const v = st.tempLog[String(hr)];
          const cur = Math.floor(st.minutes / 60) === hr;
          table.append(
            h(
              'tr',
              {},
              h('td', { text: `${String(hr).padStart(2, '0')}:00${cur ? ' ←' : ''}` }),
              h('td', { class: v === undefined ? '' : 'pencil', text: v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} °C` }),
            ),
          );
        }
        return h(
          'div',
          {},
          h('div', { class: 'sheet' }, h('h3', { text: 'Журнал температуры. 14–15.11' }), table),
          h('div', { class: 'flip' }, h('button', { class: 'btn', type: 'button', text: 'Листнуть назад: старые записи', onclick: () => ((this.oldPage = true), this.render()) })),
        );
      }
      case 'notes': {
        s.act('journal:notes');
        const list = h('ul', { class: 'notes' });
        for (const id of st.clues) {
          const c = s.shift.clues[id];
          if (c) list.append(h('li', { text: resolveText(c.note, st) }));
        }
        return h(
          'div',
          { class: 'sheet' },
          h('h3', { text: 'Мои заметки за смену' }),
          st.clues.length ? list : h('p', { class: 'muted-note', text: 'Пока ничего. Смотрите внимательнее: на покупателей, на камеры, на бумаги.' }),
        );
      }
      case 'pocket': {
        const wrap = h('div', { class: 'pocket' });
        for (const id of st.inventory) {
          const def = j.items[id];
          if (!def) continue;
          const icon = id === 'receipt0317' ? 'receipt' : id === 'rustam_card' ? 'card' : id;
          wrap.append(
            h(
              'div',
              { class: 'it' },
              h('img', { src: iconDataUrl(icon), alt: '' }),
              h('div', {}, h('strong', { text: def.name }), h('div', { class: 'desc', text: resolveText(def.desc, st) })),
            ),
          );
        }
        if (!st.inventory.length) wrap.append(h('p', { class: 'muted-note', text: 'Карманы пусты.' }));
        return wrap;
      }
    }
  }

  private rulesBack(): HTMLElement {
    const s = this.session();
    const sheet = h('div', { class: 'sheet hand' });
    for (const line of s.shift.journal.backside) {
      if (line.entry && !s.state.journal.includes(line.entry)) continue;
      const fresh = !!line.entry && !this.seenJournalEntries.has(line.entry);
      if (line.entry) this.seenJournalEntries.add(line.entry);
      sheet.append(h('p', { class: fresh ? 'fresh' : '', text: resolveText(line.text, s.state) }));
    }
    return sheet;
  }
}

export function rulesFront(title: string, rules: string[], footer: string): HTMLElement {
  const ol = h('ol');
  for (const r of rules) ol.append(h('li', { text: r }));
  return h('div', { class: 'sheet laminated' }, h('h3', { text: title }), ol, h('div', { class: 'sign', text: footer }));
}

// ═══════════════ бумаги ═══════════════

export class PaperOverlay {
  private el: HTMLElement | null = null;
  private back = false;

  constructor(
    private root: HTMLElement,
    private session: () => GameSession,
  ) {}

  show(view: PaperView | null): void {
    this.el?.remove();
    this.el = null;
    if (!view) return;
    this.back = false;
    this.el = h('div', { class: 'paper-wrap' });
    this.renderContent(view);
    this.root.append(this.el);
  }

  private renderContent(view: PaperView): void {
    if (!this.el) return;
    clear(this.el);
    if (view.kind === 'receipt') {
      this.el.append(h('div', { class: 'receipt', text: view.text }));
    } else if (view.kind === 'sms') {
      this.el.append(h('div', { class: 'sms' }, h('div', { class: 'bubble', text: view.text })));
    } else if (view.kind === 'rules') {
      const s = this.session();
      const j = s.shift.journal;
      const wrap = h('div', { class: 'rules-paper' });
      if (!this.back) wrap.append(rulesFront(j.rulesTitle, j.rules, j.rulesFooter));
      else {
        const sheet = h('div', { class: 'sheet hand' });
        for (const line of j.backside) if (!line.entry) sheet.append(h('p', { text: resolveText(line.text, s.state) }));
        wrap.append(sheet);
        s.act('journal:back');
      }
      wrap.append(
        h(
          'div',
          { class: 'flip' },
          h('button', {
            class: 'btn',
            type: 'button',
            text: this.back ? '↺ Лицевая сторона' : '↻ Перевернуть лист',
            onclick: () => {
              this.back = !this.back;
              this.renderContent(view);
            },
          }),
        ),
      );
      this.el.append(wrap);
    } else {
      this.el.append(h('div', { class: 'sheet', text: view.text }));
    }
  }
}

// ═══════════════ телефон ═══════════════

export function openPhone(host: ModalHost, session: GameSession, onCall: (sceneId: string) => void): void {
  const s = session.state;
  const list = h('div', { class: 'contacts' });
  const canCall = session.canAct();
  for (const c of session.shift.contacts) {
    if (!c.visible(s)) continue;
    list.append(
      h(
        'button',
        {
          class: 'btn contact',
          type: 'button',
          disabled: !canCall,
          onclick: () => {
            host.close();
            onCall(c.scene(s));
          },
        },
        h('span', { text: resolveText(c.name, s) }),
        h('span', { class: 'num', text: c.number }),
      ),
    );
  }
  const body = h(
    'div',
    {},
    h('p', { class: 'muted-note', style: 'margin-top:0', text: 'Стационарный телефон. Линия 1 — городская, линия 2 — внутренняя (склад).' }),
    list,
    canCall ? null : h('p', { class: 'muted-note', text: 'Сейчас не до звонков.' }),
  );
  host.open('phone', 'Телефон', body);
}

// ═══════════════ холодильник ═══════════════

export function openFridge(host: ModalHost, session: GameSession, onRecord: () => void): void {
  const s = session.state;
  const t = session.temperature();
  const hour = Math.min(5, Math.floor(s.minutes / 60));
  const recorded = s.tempLog[String(hour)] !== undefined;
  const sign = t > 0 ? '+' : t < 0 ? '−' : '';
  const body = h(
    'div',
    { class: 'thermo' },
    h('div', { class: 'muted-note', style: 'margin-top:0', text: 'Холодильник № 2 · напитки, молочная продукция' }),
    h('div', { class: `readout${t < 0 ? ' cold' : ''}`, text: `${sign}${Math.abs(t)} °C` }),
    h('div', {}, h('button', {
      class: 'btn primary',
      type: 'button',
      disabled: recorded,
      text: recorded ? `Записано за ${String(hour).padStart(2, '0')}:00` : `Записать в журнал (${String(hour).padStart(2, '0')}:00)`,
      onclick: () => {
        onRecord();
        host.close();
      },
    })),
    h('p', { class: 'muted-note', text: 'Памятка, п. 3: записывать каждый час.' }),
  );
  host.open('fridge', 'Термометр', body);
}

// ═══════════════ меню двери ═══════════════

export function openDoorMenu(
  root: HTMLElement,
  at: { x: number; y: number },
  session: GameSession,
  act: (event: 'door:listen' | 'door:open' | 'door:close') => void,
): () => void {
  const isOpen = session.state.serviceDoor === 'open';
  const canAct = session.canAct();
  const pop = h(
    'div',
    { class: 'popover', role: 'menu' },
    h('div', { class: 'title', text: 'Служебная дверь' }),
    h('button', { class: 'btn small', type: 'button', text: 'Прислушаться', onclick: () => done('door:listen') }),
    isOpen
      ? h('button', { class: 'btn small', type: 'button', text: 'Закрыть на ключ', onclick: () => done('door:close') })
      : h('button', { class: 'btn small danger', type: 'button', disabled: !canAct, text: 'Открыть', onclick: () => done('door:open') }),
    h('button', { class: 'btn small', type: 'button', text: 'Отойти', onclick: () => close() }),
  );
  pop.style.left = `${Math.max(4, at.x)}px`;
  pop.style.top = `${Math.max(4, at.y)}px`;
  root.append(pop);
  const outside = (e: Event) => {
    if (!pop.contains(e.target as Node)) close();
  };
  window.setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  function close() {
    pop.remove();
    document.removeEventListener('pointerdown', outside);
  }
  function done(ev: 'door:listen' | 'door:open' | 'door:close') {
    close();
    act(ev);
  }
  return close;
}

// ═══════════════ камеры ═══════════════

const CAM_NAMES = ['', 'ЗАЛ', 'ВХОД', 'КАССА', 'СКЛАД'];

export class CamerasUI {
  readonly el: HTMLElement;
  private osd: HTMLElement;
  private bar: HTMLElement;
  private nosignal: HTMLElement;
  cam: 1 | 2 | 3 | 4 = 1;
  private seconds = 0;
  onSwitch: (cam: 1 | 2 | 3 | 4) => void = () => {};
  onClose: () => void = () => {};
  onPower: (on: boolean) => void = () => {};

  constructor(private session: () => GameSession) {
    this.osd = h('div', { class: 'osd' });
    this.bar = h('div', { class: 'bar' });
    this.nosignal = h('div', { class: 'nosignal', text: 'НЕТ СИГНАЛА' });
    this.el = h('div', { class: 'cctv-ui' }, this.osd, this.nosignal, this.bar);
  }

  get isOpen(): boolean {
    return this.el.isConnected;
  }

  render(): void {
    const s = this.session().state;
    clear(this.bar);
    for (const n of [1, 2, 3, 4] as const) {
      this.bar.append(
        h('button', {
          class: `cam-btn${this.cam === n ? ' active' : ''}`,
          type: 'button',
          text: `${n} ${CAM_NAMES[n]}`,
          onclick: () => this.onSwitch(n),
        }),
      );
    }
    if (this.cam === 4) {
      this.bar.append(
        h('button', {
          class: `cam-btn power${s.cam4On ? '' : ' off'}`,
          type: 'button',
          text: s.cam4On ? '⏻ Выключить камеру 4' : '⏻ Включить камеру 4',
          onclick: () => this.onPower(!s.cam4On),
        }),
      );
    }
    this.bar.append(h('button', { class: 'cam-btn', type: 'button', text: '✕ Закрыть', onclick: () => this.onClose() }));
    this.nosignal.style.display = this.cam === 4 && !s.cam4On ? '' : 'none';
    this.updateOsd();
  }

  tick(dt: number): void {
    this.seconds = (this.seconds + dt / 1000) % 60;
    if (this.isOpen) this.updateOsd();
  }

  private updateOsd(): void {
    const s = this.session().state;
    const t = `${formatTime(s.minutes)}:${String(Math.floor(this.seconds)).padStart(2, '0')}`;
    clear(this.osd);
    this.osd.append(
      `CAM 0${this.cam} · ${CAM_NAMES[this.cam]}`,
      h('br'),
      `15.11.25  ${t}  `,
      h('span', { class: 'rec', text: '● REC' }),
    );
  }
}
