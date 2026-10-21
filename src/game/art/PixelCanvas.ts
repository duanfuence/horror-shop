/**
 * Попиксельное рисование в памяти. Вся графика игры генерируется кодом при запуске:
 * это временные ассеты, которые позже можно заменить нарисованными художником,
 * сохранив ключи текстур.
 */

export type RGB = [number, number, number];
export type Color = string | RGB;

const cache = new Map<string, RGB>();

export function rgb(c: Color): RGB {
  if (typeof c !== 'string') return c;
  let v = cache.get(c);
  if (!v) {
    const h = c.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    cache.set(c, v);
  }
  return v;
}

export function mix(a: Color, b: Color, t: number): RGB {
  const x = rgb(a);
  const y = rgb(b);
  return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
}

export function scale(c: Color, k: number): RGB {
  const x = rgb(c);
  return [x[0] * k, x[1] * k, x[2] * k];
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Порог упорядоченного дизеринга 0..1 для пикселя. */
export function bayer(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

/** Детерминированный генератор случайных чисел — графика одинакова при каждом запуске. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PixelCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly data: Uint8ClampedArray;
  private img: ImageData;
  private ctx: CanvasRenderingContext2D;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D недоступен');
    this.ctx = ctx;
    this.img = ctx.createImageData(w, h);
    this.data = this.img.data;
  }

  /** Записать пиксели в canvas. Вызывать после рисования. */
  commit(): HTMLCanvasElement {
    this.ctx.putImageData(this.img, 0, 0);
    return this.canvas;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): [number, number, number, number] {
    if (!this.inside(x, y)) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /** Поставить пиксель; alpha < 1 — смешать с тем, что уже нарисовано. */
  px(x: number, y: number, c: Color, alpha = 1): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inside(x, y)) return;
    const [r, g, b] = rgb(c);
    const i = (y * this.w + x) * 4;
    const d = this.data;
    if (alpha >= 1 || d[i + 3] === 0) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = alpha >= 1 ? 255 : Math.max(d[i + 3], alpha * 255);
      return;
    }
    d[i] = d[i] + (r - d[i]) * alpha;
    d[i + 1] = d[i + 1] + (g - d[i + 1]) * alpha;
    d[i + 2] = d[i + 2] + (b - d[i + 2]) * alpha;
  }

  clear(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.data[i + 3] = 0;
  }

  rect(x: number, y: number, w: number, h: number, c: Color, alpha = 1): void {
    for (let j = Math.max(0, Math.floor(y)); j < Math.min(this.h, Math.floor(y + h)); j++)
      for (let i = Math.max(0, Math.floor(x)); i < Math.min(this.w, Math.floor(x + w)); i++) this.px(i, j, c, alpha);
  }

  /** Прямоугольник, залитый двумя цветами с дизерингом (t — доля второго цвета). */
  dither(x: number, y: number, w: number, h: number, a: Color, b: Color, t: number): void {
    for (let j = Math.floor(y); j < y + h; j++)
      for (let i = Math.floor(x); i < x + w; i++) this.px(i, j, bayer(i, j) < t ? b : a);
  }

  /** Вертикальный градиент с дизерингом между ступенями. */
  gradV(x: number, y: number, w: number, h: number, top: Color, bottom: Color, steps = 6): void {
    for (let j = 0; j < h; j++) {
      const t = h <= 1 ? 0 : j / (h - 1);
      const k = t * steps;
      const lo = Math.floor(k);
      const frac = k - lo;
      for (let i = 0; i < w; i++) {
        const level = bayer(x + i, y + j) < frac ? lo + 1 : lo;
        this.px(x + i, y + j, mix(top, bottom, Math.min(1, level / steps)));
      }
    }
  }

  hline(x0: number, x1: number, y: number, c: Color, alpha = 1): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.px(x, y, c, alpha);
  }

  vline(x: number, y0: number, y1: number, c: Color, alpha = 1): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.px(x, y, c, alpha);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Color, alpha = 1): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c, alpha);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Заливка многоугольника (scanline, even-odd). fill(x,y) позволяет делать градиенты/текстуры. */
  poly(points: [number, number][], fill: Color | ((x: number, y: number) => Color | null), alpha = 1): void {
    const ys = points.map((p) => p[1]);
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = minY; y <= maxY; y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        if ((y0 <= cy && y1 > cy) || (y1 <= cy && y0 > cy)) xs.push(x0 + ((cy - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.round(xs[k]));
        const xb = Math.min(this.w - 1, Math.round(xs[k + 1]) - 1);
        for (let x = xa; x <= xb; x++) {
          const c = typeof fill === 'function' ? fill(x, y) : fill;
          if (c !== null) this.px(x, y, c, alpha);
        }
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color | ((x: number, y: number) => Color | null), alpha = 1): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          const col = typeof c === 'function' ? c(x, y) : c;
          if (col !== null) this.px(x, y, col, alpha);
        }
      }
  }

  /** Умножить яркость области (для теней). */
  darken(x: number, y: number, w: number, h: number, k: number): void {
    for (let j = Math.floor(y); j < y + h; j++)
      for (let i = Math.floor(x); i < x + w; i++) {
        if (!this.inside(i, j)) continue;
        const idx = (j * this.w + i) * 4;
        this.data[idx] *= k;
        this.data[idx + 1] *= k;
        this.data[idx + 2] *= k;
      }
  }

  /** Обвести непрозрачную фигуру контуром (для читаемости спрайтов). */
  outline(c: Color): void {
    const mask = new Uint8Array(this.w * this.h);
    for (let i = 0; i < this.w * this.h; i++) mask[i] = this.data[i * 4 + 3] > 0 ? 1 : 0;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (mask[y * this.w + x]) continue;
        const n =
          (x > 0 && mask[y * this.w + x - 1]) ||
          (x < this.w - 1 && mask[y * this.w + x + 1]) ||
          (y > 0 && mask[(y - 1) * this.w + x]) ||
          (y < this.h - 1 && mask[(y + 1) * this.w + x]);
        if (n) this.px(x, y, c);
      }
  }

  /** Нарисовать пиксельную карту: строки символов, где символ → цвет палитры ('.' — прозрачно). */
  map(x: number, y: number, rows: string[], palette: Record<string, Color>, flipX = false): void {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[flipX ? row.length - 1 - i : i];
        if (ch === '.' || ch === ' ') continue;
        const col = palette[ch];
        if (col) this.px(x + i, y + j, col);
      }
    });
  }

  /** Перевести всё в оттенки серого с тонировкой (для камер наблюдения). */
  monochrome(tint: Color, contrast = 1.1, gamma = 1): void {
    const t = rgb(tint);
    for (let i = 0; i < this.w * this.h; i++) {
      const k = i * 4;
      if (this.data[k + 3] === 0) continue;
      let l = (0.3 * this.data[k] + 0.59 * this.data[k + 1] + 0.11 * this.data[k + 2]) / 255;
      l = Math.pow(Math.min(1, Math.max(0, (l - 0.5) * contrast + 0.5)), gamma);
      this.data[k] = t[0] * l;
      this.data[k + 1] = t[1] * l;
      this.data[k + 2] = t[2] * l;
    }
  }
}
