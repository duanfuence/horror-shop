/** Страница предпросмотра процедурной графики (только для разработки). */
import * as store from '../game/art/store';

const out = document.getElementById('out')!;
const params = new URLSearchParams(location.search);
const scaleK = Number(params.get('scale') ?? 3);

function show(title: string, c: HTMLCanvasElement, k = scaleK, bg?: string) {
  const wrap = document.createElement('div');
  wrap.textContent = title;
  const v = document.createElement('canvas');
  v.width = c.width * k;
  v.height = c.height * k;
  const ctx = v.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, v.width, v.height);
  }
  ctx.drawImage(c, 0, 0, v.width, v.height);
  wrap.appendChild(v);
  out.appendChild(wrap);
}

function composite(layers: HTMLCanvasElement[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = layers[0].width;
  c.height = layers[0].height;
  const ctx = c.getContext('2d')!;
  for (const l of layers) ctx.drawImage(l, 0, 0);
  return c;
}

const what = params.get('what') ?? 'store';
if (what === 'store') {
  const outside = store.paintStoreOutside();
  const base = store.paintStoreBase();
  const counter = store.paintCounter();
  show('composite', composite([outside, base, counter]));
}
if (what === 'layers') {
  show('outside', store.paintStoreOutside(), 2);
  show('base', store.paintStoreBase(), 2, '#f0f');
  show('counter', store.paintCounter(), 2, '#f0f');
  show('door open', store.paintDoorOpen(), 2, '#333');
  show('frost', store.paintFrost(), 2, '#333');
}
(window as unknown as { __ready: boolean }).__ready = true;

import { CHARACTER_SPECS, paintCharacter } from '../game/art/characters';
if (what === 'chars') {
  const row = document.createElement('div');
  row.className = 'row';
  out.appendChild(row);
  const prevOut = out;
  for (const [key, spec] of Object.entries(CHARACTER_SPECS)) {
    for (const frame of [{}, { blink: true }, { talk: true }]) {
      const c = paintCharacter(spec, frame, 3);
      const v = document.createElement('canvas');
      v.width = c.width * 3;
      v.height = c.height * 3;
      const ctx = v.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#56635c';
      ctx.fillRect(0, 0, v.width, v.height);
      ctx.drawImage(c, 0, 0, v.width, v.height);
      v.title = key;
      row.appendChild(v);
    }
  }
  void prevOut;
}

import * as cctv from '../game/art/cctv';
if (what === 'cctv') {
  const add = (title: string, base: HTMLCanvasElement, overlays: [HTMLCanvasElement, string, number?][] = []) => {
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    for (const [img, spotName, k = 1] of overlays) {
      const sp = cctv.SPOTS[spotName];
      if (!sp) continue;
      ctx.drawImage(img, sp.x - (img.width * k) / 2, sp.y - img.height * k, img.width * k, img.height * k);
    }
    show(title, c, 2);
  };
  const c1 = cctv.paintCam1();
  add('cam1', c1, [
    [cctv.paintStanding(40, { vest: true }), 'cam1_vest'],
    [cctv.paintStanding(70, { coat: true }), 'cam1_customer'],
  ]);
  add('cam2', cctv.paintCam2(), [[cctv.paintStanding(30, { coat: true }), 'cam2_grey']]);
  add('cam3', cctv.paintCam3(), [
    [cctv.paintTopDown('#2a221c', '#3e7d50'), 'cam3_clerk'],
    [cctv.paintTopDown('#a9adb0', '#6c7277'), 'cam3_customer'],
  ]);
  add('cam4', cctv.paintCam4(), [
    [cctv.paintStanding(40, { vest: true, face: 'blank' }), 'cam4_fig1'],
    [cctv.paintStanding(60, { vest: true, face: 'up' }), 'cam4_fig2'],
  ]);
  show('close face', cctv.paintCloseFace(), 2);
}
