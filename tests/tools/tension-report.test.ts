/**
 * Отчёт по режиссёру тревоги (не тест): npm run report:tension
 * Прогоняет по 200 смен на каждую стратегию игрока и печатает сводку.
 */
import { it } from 'vitest';
import { batch, summarize } from './tensionReport';

it.runIf(import.meta.env.MODE === 'report')(
  'отчёт: режиссёр тревоги, 200 прогонов на стратегию',
  async () => {
    for (const p of ['cautious', 'watcher', 'risky', 'random']) {
      process.stdout.write(summarize(p, await batch(p, 200)) + '\n\n');
    }
  },
  600000,
);
