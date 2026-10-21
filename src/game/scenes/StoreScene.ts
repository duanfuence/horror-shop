import Phaser from 'phaser';
import type { EventBus } from '../../core/EventBus';
import type { GameSession } from '../../core/GameSession';
import { CHARACTER_SPECS, CHAR_EYE_Y } from '../art/characters';
import { PixelCanvas } from '../art/PixelCanvas';
import { drawText } from '../art/pixelFont';
import { MONITOR_SCREEN, PHONE_LEDS, REGISTER_DISPLAY, THERMO, VP } from '../art/store';
import { charKey } from '../textures';
import type { HotspotId } from '../../ui/UI';

export interface StoreDeps {
  bus: EventBus;
  session: () => GameSession;
  onHotspot(id: HotspotId, x: number, y: number): void;
  onHover(label: string | null, x?: number, y?: number): void;
}

const D = {
  outside: 0,
  headlights: 1,
  base: 2,
  door: 3,
  aisle: 4,
  walker: 5,
  customer: 6,
  counter: 7,
  items: 8,
  dark: 20,
  emissive: 21,
  flash: 22,
  frost: 30,
  vignette: 31,
  grain: 32,
  hint: 40,
};

const HOTSPOTS: { id: HotspotId; label: string; rect: [number, number, number, number] }[] = [
  { id: 'window', label: 'Витрина', rect: [66, 22, 84, 70] },
  { id: 'photo', label: 'Фото «Сотрудник месяца»', rect: [48, 44, 14, 23] },
  { id: 'calendar', label: 'Календарь', rect: [36, 37, 12, 25] },
  { id: 'door', label: 'Служебная дверь', rect: [3, 44, 36, 58] },
  { id: 'fridge', label: 'Холодильник № 2 — термометр', rect: [256, 38, 64, 80] },
  { id: 'monitor', label: 'Камеры наблюдения', rect: [3, 99, 66, 53] },
  { id: 'phone', label: 'Телефон', rect: [65, 131, 41, 28] },
  { id: 'logbook', label: 'Журнал смены', rect: [102, 145, 45, 25] },
  { id: 'register', label: 'Касса', rect: [232, 104, 77, 58] },
];

const CUSTOMER_X = 146;

export class StoreScene extends Phaser.Scene {
  private deps: StoreDeps;
  private unsub: (() => void)[] = [];
  private customer!: Phaser.GameObjects.Image;
  private customerZone!: Phaser.GameObjects.Zone;
  private current: { id: string; variant: string } | null = null;
  private talking = false;
  private talkTimer = 0;
  private talkFrame = false;
  private blinkTimer = 2000;
  private blinking = 0;
  private dark!: Phaser.GameObjects.RenderTexture;
  private flashGlow!: Phaser.GameObjects.Image;
  private frost!: Phaser.GameObjects.Image;
  private grain!: Phaser.GameObjects.TileSprite;
  private doorOpen!: Phaser.GameObjects.Image;
  private aisleFigure!: Phaser.GameObjects.Image;
  private monitorImg!: Phaser.GameObjects.Image;
  private monitorNoise!: Phaser.GameObjects.TileSprite;
  private monitorBar!: Phaser.GameObjects.Rectangle;
  private monitorCam = 1;
  private monitorTimer = 0;
  private vfdTex!: Phaser.Textures.CanvasTexture;
  private thermoTex!: Phaser.Textures.CanvasTexture;
  private leds!: Phaser.GameObjects.Graphics;
  private emergencyGlow!: Phaser.GameObjects.Image;
  private headlights!: Phaser.GameObjects.Image;
  private hintGfx!: Phaser.GameObjects.Graphics;
  private hintTarget: string | null = null;
  private items = new Map<string, Phaser.GameObjects.Image>();
  private ringing: Record<number, boolean> = { 1: false, 2: false };
  private flicker = 0;
  private flickerCooldown = 3000;
  private effects = true;
  private mode: 'menu' | 'game' = 'menu';
  private display: { top: string; bottom: string } | null = null;
  private lastThermo = '';
  private lastVfd = '';
  private carTimer = 9000;

  constructor(deps: StoreDeps) {
    super({ key: 'store' });
    this.deps = deps;
  }

  create(): void {
    this.add.image(0, 0, 'store_outside').setOrigin(0).setDepth(D.outside);
    this.headlights = this.add.image(0, 0, 'light_big').setDepth(D.headlights).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(1.4, 0.6);
    this.add.image(0, 0, 'store_base').setOrigin(0).setDepth(D.base);
    this.doorOpen = this.add.image(0, 0, 'door_open').setOrigin(0).setDepth(D.door).setVisible(false);
    this.aisleFigure = this.add.image(206, 107, 'fig_dark').setOrigin(0.5, 1).setDepth(D.aisle).setScale(0.95).setVisible(false);

    this.customer = this.add.image(CUSTOMER_X, 0, '__DEFAULT').setOrigin(0.5, 0).setDepth(D.customer).setVisible(false);
    this.add.image(0, 0, 'store_counter').setOrigin(0).setDepth(D.counter);

    // экран монитора с камерами
    const s = MONITOR_SCREEN;
    this.monitorImg = this.add.image(s.x, s.y, 'cam1_s').setOrigin(0).setDepth(D.emissive).setDisplaySize(s.w, s.h);
    this.monitorNoise = this.add.tileSprite(s.x, s.y, s.w, s.h, 'noise').setOrigin(0).setDepth(D.emissive).setAlpha(0.22);
    this.monitorBar = this.add.rectangle(s.x, s.y, s.w, 2, 0xdfffee, 0.18).setOrigin(0).setDepth(D.emissive);

    // дисплей кассы и термометр — живые canvas-текстуры
    this.vfdTex = this.textures.createCanvas('vfd', REGISTER_DISPLAY.w, REGISTER_DISPLAY.h)!;
    this.add.image(REGISTER_DISPLAY.x, REGISTER_DISPLAY.y, 'vfd').setOrigin(0).setDepth(D.emissive);
    this.thermoTex = this.textures.createCanvas('thermo', 14, 6)!;
    this.add.image(THERMO.x, THERMO.y, 'thermo').setOrigin(0).setDepth(D.emissive);
    this.leds = this.add.graphics().setDepth(D.emissive);
    this.add.image(110, 21, 'light_small').setDepth(D.emissive).setBlendMode(Phaser.BlendModes.ADD).setTint(0x3cff8a).setAlpha(0.35).setScale(1.6, 0.8);
    this.emergencyGlow = this.add.image(110, 30, 'light_big').setDepth(D.emissive).setBlendMode(Phaser.BlendModes.ADD).setTint(0xff2a1a).setAlpha(0).setScale(2.2, 1.6);

    // свет и эффекты
    this.dark = this.add.renderTexture(0, 0, 320, 180).setOrigin(0).setDepth(D.dark);
    this.flashGlow = this.add.image(0, 0, 'light_big').setDepth(D.flash).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe2b0).setAlpha(0).setScale(1.1);
    this.frost = this.add.image(0, 0, 'frost').setOrigin(0).setDepth(D.frost).setAlpha(0);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDepth(D.vignette);
    this.grain = this.add.tileSprite(0, 0, 320, 180, 'noise').setOrigin(0).setDepth(D.grain).setAlpha(0.05);
    this.hintGfx = this.add.graphics().setDepth(D.hint);

    this.createHotspots();
    this.subscribe();
    this.drawVfd();
    this.drawThermo();
  }

  // ═══════════════ интерактивные зоны ═══════════════

  private createHotspots(): void {
    this.input.topOnly = true;
    for (const hs of HOTSPOTS) {
      const [x, y, w, h] = hs.rect;
      const zone = this.add.zone(x, y, w, h).setOrigin(0).setDepth(50).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (this.mode !== 'game') return;
        this.deps.onHover(null);
        this.deps.onHotspot(hs.id, p.x, p.y);
      });
      zone.on('pointerover', () => this.mode === 'game' && this.deps.onHover(hs.label, x + w / 2, y));
      zone.on('pointerout', () => this.deps.onHover(null));
    }
    this.customerZone = this.add.zone(CUSTOMER_X - 34, 47, 68, 99).setOrigin(0).setDepth(60);
    this.customerZone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.deps.onHover(null);
      this.deps.onHotspot('customer', p.x, p.y);
    });
    this.customerZone.on('pointerover', () => this.deps.onHover('Рассмотреть', CUSTOMER_X, 50));
    this.customerZone.on('pointerout', () => this.deps.onHover(null));
  }

  // ═══════════════ события ═══════════════

  private subscribe(): void {
    const bus = this.deps.bus;
    this.unsub.push(
      bus.on('customer', (c) => this.setCustomer(c)),
      bus.on('speaking', ({ who, on }) => {
        if (this.current && who === this.current.id) {
          this.talking = on;
          if (!on) this.applyCustomerFrame('base');
        }
      }),
      bus.on('door', ({ state }) => this.doorOpen.setVisible(state === 'open')),
      bus.on('knock', ({ strength }) => this.cameras.main.shake(140, 0.004 * strength)),
      bus.on('phone:ring', ({ line, ringing }) => (this.ringing[line] = ringing)),
      bus.on('sale:items', ({ items }) => this.showItems(items)),
      bus.on('sale:scan', ({ key }) => this.scanItem(key)),
      bus.on('sale:clear', () => this.clearItems()),
      bus.on('register:display', (d) => {
        this.display = d;
        this.drawVfd();
      }),
      bus.on('hint:object', ({ target }) => (this.hintTarget = target)),
      bus.on('lights', () => (this.flicker = 0)),
      bus.on('printer', () => undefined),
      bus.on('sfx', ({ id }) => {
        if (id === 'printer') this.printAnim();
      }),
    );
    this.events.once('shutdown', () => this.unsub.forEach((u) => u()));
  }

  setMode(mode: 'menu' | 'game'): void {
    this.mode = mode;
    if (mode === 'menu') {
      this.setCustomer(null);
      this.clearItems();
      this.doorOpen.setVisible(false);
      this.hintTarget = null;
      this.display = null;
      this.drawVfd();
    } else {
      const s = this.deps.session().state;
      this.doorOpen.setVisible(s.serviceDoor === 'open');
    }
  }

  setEffects(on: boolean): void {
    this.effects = on;
    this.grain.setVisible(on);
  }

  // ═══════════════ покупатель ═══════════════

  private setCustomer(c: { id: string; variant: string } | null): void {
    const prev = this.current;
    this.current = c;
    this.talking = false;
    if (!c) {
      this.customerZone.disableInteractive();
      if (prev && this.customer.visible) {
        const eerie = prev.variant === 'v3' || prev.id === 'relief';
        this.tweens.add({
          targets: this.customer,
          alpha: 0,
          y: this.customer.y + (eerie ? 0 : 4),
          duration: eerie ? 120 : 450,
          onComplete: () => this.customer.setVisible(false),
        });
        if (!eerie) this.walker(false);
      }
      return;
    }
    const key = `${c.id}:${c.variant}`;
    const spec = CHARACTER_SPECS[key];
    const drop = spec?.drop ?? 0;
    this.customer.setTexture(charKey(c.id, c.variant, 'base'));
    const y = VP.y - CHAR_EYE_Y + drop;
    this.customer.setPosition(CUSTOMER_X, y + 5).setAlpha(0).setVisible(true);
    this.customerZone.setInteractive({ useHandCursor: true });
    const eerie = c.variant === 'v3' || c.id === 'relief';
    if (eerie) {
      // появляется рывком, с помехами
      this.customer.setPosition(CUSTOMER_X, y);
      this.tweens.add({ targets: this.customer, alpha: { from: 0, to: 1 }, duration: 60, yoyo: true, repeat: 2, onComplete: () => this.customer.setAlpha(1) });
    } else {
      this.walker(true);
      this.tweens.add({ targets: this.customer, alpha: 1, y, duration: 520, delay: 380, ease: 'Sine.easeOut' });
    }
  }

  /** Маленький силуэт, который проходит от входной двери к прилавку (или обратно). */
  private walker(entering: boolean): void {
    const fig = this.add.image(entering ? 110 : 150, entering ? 96 : 118, 'fig_dark').setOrigin(0.5, 1).setDepth(D.walker).setScale(entering ? 0.55 : 0.85).setAlpha(entering ? 0.9 : 0.6).setTint(0x8a9590);
    this.tweens.add({
      targets: fig,
      x: entering ? 150 : 110,
      y: entering ? 118 : 96,
      scale: entering ? 0.85 : 0.55,
      alpha: entering ? 0 : 0.9,
      duration: 600,
      onComplete: () => {
        if (!entering) this.tweens.add({ targets: fig, alpha: 0, duration: 200, onComplete: () => fig.destroy() });
        else fig.destroy();
      },
    });
  }

  private applyCustomerFrame(frame: 'base' | 'blink' | 'talk'): void {
    if (!this.current) return;
    this.customer.setTexture(charKey(this.current.id, this.current.variant, frame));
  }

  // ═══════════════ товары на прилавке ═══════════════

  private showItems(items: { key: string; icon: string }[]): void {
    this.clearItems();
    const n = items.length;
    const span = Math.min(50, (n - 1) * 13);
    items.forEach((it, i) => {
      const x = 180 - span / 2 + (n > 1 ? (i * span) / (n - 1) : span / 2);
      const img = this.add.image(Math.round(x), 160, `icon:${it.icon}`).setOrigin(0.5, 1).setDepth(D.items).setAlpha(0);
      this.tweens.add({ targets: img, alpha: 1, y: 158, duration: 200, delay: i * 70 });
      this.items.set(it.key, img);
    });
  }

  private scanItem(key: string): void {
    const img = this.items.get(key);
    if (!img) return;
    this.items.delete(key);
    this.tweens.add({ targets: img, x: 236, y: 150, alpha: 0, scale: 0.7, duration: 260, ease: 'Quad.easeIn', onComplete: () => img.destroy() });
  }

  private clearItems(): void {
    for (const img of this.items.values()) img.destroy();
    this.items.clear();
  }

  private printAnim(): void {
    const paper = this.add.rectangle(247, 121, 8, 1, 0xf2efe6).setOrigin(0.5, 1).setDepth(D.items);
    this.tweens.add({
      targets: paper,
      height: 14,
      duration: 900,
      onUpdate: () => paper.setSize(8, paper.height),
      onComplete: () => this.tweens.add({ targets: paper, alpha: 0, delay: 1400, duration: 400, onComplete: () => paper.destroy() }),
    });
  }

  // ═══════════════ дисплеи ═══════════════

  private drawVfd(): void {
    if (!this.vfdTex) return;
    const s = this.deps.session();
    const top = this.display?.top ?? (this.mode === 'game' ? 'КАССА' : 'КОЛОСОК');
    const bottom = this.display?.bottom ?? (this.mode === 'game' ? s.clockText() : '24 ЧАСА');
    const key = `${top}|${bottom}`;
    if (key === this.lastVfd) return;
    this.lastVfd = key;
    const pc = new PixelCanvas(REGISTER_DISPLAY.w, REGISTER_DISPLAY.h);
    pc.rect(0, 0, REGISTER_DISPLAY.w, REGISTER_DISPLAY.h, '#06120d');
    drawText(pc, 1, 0, top.slice(0, 10), '#6af2c9');
    drawText(pc, 1, 6, bottom.slice(0, 10), '#6af2c9');
    const ctx = this.vfdTex.context;
    ctx.clearRect(0, 0, REGISTER_DISPLAY.w, REGISTER_DISPLAY.h);
    ctx.drawImage(pc.commit(), 0, 0);
    this.vfdTex.refresh();
  }

  private drawThermo(): void {
    const s = this.deps.session();
    const t = this.mode === 'game' ? s.temperature() : 4;
    const text = `${t > 0 ? '+' : t < 0 ? '-' : ''}${Math.abs(t)}`;
    if (text === this.lastThermo) return;
    this.lastThermo = text;
    const pc = new PixelCanvas(14, 6);
    drawText(pc, 1, 0, text, t < 0 ? '#8fd8ff' : '#ff5a4a');
    const ctx = this.thermoTex.context;
    ctx.clearRect(0, 0, 14, 6);
    ctx.drawImage(pc.commit(), 0, 0);
    this.thermoTex.refresh();
  }

  // ═══════════════ кадр ═══════════════

  update(_time: number, delta: number): void {
    const session = this.deps.session();
    const s = session.state;
    const inGame = this.mode === 'game';
    const emergency = inGame && s.lights === 'emergency';
    const attention = inGame ? s.stats.attention : 1;
    const paused = session.paused;

    // мигание ламп: чем больше «внимание», тем чаще
    if (!emergency && !paused) {
      this.flickerCooldown -= delta;
      if (this.flickerCooldown <= 0) {
        this.flicker = 120 + Math.random() * 260;
        this.flickerCooldown = Math.max(1500, 16000 - attention * 1500) * (0.5 + Math.random());
      }
    }
    if (this.flicker > 0) this.flicker -= delta;
    const flickering = this.flicker > 0 && Math.floor(this.flicker / 45) % 2 === 0;

    // темнота и фонарик
    this.dark.clear();
    let darkness = inGame ? 0.1 + Math.min(0.18, attention * 0.015) : 0.22;
    if (flickering && this.effects) darkness += 0.4;
    if (emergency) darkness = 0.93;
    this.dark.fill(emergency ? 0x080203 : 0x000000, darkness);
    const p = this.input.activePointer;
    const lightOn = emergency && !!s.flags.flashlight;
    if (lightOn) {
      const px = p.x || 160;
      const py = p.y || 100;
      this.dark.erase('light_big', px - 40, py - 40);
      this.flashGlow.setPosition(px, py).setAlpha(0.18);
    } else {
      this.flashGlow.setAlpha(0);
    }
    this.emergencyGlow.setAlpha(emergency ? 0.25 + Math.sin(this.time.now / 300) * 0.05 : 0);
    if (emergency) {
      this.dark.erase('light_small', REGISTER_DISPLAY.x + 8, REGISTER_DISPLAY.y - 6);
      this.dark.erase('light_small', MONITOR_SCREEN.x + 9, MONITOR_SCREEN.y + 3);
    }

    // сменщик ждёт в темноте между стеллажами
    this.aisleFigure.setVisible(inGame && emergency && !!s.flags.reliefWaiting && !this.current);

    // иней
    const temp = inGame ? session.temperature() : 4;
    const frostTarget = temp < 0 ? Math.min(0.9, -temp / 9) : 0;
    this.frost.setAlpha(this.frost.alpha + (frostTarget - this.frost.alpha) * Math.min(1, delta / 600));

    // зерно
    if (this.effects) {
      this.grain.tilePositionX = Math.random() * 128;
      this.grain.tilePositionY = Math.random() * 128;
    }

    // мини-экран камер
    this.monitorTimer -= delta;
    if (this.monitorTimer <= 0) {
      this.monitorTimer = 4200;
      this.monitorCam = (this.monitorCam % 4) + 1;
      const off = inGame && this.monitorCam === 4 && !s.cam4On;
      this.monitorImg.setTexture(off ? 'noise' : `cam${this.monitorCam}_s`).setDisplaySize(MONITOR_SCREEN.w, MONITOR_SCREEN.h);
    }
    this.monitorNoise.tilePositionX = Math.random() * 128;
    this.monitorNoise.tilePositionY = Math.random() * 128;
    this.monitorBar.y = MONITOR_SCREEN.y + ((this.time.now / 40) % MONITOR_SCREEN.h);

    // покупатель: моргание и речь
    if (this.current && this.customer.visible) {
      if (this.talking) {
        this.talkTimer -= delta;
        if (this.talkTimer <= 0) {
          this.talkTimer = 110 + Math.random() * 60;
          this.talkFrame = !this.talkFrame;
          this.applyCustomerFrame(this.talkFrame ? 'talk' : 'base');
        }
      } else if (this.blinking > 0) {
        this.blinking -= delta;
        if (this.blinking <= 0) this.applyCustomerFrame('base');
      } else {
        this.blinkTimer -= delta;
        if (this.blinkTimer <= 0) {
          this.blinkTimer = 2200 + Math.random() * 3200;
          this.blinking = 130;
          this.applyCustomerFrame('blink');
        }
      }
      const tint = emergency ? 0x8a4a48 : 0xffffff;
      this.customer.setTint(tint);
    }

    // индикаторы телефона
    this.leds.clear();
    const blinkOn = Math.floor(this.time.now / 180) % 2 === 0;
    this.leds.fillStyle(this.ringing[1] && blinkOn ? 0x7dff9a : 0x1d2a20, 1).fillRect(PHONE_LEDS.line1.x, PHONE_LEDS.line1.y, 2, 2);
    this.leds.fillStyle(this.ringing[2] && blinkOn ? 0xff5a4a : 0x2a1a18, 1).fillRect(PHONE_LEDS.line2.x, PHONE_LEDS.line2.y, 2, 2);

    // фары проезжающих машин за витриной
    if (!paused) {
      this.carTimer -= delta;
      if (this.carTimer <= 0 && !emergency) {
        this.carTimer = 14000 + Math.random() * 20000;
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.headlights.setPosition(dir > 0 ? 50 : 170, 74).setAlpha(0.0);
        this.tweens.add({ targets: this.headlights, x: dir > 0 ? 170 : 50, duration: 2600, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: this.headlights, alpha: 0.32, duration: 1300, yoyo: true });
      }
    }

    // подсказка
    this.hintGfx.clear();
    if (inGame && this.hintTarget) {
      const hs = HOTSPOTS.find((x) => x.id === this.hintTarget);
      if (hs) {
        const a = 0.35 + Math.sin(this.time.now / 220) * 0.3;
        const [x, y, w, h] = hs.rect;
        this.hintGfx.lineStyle(1, 0xe9b35a, a).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    }

    if (inGame) {
      this.drawThermo();
      if (!this.display) this.drawVfd();
    }
  }
}
