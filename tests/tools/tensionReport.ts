/**
 * Отчёт по режиссёру тревоги: распределение концовок, частота фоновых событий,
 * паузы, первый минус. Используется тестами (tests/tension.test.ts) и скриптом отчёта.
 */
import { shift1 } from '../../src/content/shift1';
import { cautiousPolicy, randomPolicy, riskyPolicy, rulesPolicy, simulate, watcherPolicy, type Policy, type SimResult } from '../sim';

export interface RunStats {
  ending: string | null;
  events: number;
  /** Событий в каждом часе 0..5. */
  perHour: number[];
  /** Наибольшая пауза в игровых минутах без фоновых событий и сюжетных сцен (00:10–05:00). */
  maxGapAny: number;
  /** Наибольшая пауза без фоновых событий (00:10–05:00). */
  maxGapAmbient: number;
  firstNegative: number | null;
  attention: number;
  ids: string[];
  log: [string, number][];
  sameInRow: number;
  errors: number;
}

export function runStats(r: SimResult): RunStats {
  const log = r.state.ambient.log;
  const perHour = [0, 0, 0, 0, 0, 0];
  for (const [, m] of log) perHour[Math.min(5, Math.floor(m / 60))]++;
  const until = 300;
  const marks = (xs: number[]) => {
    const pts = [10, ...xs.filter((m) => m > 10 && m < until), until].sort((a, b) => a - b);
    let g = 0;
    for (let i = 1; i < pts.length; i++) g = Math.max(g, pts[i] - pts[i - 1]);
    return g;
  };
  const amb = log.map(([, m]) => m);
  const scenes = r.sceneLog.map(([, m]) => m);
  let firstNegative: number | null = null;
  for (let m = 0; m < r.temps.length; m++) {
    if (r.temps[m] !== undefined && r.temps[m] < 0) {
      firstNegative = m;
      break;
    }
  }
  let sameInRow = 0;
  for (let i = 1; i < log.length; i++) if (log[i][0] === log[i - 1][0]) sameInRow++;
  return {
    ending: r.ending,
    events: log.length,
    perHour,
    maxGapAny: marks([...amb, ...scenes]),
    maxGapAmbient: marks(amb),
    firstNegative,
    attention: r.state.stats.attention,
    ids: log.map(([id]) => id),
    log,
    sameInRow,
    errors: r.errors.length,
  };
}

export const POLICIES: Record<string, () => Policy> = {
  rules: () => rulesPolicy(),
  cautious: () => cautiousPolicy(),
  watcher: () => watcherPolicy(),
  risky: () => riskyPolicy(),
  random: () => randomPolicy,
};

export async function batch(policy: string, runs: number, base = 1000): Promise<RunStats[]> {
  const out: RunStats[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = base + i * 7919;
    out.push(runStats(await simulate(shift1, POLICIES[policy](), seed, 20000, seed)));
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

export function summarize(name: string, rs: RunStats[]): string {
  const endings: Record<string, number> = {};
  for (const r of rs) endings[r.ending ?? 'none'] = (endings[r.ending ?? 'none'] ?? 0) + 1;
  const neg = rs.map((r) => r.firstNegative).filter((x): x is number => x !== null);
  const negBefore5 = neg.filter((m) => m < 300);
  const perHour = [0, 1, 2, 3, 4, 5].map((h) => avg(rs.map((r) => r.perHour[h])).toFixed(1));
  const idCount: Record<string, number> = {};
  for (const r of rs) for (const id of r.ids) idCount[id] = (idCount[id] ?? 0) + 1;
  const top = Object.entries(idCount)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${id} ${(n / rs.length).toFixed(2)}`)
    .join(', ');
  return [
    `── ${name}: ${rs.length} прогонов`,
    `концовки: ${JSON.stringify(endings)}`,
    `фоновых событий за смену: среднее ${avg(rs.map((r) => r.events)).toFixed(1)}, мин ${Math.min(...rs.map((r) => r.events))}, макс ${Math.max(...rs.map((r) => r.events))}`,
    `по часам (00..05): ${perHour.join(' / ')}`,
    `макс. пауза без фоновых событий (00:10–05:00): медиана ${pct(rs.map((r) => r.maxGapAmbient), 0.5)}, p90 ${pct(rs.map((r) => r.maxGapAmbient), 0.9)}, макс ${Math.max(...rs.map((r) => r.maxGapAmbient))} мин`,
    `макс. пауза без чего-либо (фон + сюжет): медиана ${pct(rs.map((r) => r.maxGapAny), 0.5)}, макс ${Math.max(...rs.map((r) => r.maxGapAny))} мин`,
    `первый минус до 05:00: ${negBefore5.length}/${rs.length} прогонов; медиана ${negBefore5.length ? hhmm(pct(negBefore5, 0.5)) : '—'}, раньше всех ${negBefore5.length ? hhmm(Math.min(...negBefore5)) : '—'}`,
    `внимание к концу: среднее ${avg(rs.map((r) => r.attention)).toFixed(1)}`,
    `одинаковых событий подряд: ${rs.reduce((a, r) => a + r.sameInRow, 0)}; ошибок: ${rs.reduce((a, r) => a + r.errors, 0)}`,
    `частота событий (на прогон): ${top}`,
  ].join('\n');
}
