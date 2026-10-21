/**
 * Процедурный звук на Web Audio API: фоновые шумы магазина и эффекты.
 * Никаких внешних аудиофайлов — всё синтезируется при запуске.
 */
import type { EventBus } from '../core/EventBus';
import type { GameSession } from '../core/GameSession';
import type { Settings } from '../core/SaveManager';
import type { SfxId } from '../core/types';
import type { AudioPort } from '../ui/UI';

type Ctx = AudioContext;

export class AudioEngine implements AudioPort {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private amb!: GainNode;
  private sfx!: GainNode;
  private noiseBuf!: AudioBuffer;
  private hum!: GainNode;
  private buzz!: GainNode;
  private street!: GainNode;
  private drone!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private deep!: GainNode;
  private settings: Settings | null = null;
  private paused = false;
  private mode: 'menu' | 'game' | 'off' = 'off';
  private ringTimer: number | null = null;
  private carTimer: number | null = null;
  /** До какого момента (время AudioContext) холодильник молчит. */
  private humStopUntil = 0;

  constructor(
    bus: EventBus,
    private session: () => GameSession,
  ) {
    bus.on('phone:ring', ({ line, ringing }) => {
      if (line !== 1) return;
      if (this.ringTimer !== null) window.clearInterval(this.ringTimer);
      this.ringTimer = ringing ? window.setInterval(() => this.play('ring1'), 2800) : null;
    });
    bus.on('state:changed', () => this.updateMood());
    bus.on('lights', () => this.updateMood());
    bus.on('fx', ({ id }) => this.playFx(id));
  }

  /** Браузеры разрешают звук только после действия пользователя. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      this.build();
      if (this.settings) this.setSettings(this.settings);
      this.applyMode();
    }
    if (this.ctx.state === 'suspended' && !this.paused) void this.ctx.resume().catch(() => undefined);
  }

  setSettings(s: Settings): void {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.amb.gain.setTargetAtTime(s.ambience, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend().catch(() => undefined);
    else void this.ctx.resume().catch(() => undefined);
  }

  setMode(mode: 'menu' | 'game' | 'off'): void {
    this.mode = mode;
    if (mode !== 'game' && this.ringTimer !== null) {
      window.clearInterval(this.ringTimer);
      this.ringTimer = null;
    }
    this.applyMode();
  }

  // ═══════════════ фон ═══════════════

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.amb = ctx.createGain();
    this.amb.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    // белый шум
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // гул холодильников
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    this.hum.connect(this.amb);
    for (const [f, g, type] of [
      [50, 0.05, 'sine'],
      [100, 0.03, 'sine'],
      [150, 0.012, 'triangle'],
    ] as [number, number, OscillatorType][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(this.hum);
      o.start();
    }
    const humNoise = this.noise(ctx, 'lowpass', 260, 0.7);
    humNoise.gain.value = 0.05;
    humNoise.connect(this.hum);
    this.lfo(this.hum.gain, 0.07, 0.02);

    // жужжание ламп
    this.buzz = ctx.createGain();
    this.buzz.gain.value = 0;
    this.buzz.connect(this.amb);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 100;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 9;
    const sawG = ctx.createGain();
    sawG.gain.value = 0.05;
    saw.connect(bp).connect(sawG).connect(this.buzz);
    saw.start();

    // улица
    this.street = this.noise(ctx, 'lowpass', 420, 0.5);
    this.street.gain.value = 0;
    this.street.connect(this.amb);

    // напряжение: низкий расстроенный гул
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 180;
    this.droneFilter.connect(this.drone).connect(this.amb);
    for (const f of [55, 55.6, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o.connect(g).connect(this.droneFilter);
      o.start();
    }
    this.deep = ctx.createGain();
    this.deep.gain.value = 0;
    this.deep.connect(this.amb);
    const sub = ctx.createOscillator();
    sub.frequency.value = 36;
    sub.connect(this.deep);
    sub.start();
    this.lfo(this.deep.gain, 0.11, 0.03);
  }

  private noise(ctx: Ctx, type: BiquadFilterType, freq: number, q: number): GainNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f).connect(g);
    src.start();
    return g;
  }

  private lfo(param: AudioParam, rate: number, depth: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
  }

  private applyMode(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = this.mode !== 'off';
    this.street.gain.setTargetAtTime(on ? 0.04 : 0, t, 0.5);
    this.updateMood();
    if (this.carTimer === null && on) this.scheduleCar();
  }

  /** Фон зависит от состояния мира: внимание «той стороны», темнота. */
  private updateMood(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const inGame = this.mode === 'game' && this.session().status === 'running';
    const s = this.session().state;
    const blackout = inGame && s.lights === 'emergency';
    const attention = inGame ? s.stats.attention : 0;
    if (t >= this.humStopUntil) {
      this.hum.gain.setTargetAtTime(this.mode === 'off' || blackout ? 0 : 0.55, t, blackout ? 0.25 : 1);
    }
    this.buzz.gain.setTargetAtTime(this.mode === 'off' || blackout ? 0 : 0.35, t, 0.3);
    const tension = this.mode === 'menu' ? 0.08 : Math.min(1, attention / 10) * 0.5 + (blackout ? 0.45 : 0);
    this.drone.gain.setTargetAtTime(tension * 0.5, t, 2);
    this.droneFilter.frequency.setTargetAtTime(160 + tension * 260, t, 2);
    this.deep.gain.setTargetAtTime(blackout ? 0.18 : attention > 5 ? 0.06 : 0, t, 1.5);
  }

  private scheduleCar(): void {
    this.carTimer = window.setTimeout(() => {
      this.carTimer = null;
      if (this.mode === 'off') return;
      if (this.ctx && !this.paused) this.passingCar();
      this.scheduleCar();
    }, 15000 + Math.random() * 25000);
  }

  private passingCar(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(200, t);
    f.frequency.linearRampToValueAtTime(700, t + 2.2);
    f.frequency.linearRampToValueAtTime(250, t + 4.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 2.2);
    g.gain.linearRampToValueAtTime(0, t + 4.6);
    src.connect(f).connect(g).connect(this.amb);
    src.start(t);
    src.stop(t + 4.7);
  }

  // ═══════════════ эффекты ═══════════════

  /** Фоновые эффекты режиссёра тревоги, у которых есть звуковая сторона. */
  private playFx(id: string): void {
    if (!this.ctx || this.paused || this.ctx.state !== 'running' || this.mode !== 'game') return;
    const t = this.ctx.currentTime + 0.01;
    switch (id) {
      case 'fridge_stop':
        // Гудение обрывается, тишина — и компрессор запускается снова.
        this.humStopUntil = t + 2.6;
        this.hum.gain.cancelScheduledValues(t);
        this.hum.gain.setTargetAtTime(0, t, 0.06);
        this.hum.gain.setTargetAtTime(0.55, t + 2.6, 0.5);
        this.thump(t + 2.55, 0.08);
        break;
      case 'tube_buzz':
        this.buzz.gain.cancelScheduledValues(t);
        this.buzz.gain.setTargetAtTime(1.1, t, 0.05);
        this.buzz.gain.setTargetAtTime(0.35, t + 0.7, 0.2);
        break;
      case 'car_lights':
        // Машина стоит с работающим мотором.
        this.noiseBurst(t, 4.2, 0.05, 'lowpass', 140, 1.5, 22);
        break;
      case 'chill':
        this.noiseBurst(t, 1.6, 0.04, 'lowpass', 380, 0.6);
        break;
    }
  }

  play(id: SfxId): void {
    if (!this.ctx || this.paused || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    switch (id) {
      case 'bell':
        for (const [delay, k] of [
          [0, 1],
          [0.13, 0.55],
          [0.29, 0.3],
        ])
          for (const f of [2093, 2794, 3520, 4699]) this.tone(f, t + delay, 1.4, 0.03 * k, 'sine');
        break;
      case 'beep':
        this.tone(1850, t, 0.08, 0.06, 'square', 0.005);
        break;
      case 'beep_error':
        this.tone(330, t, 0.1, 0.07, 'square', 0.005);
        this.tone(330, t + 0.15, 0.1, 0.07, 'square', 0.005);
        break;
      case 'printer':
        this.noiseBurst(t, 0.9, 0.08, 'bandpass', 3200, 2, 28);
        break;
      case 'cash':
        this.noiseBurst(t, 0.25, 0.2, 'lowpass', 900, 1);
        this.tone(1250, t + 0.12, 0.35, 0.03, 'sine');
        this.tone(1760, t + 0.14, 0.3, 0.02, 'sine');
        this.tone(90, t, 0.18, 0.2, 'sine');
        break;
      case 'ring1':
        this.amTone(1150, 22, t, 1.25, 0.05);
        this.amTone(1380, 22, t, 1.25, 0.03);
        break;
      case 'ring2':
        this.amTone(780, 16, t, 0.9, 0.05);
        break;
      case 'knock':
        this.thump(t, 0.5);
        break;
      case 'knock_soft':
        this.thump(t, 0.25);
        break;
      case 'click':
      case 'pickup':
      case 'hangup':
        this.noiseBurst(t, 0.03, id === 'click' ? 0.12 : 0.25, 'highpass', 1500, 1);
        if (id === 'hangup') this.thump(t, 0.15);
        break;
      case 'static':
        this.noiseBurst(t, 0.28, 0.07, 'highpass', 1200, 0.7);
        break;
      case 'power_down':
        this.noiseBurst(t, 0.05, 0.3, 'lowpass', 2000, 1);
        this.sweep(110, 28, t, 1.6, 0.18);
        break;
      case 'power_up':
        this.noiseBurst(t, 0.05, 0.3, 'lowpass', 2000, 1);
        this.sweep(30, 100, t, 0.8, 0.12);
        break;
      case 'door_open':
        this.creak(t, 0.9);
        break;
      case 'door_slam':
        this.thump(t, 0.8);
        this.noiseBurst(t, 0.2, 0.25, 'lowpass', 700, 1);
        break;
      case 'wind':
        this.noiseBurst(t, 2.2, 0.08, 'lowpass', 500, 0.5);
        break;
      case 'whisper':
        this.noiseBurst(t, 1.3, 0.03, 'bandpass', 2600, 3, 9);
        break;
      case 'thermo_beep':
        this.tone(2600, t, 0.07, 0.04, 'sine', 0.003);
        this.tone(2600, t + 0.12, 0.07, 0.04, 'sine', 0.003);
        break;
      case 'tear':
        for (let i = 0; i < 4; i++) this.noiseBurst(t + i * 0.07, 0.06, 0.12, 'bandpass', 2400, 1.2);
        break;
      case 'steps':
        for (let i = 0; i < 4; i++) this.thump(t + i * 0.45, 0.12);
        break;
      case 'sting':
        this.tone(110, t, 2.2, 0.06, 'sine', 1.0);
        this.tone(113.5, t, 2.2, 0.05, 'sine', 1.0);
        break;
      case 'page':
        this.noiseBurst(t, 0.18, 0.05, 'highpass', 2500, 0.7);
        break;
      case 'drip':
        this.sweep(1500, 700, t, 0.08, 0.06, 'sine');
        break;
      case 'drips':
        for (const [d, f] of [
          [0, 1500],
          [0.9, 1350],
          [2.1, 1450],
        ])
          this.sweep(f, f / 2, t + d, 0.08, 0.04, 'sine');
        break;
      case 'scratch':
        this.noiseBurst(t, 1.3, 0.05, 'bandpass', 1900, 2.5, 13);
        break;
      case 'thud':
        this.thump(t, 0.6);
        this.sweep(70, 35, t, 0.5, 0.12, 'sine');
        break;
      case 'steps_far':
        for (let i = 0; i < 3; i++) this.thump(t + i * 0.55, 0.07);
        break;
      case 'glass_tap':
        for (let i = 0; i < 3; i++) {
          this.tone(1750, t + i * 0.32, 0.09, 0.05, 'triangle', 0.002);
          this.noiseBurst(t + i * 0.32, 0.03, 0.05, 'highpass', 3000, 1);
        }
        break;
      case 'clink':
        this.tone(1900, t, 0.5, 0.05, 'triangle', 0.002);
        this.tone(2750, t, 0.35, 0.03, 'triangle', 0.002);
        this.thump(t + 0.12, 0.06);
        for (let i = 0; i < 4; i++) this.noiseBurst(t + 0.3 + i * 0.16, 0.05, 0.02, 'bandpass', 1200, 2);
        break;
    }
  }

  private env(g: GainNode, t: number, dur: number, peak: number, attack = 0.005): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private tone(freq: number, t: number, dur: number, peak: number, type: OscillatorType, attack = 0.004): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, dur, peak, attack);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Электромеханический звонок: тон с амплитудной модуляцией («тррр»). */
  private amTone(freq: number, rate: number, t: number, dur: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = rate;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.02);
    g.gain.setValueAtTime(peak, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(am).connect(g).connect(this.sfx);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  private noiseBurst(t: number, dur: number, peak: number, type: BiquadFilterType, freq: number, q: number, amRate = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.02, dur / 4));
    g.gain.setValueAtTime(peak, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = src.connect(f);
    if (amRate) {
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = amRate;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
      node = node.connect(am);
    }
    node.connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private thump(t: number, peak: number): void {
    this.sweep(120, 55, t, 0.18, peak, 'sine');
    this.noiseBurst(t, 0.06, peak * 0.4, 'lowpass', 500, 1);
  }

  private sweep(f0: number, f1: number, t: number, dur: number, peak: number, type: OscillatorType = 'sawtooth'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    this.env(g, t, dur, peak, 0.01);
    o.connect(lp).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private creak(t: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    for (let i = 1; i < 8; i++) o.frequency.linearRampToValueAtTime(60 + Math.random() * 50, t + (dur * i) / 8);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 4;
    const g = ctx.createGain();
    this.env(g, t, dur, 0.12, 0.08);
    o.connect(bp).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
