import type { EventBus } from '../core/EventBus';
import type { ChoiceRequest, LineRequest } from '../core/Presenter';
import { clear, h } from './dom';

const SPEEDS = [Infinity, 70, 34];

/**
 * Диалоговая панель: реплики с эффектом печати, выбор вариантов (в т. ч. на время).
 * Продвижение — клик/тап по панели, Пробел или Enter. Выбор — клик или цифры 1–9.
 */
export class Dialog {
  readonly el: HTMLElement;
  private speakerEl: HTMLElement;
  private textEl: HTMLElement;
  private moreEl: HTMLElement;
  private promptEl: HTMLElement;
  private choicesEl: HTMLElement;
  private timerEl: HTMLElement;
  private advance: (() => void) | null = null;
  private choiceResolve: ((i: number) => void) | null = null;
  private choiceCount = 0;
  private revealing = false;
  private fullText = '';
  private shown = 0;
  private carry = 0;
  private timer: { total: number; left: number; def: number } | null = null;
  private speaker: string | null = null;
  textSpeed = 1;
  /** Звук «клика» на каждую реплику. */
  onBlip: (() => void) | null = null;

  constructor(private bus: EventBus) {
    this.speakerEl = h('div', { class: 'speaker' });
    this.textEl = h('div', { class: 'text' });
    this.moreEl = h('div', { class: 'more', text: '▼' });
    this.promptEl = h('div', { class: 'prompt' });
    this.choicesEl = h('div', { class: 'choices' });
    this.timerEl = h('div', { class: 'timer' }, h('div'));
    this.el = h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-live': 'polite' },
      this.speakerEl,
      this.textEl,
      this.moreEl,
      this.promptEl,
      this.timerEl,
      this.choicesEl,
    );
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.choice')) return;
      this.next();
    });
    bus.on('tick', ({ dt }) => this.tick(dt));
  }

  get active(): boolean {
    return this.advance !== null || this.choiceResolve !== null;
  }

  get choosing(): boolean {
    return this.choiceResolve !== null;
  }

  show(): void {
    this.el.classList.add('show');
  }

  hide(): void {
    this.el.classList.remove('show');
    this.stopSpeaking();
  }

  /** Пролистать реплику / дописать текст. */
  next(): void {
    if (this.revealing) {
      this.finishReveal();
      return;
    }
    if (this.advance) {
      const a = this.advance;
      this.advance = null;
      a();
    }
  }

  pick(i: number): void {
    if (!this.choiceResolve || i < 0 || i >= this.choiceCount) return;
    const r = this.choiceResolve;
    this.choiceResolve = null;
    this.timer = null;
    clear(this.choicesEl);
    this.timerEl.style.display = 'none';
    this.promptEl.textContent = '';
    this.promptEl.className = 'prompt';
    r(i);
  }

  line(req: LineRequest): Promise<void> {
    this.show();
    this.resetChoice();
    this.stopSpeaking();
    clear(this.speakerEl);
    if (req.speakerName && req.kind !== 'narration' && req.kind !== 'system') {
      const name = h('span', { text: req.speakerName });
      if (req.color) name.style.color = req.color;
      this.speakerEl.append(name);
      if (req.kind === 'phone') this.speakerEl.append(h('span', { class: 'tag', text: '· в трубке' }));
      if (req.kind === 'voice') this.speakerEl.append(h('span', { class: 'tag', text: '· голос' }));
      this.speakerEl.style.display = '';
    } else {
      this.speakerEl.style.display = 'none';
    }
    this.textEl.className = `text ${req.kind}`;
    this.fullText = req.text;
    this.shown = 0;
    this.carry = 0;
    this.textEl.textContent = '';
    this.moreEl.style.display = 'none';
    this.revealing = true;
    this.speaker = req.kind === 'speech' || req.kind === 'voice' ? req.speaker : null;
    if (this.speaker) this.bus.emit('speaking', { who: this.speaker, on: true });
    this.onBlip?.();
    if (SPEEDS[this.textSpeed] === Infinity) this.finishReveal();
    return new Promise((resolve) => {
      this.advance = resolve;
    });
  }

  choose(req: ChoiceRequest): Promise<number> {
    this.show();
    if (this.revealing) this.finishReveal();
    this.moreEl.style.display = 'none';
    this.advance = null;
    this.promptEl.className = `prompt style-${req.style}`;
    this.promptEl.textContent = req.prompt ?? '';
    this.promptEl.style.display = req.prompt ? '' : 'none';
    clear(this.choicesEl);
    this.choiceCount = req.options.length;
    req.options.forEach((opt, i) => {
      const b = h(
        'button',
        { class: `choice ${opt.tone}`, type: 'button', onclick: () => this.pick(i) },
        h('span', { class: 'n', text: `${i + 1}.` }),
        h('span', { text: opt.text }),
      );
      this.choicesEl.append(b);
    });
    if (req.timer) {
      this.timer = { total: req.timer.seconds * 1000, left: req.timer.seconds * 1000, def: req.timer.defaultIndex };
      this.timerEl.style.display = '';
      this.timerEl.classList.remove('urgent');
      (this.timerEl.firstElementChild as HTMLElement).style.transform = 'scaleX(1)';
    } else {
      this.timer = null;
      this.timerEl.style.display = 'none';
    }
    // Если предыдущей реплики не было — скрыть пустой текст.
    if (!this.textEl.textContent) {
      this.speakerEl.style.display = 'none';
    }
    this.el.scrollTop = this.el.scrollHeight;
    return new Promise((resolve) => {
      this.choiceResolve = resolve;
    });
  }

  /** Сбросить ожидания (перезапуск игры). */
  cancel(): void {
    this.advance = null;
    this.choiceResolve = null;
    this.timer = null;
    this.revealing = false;
    clear(this.choicesEl);
    this.textEl.textContent = '';
    this.hide();
  }

  clearText(): void {
    this.textEl.textContent = '';
    this.speakerEl.style.display = 'none';
  }

  private resetChoice(): void {
    clear(this.choicesEl);
    this.promptEl.textContent = '';
    this.promptEl.style.display = 'none';
    this.timerEl.style.display = 'none';
    this.timer = null;
  }

  private finishReveal(): void {
    this.revealing = false;
    this.shown = this.fullText.length;
    this.textEl.textContent = this.fullText;
    this.moreEl.style.display = this.advance || !this.choiceResolve ? '' : 'none';
    this.stopSpeaking();
  }

  private stopSpeaking(): void {
    if (this.speaker) {
      this.bus.emit('speaking', { who: this.speaker, on: false });
      this.speaker = null;
    }
  }

  private tick(dt: number): void {
    if (this.revealing) {
      const cps = SPEEDS[this.textSpeed] ?? 70;
      this.carry += (dt / 1000) * cps;
      const add = Math.floor(this.carry);
      if (add > 0) {
        this.carry -= add;
        this.shown = Math.min(this.fullText.length, this.shown + add);
        this.textEl.textContent = this.fullText.slice(0, this.shown);
        if (this.shown >= this.fullText.length) this.finishReveal();
      }
    }
    if (this.timer && this.choiceResolve) {
      this.timer.left -= dt;
      const k = Math.max(0, this.timer.left / this.timer.total);
      (this.timerEl.firstElementChild as HTMLElement).style.transform = `scaleX(${k})`;
      this.timerEl.classList.toggle('urgent', k < 0.3);
      if (this.timer.left <= 0) this.pick(this.timer.def);
    }
  }
}
