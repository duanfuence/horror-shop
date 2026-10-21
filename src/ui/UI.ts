import type { EventBus } from '../core/EventBus';
import type { GameSession } from '../core/GameSession';
import type { ChoiceRequest, LineRequest, Presenter, SaleRequest } from '../core/Presenter';
import type { SaveManager, Settings } from '../core/SaveManager';
import type { SaleResult, SfxId } from '../core/types';
import type { Platform } from '../platform/Platform';
import { Dialog } from './Dialog';
import { h } from './dom';
import { Hud, type ToolId } from './Hud';
import { CamerasUI, Journal, ModalHost, PaperOverlay, openDoorMenu, openFridge, openPhone, type JournalTab } from './Panels';
import { Register } from './Register';
import { aboutModal, askName, endingsModal, menuScreen, pauseModal, resultsScreen, settingsModal } from './Screens';

/** То, что интерфейсу нужно от сцены Phaser. */
export interface StageBridge {
  setMode(mode: 'menu' | 'game'): void;
  openCctv(cam: 1 | 2 | 3 | 4): void;
  closeCctv(): void;
  setEffects(on: boolean): void;
  /** Перевести координаты сцены (320×180) в пиксели внутри #stage-wrap. */
  toScreen(x: number, y: number): { x: number; y: number };
}

export interface AudioPort {
  play(id: SfxId): void;
  unlock(): void;
  setSettings(s: Settings): void;
  setPaused(paused: boolean): void;
  setMode(mode: 'menu' | 'game' | 'off'): void;
}

export type HotspotId =
  | 'fridge'
  | 'monitor'
  | 'phone'
  | 'logbook'
  | 'register'
  | 'door'
  | 'photo'
  | 'calendar'
  | 'window'
  | 'customer';

/**
 * Контроллер интерфейса: строит DOM, раскладывает его под экран,
 * реализует Presenter для ядра и связывает ввод игрока с игровой сессией.
 */
export class UI implements Presenter {
  readonly app: HTMLElement;
  readonly stageEl: HTMLElement;
  private stageWrap: HTMLElement;
  private overlays: HTMLElement;
  private screens: HTMLElement;
  private hud = new Hud();
  private dialog: Dialog;
  private register: Register;
  private modals: ModalHost;
  private journal!: Journal;
  private paper!: PaperOverlay;
  private cams!: CamerasUI;
  private session!: GameSession;
  private stage!: StageBridge;
  private waits: { left: number; resolve: () => void }[] = [];
  private closeDoorMenu: (() => void) | null = null;
  private mode: 'menu' | 'game' | 'results' = 'menu';
  private startedAt = 0;
  private lastCam: 1 | 2 | 3 | 4 = 1;
  private portrait = false;

  constructor(
    private bus: EventBus,
    private save: SaveManager,
    private audio: AudioPort,
    private platform: Platform,
  ) {
    this.dialog = new Dialog(bus);
    this.dialog.onBlip = () => undefined;
    this.register = new Register(bus);
    this.stageEl = h('div', { id: 'stage' });
    this.overlays = h('div', { id: 'overlays' });
    this.screens = h('div', { id: 'screens' });
    const dock = h('div', { id: 'dock' }, this.register.el, this.dialog.el);
    this.stageWrap = h(
      'div',
      { id: 'stage-wrap' },
      this.stageEl,
      h('div', { id: 'scanlines' }),
      this.hud.el,
      this.hud.toasts,
      dock,
      this.overlays,
    );
    const modalRoot = h('div', { id: 'modals' });
    this.app = h('div', { id: 'app' }, this.stageWrap, this.screens, modalRoot);
    this.modals = new ModalHost(modalRoot);
  }

  /** Подключить сессию и сцену. Вызывается один раз при старте. */
  attach(session: GameSession, stage: StageBridge): void {
    this.session = session;
    this.stage = stage;
    this.journal = new Journal(this.modals, () => this.session);
    this.paper = new PaperOverlay(this.overlays, () => this.session);
    this.cams = new CamerasUI(() => this.session);
    this.cams.onSwitch = (cam) => this.switchCam(cam);
    this.cams.onClose = () => this.closeCameras();
    this.cams.onPower = (on) => {
      this.session.setCam4(on);
      this.audio.play('click');
      this.cams.render();
    };
    this.register.onSfx = (id) => this.audio.play(id);
    this.register.onInspect = () => this.session.inspectCustomer();
    this.register.onOpenJournal = (tab) => this.journal.open(tab as JournalTab);
    this.hud.onTool = (id) => this.tool(id);
    this.hud.onPause = () => this.pause();

    const bus = this.bus;
    bus.on('state:changed', () => this.refreshHud());
    bus.on('clock:minute', () => this.refreshHud());
    bus.on('tick', ({ dt }) => this.tick(dt));
    bus.on('toast', ({ text }) => this.hud.toast(text));
    bus.on('paper', (view) => this.paper.show(view));
    bus.on('sfx', ({ id }) => this.audio.play(id));
    bus.on('journal:new', ({ tab }) => {
      this.journal.markNew(tab);
      this.refreshHud();
    });
    bus.on('phone:ring', ({ ringing }) => this.hud.setTool('phone', { ringing }));
    bus.on('shift:end', ({ endingId }) => this.onShiftEnd(endingId));
    bus.on('hint:object', () => this.refreshHud());

    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
    document.addEventListener('keydown', (e) => this.onKey(e));
    const unlock = () => this.audio.unlock();
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    this.applySettings(this.save.settings);
    this.layout();
  }

  // ═══════════════ раскладка ═══════════════

  layout(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.portrait = vh > vw * 1.1;
    let w: number;
    let hgt: number;
    if (this.portrait) {
      w = vw;
      hgt = Math.round((vw * 9) / 16);
    } else {
      w = Math.min(vw, Math.round((vh * 16) / 9));
      hgt = Math.round((w * 9) / 16);
    }
    this.app.style.setProperty('--stage-w', `${w}px`);
    this.app.style.setProperty('--stage-h', `${hgt}px`);
    this.app.style.setProperty('--app-h', `${vh}px`);
    this.app.classList.toggle('portrait', this.portrait);
    this.app.classList.toggle('landscape', !this.portrait);
  }

  // ═══════════════ Presenter ═══════════════

  line(req: LineRequest): Promise<void> {
    this.closeTransient();
    const p = this.dialog.line(req);
    this.refreshHud();
    return p.then(() => this.refreshHud());
  }

  choose(req: ChoiceRequest): Promise<number> {
    this.closeTransient();
    const p = this.dialog.choose(req);
    this.refreshHud();
    return p.then((i) => {
      this.audio.play('click');
      this.refreshHud();
      return i;
    });
  }

  sale(req: SaleRequest): Promise<SaleResult> {
    this.dialog.hide();
    this.dialog.clearText();
    const p = this.register.run(req);
    this.refreshHud();
    return p.then((r) => {
      this.refreshHud();
      return r;
    });
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.waits.push({ left: ms, resolve }));
  }

  dialogStart(): void {
    this.closeTransient();
    this.refreshHud();
  }

  dialogEnd(): void {
    this.dialog.hide();
    this.dialog.clearText();
    this.refreshHud();
  }

  // ═══════════════ экраны ═══════════════

  async showMenu(): Promise<void> {
    this.mode = 'menu';
    this.session.stop();
    this.resetGameUi();
    this.stage.setMode('menu');
    this.audio.setMode('menu');
    this.app.classList.add('in-menu');
    this.hud.el.style.display = 'none';
    const saved = await this.save.loadRun([this.session.shift.id]);
    this.screens.replaceChildren(
      menuScreen({
        canContinue: !!saved,
        shiftTitle: this.session.shift.title,
        actions: {
          newGame: () => askName(this.modals, this.save.meta.lastName || 'Саша', (name) => this.startNew(name)),
          continueGame: () => (saved ? this.startFromSave(saved) : undefined),
          settings: () => this.openSettings(),
          endings: () => endingsModal(this.modals, this.session.shift, this.save.meta),
          about: () => aboutModal(this.modals),
        },
      }),
    );
  }

  private enterGame(): void {
    this.mode = 'game';
    this.screens.replaceChildren();
    this.modals.close();
    this.resetGameUi();
    this.hud.el.style.display = '';
    this.app.classList.remove('in-menu');
    this.stage.setMode('game');
    this.audio.setMode('game');
    this.startedAt = performance.now();
    this.platform.gameplayStart();
  }

  private startNew(name: string): void {
    void this.save.saveName(name);
    void this.save.clearRun();
    this.enterGame();
    this.session.startNew(name);
    this.refreshHud();
  }

  private startFromSave(state: Parameters<GameSession['resume']>[0]): void {
    this.enterGame();
    this.session.resume(state);
    this.refreshHud();
  }

  private onShiftEnd(endingId: string): void {
    this.platform.gameplayStop();
    const state = this.session.state;
    const realSeconds = (performance.now() - this.startedAt) / 1000;
    void this.save.recordEnding(endingId, state.clues.length, state.playerName);
    this.closeTransient();
    this.register.cancel();
    window.setTimeout(() => {
      if (this.mode !== 'game') return;
      this.mode = 'results';
      this.dialog.cancel();
      this.audio.setMode('menu');
      this.hud.el.style.display = 'none';
      this.screens.replaceChildren(
        resultsScreen({
          shift: this.session.shift,
          state,
          meta: this.save.meta,
          totalClues: Object.keys(this.session.shift.clues).length,
          realSeconds,
          onRestart: () => void this.afterResults(() => askName(this.modals, state.playerName, (n) => this.startNew(n))),
          onMenu: () => void this.afterResults(() => void this.showMenu()),
        }),
      );
    }, 1600);
  }

  /** Межстраничная реклама — только в паузе между сменами, никогда во время игры. */
  private async afterResults(next: () => void): Promise<void> {
    this.audio.setPaused(true);
    try {
      await this.platform.showInterstitial();
    } finally {
      this.audio.setPaused(false);
      next();
    }
  }

  private resetGameUi(): void {
    this.dialog.cancel();
    this.register.cancel();
    this.modals.close();
    this.closeCameras();
    this.paper.show(null);
    this.hud.clearToasts();
    this.journal.reset();
    for (const w of this.waits) w.resolve();
    this.waits = [];
  }

  private openSettings(onClose?: () => void): void {
    settingsModal(
      this.modals,
      this.save.settings,
      (s) => {
        this.applySettings(s);
        void this.save.saveSettings(s);
      },
      onClose,
    );
  }

  private applySettings(s: Settings): void {
    this.audio.setSettings(s);
    this.dialog.textSpeed = s.textSpeed;
    this.app.classList.toggle('no-fx', !s.effects);
    this.stage?.setEffects(s.effects);
  }

  private pause(): void {
    if (this.mode !== 'game' || this.session.status !== 'running') return;
    this.session.setPaused('menu', true);
    this.audio.setPaused(true);
    pauseModal(this.modals, {
      resume: () => {
        this.session.setPaused('menu', false);
        this.audio.setPaused(false);
      },
      settings: () => {
        // Модалка паузы закроется — пауза сохраняется, пока открыты настройки.
        this.session.setPaused('settings', true);
        this.openSettings(() => {
          this.session.setPaused('settings', false);
          this.audio.setPaused(false);
        });
      },
      menu: () => {
        this.session.setPaused('menu', false);
        this.audio.setPaused(false);
        this.platform.gameplayStop();
        void this.showMenu();
      },
    });
  }

  /** Внешняя пауза (скрытая вкладка, платформа, реклама). */
  setExternalPause(reason: string, paused: boolean): void {
    this.session.setPaused(reason, paused);
    this.audio.setPaused(paused || this.session.paused);
  }

  // ═══════════════ инструменты и предметы ═══════════════

  private canUseTools(): boolean {
    return this.mode === 'game' && this.session.status === 'running' && !this.dialog.active;
  }

  tool(id: ToolId): void {
    if (this.mode !== 'game' || this.session.status !== 'running') return;
    if (id === 'journal') {
      if (this.modals.openId === 'journal') this.modals.close();
      else this.journal.open();
      this.refreshHud();
      this.audio.play('page');
      return;
    }
    if (!this.canUseTools()) {
      this.hud.toast('Сначала закончите разговор.', 2000);
      return;
    }
    if (id === 'cameras') {
      if (this.cams.isOpen) this.closeCameras();
      else this.openCameras();
      return;
    }
    if (id === 'phone') {
      if (this.register.active) {
        this.hud.toast('Покупатель ждёт. Сначала касса.', 2200);
        return;
      }
      openPhone(this.modals, this.session, (sceneId) => {
        this.audio.play('pickup');
        this.session.playScene(sceneId);
      });
      return;
    }
    if (id === 'fridge') {
      openFridge(this.modals, this.session, () => {
        this.session.recordTemperature();
        this.audio.play('thermo_beep');
        this.refreshHud();
      });
    }
  }

  onHotspot(id: HotspotId, gx: number, gy: number): void {
    if (this.mode !== 'game' || this.session.status !== 'running') return;
    this.audio.unlock();
    switch (id) {
      case 'fridge':
        return this.tool('fridge');
      case 'monitor':
        return this.tool('cameras');
      case 'phone':
        return this.tool('phone');
      case 'logbook':
        return this.tool('journal');
      case 'register':
        if (this.register.active) this.register.flash();
        else this.session.act('inspect:register');
        return;
      case 'customer':
        this.session.inspectCustomer();
        return;
      case 'photo':
      case 'calendar':
      case 'window':
        this.session.act(`inspect:${id}`);
        return;
      case 'door': {
        if (!this.canUseTools()) return;
        this.closeDoorMenu?.();
        const p = this.stage.toScreen(gx, gy);
        this.closeDoorMenu = openDoorMenu(this.overlays, { x: p.x + 8, y: p.y - 30 }, this.session, (ev) => {
          if (ev === 'door:open' && !this.session.canAct()) return;
          this.session.act(ev);
        });
      }
    }
  }

  onHover(label: string | null, gx = 0, gy = 0): void {
    if (!label || this.mode !== 'game') {
      this.hud.hover(null);
      return;
    }
    const p = this.stage.toScreen(gx, gy);
    this.hud.hover(label, p.x, p.y);
  }

  private openCameras(): void {
    if (this.cams.isOpen) return;
    this.session.openCameras();
    this.overlays.append(this.cams.el);
    this.app.classList.add('cctv-open');
    this.audio.play('static');
    this.switchCam(this.lastCam);
  }

  private switchCam(cam: 1 | 2 | 3 | 4): void {
    this.lastCam = cam;
    this.cams.cam = cam;
    this.session.viewCamera(cam);
    this.stage.openCctv(cam);
    this.bus.emit('cctv', { cam });
    this.audio.play('static');
    this.cams.render();
    this.refreshHud();
  }

  private closeCameras(): void {
    if (!this.cams?.isOpen) return;
    this.cams.el.remove();
    this.app.classList.remove('cctv-open');
    this.stage.closeCctv();
    this.bus.emit('cctv', { cam: null });
    this.session.closeCameras();
    this.refreshHud();
  }

  /** Закрыть всё, что мешает диалогу (камеры, окна, меню двери). */
  private closeTransient(): void {
    if (this.modals.openId && this.modals.openId !== 'pause' && this.modals.openId !== 'settings') this.modals.close();
    this.closeCameras();
    this.closeDoorMenu?.();
    this.closeDoorMenu = null;
  }

  // ═══════════════ обновление ═══════════════

  private tick(dt: number): void {
    if (this.waits.length) {
      for (const w of this.waits) w.left -= dt;
      const done = this.waits.filter((w) => w.left <= 0);
      this.waits = this.waits.filter((w) => w.left > 0);
      done.forEach((w) => w.resolve());
    }
    this.cams.tick(dt);
  }

  refreshHud(): void {
    if (!this.session || this.mode !== 'game') return;
    const s = this.session;
    this.hud.setClock(s.clockText(), !s.clockRunning);
    this.hud.setTasks(s.activeTasks());
    const tools = this.canUseTools();
    this.hud.setTool('cameras', { enabled: tools });
    this.hud.setTool('fridge', { enabled: tools });
    this.hud.setTool('phone', { enabled: tools && !this.register.active });
    this.hud.setTool('journal', { enabled: s.status === 'running', pulse: this.journal.hasNew });
    const hour = Math.min(5, Math.floor(s.state.minutes / 60));
    this.hud.setTool('fridge', { pulse: !!s.state.flags.rulesAccepted && s.state.tempLog[String(hour)] === undefined });
  }

  // ═══════════════ клавиатура ═══════════════

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const code = e.code;
    if (code === 'Escape') {
      if (this.closeDoorMenu) {
        this.closeDoorMenu();
        this.closeDoorMenu = null;
      } else if (this.modals.openId) this.modals.close();
      else if (this.cams.isOpen) this.closeCameras();
      else this.pause();
      e.preventDefault();
      return;
    }
    if (this.mode !== 'game' || this.session.status !== 'running' || this.modals.openId === 'pause') return;
    const digit = /^Digit([1-9])$/.exec(code) ?? /^Numpad([1-9])$/.exec(code);
    if (this.cams.isOpen && !this.modals.openId) {
      if (digit && Number(digit[1]) <= 4) return this.switchCam(Number(digit[1]) as 1 | 2 | 3 | 4);
      if (code === 'ArrowRight') return this.switchCam((((this.cams.cam % 4) + 1) as 1 | 2 | 3 | 4));
      if (code === 'ArrowLeft') return this.switchCam(((((this.cams.cam + 2) % 4) + 1) as 1 | 2 | 3 | 4));
      if (code === 'KeyC') return this.closeCameras();
      return;
    }
    if (this.modals.openId) {
      if (code === 'KeyJ' && this.modals.openId === 'journal') this.modals.close();
      return;
    }
    if (digit && this.dialog.choosing) {
      this.dialog.pick(Number(digit[1]) - 1);
      e.preventDefault();
      return;
    }
    if ((code === 'Space' || code === 'Enter' || code === 'NumpadEnter') && this.dialog.active && !this.dialog.choosing) {
      this.dialog.next();
      e.preventDefault();
      return;
    }
    if (this.register.active) {
      if (code === 'Space') {
        this.register.scanNext();
        e.preventDefault();
        return;
      }
      if (code === 'Enter') {
        this.register.confirm();
        e.preventDefault();
        return;
      }
    }
    const map: Record<string, ToolId> = { KeyC: 'cameras', KeyJ: 'journal', KeyP: 'phone', KeyT: 'fridge' };
    if (map[code]) {
      this.tool(map[code]);
      e.preventDefault();
    }
  }
}
