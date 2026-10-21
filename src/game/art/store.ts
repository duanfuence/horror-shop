/**
 * Магазин «Колосок» — вид из-за прилавка (320×180).
 * Простая перспективная проекция: глаз на высоте 1.6 м, задняя стена в 8 м.
 */
import { P, PRODUCT_COLORS } from './palette';
import { PixelCanvas, bayer, mix, rgb, seeded, type Color, type RGB } from './PixelCanvas';
import { drawText, textWidth } from './pixelFont';

export const W = 320;
export const H = 180;
export const VP = { x: 160, y: 64 };
const F = 160;
const EYE = 1.6;
const CEIL = 2.3;
const ZB = 8;
const HW = 4.8;

export function proj(X: number, Y: number, Z: number): [number, number] {
  return [VP.x + (F * X) / Z, VP.y + (F * Y) / Z];
}

const leftTop = (x: number) => VP.y - (CEIL * (VP.x - x)) / HW;
const leftBottom = (x: number) => VP.y + (EYE * (VP.x - x)) / HW;
const rightTop = (x: number) => VP.y - (CEIL * (x - VP.x)) / HW;
const rightBottom = (x: number) => VP.y + (EYE * (x - VP.x)) / HW;
const BACK_L = proj(-HW, 0, ZB)[0];
const BACK_R = proj(HW, 0, ZB)[0];
const BACK_T = proj(0, -CEIL, ZB)[1];
const BACK_B = proj(0, EYE, ZB)[1];

/** Квантование цвета с упорядоченным дизерингом — «пиксельная» передача градиентов. */
function q(c: RGB, x: number, y: number, levels = 14): RGB {
  const t = bayer(x, y);
  const step = 255 / levels;
  return [
    Math.min(255, Math.floor(c[0] / step + t) * step),
    Math.min(255, Math.floor(c[1] / step + t) * step),
    Math.min(255, Math.floor(c[2] / step + t) * step),
  ];
}

function mul(c: Color, k: number): RGB {
  const v = rgb(c);
  return [v[0] * k, v[1] * k, v[2] * k];
}

function addc(a: RGB, b: RGB, k: number): RGB {
  return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

const TUBES_X = [-1.7, 1.7];

/** Освещённость от двух рядов ламп в точке (X, Z). */
function tubeLight(X: number, Z: number): number {
  let best = 0;
  for (const tx of TUBES_X) best = Math.max(best, Math.exp(-((X - tx) ** 2) / 2.2));
  const depth = 1 / (1 + ((Z - 6.2) / 4.5) ** 2);
  return 0.55 + 0.45 * best * (0.6 + 0.4 * depth);
}

// ═════════════════════════ задний план ═════════════════════════

export function paintStoreBase(): HTMLCanvasElement {
  const pc = new PixelCanvas(W, H);
  paintCeiling(pc);
  paintBackWall(pc);
  paintSideWalls(pc);
  paintFloor(pc);
  paintStorefront(pc);
  paintShelves(pc);
  paintFridges(pc);
  paintServiceDoor(pc);
  paintLeftWallDecor(pc);
  paintWaterStack(pc);
  return pc.commit();
}

function paintCeiling(pc: PixelCanvas): void {
  for (let y = 0; y < BACK_T + 1; y++) {
    for (let x = 0; x < W; x++) {
      const top = x < BACK_L ? leftTop(x) : x > BACK_R ? rightTop(x) : BACK_T;
      if (y >= top) continue;
      const Z = (CEIL * F) / (VP.y - y - 0.5);
      const X = ((x + 0.5 - VP.x) * Z) / F;
      let c = mul(P.ceiling, 0.8 + 0.4 * tubeLight(X, Z) - 0.3);
      const gx = ((X / 1.2) % 1 + 1) % 1;
      const gz = ((Z / 1.2) % 1 + 1) % 1;
      if (gx < 0.04 * Z * 0.6 || gz < 0.05) c = mul(P.ceilingLine, 1);
      // светильники
      for (const tx of TUBES_X) {
        const dx = Math.abs(X - tx);
        if (Z > 5.4 && Z < 7.6) {
          if (dx < 0.34) c = mul(P.fixture, 1);
          if (dx > 0.06 && dx < 0.14) c = rgb(P.tube);
          if (dx > 0.2 && dx < 0.28) c = rgb(P.tube);
        } else {
          const glow = Math.exp(-(dx * dx) / 0.5) * 0.35;
          c = addc(c, rgb(P.tubeGlow), glow * (Z > 4.5 ? 0.6 : 0.2));
        }
      }
      pc.px(x, y, q(c, x, y));
    }
  }
}

function paintBackWall(pc: PixelCanvas): void {
  for (let y = Math.floor(BACK_T); y < BACK_B; y++) {
    for (let x = Math.floor(BACK_L); x < BACK_R; x++) {
      const X = ((x + 0.5 - VP.x) * ZB) / F;
      const Y = ((y + 0.5 - VP.y) * ZB) / F;
      let k = tubeLight(X, ZB) * (1.0 - Math.max(0, Y) * 0.08);
      if (Y < -1.9) k *= 0.85;
      let c = mul(P.wallBack, k);
      if (Y > 0.15 && Y < 0.25) c = mul(P.signGreen, k * 1.1);
      if (Y > 1.45) c = mul(P.skirting, 1);
      pc.px(x, y, q(c, x, y));
    }
  }
}

function paintSideWalls(pc: PixelCanvas): void {
  for (let x = 0; x < W; x++) {
    const left = x < BACK_L;
    const right = x >= BACK_R;
    if (!left && !right) continue;
    const top = left ? leftTop(x) : rightTop(x);
    const bottom = left ? leftBottom(x) : rightBottom(x);
    const Z = left ? (HW * F) / (VP.x - x - 0.5) : (HW * F) / (x + 0.5 - VP.x);
    for (let y = Math.max(0, Math.ceil(top)); y < Math.min(H, bottom); y++) {
      const Y = ((y + 0.5 - VP.y) * Z) / F;
      const light = 0.5 + 0.35 / (1 + ((Z - 6.8) / 2.5) ** 2);
      let c = mul(P.wallSide, light * 1.05);
      if (Y > 0.15 && Y < 0.25) c = mul(P.signGreen, light * 1.1);
      if (Y > 1.45) c = mul(P.skirting, 1);
      pc.px(x, y, q(c, x, y));
    }
  }
}

function paintFloor(pc: PixelCanvas): void {
  for (let y = Math.floor(BACK_B); y < H; y++) {
    for (let x = 0; x < W; x++) {
      const minY = x < BACK_L ? leftBottom(x) : x > BACK_R ? rightBottom(x) : BACK_B;
      if (y < minY) continue;
      const Z = (EYE * F) / (y + 0.5 - VP.y);
      const X = ((x + 0.5 - VP.x) * Z) / F;
      const tx = Math.floor(X / 0.6);
      const tz = Math.floor(Z / 0.6);
      let c = rgb((tx + tz) & 1 ? P.floorA : P.floorB);
      const fx = ((X / 0.6) % 1 + 1) % 1;
      const fz = ((Z / 0.6) % 1 + 1) % 1;
      if (fx < 0.035 * Z || fz < 0.025 * Z) c = rgb(P.grout);
      let k = tubeLight(X, Z);
      // блики ламп на линолеуме
      for (const t of TUBES_X) {
        const d = Math.abs(X - t);
        if (Z > 4.5 && d < 0.12 + Z * 0.01) k += 0.35 * (1 - d / (0.12 + Z * 0.01));
      }
      c = mul(c, k);
      // холодный свет от холодильников справа
      if (X > 3.4 && Z > 4.5) c = addc(c, rgb(P.fridgeInLo), 0.18 * Math.min(1, (X - 3.4) / 1.4));
      c = mix(c, P.floorFar, Math.min(0.45, Math.max(0, (Z - 3) / 11)));
      pc.px(x, y, q(c, x, y));
    }
  }
}

// ───────────── витрина и входная дверь ─────────────

export const WINDOW = { x0: 66, x1: 148, y0: 24, y1: 88 };
export const FRONT_DOOR = { x0: 97, x1: 123, y0: 52, y1: 96 };

function paintStorefront(pc: PixelCanvas): void {
  const { x0, x1, y0, y1 } = WINDOW;
  // прозрачные стёкла с отражениями
  for (let y = y0; y <= Math.max(y1, FRONT_DOOR.y1); y++)
    for (let x = x0; x <= x1; x++) {
      const inWindow = y <= y1;
      const inDoor = x >= FRONT_DOOR.x0 && x <= FRONT_DOOR.x1 && y >= FRONT_DOOR.y0;
      if (!inWindow && !inDoor) continue;
      pc.clear(x, y);
      const streak = (x + y * 0.55) % 41;
      if (streak < 2.2) pc.px(x, y, '#dff5ec', 0.13);
      else if (streak < 4) pc.px(x, y, '#dff5ec', 0.05);
      else pc.px(x, y, P.wallBack, 0.07);
    }
  const frame = (x: number, y: number, w: number, h: number) => {
    pc.rect(x, y, w, h, P.metal);
    pc.rect(x + w - 1, y, 1, h, P.metalDark);
  };
  frame(x0 - 2, y0 - 2, x1 - x0 + 5, 2);
  frame(x0 - 2, y0 - 2, 2, y1 - y0 + 4);
  frame(x1 + 1, y0 - 2, 2, y1 - y0 + 4);
  frame(x0 - 2, y1 + 1, FRONT_DOOR.x0 - x0 + 2, 2);
  frame(FRONT_DOOR.x1, y1 + 1, x1 - FRONT_DOOR.x1 + 3, 2);
  frame(81, y0, 2, y1 - y0 + 1);
  frame(135, y0, 2, y1 - y0 + 1);
  frame(x0, 49, x1 - x0 + 1, 2);
  // стена под окнами
  pc.rect(x0 - 2, y1 + 3, FRONT_DOOR.x0 - x0, BACK_B - y1 - 3, P.wallBackLo);
  pc.rect(FRONT_DOOR.x1 + 3, y1 + 3, x1 - FRONT_DOOR.x1, BACK_B - y1 - 3, P.wallBackLo);
  // рама двери
  const d = FRONT_DOOR;
  frame(d.x0 - 2, d.y0 - 2, d.x1 - d.x0 + 5, 3);
  frame(d.x0 - 2, d.y0 - 2, 3, d.y1 - d.y0 + 2);
  frame(d.x1, d.y0 - 2, 3, d.y1 - d.y0 + 2);
  pc.rect(d.x0 + 1, 74, d.x1 - d.x0 - 1, 2, P.metal);
  pc.rect(d.x0 + 1, 75, d.x1 - d.x0 - 1, 1, P.metalDark);
  pc.rect(d.x0 + 1, 89, d.x1 - d.x0 - 1, 6, P.metalDark);
  pc.rect(d.x0 + 1, 89, d.x1 - d.x0 - 1, 1, P.metal);
  // наклейка «24»
  pc.rect(d.x0 + 6, 58, 14, 8, P.red);
  pc.rect(d.x0 + 6, 65, 14, 1, P.redDark);
  drawText(pc, d.x0 + 9, 59, '24', '#ffffff');
  // колокольчик над дверью
  pc.px(110, 50, '#c8a24a');
  pc.rect(109, 51, 3, 2, '#d8b45a');
  pc.px(110, 53, '#8a6a2a');
  // табличка «ВЫХОД» над дверью
  pc.rect(101, 18, 18, 7, '#0f3b22');
  drawText(pc, 102, 19, 'ВЫХОД', '#7dffb0');
}

// ───────────── стеллажи на задней стене ─────────────

function paintShelves(pc: PixelCanvas): void {
  const x0 = 152;
  const x1 = 254;
  const rnd = seeded(7);
  // вывеска
  pc.rect(x0 + 4, 29, x1 - x0 - 8, 12, P.signGreen);
  pc.rect(x0 + 4, 29, x1 - x0 - 8, 1, '#4f9a68');
  pc.rect(x0 + 4, 40, x1 - x0 - 8, 1, '#1d4a2e');
  const label = 'ПРОДУКТЫ 24';
  const tw = textWidth(label);
  drawText(pc, Math.round((x0 + x1) / 2 - tw / 2) + 4, 32, label, P.wheat, '#173b25');
  // колосок
  const wx = Math.round((x0 + x1) / 2 - tw / 2) - 4;
  pc.vline(wx, 32, 37, '#b8902c');
  for (let i = 0; i < 3; i++) {
    pc.px(wx - 1, 32 + i * 2, P.wheat);
    pc.px(wx + 1, 33 + i * 2, P.wheat);
  }
  const shelves = [45, 53, 61, 69, 77, 85];
  // задник стеллажа
  pc.rect(x0, 43, x1 - x0, BACK_B - 43, '#3d4743');
  for (let s = 0; s < shelves.length; s++) {
    const top = shelves[s];
    const bottom = s + 1 < shelves.length ? shelves[s + 1] : 93;
    // товары
    let x = x0 + 2;
    while (x < x1 - 3) {
      const color = PRODUCT_COLORS[Math.floor(rnd() * PRODUCT_COLORS.length)];
      const w = 2 + Math.floor(rnd() * 3);
      const h = Math.min(bottom - top - 2, 3 + Math.floor(rnd() * 4));
      const facings = 1 + Math.floor(rnd() * 3);
      for (let f = 0; f < facings && x < x1 - 3; f++) {
        const yTop = bottom - 1 - h;
        pc.rect(x, yTop, w, h, color);
        pc.rect(x, yTop, w, 1, mix(color, '#ffffff', 0.35));
        pc.rect(x + w - 1, yTop + 1, 1, h - 1, mix(color, '#000000', 0.35));
        if (h > 4) pc.rect(x, yTop + Math.floor(h / 2), w - 1, 1, mix(color, '#ffffff', 0.2));
        x += w + (rnd() < 0.15 ? 1 : 0);
      }
      if (rnd() < 0.12) x += 2;
    }
    // полка и ценники
    pc.rect(x0, bottom - 1, x1 - x0, 1, P.metal);
    pc.rect(x0, bottom, x1 - x0, 1, '#262c29');
    for (let px = x0 + 4; px < x1 - 2; px += 7 + Math.floor(rnd() * 4)) pc.px(px, bottom - 1, '#f1e27a');
  }
  // стойки
  for (const ux of [x0, x0 + 34, x0 + 68, x1 - 2]) {
    pc.rect(ux, 43, 2, BACK_B - 43, P.metalDark);
    pc.rect(ux, 43, 1, BACK_B - 43, P.metal);
  }
  pc.rect(x0, 92, x1 - x0, 4, '#2b322f');
}

// ───────────── холодильники на правой стене ─────────────

export const FRIDGE_DOORS: [number, number][] = [
  [5.0, 5.9],
  [5.95, 6.85],
  [6.9, 7.8],
];

function paintFridges(pc: PixelCanvas): void {
  const rnd = seeded(11);
  const yTop = -0.55;
  // корпус над дверями
  const [fx0, ft0] = proj(HW, -0.9, 5.0);
  const [fx1, ft1] = proj(HW, -0.9, 7.8);
  const [, fb0] = proj(HW, yTop, 5.0);
  const [, fb1] = proj(HW, yTop, 7.8);
  pc.poly(
    [
      [fx0, ft0],
      [fx1, ft1],
      [fx1, fb1],
      [fx0, fb0],
    ],
    (x, y) => q(mul(P.fridgeFrame, 0.75 - (x - fx1) * 0.003), x, y),
  );
  // табло термометра над дверью № 2
  const [tx, ty] = proj(HW, -0.74, 6.4);
  pc.rect(Math.round(tx) - 7, Math.round(ty) - 3, 15, 7, '#1a1d1e');
  pc.rect(Math.round(tx) - 7, Math.round(ty) - 3, 15, 1, '#3a3f41');
  // номер «2» на корпусе
  drawText(pc, Math.round(tx) + 10, Math.round(ty) - 2, '2', '#2c3436');

  for (const [z0, z1] of FRIDGE_DOORS) {
    const quad: [number, number][] = [proj(HW, yTop, z0), proj(HW, yTop, z1), proj(HW, EYE, z1), proj(HW, EYE, z0)];
    // рама
    pc.poly(quad, (x, y) => q(mul(P.fridgeFrame, 0.8), x, y));
    // стекло и подсвеченное нутро
    const inner: [number, number][] = [
      proj(HW, yTop + 0.06, z0 + 0.07),
      proj(HW, yTop + 0.06, z1 - 0.05),
      proj(HW, EYE - 0.14, z1 - 0.05),
      proj(HW, EYE - 0.14, z0 + 0.07),
    ];
    pc.poly(inner, (x, y) => {
      const Z = (HW * F) / (x + 0.5 - VP.x);
      const Y = ((y + 0.5 - VP.y) * Z) / F;
      const shelfPos = (Y - yTop) / 0.42;
      const frac = shelfPos - Math.floor(shelfPos);
      let c = mix(P.fridgeIn, P.fridgeInLo, Math.min(1, Math.max(0, (Y + 0.5) / 2.2)));
      if (frac < 0.07) c = rgb('#e9f7f7');
      else if (frac < 0.13) c = rgb('#6f9497');
      else if (frac > 0.3) {
        // бутылки
        const slot = Math.floor(Z * 9);
        const r = seeded(slot * 31 + Math.floor(shelfPos) * 7)();
        if ((Math.floor(Z * 18) & 1) === 0 && frac > 0.3 + r * 0.25) {
          c = mix(rgb(PRODUCT_COLORS[Math.floor(r * PRODUCT_COLORS.length)]), c, 0.25);
        }
      }
      const refl = (x * 1.3 + y) % 23;
      if (refl < 1.5) c = mix(c, '#ffffff', 0.4);
      return q(c, x, y, 16);
    });
    // ручка
    const [hx0, hy0] = proj(HW - 0.03, 0.0, z1 - 0.12);
    const [, hy1] = proj(HW - 0.03, 0.8, z1 - 0.12);
    pc.vline(Math.round(hx0), Math.round(hy0), Math.round(hy1), P.metalDark);
    pc.vline(Math.round(hx0) + 1, Math.round(hy0), Math.round(hy1), '#d8e0e2');
    void rnd;
  }
}

// ───────────── служебная дверь и левая стена ─────────────

export const SERVICE_DOOR_QUAD: [number, number][] = [
  proj(-HW, -0.5, 5.0),
  proj(-HW, -0.5, 6.2),
  proj(-HW, EYE, 6.2),
  proj(-HW, EYE, 5.0),
];

function leftQuad(z0: number, z1: number, y0: number, y1: number): [number, number][] {
  return [proj(-HW, y0, z0), proj(-HW, y0, z1), proj(-HW, y1, z1), proj(-HW, y1, z0)];
}

function paintServiceDoor(pc: PixelCanvas): void {
  // наличник
  pc.poly(leftQuad(4.93, 6.28, -0.58, EYE), (x, y) => q(mul('#2a302d', 1), x, y));
  pc.poly(SERVICE_DOOR_QUAD, (x, y) => {
    const Z = (HW * F) / (VP.x - x - 0.5);
    const Y = ((y + 0.5 - VP.y) * Z) / F;
    let c = mul('#556660', 0.62 + 0.18 / (1 + (Z - 6.5) ** 2));
    // филёнки
    if ((Y > -0.35 && Y < -0.3) || (Y > 1.35 && Y < 1.4)) c = mul(c, 0.8);
    return q(c, x, y);
  });
  // окошко с армированным стеклом
  pc.poly(leftQuad(5.35, 5.85, -0.3, 0.1), (x, y) => ((x + y) % 3 === 0 ? '#1b2421' : '#0a0f0d'));
  // табличка
  pc.poly(leftQuad(5.3, 5.85, 0.22, 0.34), '#d9d4c4');
  pc.poly(leftQuad(5.38, 5.78, 0.26, 0.29), '#5b5a52');
  // ручка
  const [hx, hy] = proj(-HW + 0.04, 0.62, 6.02);
  pc.rect(Math.round(hx) - 3, Math.round(hy), 4, 1, '#c3cbcf');
  pc.rect(Math.round(hx), Math.round(hy) - 1, 1, 3, P.metalDark);
}

export const PHOTO_QUAD = leftQuad(7.0, 7.7, -0.75, -0.05);
export const CALENDAR_QUAD = leftQuad(6.3, 6.85, -0.95, -0.2);

function paintLeftWallDecor(pc: PixelCanvas): void {
  // календарь 2022
  pc.poly(CALENDAR_QUAD, '#e4e0d4');
  pc.poly(leftQuad(6.3, 6.85, -0.95, -0.78), '#b8342c');
  const [cx0, cy0] = proj(-HW, -0.7, 6.38);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) pc.px(Math.round(cx0) + c * 2, Math.round(cy0) + 2 + r * 3, '#8a8578');
  pc.px(Math.round(cx0) + 4, Math.round(cy0) + 8, '#c0392b');
  pc.px(Math.round(cx0) + 5, Math.round(cy0) + 8, '#c0392b');
  // фото «Сотрудник месяца»
  pc.poly(PHOTO_QUAD, '#5b3f2c');
  const inner = leftQuad(7.07, 7.63, -0.68, -0.12);
  pc.poly(inner, '#c9c3b2');
  const [px0, py0] = proj(-HW, -0.6, 7.2);
  const bx = Math.round(px0);
  const by = Math.round(py0);
  pc.rect(bx + 2, by + 1, 4, 2, '#3a2a20');
  pc.rect(bx + 2, by + 3, 4, 3, '#d8a88a');
  pc.px(bx + 3, by + 4, '#3a2a20');
  pc.px(bx + 5, by + 4, '#3a2a20');
  pc.rect(bx + 1, by + 6, 6, 4, P.vest);
  pc.px(bx + 4, by + 7, P.wheat);
  // подпись под фото
  const [lx, ly] = proj(-HW, 0.05, 7.1);
  pc.rect(Math.round(lx), Math.round(ly), 7, 1, '#8c8679');
}

function paintWaterStack(pc: PixelCanvas): void {
  // упаковки воды у стеллажа — на одну из них утром сядет Галина Петровна
  const base: [number, number] = [236, 99];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 2; i++) {
      const x = base[0] + i * 9 + (row % 2) * 2;
      const y = base[1] - row * 5;
      pc.rect(x, y, 9, 5, '#cfe2ea');
      pc.rect(x, y, 9, 1, '#f0fbff');
      for (let b = 0; b < 4; b++) pc.rect(x + 1 + b * 2, y + 1, 1, 3, '#7fb2c8');
      pc.rect(x, y + 4, 9, 1, '#4e7486');
    }
  }
}

// ═════════════════════════ улица за витриной ═════════════════════════

export const LAMP = { x: 84, y: 45 };

export function paintStoreOutside(): HTMLCanvasElement {
  const pc = new PixelCanvas(W, H);
  const rnd = seeded(23);
  const x0 = WINDOW.x0 - 2;
  const x1 = WINDOW.x1 + 2;
  const horizon = 66;
  for (let y = 0; y < BACK_B + 2; y++)
    for (let x = x0; x <= x1; x++) {
      if (y < horizon) {
        const t = y / horizon;
        let c = mix(P.sky1, P.sky2, t);
        c = mix(c, '#3a2f2a', Math.max(0, t - 0.75) * 0.9);
        pc.px(x, y, q(c, x, y, 20));
      } else {
        const d = (y - horizon) / (BACK_B - horizon);
        let c = mix('#14181e', P.asphalt, d);
        const lamp = Math.exp(-(((x - LAMP.x) / 20) ** 2) - (((y - 86) / 7) ** 2));
        c = mix(c, P.asphaltLit, Math.min(1, lamp * 1.4));
        // свет из магазина на тротуаре
        if (y > 88) c = mix(c, '#5d6b63', 0.35 * (y - 88) / 8);
        pc.px(x, y, q(c, x, y, 20));
      }
    }
  // пятиэтажки
  const blocks = [
    { x: x0, w: 30, top: 38 },
    { x: x0 + 34, w: 46, top: 33 },
    { x: x0 + 84, w: 30, top: 41 },
  ];
  for (const b of blocks) {
    pc.rect(b.x, b.top, b.w, horizon - b.top, P.house);
    pc.rect(b.x, b.top, b.w, 1, '#1a2130');
    for (let wy = b.top + 3; wy < horizon - 3; wy += 4)
      for (let wx = b.x + 2; wx < b.x + b.w - 2; wx += 3) {
        const r = rnd();
        const c = r < 0.08 ? P.houseLit : r < 0.16 ? P.houseLitDim : r < 0.2 ? '#3a4a6a' : '#121823';
        pc.rect(wx, wy, 2, 2, c);
      }
  }
  // деревья без листьев
  for (const tx of [x0 + 6, x0 + 60, x1 - 12]) {
    pc.vline(tx, horizon - 14, horizon + 2, '#0a0d12');
    for (let k = 0; k < 6; k++) {
      const yy = horizon - 13 + k * 2;
      const len = 2 + Math.floor(rnd() * 4);
      pc.line(tx, yy, tx + (k % 2 ? len : -len), yy - 2, '#0b0f15');
    }
  }
  // бордюр и снег
  pc.rect(x0, horizon, x1 - x0 + 1, 2, P.snow);
  for (let x = x0; x <= x1; x++) if (rnd() < 0.5) pc.px(x, horizon + 2, '#4b525c');
  // разметка стоянки
  for (let i = -3; i <= 3; i++) {
    const xa = 106 + i * 14;
    pc.line(xa, horizon + 4, xa + i * 6, BACK_B, '#5a5f66', 0.5);
  }
  // припаркованная машина
  const cx = 122;
  const cy = 76;
  pc.rect(cx, cy, 22, 6, '#20262e');
  pc.rect(cx + 4, cy - 4, 13, 4, '#1a1f26');
  pc.rect(cx + 5, cy - 3, 5, 3, '#2c3a4a');
  pc.rect(cx + 11, cy - 3, 5, 3, '#2c3a4a');
  pc.rect(cx + 2, cy + 6, 4, 2, '#0a0c0f');
  pc.rect(cx + 16, cy + 6, 4, 2, '#0a0c0f');
  pc.px(cx, cy + 2, '#7a1f1b');
  // фонарь
  pc.vline(LAMP.x - 6, LAMP.y, 88, '#0d1015');
  pc.vline(LAMP.x - 5, LAMP.y, 88, '#1b2028');
  pc.line(LAMP.x - 6, LAMP.y, LAMP.x, LAMP.y - 1, '#1b2028');
  pc.ellipse(LAMP.x, LAMP.y + 1, 7, 6, (x, y) => (bayer(x, y) < 0.25 ? P.sodiumDim : null), 0.3);
  pc.rect(LAMP.x - 2, LAMP.y, 5, 2, P.sodium);
  pc.rect(LAMP.x - 1, LAMP.y + 2, 3, 1, '#ffe2a8');
  // конус света
  pc.poly(
    [
      [LAMP.x - 2, LAMP.y + 2],
      [LAMP.x + 2, LAMP.y + 2],
      [LAMP.x + 16, 88],
      [LAMP.x - 16, 88],
    ],
    (x, y) => (bayer(x, y) < 0.06 && (x + y) % 2 === 0 ? P.sodium : null),
    0.18,
  );
  return pc.commit();
}

// ═════════════════════════ прилавок (передний план) ═════════════════════════

export const COUNTER_Y = 146;
export const MONITOR_SCREEN = { x: 12, y: 107, w: 43, h: 31 };
export const REGISTER_DISPLAY = { x: 263, y: 113, w: 40, h: 12 };
export const PHONE_LEDS = { line1: { x: 93, y: 147 }, line2: { x: 97, y: 147 } };
export const THERMO = { x: Math.round(proj(HW, -0.74, 6.4)[0]) - 6, y: Math.round(proj(HW, -0.74, 6.4)[1]) - 2 };

export function paintCounter(): HTMLCanvasElement {
  const pc = new PixelCanvas(W, H);
  const rnd = seeded(5);
  // столешница
  for (let y = COUNTER_Y; y < H; y++)
    for (let x = 0; x < W; x++) {
      const grain = Math.sin(x * 0.09 + Math.sin(y * 0.7) * 2 + y * 0.31) * 0.06 + (rnd() - 0.5) * 0.04;
      let k = 0.9 + grain + (y - COUNTER_Y) * 0.004;
      if (y === COUNTER_Y) k = 1.5;
      if (y === COUNTER_Y + 1) k = 1.2;
      pc.px(x, y, q(mul(P.wood, k), x, y, 18));
    }
  paintMonitor(pc);
  paintPhone(pc);
  paintLogbook(pc);
  paintGumRack(pc);
  paintRegister(pc);
  // монетница
  pc.ellipse(203, 165, 9, 3, '#2a2d30');
  pc.ellipse(203, 164, 8, 2, '#3f4448');
  return pc.commit();
}

function bevelBox(pc: PixelCanvas, x: number, y: number, w: number, h: number, base: Color, light = 1.25, dark = 0.7): void {
  pc.rect(x, y, w, h, base);
  pc.rect(x, y, w, 1, mul(base, light));
  pc.rect(x, y, 1, h, mul(base, light * 0.95));
  pc.rect(x + w - 1, y, 1, h, mul(base, dark));
  pc.rect(x, y + h - 1, w, 1, mul(base, dark));
}

function paintMonitor(pc: PixelCanvas): void {
  // корпус ЭЛТ-монитора, видна правая грань
  pc.poly(
    [
      [60, 102],
      [67, 106],
      [67, 141],
      [60, 145],
    ],
    mul(P.beige, 0.62),
  );
  bevelBox(pc, 5, 101, 56, 45, P.beige);
  // скруглённые углы
  for (const [cx, cy] of [
    [5, 101],
    [60, 101],
    [5, 145],
    [60, 145],
  ])
    pc.clear(cx, cy);
  // экран
  const s = MONITOR_SCREEN;
  pc.rect(s.x - 2, s.y - 2, s.w + 4, s.h + 4, P.beigeDark);
  pc.rect(s.x, s.y, s.w, s.h, P.crt);
  for (const [cx, cy] of [
    [s.x, s.y],
    [s.x + s.w - 1, s.y],
    [s.x, s.y + s.h - 1],
    [s.x + s.w - 1, s.y + s.h - 1],
  ])
    pc.px(cx, cy, P.beigeDark);
  // кнопки и индикатор
  pc.rect(44, 140, 4, 2, P.beigeDark);
  pc.rect(50, 140, 4, 2, P.beigeDark);
  pc.px(56, 140, P.green);
  pc.rect(10, 140, 12, 2, P.beigeMid);
  // подставка
  pc.rect(22, 146, 22, 4, mul(P.beige, 0.72));
  pc.rect(18, 149, 30, 2, mul(P.beige, 0.55));
}

function paintPhone(pc: PixelCanvas): void {
  // корпус
  pc.poly(
    [
      [72, 141],
      [100, 141],
      [103, 157],
      [69, 157],
    ],
    (x, y) => q(mul(P.beigeMid, 1.05 - (y - 141) * 0.012), x, y),
  );
  pc.hline(69, 103, 157, mul(P.beigeMid, 0.55));
  // трубка
  pc.rect(70, 135, 32, 6, P.beige);
  pc.rect(70, 135, 32, 1, mul(P.beige, 1.2));
  pc.rect(70, 140, 32, 1, mul(P.beige, 0.7));
  pc.rect(68, 134, 6, 8, mul(P.beige, 0.95));
  pc.rect(98, 134, 6, 8, mul(P.beige, 0.95));
  pc.rect(68, 141, 6, 1, mul(P.beige, 0.6));
  pc.rect(98, 141, 6, 1, mul(P.beige, 0.6));
  // кнопки
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 3; c++) pc.rect(76 + c * 4, 144 + r * 3, 3, 2, mul(P.beige, 1.12));
  // клавиши линий
  pc.rect(91, 145, 9, 5, mul(P.beigeMid, 0.8));
  pc.rect(92, 146, 3, 3, '#2a2d2f');
  pc.rect(96, 146, 3, 3, '#2a2d2f');
  drawText(pc, 92, 151, '1', '#5d5649');
  drawText(pc, 96, 151, '2', '#5d5649');
  // витой шнур
  for (let i = 0; i < 12; i++) pc.px(66 - (i % 2), 142 + i, mul(P.beige, 0.75 - (i % 2) * 0.15));
}

function paintLogbook(pc: PixelCanvas): void {
  const pageL: [number, number][] = [
    [107, 150],
    [124, 149],
    [124, 166],
    [104, 167],
  ];
  const pageR: [number, number][] = [
    [124, 149],
    [141, 150],
    [144, 167],
    [124, 166],
  ];
  pc.poly(pageL, (x, y) => q(mul('#e3d8bc', 0.95 - (124 - x) * 0.004), x, y));
  pc.poly(pageR, (x, y) => q(mul('#e3d8bc', 0.88 + (x - 124) * 0.002), x, y));
  pc.vline(124, 149, 166, '#9c8f73');
  for (let ly = 153; ly < 166; ly += 2) {
    pc.hline(108, 122, ly, '#b9ae95');
    pc.hline(126, 140, ly, '#b9ae95');
  }
  const rnd = seeded(3);
  for (let ly = 153; ly < 164; ly += 2)
    for (let lx = 109; lx < 121; lx++) if (rnd() < 0.45) pc.px(lx, ly - 1, '#3b3f63');
  for (let lx = 127; lx < 136; lx++) if (rnd() < 0.5) pc.px(lx, 152, '#3b3f63');
  // обложка
  pc.hline(103, 145, 168, '#5b1f1c');
  pc.hline(104, 144, 167, '#7a2a24');
  // ручка
  pc.line(132, 162, 143, 156, '#2e4a86');
  pc.line(132, 163, 143, 157, '#1f335f');
  pc.px(131, 163, '#c7c9cc');
}

function paintGumRack(pc: PixelCanvas): void {
  const x = 206;
  const y = 126;
  pc.rect(x, y, 24, 21, '#2b2f31');
  for (let r = 0; r < 3; r++) {
    pc.rect(x, y + 6 + r * 7, 24, 1, P.metal);
    for (let c = 0; c < 5; c++) {
      const color = PRODUCT_COLORS[(r * 5 + c * 3) % PRODUCT_COLORS.length];
      pc.rect(x + 1 + c * 5, y + 1 + r * 7, 4, 5, color);
      pc.rect(x + 1 + c * 5, y + 1 + r * 7, 4, 1, mix(color, '#ffffff', 0.4));
    }
  }
}

function paintRegister(pc: PixelCanvas): void {
  // основной блок
  pc.poly(
    [
      [238, 132],
      [304, 132],
      [308, 160],
      [234, 160],
    ],
    (x, y) => q(mul(P.plastic, 1.15 - (y - 132) * 0.008), x, y),
  );
  pc.hline(238, 304, 132, P.plasticLight);
  // клавиатура
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 8; c++) {
      const kx = 256 + c * 5 + r;
      const ky = 136 + r * 4;
      const col = c === 7 ? '#b84a3a' : c === 6 ? '#4a8a5a' : '#c9cdd0';
      pc.rect(kx, ky, 4, 3, col);
      pc.rect(kx, ky + 2, 4, 1, mix(col, '#000000', 0.4));
    }
  // денежный ящик
  pc.rect(236, 151, 71, 9, mul(P.plastic, 0.8));
  pc.hline(236, 306, 151, P.plasticLight);
  pc.rect(268, 154, 6, 3, P.plasticDark);
  pc.px(271, 155, P.metal);
  // принтер чеков
  bevelBox(pc, 238, 122, 18, 11, P.beigeMid);
  pc.rect(241, 122, 12, 2, '#151719');
  pc.rect(242, 120, 10, 2, '#f2f0e8');
  // дисплей кассира
  bevelBox(pc, 259, 108, 48, 22, P.plastic, 1.4, 0.6);
  pc.rect(REGISTER_DISPLAY.x - 1, REGISTER_DISPLAY.y - 1, REGISTER_DISPLAY.w + 2, REGISTER_DISPLAY.h + 2, '#0a0d0c');
  pc.rect(REGISTER_DISPLAY.x, REGISTER_DISPLAY.y, REGISTER_DISPLAY.w, REGISTER_DISPLAY.h, '#0b1712');
  pc.rect(278, 130, 8, 2, P.plasticDark);
}

// ═════════════════════════ прочие слои ═════════════════════════

/** Открытая служебная дверь: темнота склада вместо двери. */
export function paintDoorOpen(): HTMLCanvasElement {
  const pc = new PixelCanvas(W, H);
  pc.poly(SERVICE_DOOR_QUAD, (x, y) => {
    const t = (x - 6) / 30;
    return mix('#020304', '#0b1216', bayer(x, y) < 0.2 + t * 0.2 ? 0.6 : 0.1);
  });
  // полотно двери, распахнутое внутрь
  const leaf: [number, number][] = [proj(-HW, -0.5, 5.0), proj(-HW + 0.9, -0.5, 5.4), proj(-HW + 0.9, EYE, 5.4), proj(-HW, EYE, 5.0)];
  pc.poly(leaf, (x, y) => q(mul('#4b5a54', 0.45 + (x % 3) * 0.01), x, y));
  return pc.commit();
}

/** Затемнение по краям кадра. */
export function paintVignette(): HTMLCanvasElement {
  const pc = new PixelCanvas(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W * 0.62);
      const dy = (y - H / 2) / (H * 0.62);
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.min(0.85, Math.max(0, (d - 0.55) * 1.6));
      if (a > 0) pc.px(x, y, '#000000', a);
    }
  return pc.commit();
}

/** Иней по краям экрана — показывается, когда холодильник уходит в минус. */
export function paintFrost(): HTMLCanvasElement {
  const pc = new PixelCanvas(W, H);
  const rnd = seeded(91);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const n = rnd();
      const reach = 14 + Math.sin(x * 0.21) * 5 + Math.cos(y * 0.33) * 5;
      if (edge < reach) {
        const t = 1 - edge / reach;
        if (n < t * 0.85) pc.px(x, y, n < 0.15 ? '#ffffff' : '#bfe3f2', 0.25 + t * 0.55);
      }
    }
  // узоры
  for (let i = 0; i < 40; i++) {
    let x = rnd() < 0.5 ? rnd() * 16 : W - rnd() * 16;
    let y = rnd() * H;
    for (let k = 0; k < 14; k++) {
      pc.px(x, y, '#e6f6ff', 0.6);
      x += (rnd() - 0.5) * 3 + (x < W / 2 ? 0.8 : -0.8);
      y += (rnd() - 0.5) * 3;
    }
  }
  return pc.commit();
}

/** Зерно плёнки — небольшая текстура, сдвигаемая каждый кадр. */
export function paintNoise(size = 128): HTMLCanvasElement {
  const pc = new PixelCanvas(size, size);
  const rnd = seeded(13);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = rnd();
      if (v < 0.5) pc.px(x, y, v < 0.25 ? '#ffffff' : '#000000', 0.5 + rnd() * 0.5);
    }
  return pc.commit();
}

/** Мягкое пятно света (фонарик, свечение). Белое с прозрачностью по радиусу. */
export function paintSoftLight(r: number, hard = 0.35): HTMLCanvasElement {
  const size = r * 2;
  const pc = new PixelCanvas(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      if (d >= 1) continue;
      const a = d < hard ? 1 : 1 - (d - hard) / (1 - hard);
      pc.px(x, y, '#ffffff', a * a);
    }
  return pc.commit();
}
