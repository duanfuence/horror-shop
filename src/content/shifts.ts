import type { ShiftDef } from '../core/types';
import { shift1 } from './shift1';

/** Реестр смен. Новая смена добавляется сюда — ядро игры менять не нужно. */
export const SHIFTS: Record<string, ShiftDef> = {
  [shift1.id]: shift1,
};

export const FIRST_SHIFT = shift1.id;
