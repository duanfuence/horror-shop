/** Иконки товаров и предметов 16×16 — пиксельные карты (пробел или '.' — прозрачно). */
import { PixelCanvas, type Color } from './PixelCanvas';

interface Icon {
  rows: string[];
  pal: Record<string, Color>;
}

const K = '#121417';

export const ICONS: Record<string, Icon> = {
  can: {
    rows: [
      '     kkkkkk     ',
      '    kssllssk    ',
      '    kddddddk    ',
      '    kclcccck    ',
      '    kclccyck    ',
      '    kclcyyck    ',
      '    kclyycck    ',
      '    kclcyyck    ',
      '    kclyccck    ',
      '    kclcccck    ',
      '    kclcccck    ',
      '    kddddddk    ',
      '    kssssssk    ',
      '     kkkkkk     ',
    ],
    pal: { k: K, s: '#c9d2d8', l: '#7fb6ff', d: '#1b3f7a', c: '#2a68c9', y: '#f5d43a' },
  },
  gum: {
    rows: [
      '                ',
      '                ',
      '                ',
      '                ',
      '  kkkkkkkkkkkk  ',
      '  kggggggggggk  ',
      '  kgwwwwwwwwgk  ',
      '  kgwmmmmmmwdk  ',
      '  kgwwwwwwwwdk  ',
      '  kggggggggddk  ',
      '  kkkkkkkkkkkk  ',
    ],
    pal: { k: K, g: '#2fae6a', d: '#1d7346', w: '#eef7f1', m: '#5fd29a' },
  },
  coffee: {
    rows: [
      '                ',
      '                ',
      '   kkkkkkkkkk   ',
      '   kzlzlzlzlk   ',
      '   krrrrrrrrk   ',
      '   krbbbbbbrk   ',
      '   krbwwwwbrk   ',
      '   krbbbbbbrk   ',
      '   krrrrrrrrk   ',
      '   kzlzlzlzlk   ',
      '   kkkkkkkkkk   ',
    ],
    pal: { k: K, z: '#b23b2c', l: '#e0675a', r: '#c8402f', b: '#6b3a22', w: '#f1e3c6' },
  },
  cigs: {
    rows: [
      '                ',
      '    kkkkkkkk    ',
      '    kwwwwwwk    ',
      '    krrrrrrk    ',
      '    kwwwwwwk    ',
      '    kwwrrwwk    ',
      '    kwrwwrwk    ',
      '    kwwrrwwk    ',
      '    kwwwwwwk    ',
      '    kwwwwwgk    ',
      '    kddddddk    ',
      '    kkkkkkkk    ',
    ],
    pal: { k: K, w: '#f0efe9', r: '#c33a2e', d: '#a5a39b', g: '#bdbbb2' },
  },
  bread: {
    rows: [
      '                ',
      '                ',
      '                ',
      '    kkkkkkkk    ',
      '  kkbbbbbbbbkk  ',
      ' kbbllbbllbbllk ',
      ' kbbbllbbllbblk ',
      ' kbbbbbbbbbbbbk ',
      ' kddddddddddddk ',
      '  kkkkkkkkkkkk  ',
    ],
    pal: { k: K, b: '#6b3b22', l: '#9a6238', d: '#3f2213' },
  },
  bread_old: {
    rows: [
      '                ',
      '                ',
      '                ',
      '    kkkkkkkk    ',
      '  kkppppppppkk  ',
      ' kpppyyyyyyppqk ',
      ' kpppyrrrrypppk ',
      ' kpppyyyyyyppqk ',
      ' kqpppppppppqqk ',
      '  kkkkkkkkkkkk  ',
    ],
    pal: { k: K, p: '#cdbf98', q: '#a99a74', y: '#d8cc8a', r: '#8f5a4a' },
  },
  milk: {
    rows: [
      '      kkkk      ',
      '     kwwwwk     ',
      '    kwwwwwwk    ',
      '    kbbbbbbk    ',
      '    kwwwwwwk    ',
      '    kwbbbbwk    ',
      '    kwbwwbwk    ',
      '    kwbbbbwk    ',
      '    kwwwwwgk    ',
      '    kwwwwwgk    ',
      '    kggggggk    ',
      '    kkkkkkkk    ',
    ],
    pal: { k: K, w: '#f4f6f8', b: '#3a7bd5', g: '#b9c3cc' },
  },
  noodles: {
    rows: [
      '                ',
      '                ',
      '   kkkkkkkkkk   ',
      '   kssssssssk   ',
      '   kkkkkkkkkk   ',
      '    krrrrrrk    ',
      '    kryyyyrk    ',
      '    kryrryrk    ',
      '    krrrrrrk    ',
      '     krrrrk     ',
      '     kkkkkk     ',
    ],
    pal: { k: K, s: '#e9e4d6', r: '#d0442f', y: '#f2c94c' },
  },
  plaster: {
    rows: [
      '                ',
      '                ',
      '   kkkkkkkkkk   ',
      '   kwwwwwwwwk   ',
      '   kwwwrrwwwk   ',
      '   kwwrrrrwwk   ',
      '   kwwwrrwwwk   ',
      '   kwwwwwwwgk   ',
      '   kggggggggk   ',
      '   kkkkkkkkkk   ',
    ],
    pal: { k: K, w: '#f5f2ea', r: '#d23a32', g: '#bdb8ab' },
  },
  vodka: {
    rows: [
      '      kkk       ',
      '      krk       ',
      '      kgk       ',
      '      kgk       ',
      '     kgggk      ',
      '    kglgggk     ',
      '    kglgggk     ',
      '    kwwwwwk     ',
      '    kwrrrwk     ',
      '    kwwwwwk     ',
      '    kglgggk     ',
      '    kglgggk     ',
      '    kdddddk     ',
      '    kkkkkkk     ',
    ],
    pal: { k: K, r: '#b23028', g: '#cfe4ea', l: '#ffffff', w: '#efe7d2', d: '#8fb0ba' },
  },
  water: {
    rows: [
      '      kkk       ',
      '      kbk       ',
      '      kgk       ',
      '     kgggk      ',
      '    kglgggk     ',
      '    kglgggk     ',
      '    kbbbbbk     ',
      '    kbwwwbk     ',
      '    kbbbbbk     ',
      '    kglgggk     ',
      '    kglgggk     ',
      '    kdddddk     ',
      '    kkkkkkk     ',
    ],
    pal: { k: K, b: '#2f78c4', g: '#a9d6f2', l: '#ffffff', w: '#e8f4ff', d: '#6aa6cc' },
  },
  matches: {
    rows: [
      '                ',
      '                ',
      '                ',
      '   kkkkkkkkkk   ',
      '   kbbbbbbbbk   ',
      '   kbyyyyyybk   ',
      '   kbyrrrrybk   ',
      '   kbyyyyyybk   ',
      '   kbbbbbbbbk   ',
      '   kkkkkkkkkk   ',
    ],
    pal: { k: K, b: '#5a3a24', y: '#e6d6a8', r: '#c0392b' },
  },
  battery: {
    rows: [
      '                ',
      '                ',
      '                ',
      '                ',
      '  kkkkkkkkkkk   ',
      '  kooooobbbbkk  ',
      '  kollllbbbbsk  ',
      '  kooooobbbbkk  ',
      '  kkkkkkkkkkk   ',
    ],
    pal: { k: K, o: '#c47a2c', l: '#e8a457', b: '#1f2226', s: '#c9d2d8' },
  },
  dogfood: {
    rows: [
      '   kkkkkkkkkk   ',
      '   kbbbbbbbbk   ',
      '   kbbbbbbbbk   ',
      '   kbwwwwwwbk   ',
      '   kbwppwpwbk   ',
      '   kbwwppwwbk   ',
      '   kbwwwwwwbk   ',
      '   kbbbbbbbbk   ',
      '   kddddddddk   ',
      '   kkkkkkkkkk   ',
    ],
    pal: { k: K, b: '#b5793a', w: '#f1e3c6', p: '#4a2e1c', d: '#7a4f24' },
  },
  candle: {
    rows: [
      '        k       ',
      '       yk       ',
      '       kk       ',
      '      kwwk      ',
      '      kwlk      ',
      '      kwlk      ',
      '      kwlk      ',
      '      kwlk      ',
      '      kwlk      ',
      '      kwlk      ',
      '      kwgk      ',
      '      kggk      ',
      '      kkkk      ',
    ],
    pal: { k: K, w: '#f4f1e6', l: '#d9d4c3', g: '#b5af9c', y: '#f2c94c' },
  },
  receipt: {
    rows: [
      '    kkkkkkkk    ',
      '    kwwwwwwk    ',
      '    kwggggwk    ',
      '    kwwwwwwk    ',
      '    kwgggwwk    ',
      '    kwggggwk    ',
      '    kwwwwwwk    ',
      '    kwgggwwk    ',
      '    kwwwwwwk    ',
      '    kwkwkwkk    ',
      '     k k k      ',
    ],
    pal: { k: K, w: '#f2efe4', g: '#8f8b80' },
  },
  card: {
    rows: [
      '                ',
      '                ',
      '  kkkkkkkkkkkk  ',
      '  kyyyyyyyyyyk  ',
      '  kykkyyyyyyyk  ',
      '  kyyyyggggyyk  ',
      '  kyyyyyyyyyyk  ',
      '  kyggggggyyyk  ',
      '  kkkkkkkkkkkk  ',
    ],
    pal: { k: K, y: '#f2cf4a', g: '#5a4a1c' },
  },
  flashlight: {
    rows: [
      '                ',
      '                ',
      '                ',
      '   kkkk         ',
      '  kllllkkkkkkk  ',
      '  klyylmmmmmmk  ',
      '  kllllkkkkkkk  ',
      '   kkkk         ',
    ],
    pal: { k: K, l: '#9aa4a8', y: '#fff3b0', m: '#3c4246' },
  },
  keys: {
    rows: [
      '                ',
      '   kkk          ',
      '  kyyyk         ',
      '  ky ykkkkkkk   ',
      '  kyyyysssssk   ',
      '   kkkkkskksk   ',
      '        k  k    ',
    ],
    pal: { k: K, y: '#e6be4c', s: '#c9d2d8' },
  },
  order: {
    rows: [
      '   kkkkkkkkkk   ',
      '   kwwwwwwwwk   ',
      '   kwggggggwk   ',
      '   kwwwwwwwwk   ',
      '   kwgggggwwk   ',
      '   kwwwwwwwwk   ',
      '   kwggggwwwk   ',
      '   kwwwwwwwwk   ',
      '   kwrrrrrrwk   ',
      '   kwwwwwwwwk   ',
      '   kkkkkkkkkk   ',
    ],
    pal: { k: K, w: '#f2efe4', g: '#8f8b80', r: '#b5463c' },
  },
};

/** Нарисовать иконку в холсте 16×16, выровняв по нижнему краю. */
export function paintIcon(key: string): HTMLCanvasElement {
  const icon = ICONS[key] ?? ICONS.receipt;
  const pc = new PixelCanvas(16, 16);
  const offY = 16 - icon.rows.length;
  pc.map(0, offY, icon.rows, icon.pal);
  return pc.commit();
}

const urlCache = new Map<string, string>();

/** PNG data-URL иконки для HTML-интерфейса (касса, журнал). */
export function iconDataUrl(key: string): string {
  let url = urlCache.get(key);
  if (!url) {
    url = paintIcon(key).toDataURL('image/png');
    urlCache.set(key, url);
  }
  return url;
}
