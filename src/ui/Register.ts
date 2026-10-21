import type { EventBus } from '../core/EventBus';
import type { SaleItemView, SaleRequest } from '../core/Presenter';
import type { SaleResult } from '../core/types';
import { iconDataUrl } from '../game/art/items';
import { clear, formatRub, h } from './dom';

/**
 * Касса: игрок пробивает товары, видит запреты и неизвестные товары,
 * может спросить фамилию покупателя, продать или отказать.
 */
export class Register {
  readonly el: HTMLElement;
  private whoEl: HTMLElement;
  private itemsEl: HTMLElement;
  private vfdEl: HTMLElement;
  private answerEl: HTMLElement;
  private actionsEl: HTMLElement;
  private patienceEl: HTMLElement;
  private req: SaleRequest | null = null;
  private scanned: SaleItemView[] = [];
  private pending: SaleItemView[] = [];
  private askedName = false;
  private resolve: ((r: SaleResult) => void) | null = null;
  private patienceLeft = 0;
  /** Колбэки во внешний мир. */
  onSfx: (id: 'beep' | 'beep_error' | 'cash' | 'printer') => void = () => {};
  onInspect: () => void = () => {};
  onOpenJournal: (tab: string) => void = () => {};

  constructor(private bus: EventBus) {
    this.whoEl = h('span', { class: 'who' });
    this.itemsEl = h('div', { class: 'items' });
    this.vfdEl = h('div', { class: 'vfd' });
    this.answerEl = h('div');
    this.actionsEl = h('div', { class: 'actions' });
    this.patienceEl = h('div', { class: 'patience' });
    this.el = h(
      'div',
      { class: 'register', role: 'region', 'aria-label': 'Касса' },
      h(
        'div',
        { class: 'head' },
        h('strong', { text: 'Касса' }),
        this.whoEl,
        h('button', { class: 'btn small', type: 'button', onclick: () => this.onInspect(), text: 'Рассмотреть' }),
      ),
      h('div', { class: 'label', text: 'На прилавке — нажмите, чтобы пробить' }),
      this.itemsEl,
      h('div', { class: 'label', text: 'Чек' }),
      this.vfdEl,
      this.answerEl,
      this.actionsEl,
      this.patienceEl,
    );
    bus.on('tick', ({ dt }) => this.tick(dt));
  }

  get active(): boolean {
    return this.resolve !== null;
  }

  run(req: SaleRequest): Promise<SaleResult> {
    this.req = req;
    this.pending = [...req.items];
    this.scanned = [];
    this.askedName = false;
    this.patienceLeft = req.patienceSec * 1000;
    this.whoEl.textContent = `Покупатель: ${req.customerName}`;
    this.el.classList.add('show');
    this.bus.emit('sale:items', { items: req.items.map((i) => ({ key: i.key, icon: i.icon })) });
    this.render();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /** Пробить следующий товар (клавиша Пробел). */
  scanNext(): void {
    if (this.pending.length) this.scan(this.pending[0].key);
  }

  /** Enter — продать, если можно. */
  confirm(): void {
    if (this.canSell()) this.finish({ outcome: 'sold', askedName: this.askedName, overridden: false });
  }

  cancel(): void {
    this.resolve = null;
    this.req = null;
    this.el.classList.remove('show');
    this.bus.emit('sale:clear');
    this.bus.emit('register:display', null);
  }

  flash(): void {
    this.el.animate([{ borderColor: '#e9b35a' }, { borderColor: '' }], { duration: 700 });
  }

  private scan(key: string): void {
    const idx = this.pending.findIndex((i) => i.key === key);
    if (idx < 0) return;
    const item = this.pending.splice(idx, 1)[0];
    this.scanned.push(item);
    const bad = !item.inCatalog || item.alcohol;
    this.onSfx(bad ? 'beep_error' : 'beep');
    this.bus.emit('sale:scan', { key });
    this.bus.emit('register:display', {
      top: item.inCatalog ? item.name.toUpperCase().slice(0, 16) : 'НЕТ В БАЗЕ',
      bottom: item.alcohol ? 'ЗАПРЕТ 23-08' : `ИТОГО ${this.total()}`,
    });
    this.render();
  }

  private total(): number {
    return this.scanned.filter((i) => i.inCatalog || this.askedName).reduce((s, i) => s + i.price, 0);
  }

  private hasUnknown(): boolean {
    return this.scanned.some((i) => !i.inCatalog);
  }

  private hasAlcohol(): boolean {
    return this.scanned.some((i) => i.alcohol);
  }

  private canSell(): boolean {
    return this.pending.length === 0 && !this.hasAlcohol();
  }

  private render(): void {
    const req = this.req;
    if (!req) return;
    // товары на прилавке
    clear(this.itemsEl);
    this.itemsEl.classList.toggle('tutorial', req.tutorial && this.pending.length > 0);
    for (const item of this.pending) {
      this.itemsEl.append(
        h(
          'button',
          { class: 'item', type: 'button', onclick: () => this.scan(item.key), title: 'Пробить' },
          h('img', { src: iconDataUrl(item.icon), alt: '' }),
          h('span', { text: item.name }),
        ),
      );
    }
    if (!this.pending.length) this.itemsEl.append(h('span', { class: 'muted-note', text: 'Всё пробито.' }));
    // чек
    clear(this.vfdEl);
    if (!this.scanned.length) this.vfdEl.append(h('div', { class: 'empty', text: '— ожидание —' }));
    for (const item of this.scanned) {
      const bad = !item.inCatalog || item.alcohol;
      this.vfdEl.append(
        h(
          'div',
          { class: `row${bad ? ' bad' : ''}` },
          h('span', { text: item.name }),
          h(
            'span',
            { text: item.alcohol ? 'ЗАПРЕТ 23:00–08:00' : item.inCatalog ? formatRub(item.price) : 'НЕТ В БАЗЕ' },
          ),
        ),
      );
    }
    if (this.scanned.length)
      this.vfdEl.append(h('div', { class: 'row total' }, h('span', { text: 'ИТОГО' }), h('span', { text: formatRub(this.total()) })));
    // ответ покупателя
    clear(this.answerEl);
    if (this.askedName && req.nameAnswer) {
      this.answerEl.append(
        h(
          'div',
          { class: 'answer' },
          h('div', { text: `— ${req.nameAnswer}` }),
          h(
            'div',
            { class: 'hint' },
            'Памятка, п. 4: сверить с журналом постоянных покупателей. ',
            h('button', { class: 'btn small', type: 'button', onclick: () => this.onOpenJournal('regulars'), text: 'Открыть журнал' }),
          ),
        ),
      );
    }
    // действия
    clear(this.actionsEl);
    const unknown = this.hasUnknown();
    const alcohol = this.hasAlcohol();
    const sell = h('button', {
      class: 'btn primary',
      type: 'button',
      disabled: !this.canSell(),
      text: unknown ? 'Продать (цена с этикетки)' : 'Продать',
      onclick: () => this.finish({ outcome: 'sold', askedName: this.askedName, overridden: false }),
    });
    this.actionsEl.append(sell);
    if (unknown && req.nameAnswer && !this.askedName) {
      this.actionsEl.append(
        h('button', {
          class: 'btn',
          type: 'button',
          text: 'Спросить фамилию',
          onclick: () => {
            this.askedName = true;
            this.bus.emit('speaking', { who: req.customerId, on: true });
            window.setTimeout(() => this.bus.emit('speaking', { who: req.customerId, on: false }), 1200);
            this.render();
          },
        }),
      );
    }
    if (alcohol && this.pending.length === 0) {
      this.actionsEl.append(
        h('button', {
          class: 'btn danger',
          type: 'button',
          text: 'Пробить как «Минеральная вода»',
          onclick: () => this.finish({ outcome: 'sold', askedName: this.askedName, overridden: true }),
        }),
      );
    }
    this.actionsEl.append(
      h('button', {
        class: 'btn',
        type: 'button',
        text: 'Отказать',
        onclick: () => this.finish({ outcome: 'refused', askedName: this.askedName, overridden: false }),
      }),
    );
    this.renderPatience();
  }

  private renderPatience(): void {
    const req = this.req;
    if (!req) return;
    const k = Math.max(0, this.patienceLeft / (req.patienceSec * 1000));
    const text = k > 0.6 ? 'Покупатель ждёт.' : k > 0.3 ? 'Покупатель поглядывает на часы.' : 'Покупатель нетерпеливо стучит пальцами по прилавку.';
    if (!this.patienceEl.firstChild) {
      this.patienceEl.append(h('span'), h('div', { class: 'bar' }, h('div')));
    }
    (this.patienceEl.firstChild as HTMLElement).textContent = text;
    const bar = this.patienceEl.querySelector('.bar > div') as HTMLElement;
    bar.style.transform = `scaleX(${k})`;
    this.patienceEl.classList.toggle('low', k < 0.3);
  }

  private tick(dt: number): void {
    if (!this.resolve || !this.req) return;
    this.patienceLeft -= dt;
    this.renderPatience();
    if (this.patienceLeft <= 0) this.finish({ outcome: 'timeout', askedName: this.askedName, overridden: false });
  }

  private finish(result: SaleResult): void {
    const r = this.resolve;
    if (!r) return;
    this.resolve = null;
    if (result.outcome === 'sold') {
      this.onSfx('cash');
      this.bus.emit('register:display', { top: 'СПАСИБО', bottom: `ИТОГО ${this.total()}` });
      window.setTimeout(() => this.onSfx('printer'), 250);
      // Через несколько секунд дисплей возвращается в режим ожидания (если не началась новая продажа).
      window.setTimeout(() => {
        if (!this.resolve) this.bus.emit('register:display', null);
      }, 3500);
    } else {
      this.bus.emit('register:display', null);
    }
    this.el.classList.remove('show');
    this.bus.emit('sale:clear');
    this.req = null;
    r(result);
  }
}
