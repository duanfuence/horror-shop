/**
 * Архив камер наблюдения — «кассета на час».
 *
 * Изображение камеры целиком задаётся списком визуальных ключей (что видно: продавец, покупатель,
 * открытая дверь, стадия аномалии…), по которому CctvScene строит кадр. Поэтому архив хранит
 * не картинки, а эти списки — и только в те минуты, когда на камере что-то изменилось.
 * Кадр на любую минуту — последний записанный до неё список.
 *
 * Память ограничена: глубина ARCHIVE_DEPTH игровых минут и не больше MAX_FRAMES кадров на камеру.
 * Просмотр архива ничего не меняет в мире, кроме отметки «игрок смотрел камеру N в минуту M»
 * (её проверяют неполные наблюдения, которые нужно сверить с другой камерой).
 */
import type { ArchiveFrame, ArchiveState, CamId, WorldState } from './types';

/** Сколько игровых минут хранит кассета. */
export const ARCHIVE_DEPTH = 60;
/** Не больше стольких кадров на камеру (страховка на случай очень «шумной» ночи). */
export const MAX_FRAMES = 90;
/** Сколько отметок просмотра помнить. */
const MAX_VIEWED = 40;

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Записать, что видно на камере в эту минуту. Одинаковые подряд кадры не дублируются. */
export function recordFrame(ar: ArchiveState, cam: CamId, minute: number, visuals: string[], refs: string[]): void {
  const track = (ar.tracks[String(cam)] ??= []);
  const last = track[track.length - 1];
  if (last && same(last[1], visuals) && same(last[2], refs)) return;
  const frame: ArchiveFrame = [minute, [...visuals], [...refs]];
  if (last && last[0] === minute) track[track.length - 1] = frame;
  else track.push(frame);
  prune(ar, minute);
}

/**
 * Убрать то, что старше глубины кассеты. Последний кадр перед окном сохраняется:
 * он описывает, что было видно в начале доступного промежутка.
 */
export function prune(ar: ArchiveState, now: number): void {
  const from = now - ARCHIVE_DEPTH;
  for (const key of Object.keys(ar.tracks)) {
    const track = ar.tracks[key];
    let cut = 0;
    while (cut + 1 < track.length && track[cut + 1][0] <= from) cut++;
    if (cut > 0) track.splice(0, cut);
    if (track.length > MAX_FRAMES) track.splice(0, track.length - MAX_FRAMES);
  }
}

/** Доступный промежуток архива [от, до] в минутах (до — прошлая минута), или null, если смотреть нечего. */
export function archiveRange(ar: ArchiveState, now: number): [number, number] | null {
  let first = Infinity;
  for (const track of Object.values(ar.tracks)) if (track.length) first = Math.min(first, track[0][0]);
  if (!Number.isFinite(first)) return null;
  const from = Math.max(ar.since, first, now - ARCHIVE_DEPTH);
  const to = now - 1;
  return to >= from ? [from, to] : null;
}

/** Кадр камеры на минуту: последний записанный не позже неё. */
export function frameAt(ar: ArchiveState, cam: CamId, minute: number): ArchiveFrame | null {
  const track = ar.tracks[String(cam)] ?? [];
  let found: ArchiveFrame | null = null;
  for (const f of track) {
    if (f[0] > minute) break;
    found = f;
  }
  return found;
}

/** Минуты, когда на камере что-то менялось (отметки на шкале архива). Не говорит, что именно. */
export function changeMarks(ar: ArchiveState, cam: CamId, range: [number, number]): number[] {
  return (ar.tracks[String(cam)] ?? []).map((f) => f[0]).filter((m) => m > range[0] && m <= range[1]);
}

export function markViewed(ar: ArchiveState, cam: CamId, minute: number): void {
  const key = `${cam}@${minute}`;
  if (ar.viewed[ar.viewed.length - 1] === key) return;
  ar.viewed = ar.viewed.filter((k) => k !== key);
  ar.viewed.push(key);
  if (ar.viewed.length > MAX_VIEWED) ar.viewed.splice(0, ar.viewed.length - MAX_VIEWED);
}

/** Смотрел ли игрок в архиве одну из камер cams в пределах ±within минут от minute. */
export function viewedNear(ar: ArchiveState, cams: CamId[], minute: number, within: number): boolean {
  return ar.viewed.some((k) => {
    const [c, m] = k.split('@').map(Number);
    return cams.includes(c as CamId) && Math.abs(m - minute) <= within;
  });
}

/** Общий размер архива в кадрах — для тестов и отладки. */
export function archiveSize(s: WorldState): number {
  return Object.values(s.archive.tracks).reduce((n, t) => n + t.length, 0);
}
