/**
 * Воспроизводимая случайность без хранимого состояния.
 * Число зависит только от seed прохождения и набора ключей (минута, метка события и т. п.),
 * поэтому одинаковый seed при одинаковых действиях игрока даёт одинаковую ночь,
 * а восстановление из сохранения не требует сохранять состояние генератора.
 */

function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mix(a: number): number {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Число в [0, 1), определяемое seed и ключами. */
export function rand(seed: number, ...keys: (string | number)[]): number {
  let h = mix(seed >>> 0);
  for (const k of keys) h = mix(h ^ hashString(String(k)));
  return h / 4294967296;
}

/** Целое в [min, max] включительно. */
export function randInt(seed: number, min: number, max: number, ...keys: (string | number)[]): number {
  return min + Math.floor(rand(seed, ...keys) * (max - min + 1));
}

/** Новый seed для прохождения. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}

/** seed для старых сохранений, где его не было: стабильный, из данных самого прохождения. */
export function seedFrom(text: string): number {
  return (hashString(text) & 0x7fffffff) || 1;
}
