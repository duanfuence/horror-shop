import { h } from './dom';

const ICONS: Record<string, string> = {
  cameras:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="13" height="11" rx="1.5"/><path d="M16 10l5-3v10l-5-3"/></svg>',
  journal:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4h11a2 2 0 012 2v14H7a2 2 0 01-2-2z"/><path d="M5 18a2 2 0 012-2h11M9 8h6M9 11h5"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z"/></svg>',
  fridge:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v11"/><circle cx="12" cy="17" r="3"/><path d="M15 6h3M15 9h2"/></svg>',
};

/** SVG-иконки — статичная разметка без пользовательских данных. */
function icon(name: keyof typeof ICONS): HTMLElement {
  const span = h('span', { class: 'ico', 'aria-hidden': 'true' });
  span.innerHTML = ICONS[name];
  return span;
}

export type ToolId = 'cameras' | 'journal' | 'phone' | 'fridge';

/** Часы, список задач, кнопки инструментов, тосты и подписи над предметами. */
export class Hud {
  readonly el: HTMLElement;
  readonly toasts: HTMLElement;
  readonly hoverLabel: HTMLElement;
  private clock: HTMLElement;
  private tasks: HTMLElement;
  private tools = new Map<ToolId, HTMLButtonElement>();
  private lastTasks = '';
  onTool: (id: ToolId) => void = () => {};
  onPause: () => void = () => {};

  constructor() {
    this.clock = h('div', { class: 'clock', 'aria-label': 'Время' });
    this.tasks = h('div', { class: 'tasks', 'aria-live': 'polite' });
    const tools = h('div', { class: 'tools' });
    const defs: [ToolId, string, string][] = [
      ['cameras', 'Камеры', 'C'],
      ['journal', 'Журнал', 'J'],
      ['phone', 'Телефон', 'P'],
      ['fridge', 'Термометр', 'T'],
    ];
    for (const [id, label, key] of defs) {
      const b = h(
        'button',
        { class: 'tool', type: 'button', title: `${label} (${key})`, onclick: () => this.onTool(id) },
        icon(id),
        h('span', { class: 'label', text: label }),
        h('span', { class: 'key', text: key }),
      ) as HTMLButtonElement;
      this.tools.set(id, b);
      tools.append(b);
    }
    const pause = h('button', { class: 'pause-btn', type: 'button', 'aria-label': 'Пауза', title: 'Пауза (Esc)', text: '❚❚', onclick: () => this.onPause() });
    this.toasts = h('div', { id: 'toasts' });
    this.hoverLabel = h('div', { class: 'hover-label', style: 'display:none' });
    const topbar = h('div', { class: 'topbar' }, this.clock, tools);
    this.el = h('div', { id: 'hud' }, topbar, this.tasks, pause, this.hoverLabel);
  }

  setClock(text: string, paused: boolean): void {
    if (this.clock.textContent !== text) this.clock.textContent = text;
    this.clock.classList.toggle('paused', paused);
  }

  setTasks(tasks: { id: string; text: string; done: boolean }[]): void {
    const key = JSON.stringify(tasks);
    if (key === this.lastTasks) return;
    this.lastTasks = key;
    this.tasks.replaceChildren();
    if (!tasks.length) return;
    this.tasks.append(h('div', { class: 'title', text: 'Задачи' }));
    for (const t of tasks) {
      const alert = t.id === 'order' || t.id === 'door_open';
      this.tasks.append(h('div', { class: `task${t.done ? ' done' : ''}${alert ? ' alert' : ''}`, text: t.text }));
    }
  }

  setTool(id: ToolId, opts: { enabled?: boolean; pulse?: boolean; ringing?: boolean }): void {
    const b = this.tools.get(id);
    if (!b) return;
    if (opts.enabled !== undefined) b.disabled = !opts.enabled;
    if (opts.pulse !== undefined) b.classList.toggle('pulse', opts.pulse);
    if (opts.ringing !== undefined) b.classList.toggle('ringing', opts.ringing);
  }

  toast(text: string, ms?: number): void {
    for (const el of Array.from(this.toasts.children)) if (el.textContent === text && !el.classList.contains('out')) return;
    const t = h('div', { class: 'toast', role: 'status', text });
    const life = ms ?? Math.min(9000, 3200 + text.length * 45);
    const kill = () => {
      t.classList.add('out');
      window.setTimeout(() => t.remove(), 400);
    };
    t.addEventListener('click', kill);
    this.toasts.append(t);
    while (this.toasts.children.length > 2) this.toasts.firstElementChild?.remove();
    window.setTimeout(kill, life);
  }

  clearToasts(): void {
    this.toasts.replaceChildren();
  }

  hover(label: string | null, x = 0, y = 0): void {
    if (!label) {
      this.hoverLabel.style.display = 'none';
      return;
    }
    this.hoverLabel.textContent = label;
    this.hoverLabel.style.display = '';
    this.hoverLabel.style.left = `${x}px`;
    this.hoverLabel.style.top = `${y}px`;
  }
}
