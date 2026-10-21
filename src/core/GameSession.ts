import { EventBus } from './EventBus';
import type { Presenter, SaleItemView } from './Presenter';
import { createState, formatTime, parseTime, resolveText, SHIFT_END_MINUTES } from './state';
import type {
  Beat,
  CameraEvent,
  EffectContext,
  ShiftDef,
  Step,
  Trigger,
  WorldState,
  SaleResult,
} from './types';

class Aborted extends Error {
  constructor() {
    super('scene aborted');
  }
}

type Flow = 'continue' | 'stop';

export interface CustomerPresence {
  id: string;
  variant: string;
}

export type SessionStatus = 'idle' | 'running' | 'ended';

/**
 * Игровая сессия одной смены: часы, хронология событий, исполнение сцен,
 * реакции на действия игрока. Не зависит от Phaser и DOM.
 */
export class GameSession {
  state: WorldState;
  status: SessionStatus = 'idle';
  customer: CustomerPresence | null = null;
  /** Колбэк контрольной точки сохранения. */
  onCheckpoint: ((s: WorldState) => void) | null = null;

  private runToken = 0;
  private busy = false;
  private clockPauses = new Set<string>();
  private pauseReasons = new Set<string>();
  private msAcc = 0;
  private beats: (Beat & { atMin: number })[];
  private camEvents: (CameraEvent & { fromMin: number; toMin: number })[];
  private ctx: EffectContext;
  private currentSceneId: string | null = null;

  constructor(
    readonly shift: ShiftDef,
    readonly bus: EventBus,
    private presenter: Presenter,
  ) {
    this.state = createState(shift, 'Саша');
    this.beats = shift.timeline
      .map((b) => ({ ...b, atMin: parseTime(b.at) }))
      .sort((a, b) => a.atMin - b.atMin);
    this.camEvents = shift.cameraEvents.map((e) => ({
      ...e,
      fromMin: parseTime(e.from),
      toMin: parseTime(e.to),
    }));
    this.ctx = {
      emitToast: (text) => this.bus.emit('toast', { text: resolveText(text, this.state) }),
      emitJournal: (tab) => this.bus.emit('journal:new', { tab }),
    };
  }

  // ───────────── жизненный цикл ─────────────

  startNew(playerName: string): void {
    this.reset(createState(this.shift, playerName));
    this.status = 'running';
    this.runScene(this.shift.startScene, this.shift.scenes[this.shift.startScene]);
  }

  /** Продолжить с контрольной точки. */
  resume(saved: WorldState): void {
    this.reset(saved);
    delete this.state.flags.customer;
    delete this.state.flags.saleActive;
    this.status = 'running';
    this.bus.emit('lights', { mode: this.state.lights });
    this.bus.emit('door', { door: 'service', state: this.state.serviceDoor });
    this.bus.emit('flashlight', { on: Boolean(this.state.flags.flashlight) });
    this.bus.emit('toast', { text: `Смена продолжается. ${formatTime(this.state.minutes)}` });
    this.checkTimeline();
  }

  /** Полная остановка: прерывает текущую сцену. */
  stop(): void {
    this.runToken++;
    this.busy = false;
    this.status = 'idle';
    this.customer = null;
    this.clockPauses.clear();
    this.bus.emit('customer', null);
    this.bus.emit('paper', null);
    this.bus.emit('phone:ring', { line: 1, ringing: false });
    this.bus.emit('phone:ring', { line: 2, ringing: false });
  }

  private reset(state: WorldState): void {
    this.stop();
    this.state = state;
    this.msAcc = 0;
    this.currentSceneId = null;
    this.bus.emit('state:changed');
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get sceneId(): string | null {
    return this.currentSceneId;
  }

  /** Может ли игрок сейчас начать действие, запускающее сцену (звонок, дверь). */
  canAct(): boolean {
    return this.status === 'running' && !this.busy;
  }

  get clockRunning(): boolean {
    return this.status === 'running' && this.clockPauses.size === 0 && this.pauseReasons.size === 0;
  }

  setPaused(reason: string, paused: boolean): void {
    const was = this.pauseReasons.size > 0;
    if (paused) this.pauseReasons.add(reason);
    else this.pauseReasons.delete(reason);
    const now = this.pauseReasons.size > 0;
    if (was !== now) this.bus.emit('pause', { paused: now, reason });
  }

  get paused(): boolean {
    return this.pauseReasons.size > 0;
  }

  // ───────────── время ─────────────

  /** Вызывается каждый кадр с реальным временем в мс. */
  update(dtMs: number): void {
    if (this.status !== 'running' || this.paused) return;
    const dt = Math.min(dtMs, 250);
    this.bus.emit('tick', { dt });
    if (this.clockPauses.size > 0) return;
    if (this.state.minutes >= SHIFT_END_MINUTES) return;
    this.msAcc += dt;
    const msPerMinute = this.shift.secondsPerMinute * 1000;
    while (this.msAcc >= msPerMinute && this.status === 'running') {
      this.msAcc -= msPerMinute;
      this.advanceMinute();
      if (this.clockPauses.size > 0) break;
    }
  }

  /** Перемотка на n игровых минут (отладка, тесты). */
  skipMinutes(n: number): void {
    for (let i = 0; i < n && this.status === 'running' && this.state.minutes < SHIFT_END_MINUTES; i++) {
      if (this.clockPauses.size > 0) break;
      this.advanceMinute();
    }
  }

  private advanceMinute(): void {
    const s = this.state;
    s.minutes = Math.min(SHIFT_END_MINUTES, s.minutes + 1);
    if (s.minutes % 60 === 0) {
      this.shift.onHourEnd?.(s, s.minutes / 60 - 1, this.ctx);
    }
    this.bus.emit('clock:minute', { minutes: s.minutes });
    this.bus.emit('state:changed');
    this.checkTimeline();
    if (!this.busy && s.minutes % 5 === 0) this.checkpoint();
  }

  private checkpoint(): void {
    if (this.status !== 'running' || this.busy) return;
    if (this.state.flags.noSave) return;
    this.onCheckpoint?.(this.state);
  }

  // ───────────── хронология ─────────────

  private checkTimeline(): void {
    if (this.status !== 'running') return;
    const s = this.state;
    for (const beat of this.beats) {
      if (s.fired.includes(beat.id)) continue;
      if (s.minutes < beat.atMin) break;
      const window = beat.window ?? 30;
      if (s.minutes > beat.atMin + window) {
        s.fired.push(beat.id);
        continue;
      }
      if (beat.when && !beat.when(s)) continue;
      if (beat.ambient) {
        s.fired.push(beat.id);
        this.runAmbient(this.sceneSteps(beat.scene));
        continue;
      }
      if (this.busy) continue;
      s.fired.push(beat.id);
      this.runScene(beat.scene, this.sceneSteps(beat.scene));
    }
  }

  private sceneSteps(id: string): Step[] {
    const steps = this.shift.scenes[id];
    if (!steps) throw new Error(`Сцена не найдена: ${id}`);
    return steps;
  }

  // ───────────── исполнение сцен ─────────────

  private pauseClock(reason: string): void {
    this.clockPauses.add(reason);
  }

  private resumeClock(reason: string): void {
    this.clockPauses.delete(reason);
  }

  private runScene(id: string, steps: Step[]): void {
    this.busy = true;
    this.currentSceneId = id;
    const token = this.runToken;
    this.pauseClock('scene');
    this.presenter.dialogStart();
    this.bus.emit('state:changed');
    void this.execAll(steps, token)
      .catch((err) => {
        if (!(err instanceof Aborted)) console.error(`[scene ${id}]`, err);
      })
      .finally(() => {
        if (token !== this.runToken) return;
        this.presenter.dialogEnd();
        this.resumeClock('scene');
        this.busy = false;
        this.currentSceneId = null;
        this.bus.emit('state:changed');
        if (this.status === 'running') {
          this.checkpoint();
          this.checkTimeline();
        }
      });
  }

  private check(token: number): void {
    if (token !== this.runToken) throw new Aborted();
  }

  private async execAll(steps: Step[], token: number): Promise<Flow> {
    for (const step of steps) {
      this.check(token);
      const flow = await this.exec(step, token);
      if (flow === 'stop') return 'stop';
    }
    return 'continue';
  }

  private async exec(step: Step, token: number): Promise<Flow> {
    const s = this.state;
    switch (step.t) {
      case 'say': {
        const sp = this.shift.speakers[step.who];
        await this.presenter.line({
          speaker: step.who,
          speakerName: sp ? resolveText(sp.name, s) : step.who,
          color: sp?.color ?? null,
          text: resolveText(step.text, s),
          kind: step.kind ?? 'speech',
        });
        this.check(token);
        return 'continue';
      }
      case 'narr': {
        await this.presenter.line({
          speaker: null,
          speakerName: null,
          color: null,
          text: resolveText(step.text, s),
          kind: step.kind ?? 'narration',
        });
        this.check(token);
        return 'continue';
      }
      case 'choice': {
        const used = new Set<number>();
        for (;;) {
          const visible = step.options
            .map((o, i) => ({ o, i }))
            .filter(({ o, i }) => !used.has(i) && (!o.if || o.if(s)));
          if (visible.length === 0) return 'continue';
          let timer = null;
          if (step.timer) {
            let def = visible.findIndex(({ i }) => i === step.timer!.defaultIndex);
            if (def < 0) def = visible.length - 1;
            timer = { seconds: step.timer.seconds, defaultIndex: def };
          }
          const picked = await this.presenter.choose({
            prompt: step.prompt ? resolveText(step.prompt, s) : null,
            options: visible.map(({ o }) => ({ text: resolveText(o.text, s), tone: o.tone ?? 'normal' })),
            timer,
            style: step.style ?? 'dialog',
          });
          this.check(token);
          const chosen = visible[Math.max(0, Math.min(visible.length - 1, picked))];
          const flow = await this.execAll(chosen.o.next ?? [], token);
          if (flow === 'stop') return 'stop';
          if (step.loop && chosen.o.repeatable === 'loop') {
            used.add(chosen.i);
            continue;
          }
          return 'continue';
        }
      }
      case 'do':
        for (const effect of step.fx) effect(s, this.ctx);
        this.bus.emit('state:changed');
        return 'continue';
      case 'if':
        return this.execAll(step.cond(s) ? step.then : (step.else ?? []), token);
      case 'enter':
        this.customer = { id: step.who, variant: step.variant ?? 'v1' };
        s.flags.customer = `${step.who}:${this.customer.variant}`;
        if (step.bell !== false) this.bus.emit('sfx', { id: 'bell' });
        this.bus.emit('customer', this.customer);
        await this.presenter.wait(700);
        this.check(token);
        return 'continue';
      case 'leave':
        this.customer = null;
        delete s.flags.customer;
        this.bus.emit('customer', null);
        if (step.bell !== false) this.bus.emit('sfx', { id: 'bell' });
        this.presenter.dialogEnd();
        await this.presenter.wait(500);
        this.check(token);
        return 'continue';
      case 'sale': {
        const result = await this.runSale(step, token);
        step.after?.(s, result);
        this.bus.emit('state:changed');
        const branch =
          result.outcome === 'sold' ? step.onSold : result.outcome === 'refused' ? step.onRefused : step.onTimeout;
        return this.execAll(branch ?? [], token);
      }
      case 'sfx':
        this.bus.emit('sfx', { id: step.id });
        return 'continue';
      case 'wait':
        await this.presenter.wait(step.ms);
        this.check(token);
        return 'continue';
      case 'paper':
        this.bus.emit('paper', step.id ? this.paperView(step.id) : null);
        return 'continue';
      case 'ring':
        this.bus.emit('phone:ring', { line: step.line, ringing: step.ringing });
        return 'continue';
      case 'lights':
        s.lights = step.mode;
        this.bus.emit('lights', { mode: step.mode });
        return 'continue';
      case 'door':
        s.serviceDoor = step.state;
        this.bus.emit('door', { door: 'service', state: step.state });
        return 'continue';
      case 'knock':
        this.bus.emit('knock', { strength: step.strength ?? 1 });
        this.bus.emit('sfx', { id: 'knock' });
        return 'continue';
      case 'flashlight':
        s.flags.flashlight = step.on;
        this.bus.emit('flashlight', { on: step.on });
        return 'continue';
      case 'hint':
        this.bus.emit('hint:object', { target: step.target });
        return 'continue';
      case 'goto': {
        const flow = await this.execAll(this.sceneSteps(step.scene), token);
        void flow;
        return 'stop';
      }
      case 'end':
        this.finish(step.ending);
        return 'stop';
      case 'clear':
        this.presenter.dialogEnd();
        return 'continue';
    }
  }

  private async runSale(step: Extract<Step, { t: 'sale' }>, token: number): Promise<SaleResult> {
    const s = this.state;
    const items: SaleItemView[] = [];
    step.items.forEach((spec, idx) => {
      const p = this.shift.products[spec.product];
      if (!p) throw new Error(`Товар не найден в данных смены: ${spec.product}`);
      const qty = spec.qty ?? 1;
      for (let k = 0; k < qty; k++) {
        items.push({
          key: `${idx}-${k}`,
          productId: p.id,
          name: p.name,
          price: p.price,
          icon: p.icon,
          inCatalog: p.inCatalog,
          alcohol: Boolean(p.alcohol),
        });
      }
    });
    const customerId = this.customer?.id ?? 'unknown';
    const ch = this.shift.characters[customerId];
    // Во время работы за кассой часы идут: магазин живёт своей жизнью.
    this.resumeClock('scene');
    s.flags.saleActive = true;
    this.bus.emit('state:changed');
    let result: SaleResult;
    try {
      result = await this.presenter.sale({
        customerId,
        customerName: ch?.name ?? 'Покупатель',
        items,
        patienceSec: step.patience,
        nameAnswer: step.nameAnswer ? resolveText(step.nameAnswer, s) : null,
        tutorial: Boolean(step.tutorial),
      });
    } finally {
      if (token === this.runToken) {
        this.pauseClock('scene');
        delete s.flags.saleActive;
      }
    }
    this.check(token);
    s.sales.push({
      minutes: s.minutes,
      customer: customerId,
      items: items.map((i) => i.productId),
      total: items.reduce((sum, i) => sum + i.price, 0),
      outcome: result.outcome,
      overridden: result.overridden,
    });
    return result;
  }

  /** Неблокирующее исполнение: эффекты, звуки, короткие сообщения. */
  private runAmbient(steps: Step[]): void {
    const s = this.state;
    for (const step of steps) {
      switch (step.t) {
        case 'do':
          for (const effect of step.fx) effect(s, this.ctx);
          break;
        case 'if':
          this.runAmbient(step.cond(s) ? step.then : (step.else ?? []));
          break;
        case 'sfx':
          this.bus.emit('sfx', { id: step.id });
          break;
        case 'say':
        case 'narr':
          this.bus.emit('toast', { text: resolveText(step.text, s) });
          break;
        case 'lights':
          s.lights = step.mode;
          this.bus.emit('lights', { mode: step.mode });
          break;
        case 'knock':
          this.bus.emit('knock', { strength: step.strength ?? 1 });
          this.bus.emit('sfx', { id: 'knock' });
          break;
        case 'door':
          s.serviceDoor = step.state;
          this.bus.emit('door', { door: 'service', state: step.state });
          break;
        case 'hint':
          this.bus.emit('hint:object', { target: step.target });
          break;
        default:
          console.warn(`[ambient] шаг "${step.t}" не поддерживается в фоновом режиме`);
      }
    }
    this.bus.emit('state:changed');
  }

  private finish(endingId: string): void {
    if (this.status === 'ended') return;
    this.state.endingId = endingId;
    this.status = 'ended';
    this.customer = null;
    delete this.state.flags.customer;
    this.bus.emit('customer', null);
    this.bus.emit('shift:end', { endingId });
  }

  // ───────────── действия игрока ─────────────

  /**
   * Сообщить о действии игрока. Подходящие триггеры смены сработают:
   * неблокирующие — сразу, блокирующие — как сцена (только если игрок свободен).
   * Возвращает true, если была запущена блокирующая сцена.
   */
  act(event: string): boolean {
    if (this.status !== 'running') return false;
    const s = this.state;
    let startedScene = false;
    for (const trig of this.shift.triggers) {
      if (trig.on !== event) continue;
      if (!this.triggerReady(trig)) continue;
      if (trig.blocking) {
        if (this.busy || startedScene) continue;
        s.triggerLog[trig.id] = s.minutes;
        this.runScene(`trigger:${trig.id}`, trig.steps);
        startedScene = true;
      } else {
        s.triggerLog[trig.id] = s.minutes;
        this.runAmbient(trig.steps);
      }
    }
    return startedScene;
  }

  private triggerReady(trig: Trigger): boolean {
    const s = this.state;
    if (trig.when && !trig.when(s)) return false;
    const last = s.triggerLog[trig.id];
    if (last === undefined) return true;
    if (trig.cooldown === undefined || trig.cooldown === null) return false;
    return s.minutes - last >= trig.cooldown;
  }

  /** Запустить сцену по инициативе игрока (звонок). */
  playScene(sceneId: string): boolean {
    if (!this.canAct()) return false;
    this.runScene(sceneId, this.sceneSteps(sceneId));
    return true;
  }

  temperature(): number {
    return this.shift.temperature(this.state);
  }

  recordTemperature(): number {
    const s = this.state;
    const hour = Math.min(5, Math.floor(s.minutes / 60));
    const t = this.temperature();
    s.tempLog[String(hour)] = t;
    this.bus.emit('state:changed');
    this.act('fridge:record');
    return t;
  }

  openCameras(): void {
    this.state.camViews++;
    this.act('cameras:open');
  }

  closeCameras(): void {
    this.act('cameras:close');
  }

  /** Игрок переключился на камеру n. Возвращает видимые аномалии. */
  viewCamera(cam: 1 | 2 | 3 | 4): string[] {
    const s = this.state;
    const round = this.currentRound();
    if (round) {
      const seen = (s.camRounds[round] ??= []);
      if (!seen.includes(cam)) seen.push(cam);
    }
    const visuals: string[] = [];
    for (const ev of this.visibleCameraEvents(cam)) {
      visuals.push(ev.visual);
      const key = `cam:${ev.id}`;
      if (!s.fired.includes(key)) {
        s.fired.push(key);
        if (ev.onSeen) this.runAmbient(ev.onSeen);
      }
    }
    this.act(`camera:${cam}`);
    this.bus.emit('state:changed');
    return visuals;
  }

  /** Обход камер привязан к часу: 02:00–02:59 → '2', 04:00–04:59 → '4'. */
  currentRound(): string | null {
    const hour = Math.floor(this.state.minutes / 60);
    return hour === 2 || hour === 4 ? String(hour) : null;
  }

  visibleCameraEvents(cam: number): CameraEvent[] {
    const s = this.state;
    return this.camEvents.filter(
      (e) => e.cam === cam && s.minutes >= e.fromMin && s.minutes <= e.toMin && (!e.when || e.when(s)),
    );
  }

  setCam4(on: boolean): void {
    if (this.state.cam4On === on) return;
    this.state.cam4On = on;
    this.act(on ? 'cam4:on' : 'cam4:off');
    this.bus.emit('state:changed');
  }

  inspectCustomer(): void {
    if (!this.customer) return;
    const ch = this.shift.characters[this.customer.id];
    const ins = ch?.inspect?.[this.customer.variant];
    if (!ins) return;
    for (const effect of ins.fx ?? []) effect(this.state, this.ctx);
    this.bus.emit('toast', { text: resolveText(ins.text, this.state) });
    this.bus.emit('state:changed');
  }

  activeTasks(): { id: string; text: string; done: boolean }[] {
    const s = this.state;
    return this.shift.tasks
      .filter((t) => t.visible(s))
      .map((t) => ({ id: t.id, text: resolveText(t.text, s), done: t.done(s) }));
  }

  paperView(id: string) {
    const def = this.shift.papers[id];
    if (!def) throw new Error(`Документ не найден: ${id}`);
    return { id, kind: def.kind, text: resolveText(def.text, this.state) };
  }

  clockText(): string {
    return formatTime(this.state.minutes);
  }
}
