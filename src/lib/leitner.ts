import type { Box, DefinitionSource, VocabDb, VocabWord } from './types';

export const BOX_INTERVAL_DAYS: Record<Box, number> = { 1: 1, 2: 3, 3: 7 };

const HOUR = 3_600_000;
const DAY_START_HOUR = 4;

/** 4 AM local-time boundary `days` study-days after `now`. A study day runs 4 AM → 4 AM. */
export function nextDayBoundary(now: number, days: number): number {
  const shifted = new Date(now - DAY_START_HOUR * HOUR);
  return new Date(
    shifted.getFullYear(), shifted.getMonth(), shifted.getDate() + days,
    DAY_START_HOUR, 0, 0, 0,
  ).getTime();
}

export function newWordEntry(
  word: string, definition: string, definitionSource: DefinitionSource, now: number,
): VocabWord {
  return {
    word, definition, definitionSource,
    status: 'learning', box: 1, dueAt: now, addedAt: now, lapses: 0,
  };
}

/** "Already know" import: straight to mastered, present in stats but never scheduled. */
export function knownWordEntry(
  word: string, definition: string, definitionSource: DefinitionSource, now: number,
): VocabWord {
  return {
    word, definition, definitionSource,
    status: 'mastered', box: 3, dueAt: now, addedAt: now, lapses: 0,
  };
}

export function gradeGotIt(w: VocabWord, now: number): VocabWord {
  if (w.box === 3) return { ...w, status: 'mastered' };
  const box = (w.box + 1) as Box;
  return { ...w, box, dueAt: nextDayBoundary(now, BOX_INTERVAL_DAYS[box]) };
}

export function gradeMissed(w: VocabWord, now: number): VocabWord {
  return { ...w, box: 1, dueAt: nextDayBoundary(now, 1), lapses: w.lapses + 1 };
}

export function resetToLearning(w: VocabWord, now: number): VocabWord {
  return { ...w, status: 'learning', box: 1, dueAt: now };
}

export function unmaster(w: VocabWord, now: number): VocabWord {
  return { ...w, status: 'learning', box: 3, dueAt: now };
}

export function dueWords(db: VocabDb, now: number): VocabWord[] {
  return Object.values(db.words)
    .filter((w) => w.status === 'learning' && w.dueAt <= now)
    .sort((a, b) => a.box - b.box || a.dueAt - b.dueAt || a.word.localeCompare(b.word));
}

export function nextDueAt(db: VocabDb, now: number): number | null {
  let min: number | null = null;
  for (const w of Object.values(db.words)) {
    if (w.status === 'learning' && w.dueAt > now && (min === null || w.dueAt < min)) {
      min = w.dueAt;
    }
  }
  return min;
}
