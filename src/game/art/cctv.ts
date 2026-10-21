/**
 * Камеры наблюдения: четыре ракурса магазина и фигуры, которые на них появляются.
 * Всё рисуется в цвете простыми формами, затем переводится в монохром старой камеры.
 * Мировые координаты (м): X — вправо, Y — вверх, Z — от прилавка к витрине.
 */
import { PixelCanvas, bayer, mix, seeded, type Color } from './PixelCanvas';
import { PRODUCT_COLORS } from './palette';

export const CW = 320;
export const CH = 180;
export const CCTV_TINT = '#b9f3cf';

type V3 = [number, number, number];

class Cam3 {
  private cy: number;
  private sy: number;
  private cp: number;
  private sp: number;
  constructor(
    readonly pos: V3,
    yawDeg: number,
    pitchDeg: number,
    readonly f = 170,
  ) {
    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;
    this.cy = Math.cos(yaw);
    this.sy = Math.sin(yaw);
    this.cp = Math.cos(pitch);
    this.sp = Math.sin(pitch);
  }

  /** Проекция точки; z — расстояние до точки по оси камеры. */
  p(X: number, Y: number, Z: number): [number, number, number] {
    const dx = X - this.pos[0];
    const dy = Y - this.pos[1];
    const dz = Z - this.pos[2];
    const x1 = dx * this.cy - dz * this.sy;
    const z1 = dx * this.sy + dz * this.cy;
    const zc = -dy * this.sp + z1 * this.cp;
    const yc = dy * this.cp + z1 * this.sp;
    const z = Math.max(0.05, zc);
    return [CW / 2 + (this.f * x1) / z, CH / 2 - (this.f * yc) / z, z];
  }

  quad(pc: PixelCanvas, pts: V3[], fill: Color | ((x: number, y: number) => Color | null)): void {
    pc.poly(
      pts.map((q) => {
        const [x, y] = this.p(q[0], q[1], q[2]);
        return [x, y] as [number, number];
      }),
      fill,
    );
  }

  line(pc: PixelCanvas, a: V3, b: V3, c: Color, alpha = 1): void {
    const [x0, y0] = this.p(...a);
    const [x1, y1] = this.p(...b);
    pc.line(x0, y0, x1, y1, c, alpha);
  }

  /** Коробка: ось-выровненный параллелепипед. Рисуются видимые грани. */
  box(pc: PixelCanvas, min: V3, max: V3, top: Color, front: Color, side: Color, frontZ: 'min' | 'max' = 'min', sideX: 'min' | 'max' = 'max'): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const fz = frontZ === 'min' ? z0 : z1;
    const sx = sideX === 'min' ? x0 : x1;
    this.quad(pc, [
      [sx, y0, z0],
      [sx, y0, z1],
      [sx, y1, z1],
      [sx, y1, z0],
    ], side);
    this.quad(pc, [
      [x0, y0, fz],
      [x1, y0, fz],
      [x1, y1, fz],
      [x0, y1, fz],
    ], front);
    this.quad(pc, [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ], top);
  }
}

export interface Spot {
  x: number;
  y: number;
  s: number;
}

/** Где на кадре камеры стоят фигуры (центр низа спрайта и масштаб). */
export const SPOTS: Record<string, Spot> = {};

function spot(name: string, cam: Cam3, X: number, Z: number, heightPx = 1): void {
  const [x, y, z] = cam.p(X, 0, Z);
  SPOTS[name] = { x: Math.round(x), y: Math.round(y), s: (cam.f / z) * heightPx };
}

function finish(pc: PixelCanvas, contrast = 1.2): HTMLCanvasElement {
  pc.monochrome(CCTV_TINT, contrast, 1.1);
  return pc.commit();
}

function noiseFill(base: Color, alt: Color, t: number) {
  return (x: number, y: number) => (bayer(x, y) < t ? alt : base);
}

// ═══════════════ CAM 1 — торговый зал ═══════════════

const cam1 = new Cam3([4.3, 3.3, -1.2], -26, 33, 160);

export function paintCam1(): HTMLCanvasElement {
  const pc = new PixelCanvas(CW, CH);
  const c = cam1;
  pc.rect(0, 0, CW, CH, '#2a2f2c');
  // пол с плиткой
  c.quad(pc, [
    [-4.8, 0, 0],
    [4.8, 0, 0],
    [4.8, 0, 8],
    [-4.8, 0, 8],
  ], noiseFill('#8a958e', '#7a857e', 0.3));
  for (let x = -4.8; x <= 4.8; x += 0.6) c.line(pc, [x, 0, 0], [x, 0, 8], '#5c665f', 0.6);
  for (let z = 0; z <= 8; z += 0.6) c.line(pc, [-4.8, 0, z], [4.8, 0, z], '#5c665f', 0.6);
  // правая стена с холодильниками
  c.quad(pc, [
    [4.8, 0, -1],
    [4.8, 0, 8],
    [4.8, 3, 8],
    [4.8, 3, -1],
  ], '#6a756f');
  for (const [z0, z1] of [
    [5.0, 5.9],
    [5.95, 6.85],
    [6.9, 7.8],
  ]) {
    c.quad(pc, [
      [4.79, 0, z0],
      [4.79, 0, z1],
      [4.79, 2.1, z1],
      [4.79, 2.1, z0],
    ], (x, y) => (bayer(x, y) < 0.3 ? '#e9f4f2' : '#c8dcda'));
  }
  // левая стена со служебной дверью
  c.quad(pc, [
    [-4.8, 0, 0],
    [-4.8, 0, 8],
    [-4.8, 3, 8],
    [-4.8, 3, 0],
  ], '#6f7b74');
  c.quad(pc, [
    [-4.8, 0, 5.0],
    [-4.8, 0, 6.2],
    [-4.8, 2.1, 6.2],
    [-4.8, 2.1, 5.0],
  ], '#48534e');
  c.line(pc, [-4.79, 0, 5.0], [-4.79, 2.1, 5.0], '#2a302d');
  c.line(pc, [-4.79, 2.1, 5.0], [-4.79, 2.1, 6.2], '#2a302d');
  // фасад: витрина, дверь, стеллаж
  c.quad(pc, [
    [-4.8, 0, 8],
    [4.8, 0, 8],
    [4.8, 3, 8],
    [-4.8, 3, 8],
  ], '#7b8780');
  c.quad(pc, [
    [-4.6, 0.6, 8],
    [-0.8, 0.6, 8],
    [-0.8, 2.8, 8],
    [-4.6, 2.8, 8],
  ], noiseFill('#1b2027', '#262c35', 0.25));
  c.quad(pc, [
    [-3.2, 0, 7.99],
    [-1.9, 0, 7.99],
    [-1.9, 2.2, 7.99],
    [-3.2, 2.2, 7.99],
  ], '#121619');
  for (const x of [-4.6, -3.9, -3.2, -1.9, -1.4, -0.8]) c.line(pc, [x, 0.6, 7.98], [x, 2.8, 7.98], '#a5b0b5');
  c.box(pc, [-0.4, 0, 7.5], [4.6, 2.2, 8], '#5a625e', '#4a524e', '#3d4441');
  const rnd = seeded(31);
  for (let sh = 0; sh < 5; sh++) {
    const y = 0.25 + sh * 0.42;
    c.line(pc, [-0.4, y, 7.5], [4.6, y, 7.5], '#9aa39f');
    for (let x = -0.3; x < 4.5; x += 0.12) {
      const col = PRODUCT_COLORS[Math.floor(rnd() * PRODUCT_COLORS.length)];
      c.line(pc, [x, y + 0.04, 7.49], [x, y + 0.3, 7.49], col);
    }
  }
  // упаковки воды
  c.box(pc, [3.4, 0, 6.9], [4.2, 0.45, 7.4], '#c6d8df', '#a8bcc4', '#8ea3ab');
  // прилавок
  c.box(pc, [-2.4, 0, 0.6], [2.6, 1.0, 1.2], '#6a5448', '#4a3a31', '#3b2e27', 'max', 'min');
  c.box(pc, [1.6, 1.0, 0.7], [2.4, 1.3, 1.1], '#2c3134', '#202427', '#1a1d1f', 'max', 'min');
  spot('cam1_clerk', c, 0.2, 0.25);
  spot('cam1_customer', c, 0.3, 1.8);
  spot('cam1_vest', c, 1.6, 6.9);
  spot('cam1_relief', c, 2.4, 6.2);
  spot('cam1_amb', c, 3.3, 7.6);
  return finish(pc);
}

// ═══════════════ CAM 2 — вход и стоянка ═══════════════

const cam2 = new Cam3([-2.0, 3.6, 7.6], -10, 30, 165);

export function paintCam2(): HTMLCanvasElement {
  const pc = new PixelCanvas(CW, CH);
  const c = cam2;
  const rnd = seeded(41);
  // ночное небо и дома
  pc.gradV(0, 0, CW, 60, '#05070b', '#141a22', 5);
  for (const [x, w, top] of [
    [0, 70, 22],
    [80, 120, 14],
    [212, 108, 26],
  ]) {
    pc.rect(x, top, w, 60 - top, '#0e1218');
    for (let wy = top + 4; wy < 56; wy += 6)
      for (let wx = x + 3; wx < x + w - 4; wx += 6) if (rnd() < 0.12) pc.rect(wx, wy, 3, 3, '#7a6a48');
  }
  // асфальт
  c.quad(pc, [
    [-12, 0, 8],
    [12, 0, 8],
    [14, 0, 40],
    [-14, 0, 40],
  ], noiseFill('#4a5056', '#41464c', 0.4));
  // тротуар у входа
  c.quad(pc, [
    [-6, 0.02, 8],
    [6, 0.02, 8],
    [6, 0.02, 10],
    [-6, 0.02, 10],
  ], '#7c8388');
  // свет из двери
  c.quad(pc, [
    [-3.2, 0.03, 8],
    [-1.9, 0.03, 8],
    [-1.4, 0.03, 10.5],
    [-3.7, 0.03, 10.5],
  ], (x, y) => (bayer(x, y) < 0.5 ? '#c9d2cc' : '#9aa49e'));
  // разметка
  for (let i = -3; i <= 4; i++) c.line(pc, [i * 2.6, 0.02, 11], [i * 2.6, 0.02, 16], '#b5bab8', 0.8);
  c.line(pc, [-9, 0.02, 16], [12, 0.02, 16], '#b5bab8', 0.6);
  // фонарь и пятно света
  const lampBase: V3 = [-5.2, 0, 14.2];
  c.quad(pc, [
    [-9, 0.01, 11],
    [-1.5, 0.01, 11],
    [-1.5, 0.01, 17.5],
    [-9, 0.01, 17.5],
  ], (x, y) => {
    const [lx, ly] = c.p(lampBase[0], 0, lampBase[2]);
    const d = Math.hypot((x - lx) / 1.6, y - ly);
    return d < 30 ? mix('#b9b4a2', '#4a5056', Math.min(1, d / 30)) : null;
  });
  c.line(pc, lampBase, [-5.2, 5.5, 14.2], '#101315');
  c.line(pc, [-5.1, 0, 14.2], [-5.1, 5.5, 14.2], '#22272a');
  const [hx, hy] = c.p(-4.7, 5.5, 14.2);
  pc.ellipse(hx, hy, 5, 3, '#f4f1e2');
  pc.ellipse(hx, hy, 9, 6, (x, y) => (bayer(x, y) < 0.3 ? '#d8d2bd' : null), 0.6);
  // припаркованная машина
  c.box(pc, [1.8, 0, 15.0], [3.6, 1.0, 19.0], '#6a7278', '#50575c', '#43494d', 'min', 'min');
  c.box(pc, [2.0, 1.0, 16.0], [3.4, 1.5, 18.0], '#5a6166', '#2c3236', '#24292c', 'min', 'min');
  // козырёк над входом снизу кадра
  pc.rect(0, CH - 12, CW, 12, '#1b1f22');
  pc.hline(0, CW, CH - 12, '#454c50');
  spot('cam2_grey', c, -4.6, 14.5);
  spot('cam2_taxi', c, -1.0, 11.5);
  spot('cam2_amb', c, 0.8, 19);
  return finish(pc, 1.25);
}

// ═══════════════ CAM 3 — касса сверху ═══════════════

export function paintCam3(): HTMLCanvasElement {
  const pc = new PixelCanvas(CW, CH);
  // пол за прилавком (сторона продавца) и перед прилавком (сторона покупателя)
  pc.dither(0, 0, CW, 70, '#7b867f', '#6c766f', 0.3);
  for (let x = 0; x < CW; x += 24) pc.vline(x, 0, 70, '#5c665f');
  for (let y = 0; y < 70; y += 24) pc.hline(0, CW, y, '#5c665f');
  pc.dither(0, 122, CW, 58, '#7b867f', '#6c766f', 0.3);
  for (let x = 12; x < CW; x += 24) pc.vline(x, 122, CH, '#5c665f');
  // столешница
  pc.rect(0, 70, CW, 52, '#6a5448');
  pc.hline(0, CW, 70, '#8a7466');
  pc.hline(0, CW, 121, '#3b2e27');
  for (let i = 0; i < 12; i++) pc.hline(Math.floor(i * 27), Math.floor(i * 27 + 16), 80 + (i * 7) % 36, '#5c483d');
  // касса
  pc.rect(214, 76, 62, 38, '#2a2e31');
  pc.rect(218, 80, 26, 14, '#1c2022');
  for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) pc.rect(222 + k * 8, 98 + r * 5, 6, 3, '#9aa2a6');
  pc.rect(248, 80, 24, 12, '#3a3f42');
  // монитор, телефон, журнал
  pc.rect(22, 74, 44, 34, '#b8af98');
  pc.rect(28, 78, 32, 22, '#2a332f');
  pc.rect(78, 92, 26, 18, '#a9a08b');
  pc.rect(112, 96, 34, 22, '#d9cfb4');
  pc.vline(129, 96, 117, '#8c826b');
  SPOTS.cam3_clerk = { x: 150, y: 54, s: 1 };
  SPOTS.cam3_customer = { x: 160, y: 158, s: 1 };
  return finish(pc);
}

// ═══════════════ CAM 4 — склад ═══════════════

const cam4 = new Cam3([2.4, 2.6, 0.2], -18, 26, 165);

export function paintCam4(): HTMLCanvasElement {
  const pc = new PixelCanvas(CW, CH);
  const c = cam4;
  const rnd = seeded(51);
  pc.rect(0, 0, CW, CH, '#1d2120');
  // пол
  c.quad(pc, [
    [-3, 0, 0],
    [3, 0, 0],
    [3, 0, 6],
    [-3, 0, 6],
  ], noiseFill('#6b706c', '#5e635f', 0.4));
  for (let i = 0; i < 40; i++) {
    const [x, y] = c.p(-3 + rnd() * 6, 0, rnd() * 6);
    pc.px(x, y, '#4a4f4b');
  }
  // стены
  c.quad(pc, [
    [-3, 0, 6],
    [3, 0, 6],
    [3, 2.8, 6],
    [-3, 2.8, 6],
  ], '#6a716d');
  c.quad(pc, [
    [-3, 0, 0],
    [-3, 0, 6],
    [-3, 2.8, 6],
    [-3, 2.8, 0],
  ], '#5b625e');
  c.quad(pc, [
    [3, 0, 0],
    [3, 0, 6],
    [3, 2.8, 6],
    [3, 2.8, 0],
  ], '#555c58');
  // рулонные ворота разгрузки
  c.quad(pc, [
    [-2.6, 0, 5.99],
    [-0.4, 0, 5.99],
    [-0.4, 2.3, 5.99],
    [-2.6, 2.3, 5.99],
  ], '#4b514e');
  for (let y = 0.1; y < 2.3; y += 0.14) c.line(pc, [-2.6, y, 5.98], [-0.4, y, 5.98], '#3a3f3c');
  // щиток
  c.quad(pc, [
    [1.6, 1.1, 5.99],
    [2.5, 1.1, 5.99],
    [2.5, 2.1, 5.99],
    [1.6, 2.1, 5.99],
  ], '#8a918d');
  c.quad(pc, [
    [1.95, 1.4, 5.98],
    [2.15, 1.4, 5.98],
    [2.15, 1.8, 5.98],
    [1.95, 1.8, 5.98],
  ], '#2d312f');
  // календарь 2022 и настенный телефон (линия 2)
  c.quad(pc, [
    [0.3, 1.3, 5.99],
    [0.8, 1.3, 5.99],
    [0.8, 1.95, 5.99],
    [0.3, 1.95, 5.99],
  ], '#d9d6cc');
  c.quad(pc, [
    [0.3, 1.8, 5.98],
    [0.8, 1.8, 5.98],
    [0.8, 1.95, 5.98],
    [0.3, 1.95, 5.98],
  ], '#8a3a32');
  c.quad(pc, [
    [1.0, 1.2, 5.99],
    [1.25, 1.2, 5.99],
    [1.25, 1.55, 5.99],
    [1.0, 1.55, 5.99],
  ], '#c9c0a8');
  // стеллаж с коробками слева
  for (let tier = 0; tier < 4; tier++) {
    const y = tier * 0.62;
    c.box(pc, [-3, y, 0.8], [-2.2, y + 0.06, 5.2], '#8c938f', '#6f7672', '#5c625f', 'min', 'max');
    for (let z = 1.0; z < 5.0; z += 0.55 + rnd() * 0.2) {
      const h = 0.25 + rnd() * 0.25;
      const shadeBox = mix('#a88a62', '#7a6448', rnd());
      c.box(pc, [-2.95, y + 0.06, z], [-2.3, y + 0.06 + h, z + 0.42], mix(shadeBox, '#ffffff', 0.15), shadeBox, mix(shadeBox, '#000000', 0.25), 'min', 'max');
    }
  }
  // служебная дверь в зал (на правой стене)
  c.quad(pc, [
    [2.99, 0, 1.4],
    [2.99, 0, 2.6],
    [2.99, 2.1, 2.6],
    [2.99, 2.1, 1.4],
  ], '#4a5550');
  // стул с курткой
  c.box(pc, [0.4, 0, 3.2], [0.9, 0.45, 3.7], '#3c3f3d', '#2e312f', '#262826');
  c.box(pc, [0.4, 0.45, 3.65], [0.9, 1.0, 3.72], '#3c3f3d', '#2e312f', '#262826');
  c.quad(pc, [
    [0.35, 0.5, 3.6],
    [0.95, 0.5, 3.6],
    [0.95, 1.05, 3.62],
    [0.35, 1.05, 3.62],
  ], '#556b5a');
  // лампочка
  const [lx, ly] = c.p(0, 2.75, 3);
  pc.vline(Math.round(lx), 0, Math.round(ly), '#111');
  pc.ellipse(lx, ly + 2, 2, 2, '#f2f2e0');
  pc.ellipse(lx, ly + 2, 14, 10, (x, y) => (bayer(x, y) < 0.18 ? '#c9c6b4' : null), 0.5);
  spot('cam4_fig1', c, -1.0, 5.4);
  spot('cam4_fig2', c, 0.4, 3.0);
  spot('cam4_fig3', c, 1.7, 1.3);
  spot('cam4_door', c, 2.95, 2.0);
  return finish(pc, 1.15);
}

/** Пятно света из открытой служебной двери. */
export function paintCam4DoorOpen(): HTMLCanvasElement {
  const pc = new PixelCanvas(CW, CH);
  const c = cam4;
  c.quad(pc, [
    [2.99, 0, 1.4],
    [2.99, 0, 2.6],
    [2.99, 2.1, 2.6],
    [2.99, 2.1, 1.4],
  ], '#e8eee6');
  c.quad(pc, [
    [3, 0.01, 1.4],
    [3, 0.01, 2.6],
    [1.2, 0.01, 2.9],
    [1.2, 0.01, 1.1],
  ], (x, y) => (bayer(x, y) < 0.6 ? '#c9d1c8' : null));
  return finish(pc);
}

// ═══════════════ фигуры ═══════════════

/** Стоящий человек в полный рост (для зала, стоянки, склада). h — высота в пикселях. */
export function paintStanding(h: number, opts: { vest?: boolean; coat?: boolean; face?: 'up' | 'away' | 'blank'; wave?: boolean } = {}): HTMLCanvasElement {
  const w = Math.max(6, Math.round(h * 0.42));
  const pc = new PixelCanvas(w + 4, h + 2);
  const cx = (w + 4) / 2;
  const headR = Math.max(1.5, h * 0.075);
  const body = opts.vest ? '#5b8a68' : opts.coat ? '#6c7277' : '#3a3f42';
  // ноги
  pc.rect(cx - w * 0.22, h * 0.6, w * 0.18, h * 0.4, '#202325');
  pc.rect(cx + w * 0.04, h * 0.6, w * 0.18, h * 0.4, '#1b1e20');
  // туловище
  pc.poly(
    [
      [cx - w * 0.36, h * 0.2],
      [cx + w * 0.36, h * 0.2],
      [cx + w * (opts.coat ? 0.34 : 0.3), h * (opts.coat ? 0.8 : 0.62)],
      [cx - w * (opts.coat ? 0.34 : 0.3), h * (opts.coat ? 0.8 : 0.62)],
    ],
    body,
  );
  if (opts.vest) pc.rect(cx - w * 0.36, h * 0.2, w * 0.12, h * 0.4, '#2c3033');
  if (opts.wave) {
    pc.line(cx + w * 0.34, h * 0.24, cx + w * 0.55, h * 0.02, body);
    pc.ellipse(cx + w * 0.56, h * 0.02 + 1, headR * 0.7, headR * 0.7, '#cdb5a4');
  }
  // голова
  pc.ellipse(cx, h * 0.12, headR, headR * 1.15, opts.face === 'away' ? '#2a2420' : '#cdb5a4');
  if (opts.face === 'up' && h > 30) {
    pc.px(cx - 1, h * 0.11, '#000000');
    pc.px(cx + 1, h * 0.11, '#000000');
  }
  if (opts.face === 'blank' && h > 20) pc.hline(cx - 1, cx + 1, h * 0.12, '#7a6a60');
  pc.outline('#0b0d0c');
  return finish(pc, 1.1);
}

/** Голова и плечи сверху (камера над кассой). */
export function paintTopDown(hair: Color, coat: Color): HTMLCanvasElement {
  const pc = new PixelCanvas(60, 40);
  pc.ellipse(30, 22, 26, 13, coat);
  pc.ellipse(30, 22, 26, 13, (x, y) => (bayer(x, y) < 0.25 ? mix(coat, '#ffffff', 0.15) : null));
  pc.ellipse(30, 20, 9, 10, hair);
  pc.ellipse(28, 17, 4, 4, mix(hair, '#ffffff', 0.18));
  pc.outline('#0b0d0c');
  return finish(pc, 1.1);
}

/** Лицо у самого объектива на складе — финальная стадия. */
export function paintCloseFace(): HTMLCanvasElement {
  const pc = new PixelCanvas(120, 110);
  pc.ellipse(60, 70, 44, 52, (_x, y) => mix('#a89a90', '#3a3633', Math.min(1, Math.max(0, (y - 40) / 60))));
  pc.rect(0, 92, 120, 18, '#2c4a36');
  // глаза смотрят вверх, прямо в камеру
  for (const ex of [40, 80]) {
    pc.ellipse(ex, 58, 9, 5, '#e2ded6');
    pc.ellipse(ex, 56, 4, 4, '#101010');
  }
  pc.hline(46, 74, 88, '#3a2a28');
  pc.ellipse(60, 20, 46, 18, '#1d1a18');
  return finish(pc);
}

export function paintTaxi(): HTMLCanvasElement {
  const pc = new PixelCanvas(56, 28);
  pc.rect(4, 10, 48, 12, '#d8c25a');
  pc.rect(12, 3, 30, 8, '#c9b450');
  pc.rect(15, 5, 10, 5, '#2c3a4a');
  pc.rect(28, 5, 10, 5, '#2c3a4a');
  pc.rect(24, 0, 8, 3, '#f0f0f0');
  pc.rect(8, 22, 8, 5, '#111');
  pc.rect(40, 22, 8, 5, '#111');
  pc.rect(48, 13, 4, 3, '#fff8d0');
  pc.outline('#0b0d0c');
  return finish(pc);
}
