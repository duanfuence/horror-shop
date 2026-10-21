/**
 * Режиссёр тревоги: раз в игровую минуту решает, не случится ли в магазине
 * небольшое фоновое событие (стук, погасшая лампа, тень за витриной…).
 *
 * Правила:
 * - не вмешивается в сюжетные сцены (только тихие события во время продажи);
 * - уступает место сюжету: не срабатывает за пару минут до и после сюжетной сцены;
 * - после каждого события держит тишину, иногда — длинную;
 * - не повторяет одно событие и один «канал» подряд, соблюдает перезарядку и лимиты;
 * - чем ближе утро и выше угроза, тем чаще и тревожнее события;
 * - вся случайность выводится из seed прохождения и минуты — ночь воспроизводима.
 *
 * Режиссёр не меняет скрытые параметры игрока: фоновые события сами по себе
 * не ведут к плохой концовке.
 */
import { rand, randInt } from './random';
import { parseTime } from './state';
import type { AmbientConfig, AmbientEventDef, Step, WorldState } from './types';

export interface DirectorHost {
  state: WorldState;
  /** Идёт сюжетная сцена (диалог, звонок, касса). */
  busy: boolean;
  /** Игрок обслуживает покупателя (часы идут, но человек занят). */
  inSale: boolean;
  /** Через сколько минут ближайшая ещё не сработавшая сюжетная сцена (Infinity — нет). */
  minutesToNextScene(): number;
  /** Эффективная минута сюжетного события по id (с учётом сдвига), undefined — нет такого. */
  beatMinute(id: string): number | undefined;
  /** Исполнить шаги события неблокирующе (звук, эффект, наблюдение). */
  run(steps: Step[]): void;
  toast(text: string): void;
  announce(id: string, minutes: number): void;
}

interface Prepared extends AmbientEventDef {
  fromMin: number;
  toMin: number;
}

export class TensionDirector {
  private events: Prepared[];

  constructor(private config: AmbientConfig) {
    this.events = config.events.map((e) => ({
      ...e,
      fromMin: e.from ? parseTime(e.from) : 0,
      toMin: e.to ? parseTime(e.to) : 24 * 60,
    }));
  }

  get pool(): readonly AmbientEventDef[] {
    return this.events;
  }

  /**
   * Вызывается раз в игровую минуту (только когда часы идут — то есть не на паузе и не после концовки).
   * Возвращает id сработавшего события или null.
   */
  onMinute(host: DirectorHost): string | null {
    const s = host.state;
    const a = s.ambient;
    const m = s.minutes;
    if (m < 8) return null;
    // Сюжетная сцена идёт — не мешать. Во время продажи — только тихие события.
    if (host.busy && !host.inSale) return null;
    if (m < a.quietUntil) return null;
    // Уступить место сюжету: не перед самой сценой и не сразу после неё.
    const margin = this.config.sceneMargin;
    if (host.minutesToNextScene() <= margin) return null;
    if (a.lastScene > 0 && m - a.lastScene < margin) return null;

    const sinceAny = m - Math.max(a.lastAt, a.lastScene);
    const forced = sinceAny >= this.config.maxQuiet;
    if (!forced && rand(s.seed, 'roll', m) >= this.config.rate(s)) return null;

    const picked = this.pick(host, forced);
    if (!picked) return null;
    this.fire(host, picked);
    return picked.id;
  }

  /** События, которые можно запустить прямо сейчас (для тестов и отладки). */
  eligible(host: DirectorHost, forced = false): Prepared[] {
    const s = host.state;
    const a = s.ambient;
    const m = s.minutes;
    const blackout = !!s.flags.blackout;
    const lastId = a.log.length ? a.log[a.log.length - 1][0] : null;
    const prevId = a.log.length > 1 ? a.log[a.log.length - 2][0] : null;
    const lastChannel = lastId ? this.events.find((e) => e.id === lastId)?.channel : null;
    return this.events.filter((e) => {
      if (m < e.fromMin || m > e.toMin) return false;
      if (blackout ? !e.dark : false) return false;
      if (host.inSale && !e.duringSale) return false;
      if (forced && e.intensity === 3) return false;
      if (e.id === lastId || e.id === prevId) return false;
      if (e.channel === lastChannel) return false;
      const last = a.last[e.id];
      if (last !== undefined && m - last < e.cooldown) return false;
      if (e.max !== undefined && (a.count[e.id] ?? 0) >= e.max) return false;
      if (e.avoid) {
        for (const id of e.avoid.beats) {
          const at = host.beatMinute(id);
          if (at !== undefined && Math.abs(at - m) <= e.avoid.radius) return false;
        }
      }
      if (e.when && !e.when(s)) return false;
      return true;
    });
  }

  private pick(host: DirectorHost, forced: boolean): Prepared | null {
    const s = host.state;
    const list = this.eligible(host, forced);
    if (!list.length) return null;
    // Чем выше угроза ночи, тем больше вес тревожных событий.
    const dread = Math.max(0, Math.min(10, this.dread(s)));
    const weightOf = (e: Prepared) =>
      e.weight * (e.intensity === 1 ? 1.15 - dread * 0.05 : e.intensity === 2 ? 0.55 + dread * 0.09 : dread * 0.1);
    const weights = list.map(weightOf);
    const total = weights.reduce((x, y) => x + y, 0);
    if (total <= 0) return null;
    let r = rand(s.seed, 'pick', s.minutes) * total;
    for (let i = 0; i < list.length; i++) {
      r -= weights[i];
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  /** Угроза ночи берётся из данных смены, если там она описана. */
  dread: (s: WorldState) => number = (s) => s.minutes / 60 + s.stats.attention;

  private fire(host: DirectorHost, e: Prepared): void {
    const s = host.state;
    const a = s.ambient;
    const m = s.minutes;
    a.last[e.id] = m;
    a.count[e.id] = (a.count[e.id] ?? 0) + 1;
    a.log.push([e.id, m]);
    if (a.log.length > 80) a.log.splice(0, a.log.length - 80);
    a.lastAt = m;
    // Тишина после события; иногда — длинная пауза, чтобы ночь «дышала».
    const cfg = this.config;
    const long = rand(s.seed, 'lull', m) < cfg.lull.chance;
    const [g0, g1] = long ? cfg.lull.gap : cfg.gap;
    a.quietUntil = m + randInt(s.seed, g0, g1, 'gap', m) + (e.intensity - 1);

    e.onFire?.(s, (key) => rand(s.seed, 'fire', e.id, m, key));
    host.run(e.steps);
    if (e.texts?.length && rand(s.seed, 'text?', e.id, m) < (e.textChance ?? 0)) {
      host.toast(e.texts[Math.floor(rand(s.seed, 'text', e.id, m) * e.texts.length)]);
    }
    host.announce(e.id, m);
  }
}
