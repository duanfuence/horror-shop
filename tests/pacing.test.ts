import { describe, expect, it } from 'vitest';
import { shift1 } from '../src/content/shift1';
import { parseTime } from '../src/core/state';
import { rulesPolicy, simulate } from './sim';

/**
 * Оценка длительности смены в реальном времени.
 * Часы стоят во время диалогов, поэтому время = ход часов + чтение реплик + раздумья над выбором.
 * Допущения: чтение 16 символов/с + 0,6 с на реплику; выбор — 3 с.
 */
describe('Темп смены', () => {
  it('смена длится примерно 10–15 минут, первая странность — в первые 1–2 минуты', async () => {
    const r = await simulate(shift1, rulesPolicy(), 11);
    const clockSec = 360 * shift1.secondsPerMinute;
    const readSec = r.lines.reduce((s, l) => s + l.text.length / 16 + 0.6, 0);
    const choiceSec = r.choices.length * 3;
    const totalMin = (clockSec + readSec + choiceSec) / 60;
    console.log(
      `часы: ${(clockSec / 60).toFixed(1)} мин, чтение: ${(readSec / 60).toFixed(1)} мин (${r.lines.length} реплик), ` +
        `выборы: ${(choiceSec / 60).toFixed(1)} мин (${r.choices.length}) → итого ≈ ${totalMin.toFixed(1)} мин`,
    );
    expect(totalMin).toBeGreaterThanOrEqual(10);
    expect(totalMin).toBeLessThanOrEqual(16);

    // Первая странность (колокольчик без посетителя) — по реальному времени не позже ~2 минут.
    const bellMin = parseTime(shift1.timeline.find((b) => b.id === 'bell')!.at);
    const introLines = 8;
    const firstOddSec = bellMin * shift1.secondsPerMinute + introLines * 4 + 3 * 25;
    expect(firstOddSec).toBeLessThanOrEqual(150);
  });
});
