/**
 * Аномалии на камерах наблюдения.
 *
 * Когда появляться новой аномалии, решает режиссёр тревоги (TensionDirector) — тем же seed,
 * с теми же отступами от сюжетных сцен. Здесь — всё остальное: на какой камере, как она
 * развивается по стадиям, чем кончается, если её пропустить, и что происходит, когда игрок
 * её фиксирует.
 *
 * Правила:
 * - не больше config.maxActive аномалий одновременно и не больше одной на камере;
 * - аномалия появляется и меняет стадию только на той камере, которую игрок сейчас не смотрит —
 *   изменения видны «между наблюдениями»;
 * - ошибочная фиксация ничего не ломает: журнал просто занят несколько минут;
 * - скрытые параметры меняют только явно описанные последствия (шаги в данных аномалии).
 */
import { rand, randInt } from './random';
import { parseTime, resolveText } from './state';
import type { ActiveAnomaly, AnomalyCategory, AnomalyConfig, AnomalyDef, CamId, ObservationEntry, Step, WorldState } from './types';

export interface AnomalyHost {
  state: WorldState;
  busy: boolean;
  inSale: boolean;
  minutesToNextScene(): number;
  /** Какую камеру игрок смотрит прямо сейчас (null — камеры закрыты). */
  viewingCam(): CamId | null;
  /** Показывает ли камера изображение (камеру 4 можно выключить). */
  camAvailable(cam: CamId): boolean;
  run(steps: Step[]): void;
}

export interface ReportResult {
  result: 'correct' | 'mundane' | 'false' | 'busy' | 'duplicate';
  text: string;
}

interface Prepared extends AnomalyDef {
  fromMin: number;
  toMin: number;
  untilMin: number;
}

export const CATEGORY_LABELS: Record<AnomalyCategory, string> = {
  person: 'Кто-то в кадре',
  object: 'Предмет не на месте',
  door: 'Открыто то, что закрыто',
  image: 'Запись врёт: время, отражение',
};

export class AnomalySystem {
  private defs: Prepared[];
  private byId = new Map<string, Prepared>();
  private firstAt: number;
  private lastAt: number;

  constructor(readonly config: AnomalyConfig) {
    this.defs = config.defs.map((d) => ({
      ...d,
      fromMin: d.from ? parseTime(d.from) : 0,
      toMin: d.to ? parseTime(d.to) : 24 * 60,
      untilMin: d.until ? parseTime(d.until) : Infinity,
    }));
    for (const d of this.defs) this.byId.set(d.id, d);
    this.firstAt = parseTime(config.firstAt);
    this.lastAt = parseTime(config.lastAt);
  }

  def(id: string): AnomalyDef | undefined {
    return this.byId.get(id);
  }

  get pool(): readonly AnomalyDef[] {
    return this.defs;
  }

  // ───────────── время ─────────────

  /** Раз в игровую минуту: стадии и окончание активных аномалий. */
  update(host: AnomalyHost): void {
    const s = host.state;
    const st = s.anomalies;
    const m = s.minutes;
    const viewing = host.viewingCam();
    for (const a of [...st.active]) {
      const d = this.byId.get(a.id);
      if (!d) {
        this.remove(s, a, 'vanished');
        continue;
      }
      // В темноте камеры показывают только темноту: всё, что было, растворяется.
      if (s.flags.blackout) {
        this.remove(s, a, 'vanished');
        continue;
      }
      const end = Math.min(a.at + d.duration, d.untilMin);
      if (m >= end) {
        this.remove(s, a, 'missed');
        if (d.miss?.trace?.length && !st.traces.some(([id]) => id === d.id)) st.traces.push([d.id, a.cam]);
        if (d.miss?.steps) host.run(d.miss.steps);
        continue;
      }
      // Новая стадия наступает, только пока игрок не смотрит на эту камеру.
      if (viewing === a.cam) continue;
      let next = a.stage;
      while (next + 1 < d.stages.length && d.stages[next + 1].at <= m - a.at) next++;
      if (next !== a.stage) {
        a.stage = next;
        const steps = d.stages[next].steps;
        if (steps && (!host.busy || host.inSale)) host.run(steps);
      }
    }
  }

  /**
   * Попробовать запустить новую аномалию в эту минуту. Вызывает режиссёр тревоги,
   * когда фоновое событие в эту минуту не случилось.
   */
  trySpawn(host: AnomalyHost, sceneMargin: number, dread: (s: WorldState) => number): string | null {
    const s = host.state;
    const st = s.anomalies;
    const m = s.minutes;
    if (m < this.firstAt || m > this.lastAt || s.flags.blackout) return null;
    if (host.busy && !host.inSale) return null;
    if (m < st.quietUntil) return null;
    if (st.active.length >= this.config.maxActive) return null;
    if (host.minutesToNextScene() <= sceneMargin) return null;
    if (s.ambient.lastScene > 0 && m - s.ambient.lastScene < sceneMargin) return null;
    if (rand(s.seed, 'anom', m) >= this.config.rate(s)) return null;

    const options = this.candidates(host);
    if (!options.length) return null;
    const threat = Math.max(0, Math.min(10, dread(s)));
    const weightOf = (d: Prepared) => d.weight * (d.danger === 3 ? 0.15 + threat * 0.08 : d.danger === 0 ? 1.2 - threat * 0.08 : 1);
    const weights = options.map(([d]) => Math.max(0, weightOf(d)));
    const total = weights.reduce((x, y) => x + y, 0);
    if (total <= 0) return null;
    let r = rand(s.seed, 'anom-pick', m) * total;
    let idx = options.length - 1;
    for (let i = 0; i < options.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    const [d, cams] = options[idx];
    const cam = cams[Math.floor(rand(s.seed, 'anom-cam', d.id, m) * cams.length)];
    st.active.push({ id: d.id, cam, at: m, stage: 0, seen: false });
    st.last[d.id] = m;
    st.count[d.id] = (st.count[d.id] ?? 0) + 1;
    st.spawned.push([d.id, cam, m]);
    const [g0, g1] = this.config.gap;
    st.quietUntil = m + randInt(s.seed, g0, g1, 'anom-gap', m);
    const steps = d.stages[0].steps;
    if (steps) host.run(steps);
    return d.id;
  }

  /** Аномалии, которые можно запустить сейчас, с камерами, где это возможно. */
  candidates(host: AnomalyHost): [Prepared, CamId[]][] {
    const s = host.state;
    const st = s.anomalies;
    const m = s.minutes;
    const viewing = host.viewingCam();
    const busyCams = new Set(st.active.map((a) => a.cam));
    const out: [Prepared, CamId[]][] = [];
    for (const d of this.defs) {
      if (m < d.fromMin || m > d.toMin || m >= d.untilMin) continue;
      if (st.active.some((a) => a.id === d.id)) continue;
      if (st.traces.some(([id]) => id === d.id)) continue;
      const last = st.last[d.id];
      if (last !== undefined && m - last < d.cooldown) continue;
      if (d.max !== undefined && (st.count[d.id] ?? 0) >= d.max) continue;
      const cams = d.cams.filter(
        (c) => !busyCams.has(c) && c !== viewing && host.camAvailable(c) && (!d.when || d.when(s, c)),
      );
      if (cams.length) out.push([d, cams]);
    }
    return out;
  }

  // ───────────── что видно ─────────────

  /** Визуальные ключи аномалий и следов на камере. */
  visuals(s: WorldState, cam: CamId): string[] {
    const out: string[] = [];
    for (const a of s.anomalies.active) {
      if (a.cam !== cam) continue;
      const d = this.byId.get(a.id);
      if (d) out.push(...d.stages[Math.min(a.stage, d.stages.length - 1)].visuals);
    }
    for (const [id, c] of s.anomalies.traces) {
      if (c !== cam) continue;
      out.push(...(this.byId.get(id)?.miss?.trace ?? []));
    }
    return out;
  }

  /** Подмена времени в углу экрана камеры (если она есть). */
  osd(s: WorldState, cam: CamId): string | null {
    const v = this.visuals(s, cam).find((x) => x.startsWith('osd:'));
    return v ? v.slice(4) : null;
  }

  /** Игрок посмотрел на камеру: отметить увиденное, убрать исчезающие при переключении. */
  onView(s: WorldState, cam: CamId): void {
    for (const a of [...s.anomalies.active]) {
      if (a.cam === cam) a.seen = true;
      else if (a.seen && this.byId.get(a.id)?.vanishOnSwitch) this.remove(s, a, 'vanished');
    }
  }

  // ───────────── фиксация ─────────────

  /**
   * Игрок фиксирует наблюдение: камера и что, по его мнению, не так.
   * sceneVisuals — что ещё сейчас видно на этой камере (сюжетные аномалии, покупатели).
   */
  report(host: AnomalyHost, cam: CamId, category: AnomalyCategory, sceneVisuals: string[]): ReportResult {
    const s = host.state;
    const st = s.anomalies;
    const m = s.minutes;
    const cfg = this.config;
    if (m < st.reportUntil) return { result: 'busy', text: 'Журнал наблюдений: предыдущая запись ещё не дописана.' };
    const available = host.camAvailable(cam);
    const log = (entry: Omit<ObservationEntry, 'm' | 'cam' | 'category'>) => st.log.push({ m, cam, category, ...entry });

    if (available) {
      // 1. Активная аномалия на этой камере.
      const a = st.active.find((x) => x.cam === cam && this.byId.get(x.id)!.danger > 0);
      const d = a && this.byId.get(a.id)!;
      if (a && d && d.categories.includes(category)) {
        this.remove(s, a, 'reported');
        const text = resolveText(d.report.text, s);
        log({ result: 'correct', ref: d.id, text });
        st.reportUntil = m + cfg.reportCooldown.correct;
        if (d.report.steps) host.run(d.report.steps);
        return { result: 'correct', text };
      }
      // 2. След пропущенной аномалии — записать можно и с опозданием.
      for (const [id, c] of st.traces) {
        const td = this.byId.get(id);
        if (c !== cam || !td || !td.categories.includes(category)) continue;
        const ref = `trace:${id}`;
        if (st.log.some((e) => e.ref === ref)) return { result: 'duplicate', text: 'Это уже записано в журнал.' };
        const text = `С опозданием: ${resolveText(td.report.text, s)}`;
        log({ result: 'correct', ref, text });
        st.reportUntil = m + cfg.reportCooldown.correct;
        return { result: 'correct', text };
      }
      // 3. Сюжетные странности на камере.
      for (const v of sceneVisuals) {
        const r = this.reportable(v);
        if (!r || r.kind !== 'strange' || !r.categories.includes(category)) continue;
        if (st.log.some((e) => e.ref === v)) return { result: 'duplicate', text: 'Это уже записано в журнал.' };
        const text = resolveText(r.text, s);
        log({ result: 'correct', ref: v, text });
        st.reportUntil = m + cfg.reportCooldown.correct;
        return { result: 'correct', text };
      }
      // 4. Обычные вещи, которые легко принять за странность.
      const mundane = st.active.find((x) => x.cam === cam && this.byId.get(x.id)!.danger === 0 && this.byId.get(x.id)!.categories.includes(category));
      if (mundane) {
        const text = resolveText(this.byId.get(mundane.id)!.report.text, s);
        log({ result: 'mundane', ref: mundane.id, text });
        st.reportUntil = m + cfg.reportCooldown.wrong;
        return { result: 'mundane', text };
      }
      for (const v of sceneVisuals) {
        const r = this.reportable(v);
        if (!r || r.kind !== 'mundane' || !r.categories.includes(category)) continue;
        const text = resolveText(r.text, s);
        log({ result: 'mundane', ref: v, text });
        st.reportUntil = m + cfg.reportCooldown.wrong;
        return { result: 'mundane', text };
      }
    }
    // 5. Ничего такого. Ответ не подсказывает, есть ли на камере что-то другое.
    const texts = cfg.falseTexts;
    const text = texts[Math.floor(rand(s.seed, 'false', m, cam, category) * texts.length)];
    log({ result: 'false', ref: null, text });
    st.reportUntil = m + cfg.reportCooldown.wrong;
    return { result: 'false', text };
  }

  /** Описание видимого на камере ключа; 'customer:grey' находит запись 'customer:*'. */
  private reportable(v: string) {
    return this.config.reportables[v] ?? (v.includes(':') ? this.config.reportables[`${v.split(':')[0]}:*`] : undefined);
  }

  private remove(s: WorldState, a: ActiveAnomaly, outcome: 'reported' | 'missed' | 'vanished'): void {
    const st = s.anomalies;
    st.active = st.active.filter((x) => x !== a);
    st.outcomes.push([a.id, outcome, s.minutes]);
  }
}
