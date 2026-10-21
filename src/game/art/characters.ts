/**
 * Генератор персонажей: по описанию (одежда, причёска, лицо) рисуется
 * поясной портрет 96×100 со светом сверху-слева, контуром и кадрами моргания/речи.
 * Пропорции рассчитаны под перспективу сцены: глаза на линии горизонта (y=64),
 * кромка прилавка (y=146) — на уровне пояса.
 */
import { P } from './palette';
import { PixelCanvas, bayer, mix, rgb, seeded, type Color, type RGB } from './PixelCanvas';

export const CHAR_W = 96;
export const CHAR_H = 100;
/** Высота глаз в спрайте (совмещается с горизонтом сцены). */
export const CHAR_EYE_Y = 17;
const CX = 48;
const HEAD = { cx: 48, cy: 17, rx: 11, ry: 15 };
const EYE_Y = 17;
const L_EYE = 43;
const R_EYE = 53;

type CoatStyle = 'jacket' | 'coat' | 'puffer' | 'leather' | 'vest';
type Hair = 'short' | 'neat' | 'bun' | 'bob' | 'wet' | 'none';
type Hat = 'beanie' | 'cap' | 'ushanka' | 'headscarf' | null;

export interface CharSpec {
  skin: Color;
  hair: Color;
  hairStyle: Hair;
  hat?: Hat;
  hatColor?: Color;
  coat: Color;
  coatStyle: CoatStyle;
  inner?: Color;
  innerStripes?: Color;
  shoulder?: number;
  buttons?: 'left' | 'right';
  ring?: 'left' | 'right';
  zipper?: boolean;
  tie?: Color;
  scarf?: Color;
  furCollar?: Color;
  badge?: boolean;
  lanyard?: Color;
  straps?: Color;
  stripe?: Color;
  glasses?: boolean;
  stubble?: number;
  mustache?: boolean;
  brows?: 'flat' | 'tired' | 'raised' | 'stern';
  mouth?: 'neutral' | 'smile' | 'tight' | 'open';
  eyes?: Color;
  lips?: Color;
  redNose?: boolean;
  wet?: number;
  frost?: boolean;
  umbrella?: boolean;
  shadowFace?: boolean;
  glitch?: number;
  wrinkles?: boolean;
  gloves?: Color;
  /** Сдвиг вниз в сцене (рост): чем больше, тем ниже персонаж. */
  drop?: number;
}

export interface Frame {
  blink?: boolean;
  talk?: boolean;
}

const OUTLINE = '#0a0c0e';

function shade(c: Color, k: number): RGB {
  const v = rgb(c);
  return [Math.min(255, v[0] * k), Math.min(255, v[1] * k), Math.min(255, v[2] * k)];
}

function quant(c: RGB, x: number, y: number, lv = 12): RGB {
  const t = bayer(x, y);
  return [Math.floor(c[0] / lv + t) * lv, Math.floor(c[1] / lv + t) * lv, Math.floor(c[2] / lv + t) * lv];
}

/** Свет люминесцентных ламп: сверху-слева, книзу темнее. */
function bodyLight(x: number, y: number): number {
  return 1.12 - ((x - 18) / 60) * 0.34 - Math.max(0, (y - 40) / 60) * 0.3;
}

export function paintCharacter(spec: CharSpec, frame: Frame = {}, seed = 1): HTMLCanvasElement {
  const pc = new PixelCanvas(CHAR_W, CHAR_H);
  const rnd = seeded(seed);
  const sw = spec.shoulder ?? 27;
  const coat = spec.wet ? shade(spec.coat, 1 - spec.wet * 0.18) : rgb(spec.coat);
  const isVest = spec.coatStyle === 'vest';
  const puff = spec.coatStyle === 'puffer' ? 2 : 0;
  const sleeve = rgb(isVest ? (spec.inner ?? '#2a2d33') : coat);

  // ───── руки (рукава) ─────
  for (const side of [-1, 1]) {
    const outer = CX + side * (sw + puff);
    const arm: [number, number][] = [
      [CX + side * (sw - 9), 42],
      [outer, 46],
      [outer + side * 2, 64],
      [outer + side * 1, 84],
      [CX + side * 14, 93],
      [CX + side * 13, 100],
      [CX + side * (sw - 10), 100],
      [CX + side * (sw - 8), 60],
    ];
    pc.poly(arm, (x, y) => quant(shade(sleeve, bodyLight(x, y) * (side > 0 ? 0.92 : 1.0)), x, y));
  }

  // ───── туловище ─────
  const torso: [number, number][] = [
    [CX - 8, 33],
    [CX + 8, 33],
    [CX + sw - 6, 38],
    [CX + sw - 3 + puff, 44],
    [CX + sw - 8, 62],
    [CX + sw - 9, 100],
    [CX - sw + 9, 100],
    [CX - sw + 8, 62],
    [CX - sw + 3 - puff, 44],
    [CX - sw + 6, 38],
  ];
  pc.poly(torso, (x, y) => {
    let k = bodyLight(x, y);
    if (spec.coatStyle === 'puffer') {
      const r = (y - 44) % 9;
      if (r === 0) k *= 0.78;
      else if (r === 1 || r === 2) k *= 1.08;
    }
    if (spec.coatStyle === 'leather' && (x * 2 + y) % 31 < 2 && x < CX) k *= 1.3;
    return quant(shade(coat, k), x, y);
  });
  // складки между туловищем и руками
  for (const side of [-1, 1]) {
    pc.line(CX + side * (sw - 8), 50, CX + side * (sw - 9), 99, shade(side < 0 ? coat : sleeve, 0.6));
  }

  // ───── вырез, воротник, внутренняя одежда ─────
  const inner = rgb(spec.inner ?? '#2b2f36');
  const innerFill = (x: number, y: number): RGB => {
    let c = inner;
    if (spec.innerStripes && Math.floor(y / 2) % 2 === 0) c = rgb(spec.innerStripes);
    return quant(shade(c, bodyLight(x, y) * 1.05), x, y);
  };
  if (spec.coatStyle === 'coat' || isVest) {
    const depth = isVest ? 62 : 66;
    pc.poly(
      [
        [CX - 7, 32],
        [CX + 7, 32],
        [CX + 1, depth],
        [CX - 1, depth],
      ],
      innerFill,
    );
    if (spec.tie) {
      // воротник рубашки и галстук
      pc.poly(
        [
          [CX - 6, 32],
          [CX - 1, 36],
          [CX - 4, 39],
        ],
        '#f2efe8',
      );
      pc.poly(
        [
          [CX + 6, 32],
          [CX + 1, 36],
          [CX + 4, 39],
        ],
        '#d4d0c6',
      );
      pc.rect(CX - 1, 35, 3, 3, spec.tie);
      pc.poly(
        [
          [CX - 1, 38],
          [CX + 2, 38],
          [CX + 3, 56],
          [CX, 60],
          [CX - 2, 56],
        ],
        (x, y) => quant(shade(spec.tie!, x < CX + 1 ? 1.15 : 0.85), x, y),
      );
    }
    if (!isVest) {
      // лацканы
      pc.poly(
        [
          [CX - 8, 33],
          [CX - 1, depth],
          [CX - 5, depth - 6],
          [CX - 12, 40],
        ],
        (x, y) => quant(shade(coat, bodyLight(x, y) * 1.2), x, y),
      );
      pc.poly(
        [
          [CX + 8, 33],
          [CX + 1, depth],
          [CX + 5, depth - 6],
          [CX + 12, 40],
        ],
        (x, y) => quant(shade(coat, bodyLight(x, y) * 0.78), x, y),
      );
      pc.line(CX - 12, 40, CX - 5, depth - 6, shade(coat, 0.55));
      pc.line(CX + 12, 40, CX + 5, depth - 6, shade(coat, 0.45));
    } else {
      pc.line(CX - 7, 33, CX - 1, depth, shade(coat, 0.65));
      pc.line(CX + 7, 33, CX + 1, depth, shade(coat, 0.55));
    }
  } else {
    // стойка воротника
    pc.poly(
      [
        [CX - 10, 30],
        [CX + 10, 30],
        [CX + 11, 38],
        [CX - 11, 38],
      ],
      (x, y) => quant(shade(coat, (x < CX ? 1.12 : 0.85) * (y < 31 ? 1.2 : 1)), x, y),
    );
    if (spec.coatStyle === 'leather') {
      pc.poly(
        [
          [CX - 1, 33],
          [CX + 5, 33],
          [CX + 2, 46],
        ],
        innerFill,
      );
      pc.poly(
        [
          [CX - 12, 34],
          [CX - 2, 38],
          [CX - 7, 50],
        ],
        (x, y) => quant(shade(coat, 1.2), x, y),
      );
      pc.poly(
        [
          [CX + 12, 34],
          [CX + 6, 38],
          [CX + 8, 50],
        ],
        (x, y) => quant(shade(coat, 0.7), x, y),
      );
    }
  }
  if (spec.furCollar) {
    pc.poly(
      [
        [CX - 13, 33],
        [CX + 13, 33],
        [CX + 15, 41],
        [CX - 15, 41],
      ],
      (x, y) => shade(spec.furCollar!, bayer(x, y) < 0.5 ? 1.15 : 0.8),
    );
  }
  if (spec.zipper || spec.coatStyle === 'jacket' || spec.coatStyle === 'puffer' || spec.coatStyle === 'leather') {
    const zx = spec.coatStyle === 'leather' ? CX + 3 : CX;
    for (let y = 38; y < 100; y++) pc.px(zx, y, y % 2 ? P.metalDark : P.metal);
    pc.rect(zx - 1, 52, 3, 4, P.metal);
  }
  if (spec.stripe) {
    for (const yy of [70, 71]) pc.hline(CX - sw - 2, CX + sw + 2, yy, mix(spec.stripe, '#ffffff', yy % 2 ? 0 : 0.35));
    for (const yy of [82, 83]) pc.hline(CX - sw - 2, CX + sw + 2, yy, mix(spec.stripe, '#ffffff', yy % 2 ? 0 : 0.35));
  }
  if (spec.buttons) {
    const side = spec.buttons === 'left' ? -1 : 1;
    pc.line(CX + side * 2, 66, CX + side * 2, 100, shade(coat, 0.6));
    for (const by of [70, 80, 90]) {
      const bx = CX + side * 6;
      pc.rect(bx, by, 2, 2, shade(coat, 0.45));
      pc.px(bx, by, shade(coat, 1.4));
    }
  }
  if (spec.straps) {
    for (const sx of [CX - 17, CX + 17]) {
      pc.poly(
        [
          [sx - 3, 36],
          [sx + 2, 36],
          [sx + 3, 100],
          [sx - 2, 100],
        ],
        (x, y) => quant(shade(spec.straps!, bodyLight(x, y)), x, y),
      );
      pc.rect(sx - 2, 66, 4, 2, P.metalDark);
    }
  }
  if (isVest) {
    // фирменный колосок
    const lx = CX - 14;
    pc.vline(lx, 48, 56, '#b8902c');
    for (let i = 0; i < 4; i++) {
      pc.px(lx - 1, 48 + i * 2, P.wheat);
      pc.px(lx + 1, 49 + i * 2, P.wheat);
    }
  }
  if (spec.lanyard) {
    pc.line(CX - 6, 34, CX - 2, 58, spec.lanyard);
    pc.line(CX + 6, 34, CX + 2, 58, spec.lanyard);
  }
  if (spec.badge) {
    const bx = spec.lanyard ? CX - 4 : CX + 9;
    const by = spec.lanyard ? 58 : 50;
    pc.rect(bx, by, 9, 6, '#e9ecef');
    pc.rect(bx, by, 9, 2, spec.lanyard ? '#5d93c9' : '#c9a34a');
    pc.hline(bx + 1, bx + 6, by + 4, '#6a7480');
  }
  if (spec.scarf) {
    pc.poly(
      [
        [CX - 11, 30],
        [CX + 11, 30],
        [CX + 12, 38],
        [CX - 12, 38],
      ],
      (x, y) => quant(shade(spec.scarf!, x < CX ? 1.1 : 0.85), x, y),
    );
    pc.poly(
      [
        [CX + 3, 35],
        [CX + 10, 35],
        [CX + 9, 64],
        [CX + 3, 63],
      ],
      (x, y) => quant(shade(spec.scarf!, bodyLight(x, y) * 0.95), x, y),
    );
    for (let y = 38; y < 63; y += 4) pc.hline(CX + 4, CX + 8, y, shade(spec.scarf, 0.7));
    pc.hline(CX + 3, CX + 9, 64, mix(spec.scarf, '#ffffff', 0.3));
  }
  if (spec.umbrella) {
    const ux = CX + sw + 3;
    pc.poly(
      [
        [ux - 1, 52],
        [ux + 2, 52],
        [ux + 6, 100],
        [ux + 1, 100],
      ],
      (x, y) => quant(shade('#1c2024', x < ux + 2 ? 1.2 : 0.8), x, y),
    );
    pc.line(ux, 52, ux - 3, 46, '#6a4528');
    pc.line(ux - 3, 46, ux - 6, 47, '#6a4528');
    for (let i = 0; i < 6; i++) pc.px(ux + 3 + i * 0.4, 62 + i * 6, '#9cc8e8');
  }

  // ───── кисти рук на кромке прилавка ─────
  const skin = rgb(spec.skin);
  for (const side of [-1, 1]) {
    const hx = CX + side * 18;
    const glove = spec.gloves ? rgb(spec.gloves) : null;
    pc.ellipse(hx, 96, 6, 4.5, (x, y) => quant(shade(glove ?? skin, (x < hx ? 1.05 : 0.85) - (y - 92) * 0.03), x, y));
    // пальцы
    for (let f = -2; f <= 2; f++) pc.px(hx + f * 2, 100 - 1, shade(glove ?? skin, 0.7));
    // манжета
    pc.hline(hx - 6, hx + 6, 91, shade(sleeve, 0.6));
    if (spec.ring && ((spec.ring === 'left' && side < 0) || (spec.ring === 'right' && side > 0))) {
      pc.px(hx + side * 2, 97, '#f2d26a');
      pc.px(hx + side * 2 + 1, 97, '#b8902c');
    }
  }

  // ───── шея ─────
  pc.poly(
    [
      [CX - 5, 26],
      [CX + 5, 26],
      [CX + 6, 36],
      [CX - 6, 36],
    ],
    (x, y) => quant(shade(skin, y < 31 ? 0.62 : 0.74 - (x - CX) * 0.015), x, y),
  );

  // ───── голова ─────
  pc.ellipse(HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry, (x, y) => {
    let k = 1.04;
    const dx = x - HEAD.cx;
    if (dx > 3) k -= (dx - 3) * 0.035;
    if (dx < -6) k += 0.03;
    if (y > 25) k -= (y - 25) * 0.035;
    // скулы
    if (Math.abs(dx) > 5 && y > 19 && y < 25) k -= 0.05;
    return quant(shade(skin, k), x, y, 10);
  });
  // уши
  for (const side of [-1, 1]) {
    const ex = HEAD.cx + side * (HEAD.rx + 0.5);
    pc.ellipse(ex, 19, 1.6, 3.2, shade(skin, side > 0 ? 0.72 : 0.95));
    pc.vline(Math.round(ex), 18, 21, shade(skin, side > 0 ? 0.55 : 0.75));
  }

  // ───── лицо ─────
  const browC = shade(spec.hair, 0.75);
  const lidC = shade(skin, 0.55);
  const iris = rgb(spec.eyes ?? '#2b2422');
  for (const [ex, side] of [
    [L_EYE, -1],
    [R_EYE, 1],
  ] as const) {
    const x0 = ex - 2;
    if (frame.blink) {
      pc.hline(x0, x0 + 3, EYE_Y, lidC);
      pc.hline(x0, x0 + 3, EYE_Y + 1, shade(skin, 0.85));
    } else {
      pc.hline(x0, x0 + 3, EYE_Y - 1, shade(skin, 0.5));
      pc.hline(x0, x0 + 3, EYE_Y, side < 0 ? '#e6e1d6' : '#cfc9bd');
      pc.hline(x0, x0 + 3, EYE_Y + 1, shade(skin, 0.82));
      // зрачки смотрят на игрока
      const ix = side < 0 ? x0 + 2 : x0 + 1;
      pc.px(ix, EYE_Y, iris);
      pc.px(ix, EYE_Y + 1, shade(iris, 1.3));
      pc.px(ix + (side < 0 ? -1 : 1), EYE_Y, shade(iris, 1.6));
    }
    // брови
    const by = spec.brows === 'raised' ? EYE_Y - 5 : EYE_Y - 4;
    pc.hline(x0 - 1, x0 + 3, by, browC);
    if (spec.brows === 'tired') pc.px(side < 0 ? x0 - 1 : x0 + 3, by + 1, browC);
    if (spec.brows === 'stern') {
      pc.px(side < 0 ? x0 + 3 : x0 - 1, by + 1, browC);
      pc.px(side < 0 ? x0 - 1 : x0 + 3, by, shade(skin, 0.9));
    }
    if (spec.brows === 'raised') pc.px(side < 0 ? x0 + 3 : x0 - 1, by - 1, browC);
  }
  // нос
  pc.vline(HEAD.cx + 1, EYE_Y + 1, EYE_Y + 5, shade(skin, 0.86));
  pc.px(HEAD.cx + 2, EYE_Y + 4, shade(skin, 0.78));
  pc.hline(HEAD.cx - 1, HEAD.cx + 2, EYE_Y + 6, shade(skin, 0.74));
  pc.px(HEAD.cx - 1, EYE_Y + 6, shade(skin, 0.62));
  pc.px(HEAD.cx + 2, EYE_Y + 6, shade(skin, 0.55));
  pc.px(HEAD.cx, EYE_Y + 5, shade(skin, 1.12));
  if (spec.redNose) {
    pc.ellipse(HEAD.cx + 0.5, EYE_Y + 5, 2, 1.6, '#b9493f');
    pc.px(HEAD.cx, EYE_Y + 4, '#d9706a');
    for (const cxk of [HEAD.cx - 7, HEAD.cx + 7]) pc.ellipse(cxk, EYE_Y + 5, 2, 1, '#c56a5c', 0.6);
  }
  // рот
  const mouthY = EYE_Y + 10;
  const lip = rgb(spec.lips ?? shade(skin, 0.62));
  if (frame.talk) {
    pc.hline(HEAD.cx - 2, HEAD.cx + 2, mouthY, '#3a1a1a');
    pc.hline(HEAD.cx - 1, HEAD.cx + 1, mouthY + 1, '#5a2622');
    pc.hline(HEAD.cx - 1, HEAD.cx + 1, mouthY + 2, shade(lip, 1.1));
  } else if (spec.mouth === 'smile') {
    pc.hline(HEAD.cx - 2, HEAD.cx + 2, mouthY, shade(lip, 0.85));
    pc.px(HEAD.cx - 3, mouthY - 1, shade(lip, 0.85));
    pc.px(HEAD.cx + 3, mouthY - 1, shade(lip, 0.75));
    pc.hline(HEAD.cx - 1, HEAD.cx + 1, mouthY + 1, shade(lip, 1.15));
  } else if (spec.mouth === 'tight') {
    pc.hline(HEAD.cx - 2, HEAD.cx + 2, mouthY, shade(skin, 0.5));
  } else if (spec.mouth === 'open') {
    pc.hline(HEAD.cx - 1, HEAD.cx + 1, mouthY, '#3a1a1a');
    pc.hline(HEAD.cx - 1, HEAD.cx + 1, mouthY + 1, '#3a1a1a');
  } else {
    pc.hline(HEAD.cx - 3, HEAD.cx + 2, mouthY, shade(lip, 0.85));
    pc.hline(HEAD.cx - 1, HEAD.cx + 1, mouthY + 1, shade(lip, 1.15));
  }
  if (spec.mustache) pc.hline(HEAD.cx - 3, HEAD.cx + 3, mouthY - 1, shade(spec.hair, 0.9));
  if (spec.stubble) {
    pc.ellipse(HEAD.cx, HEAD.cy + 3, HEAD.rx - 0.8, HEAD.ry - 1.2, (x, y) => {
      if (y < EYE_Y + 7 || (y >= mouthY && y <= mouthY + 1 && Math.abs(x - HEAD.cx) <= 2)) return null;
      return bayer(x, y) < spec.stubble! ? shade(spec.hair, 0.65) : null;
    }, 0.5);
  }
  if (spec.wrinkles) {
    pc.px(L_EYE - 4, EYE_Y + 1, shade(skin, 0.82));
    pc.px(R_EYE + 4, EYE_Y + 1, shade(skin, 0.72));
    pc.line(HEAD.cx - 4, EYE_Y + 6, HEAD.cx - 5, EYE_Y + 9, shade(skin, 0.85));
    pc.line(HEAD.cx + 5, EYE_Y + 6, HEAD.cx + 6, EYE_Y + 9, shade(skin, 0.75));
    pc.hline(HEAD.cx - 3, HEAD.cx + 3, EYE_Y - 8, shade(skin, 0.9));
  }
  if (spec.glasses) {
    const gc = '#2b2725';
    for (const ex of [L_EYE, R_EYE]) {
      const x0 = ex - 4;
      pc.hline(x0, x0 + 7, EYE_Y - 3, gc);
      pc.hline(x0, x0 + 7, EYE_Y + 3, gc);
      pc.vline(x0, EYE_Y - 3, EYE_Y + 3, gc);
      pc.vline(x0 + 7, EYE_Y - 3, EYE_Y + 3, gc);
      pc.px(x0 + 1, EYE_Y - 2, '#eaf6ff');
      pc.px(x0 + 2, EYE_Y - 2, '#c8dbe8');
    }
    pc.hline(L_EYE + 4, R_EYE - 4, EYE_Y - 2, gc);
    for (let i = 0; i < 14; i++) pc.px(HEAD.cx - 12 - Math.floor(i / 7), EYE_Y + 1 + i, i % 2 ? '#c9a75a' : '#8a6d2c');
  }

  // ───── волосы и головные уборы ─────
  paintHair(pc, spec);

  // ───── эффекты ─────
  if (spec.wet) {
    for (let i = 0; i < 55 * spec.wet; i++) {
      const x = 14 + Math.floor(rnd() * 68);
      const y = 38 + Math.floor(rnd() * 58);
      if (pc.get(x, y)[3] === 0) continue;
      const len = 2 + Math.floor(rnd() * 6);
      for (let k = 0; k < len; k++) pc.px(x, y + k, '#a9cfe6', 0.3 + (k / len) * 0.35);
    }
    for (let i = 0; i < 10; i++) pc.px(38 + Math.floor(rnd() * 21), 4 + Math.floor(rnd() * 10), '#bfe2f5', 0.7);
  }
  if (spec.frost) {
    for (let i = 0; i < 160; i++) {
      const x = 10 + Math.floor(rnd() * 76);
      const y = 34 + Math.floor(rnd() * 64);
      if (pc.get(x, y)[3] === 0) continue;
      pc.px(x, y, rnd() < 0.4 ? '#ffffff' : '#cfe9f5', 0.75);
    }
  }
  if (spec.shadowFace) applyShadowFace(pc, frame);
  if (spec.glitch) applyGlitch(pc, spec, frame, seed, skin);

  pc.outline(OUTLINE);
  return pc.commit();
}

/** Лицо в тени: сверху почти темнота, снизу — бледный зеленоватый свет кассы. Тон кожи не меняется на «тёмный». */
function applyShadowFace(pc: PixelCanvas, frame: Frame): void {
  for (let y = 0; y < 40; y++)
    for (let x = 30; x < 68; x++) {
      const px = pc.get(x, y);
      if (px[3] === 0) continue;
      const lum = (0.3 * px[0] + 0.59 * px[1] + 0.11 * px[2]) / 255;
      const t = Math.min(1, Math.max(0, (y - 6) / 30));
      // обесцветить и приглушить: верх в тени, низ подсвечен
      const k = 0.42 + 0.5 * t;
      const grey: RGB = [lum * 255 * k, lum * 255 * k * 1.02, lum * 255 * k];
      pc.px(x, y, mix(grey, '#9fd6bd', 0.22 * t * k));
    }
  if (!frame.blink) {
    pc.px(L_EYE, EYE_Y, '#cfeee0');
    pc.px(R_EYE - 1, EYE_Y, '#cfeee0');
  }
}

function applyGlitch(pc: PixelCanvas, spec: CharSpec, frame: Frame, seed: number, skin: RGB): void {
  const g = seeded(seed * 7 + (frame.talk ? 3 : 0) + (frame.blink ? 5 : 0));
  // черты лица «стёрты»
  for (let y = EYE_Y - 4; y < EYE_Y + 13; y++)
    for (let x = HEAD.cx - 8; x <= HEAD.cx + 8; x++) {
      if (pc.get(x, y)[3] === 0) continue;
      pc.px(x, y, quant(shade(skin, 0.78 - (x - HEAD.cx) * 0.01 + g() * 0.06), x, y, 16));
    }
  pc.hline(L_EYE - 2, L_EYE + 1, EYE_Y, '#0c0c0e');
  pc.hline(R_EYE - 1, R_EYE + 2, EYE_Y + 1, '#0c0c0e');
  // сдвиг строк, как помехи на плёнке
  const rows: [number, number, number, number][][] = [];
  for (let y = 0; y < 40; y++) {
    const row: [number, number, number, number][] = [];
    for (let x = 0; x < CHAR_W; x++) row.push(pc.get(x, y));
    rows.push(row);
  }
  for (let y = 0; y < 40; y++) {
    const shift = g() < (spec.glitch ?? 0) ? Math.round((g() - 0.5) * 8) : 0;
    if (!shift) continue;
    const row = rows[y];
    for (let x = 22; x < 74; x++) {
      const src = row[Math.min(CHAR_W - 1, Math.max(0, x - shift))];
      if (src[3] === 0) pc.clear(x, y);
      else pc.px(x, y, [src[0], src[1], src[2]]);
    }
  }
  for (let i = 0; i < 5; i++) pc.vline(HEAD.cx - 8 + Math.floor(g() * 17), 8, 30, '#1a1c20', 0.45);
}

function paintHair(pc: PixelCanvas, spec: CharSpec): void {
  const hairBase = rgb(spec.hairStyle === 'wet' ? shade(spec.hair, 0.65) : spec.hair);
  const hk = (x: number, y: number) =>
    quant(shade(hairBase, 1.12 - (x - 36) * 0.018 + (y < 6 ? 0.1 : 0) + (bayer(x, y) < 0.18 ? 0.12 : 0)), x, y, 10);
  const top = HEAD.cy - HEAD.ry;
  const style = spec.hat ? (spec.hat === 'headscarf' ? null : 'cropped') : spec.hairStyle;
  const skinEdge = shade(spec.skin, 0.75);

  if (style === 'short' || style === 'wet' || style === 'neat' || style === 'cropped') {
    const fringeY = style === 'neat' ? top + 9 : top + 8;
    pc.ellipse(HEAD.cx, HEAD.cy - 1, HEAD.rx + 1, HEAD.ry + 0.5, (x, y) => {
      const sideBurn = x <= HEAD.cx - HEAD.rx + 2 || x >= HEAD.cx + HEAD.rx - 2;
      const jag = style === 'neat' ? (x < HEAD.cx - 3 ? 0 : 1) : (x * 5) % 3 === 0 ? 1 : 0;
      if (y > fringeY + jag && !(sideBurn && y < EYE_Y + 1)) return null;
      return hk(x, y);
    });
    if (style === 'neat') pc.line(HEAD.cx - 4, top + 1, HEAD.cx - 5, fringeY, shade(hairBase, 0.6));
    pc.hline(HEAD.cx - HEAD.rx + 3, HEAD.cx + HEAD.rx - 3, fringeY + 1, skinEdge);
  }
  if (style === 'bun') {
    pc.ellipse(HEAD.cx, HEAD.cy - 1, HEAD.rx + 1.2, HEAD.ry + 0.5, (x, y) => {
      if (y > top + 9 && x > HEAD.cx - HEAD.rx + 2 && x < HEAD.cx + HEAD.rx - 2) return null;
      if (y > EYE_Y + 8) return null;
      return hk(x, y);
    });
    pc.ellipse(HEAD.cx + 1, top - 1, 5.5, 4, (x, y) => hk(x, y));
    pc.line(HEAD.cx - 3, top + 2, HEAD.cx + 4, top + 7, shade(hairBase, 0.7));
    pc.hline(HEAD.cx - 8, HEAD.cx + 8, top + 10, skinEdge);
    pc.vline(HEAD.cx - HEAD.rx + 1, EYE_Y + 2, EYE_Y + 10, hk(37, 25));
  }
  if (style === 'bob') {
    pc.ellipse(HEAD.cx, HEAD.cy + 1, HEAD.rx + 2, HEAD.ry + 1, (x, y) => {
      if (y > top + 9 && x > HEAD.cx - HEAD.rx + 2 && x < HEAD.cx + HEAD.rx - 2) return null;
      if (y > EYE_Y + 11) return null;
      return hk(x, y);
    });
    pc.hline(HEAD.cx - 8, HEAD.cx + 8, top + 10, skinEdge);
  }

  const hat = spec.hat;
  const hc = rgb(spec.hatColor ?? '#2a2d33');
  if (hat === 'beanie') {
    pc.ellipse(HEAD.cx, HEAD.cy - 3, HEAD.rx + 1.5, HEAD.ry - 1, (x, y) =>
      y > top + 10 ? null : quant(shade(hc, 1.12 - (x - 36) * 0.02 + ((x + y) % 4 === 0 ? 0.06 : 0)), x, y),
    );
    for (let x = HEAD.cx - HEAD.rx - 1; x <= HEAD.cx + HEAD.rx + 1; x++)
      pc.vline(x, top + 7, top + 10, shade(hc, x % 2 ? 0.72 : 1.0 - (x - 36) * 0.01));
    pc.ellipse(HEAD.cx, top - 3, 3, 2.2, shade(hc, 1.2));
    pc.hline(HEAD.cx - HEAD.rx + 2, HEAD.cx + HEAD.rx - 2, top + 11, shade(spec.skin, 0.72));
  }
  if (hat === 'cap') {
    pc.ellipse(HEAD.cx, HEAD.cy - 3, HEAD.rx + 1.2, HEAD.ry - 2, (x, y) =>
      y > top + 9 ? null : quant(shade(hc, 1.15 - (x - 36) * 0.02), x, y),
    );
    // шов и козырёк
    pc.vline(HEAD.cx, top + 1, top + 8, shade(hc, 0.7));
    pc.poly(
      [
        [HEAD.cx - 12, top + 8],
        [HEAD.cx + 12, top + 8],
        [HEAD.cx + 16, top + 13],
        [HEAD.cx - 16, top + 13],
      ],
      (x, y) => quant(shade(hc, y < top + 10 ? 1.25 : 0.6), x, y),
    );
    pc.hline(HEAD.cx - 16, HEAD.cx + 16, top + 13, shade(hc, 0.4));
    pc.hline(HEAD.cx - 9, HEAD.cx + 9, top + 14, shade(spec.skin, 0.5));
    pc.hline(HEAD.cx - 9, HEAD.cx + 9, top + 15, shade(spec.skin, 0.72));
    pc.px(HEAD.cx, top - 1, shade(hc, 1.4));
  }
  if (hat === 'ushanka') {
    const fur = (x: number, y: number, k = 1) =>
      quant(shade(hc, k * ((bayer(x, y) < 0.45 ? 1.18 : 0.86) - (x - 32) * 0.01)), x, y, 10);
    // макушка
    pc.ellipse(HEAD.cx, top + 2, HEAD.rx + 2, 7, (x, y) => (y > top + 6 ? null : fur(x, y, 0.85)));
    // отворот надо лбом
    pc.poly(
      [
        [HEAD.cx - HEAD.rx - 4, top + 4],
        [HEAD.cx + HEAD.rx + 4, top + 4],
        [HEAD.cx + HEAD.rx + 3, top + 12],
        [HEAD.cx - HEAD.rx - 3, top + 12],
      ],
      (x, y) => fur(x, y, 1.2),
    );
    // уши шапки
    for (const side of [-1, 1]) {
      const ex = HEAD.cx + side * (HEAD.rx + 1);
      pc.poly(
        [
          [ex - 4, top + 10],
          [ex + 4, top + 10],
          [ex + 3 + side, EYE_Y + 12],
          [ex - 3 + side, EYE_Y + 12],
        ],
        (x, y) => fur(x, y, side > 0 ? 0.85 : 1.05),
      );
    }
    pc.hline(HEAD.cx - HEAD.rx + 3, HEAD.cx + HEAD.rx - 3, top + 13, shade(spec.skin, 0.7));
  }
  if (hat === 'headscarf') {
    const dot = (x: number, y: number) =>
      (x * 2 + y * 3) % 7 === 0 ? mix(hc, '#ead9ae', 0.65) : quant(shade(hc, 1.08 - (x - 34) * 0.016), x, y);
    pc.ellipse(HEAD.cx, HEAD.cy, HEAD.rx + 2.4, HEAD.ry + 1.4, (x, y) => {
      if (y > top + 9 && x > HEAD.cx - HEAD.rx + 1 && x < HEAD.cx + HEAD.rx - 1) return null;
      if (y > HEAD.cy + HEAD.ry - 1) return null;
      return dot(x, y);
    });
    pc.poly(
      [
        [HEAD.cx - 4, HEAD.cy + HEAD.ry - 2],
        [HEAD.cx + 4, HEAD.cy + HEAD.ry - 2],
        [HEAD.cx + 3, HEAD.cy + HEAD.ry + 5],
        [HEAD.cx - 3, HEAD.cy + HEAD.ry + 5],
      ],
      (x, y) => dot(x, y),
    );
    pc.hline(HEAD.cx - 9, HEAD.cx + 9, top + 10, shade(spec.skin, 0.8));
    // прядь из-под платка
    for (let i = 0; i < 4; i++) pc.px(HEAD.cx - 8 + i, top + 10 + (i > 1 ? 1 : 0), rgb(spec.hair));
  }
}

// ───────────── каталог персонажей ─────────────

export const CHARACTER_SPECS: Record<string, CharSpec> = {
  'courier:v1': {
    skin: '#d9a98a',
    hair: '#3b2a20',
    hairStyle: 'short',
    hat: 'beanie',
    hatColor: '#2e3640',
    coat: '#d8b432',
    coatStyle: 'jacket',
    stripe: '#cfd6da',
    straps: '#2b2f33',
    brows: 'flat',
    mouth: 'neutral',
  },
  'rustam:v1': {
    skin: '#b98262',
    hair: '#1f1a17',
    hairStyle: 'short',
    hat: 'cap',
    hatColor: '#30343a',
    coat: '#4a3326',
    coatStyle: 'leather',
    inner: '#6b6f78',
    stubble: 0.55,
    brows: 'tired',
    mouth: 'smile',
    shoulder: 29,
    drop: -1,
  },
  'grey:v1': {
    skin: '#d4ac94',
    hair: '#a9adb0',
    hairStyle: 'neat',
    coat: '#6c7277',
    coatStyle: 'coat',
    inner: '#e5e2da',
    tie: '#2c3440',
    buttons: 'left',
    ring: 'right',
    brows: 'flat',
    mouth: 'smile',
    wrinkles: true,
  },
  'grey:v2': {
    skin: '#cfa58d',
    hair: '#a9adb0',
    hairStyle: 'neat',
    coat: '#6c7277',
    coatStyle: 'coat',
    inner: '#e5e2da',
    tie: '#2c3440',
    buttons: 'right',
    ring: 'left',
    brows: 'flat',
    mouth: 'neutral',
    wrinkles: true,
    wet: 0.6,
    umbrella: true,
  },
  'grey:v3': {
    skin: '#b9a394',
    hair: '#8d9295',
    hairStyle: 'wet',
    coat: '#55595d',
    coatStyle: 'coat',
    inner: '#bdbab2',
    tie: '#1e242c',
    buttons: 'right',
    ring: 'left',
    mouth: 'tight',
    wet: 1.6,
    glitch: 0.55,
  },
  'liza:v1': {
    skin: '#e8c0a8',
    hair: '#5a3a26',
    hairStyle: 'bun',
    coat: '#8fb6d8',
    coatStyle: 'puffer',
    scarf: '#8a2f3a',
    lanyard: '#3a6fc0',
    badge: true,
    brows: 'tired',
    mouth: 'smile',
    lips: '#b86a66',
    shoulder: 24,
    drop: 7,
  },
  'liza:v2': {
    skin: '#dfbfae',
    hair: '#5a3a26',
    hairStyle: 'bun',
    coat: '#8fb6d8',
    coatStyle: 'puffer',
    scarf: '#8a2f3a',
    lanyard: '#3a6fc0',
    badge: true,
    brows: 'raised',
    mouth: 'open',
    frost: true,
    shoulder: 24,
    drop: 7,
  },
  'misha:v1': {
    skin: '#d39a82',
    hair: '#9a9590',
    hairStyle: 'short',
    hat: 'ushanka',
    hatColor: '#5a4030',
    coat: '#3e4536',
    coatStyle: 'coat',
    inner: '#e8ecf2',
    innerStripes: '#2b4a8a',
    stubble: 0.6,
    redNose: true,
    brows: 'tired',
    mouth: 'smile',
    wrinkles: true,
    shoulder: 28,
    gloves: '#2a2622',
    drop: 3,
  },
  'relief:v1': {
    skin: '#d6b29c',
    hair: '#2a221c',
    hairStyle: 'short',
    coat: P.vest,
    coatStyle: 'vest',
    inner: '#22252b',
    badge: true,
    brows: 'flat',
    mouth: 'neutral',
    shadowFace: true,
  },
  'gp:v1': {
    skin: '#dcb6a0',
    hair: '#b8a48a',
    hairStyle: 'bob',
    hat: 'headscarf',
    hatColor: '#6e2a34',
    coat: '#3b3242',
    coatStyle: 'coat',
    inner: '#8c7a6a',
    furCollar: '#5e5048',
    buttons: 'right',
    glasses: true,
    brows: 'stern',
    mouth: 'tight',
    wrinkles: true,
    gloves: '#3a2a26',
    shoulder: 25,
    drop: 5,
  },
};

/** Силуэт (для камер и далёких фигур). */
export function paintSilhouette(spec: CharSpec, light = '#2a3134'): HTMLCanvasElement {
  const src = paintCharacter(spec);
  const pc = new PixelCanvas(CHAR_W, CHAR_H);
  const d = src.getContext('2d')!.getImageData(0, 0, CHAR_W, CHAR_H).data;
  for (let i = 0; i < CHAR_W * CHAR_H; i++) {
    if (d[i * 4 + 3] === 0) continue;
    const l = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765;
    pc.px(i % CHAR_W, Math.floor(i / CHAR_W), mix('#040506', light, l));
  }
  return pc.commit();
}
