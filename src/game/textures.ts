import Phaser from 'phaser';
import * as cctv from './art/cctv';
import { CHARACTER_SPECS, paintCharacter } from './art/characters';
import { ICONS, paintIcon } from './art/items';
import * as store from './art/store';

/** Все процедурные текстуры создаются один раз при загрузке. */
export function registerTextures(scene: Phaser.Scene): void {
  const tex = scene.textures;
  const add = (key: string, canvas: HTMLCanvasElement) => {
    if (tex.exists(key)) tex.remove(key);
    tex.addCanvas(key, canvas);
  };

  add('store_outside', store.paintStoreOutside());
  add('store_base', store.paintStoreBase());
  add('store_counter', store.paintCounter());
  add('door_open', store.paintDoorOpen());
  add('vignette', store.paintVignette());
  add('frost', store.paintFrost());
  add('noise', store.paintNoise(128));
  add('light_big', store.paintSoftLight(40, 0.3));
  add('light_small', store.paintSoftLight(12, 0.2));

  let seed = 1;
  for (const [key, spec] of Object.entries(CHARACTER_SPECS)) {
    seed++;
    add(`char:${key}:base`, paintCharacter(spec, {}, seed));
    add(`char:${key}:blink`, paintCharacter(spec, { blink: true }, seed));
    add(`char:${key}:talk`, paintCharacter(spec, { talk: true }, seed));
  }

  for (const key of Object.keys(ICONS)) add(`icon:${key}`, paintIcon(key));

  // камеры
  const cams = [cctv.paintCam1(), cctv.paintCam2(), cctv.paintCam3(), cctv.paintCam4()];
  cams.forEach((c, i) => {
    add(`cam${i + 1}`, c);
    add(`cam${i + 1}_s`, downscale(c, 43, 31));
  });
  add('cam4_door', cctv.paintCam4DoorOpen());
  add('fig_vest', cctv.paintStanding(64, { vest: true, face: 'away' }));
  add('fig_vest_front', cctv.paintStanding(64, { vest: true, face: 'blank' }));
  add('fig_coat', cctv.paintStanding(64, { coat: true }));
  add('fig_jacket', cctv.paintStanding(64, {}));
  add('fig_storage', cctv.paintStanding(64, { vest: true, face: 'up' }));
  add('fig_wave', cctv.paintStanding(64, { vest: true, face: 'up', wave: true }));
  add('close_face', cctv.paintCloseFace());
  add('taxi', cctv.paintTaxi());
  add('top_clerk', cctv.paintTopDown('#2a221c', '#3e7d50'));
  const topColors: Record<string, [string, string]> = {
    courier: ['#2e3640', '#d8b432'],
    rustam: ['#30343a', '#4a3326'],
    grey: ['#a9adb0', '#6c7277'],
    liza: ['#5a3a26', '#8fb6d8'],
    misha: ['#5a4030', '#3e4536'],
    gp: ['#6e2a34', '#3b3242'],
    relief: ['#2a221c', '#3e7d50'],
  };
  for (const [id, [hair, coat]] of Object.entries(topColors)) add(`top_${id}`, cctv.paintTopDown(hair, coat));
  add('fig_dark', darkFigure());
}

function downscale(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

/** Тёмный силуэт в полный рост — сменщик, ждущий между стеллажами в темноте. */
function darkFigure(): HTMLCanvasElement {
  const fig = cctv.paintStanding(48, { vest: true, face: 'blank' });
  const c = document.createElement('canvas');
  c.width = fig.width;
  c.height = fig.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(fig, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    if (d.data[i + 3] === 0) continue;
    const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3 / 255;
    d.data[i] = 20 + l * 30;
    d.data[i + 1] = 26 + l * 60;
    d.data[i + 2] = 24 + l * 40;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

export function charKey(id: string, variant: string, frame: 'base' | 'blink' | 'talk'): string {
  return `char:${id}:${variant}:${frame}`;
}
