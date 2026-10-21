/**
 * Отчёт по режиссёру тревоги (не тест): npm run report:tension
 * Прогоняет по 200 смен на каждую стратегию игрока и печатает сводку.
 */
import { it } from 'vitest';
import { batch, summarize } from './tensionReport';

it.runIf(import.meta.env.MODE === 'report')(
  'отчёт: режиссёр тревоги, 200 прогонов на стратегию',
  async () => {
    const only = process.env.POLICIES?.split(',');
    for (const p of only ?? ['cautious', 'watcher', 'risky', 'random', 'observer', 'observer_cold']) {
      process.stdout.write(summarize(p, await batch(p, 200)) + '\n\n');
    }
  },
  600000,
);
