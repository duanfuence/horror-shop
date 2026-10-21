/**
 * Угроза ночи и температура холодильника.
 *
 * Отдельного «счётчика угрозы» нет: угроза выводится из того, что уже есть в мире, —
 * времени, «внимания той стороны» и ключевых сюжетных событий, которые случаются
 * с любым игроком. Поэтому осторожный игрок тоже доживает до минуса к утру,
 * а рискованный попадает в холод раньше.
 */
import { rand } from '../../core/random';
import type { WorldState } from '../../core/types';

/** Сюжетные события, после которых холоднее у всех, независимо от выборов игрока. */
const STORY_COLD: [beat: string, weight: number][] = [
  ['h3', 0.3], // 03:00 — щелчок реле в подсобке
  ['delivery', 0.4], // 03:40 — стук в служебную дверь
  ['grey3', 0.3], // 04:36 — третий визит
];

export function storyCold(s: WorldState): number {
  let v = 0;
  for (const [beat, w] of STORY_COLD) if (s.fired.includes(beat)) v += w;
  return v;
}

/** Уровень угрозы ночи: 0 в полночь, к утру — 5–6 у осторожного игрока, больше — у рискованного. */
export function dread(s: WorldState): number {
  return s.minutes / 60 + s.stats.attention + storyCold(s);
}

/** Как холодает со временем: почти незаметно до двух, заметно после трёх, к пяти — около нуля. */
function timeCurve(minutes: number): number {
  const h = Math.min(6, minutes / 60);
  return 4.6 - 0.3 * h - 0.15 * h * h;
}

/**
 * Небольшое колебание показаний по получасам, своё у каждого прохождения:
 * минус нельзя предсказать по часам с точностью до минуты.
 */
function wobble(s: WorldState): number {
  const slot = Math.floor(s.minutes / 30);
  return (rand(s.seed, 'temp', slot) - 0.5) * 1.4;
}

/** Температура в холодильнике № 2. */
export function temperature(s: WorldState): number {
  if (s.flags.blackout) return -9 - Math.floor(s.stats.attention);
  const dip = s.ambient.dip && s.minutes <= s.ambient.dip.until ? s.ambient.dip.value : 0;
  const t = timeCurve(s.minutes) - s.stats.attention * 0.8 - storyCold(s) + wobble(s) - dip;
  // Пока не стемнело, до мороза старого журнала не доходит.
  return Math.max(-8, Math.round(t));
}

export const cold = (s: WorldState): boolean => temperature(s) < 0;
