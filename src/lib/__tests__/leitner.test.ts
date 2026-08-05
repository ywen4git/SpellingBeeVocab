import { describe, expect, it } from 'vitest';
import {
  BOX_INTERVAL_DAYS, dueWords, gradeGotIt, gradeMissed, knownWordEntry,
  newWordEntry, nextDayBoundary, nextDueAt, resetToLearning, unmaster,
} from '../leitner';
import type { VocabDb, VocabWord } from '../types';

const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

function db(...words: VocabWord[]): VocabDb {
  return { schemaVersion: 1, words: Object.fromEntries(words.map((w) => [w.word, w])) };
}

describe('nextDayBoundary (4 AM local study-day boundary)', () => {
  it('11 PM + 1 day -> 4 AM next morning', () => {
    expect(nextDayBoundary(at(2026, 7, 12, 23), 1)).toBe(at(2026, 7, 13, 4));
  });
  it('2 AM still belongs to the previous study day', () => {
    expect(nextDayBoundary(at(2026, 7, 13, 2), 1)).toBe(at(2026, 7, 13, 4));
  });
  it('7 AM + 1 day -> 4 AM the next calendar day', () => {
    expect(nextDayBoundary(at(2026, 7, 13, 7), 1)).toBe(at(2026, 7, 14, 4));
  });
  it('supports multi-day intervals', () => {
    expect(nextDayBoundary(at(2026, 7, 12, 12), 3)).toBe(at(2026, 7, 15, 4));
  });
});

describe('grading', () => {
  const now = at(2026, 7, 12, 12);
  const w = newWordEntry('AGARIC', 'a mushroom', 'api', now);

  it('new words start learning, box 1, due immediately', () => {
    expect(w).toMatchObject({ status: 'learning', box: 1, dueAt: now, lapses: 0 });
  });
  it('known words import as mastered', () => {
    expect(knownWordEntry('TIARA', 'a crown', 'api', now)).toMatchObject({
      status: 'mastered', box: 3, addedAt: now,
    });
  });
  it('got it: box 1 -> 2 with a 3-day interval', () => {
    const g = gradeGotIt(w, now);
    expect(g.box).toBe(2);
    expect(g.dueAt).toBe(nextDayBoundary(now, BOX_INTERVAL_DAYS[2]));
  });
  it('got it: box 2 -> 3 with a 7-day interval', () => {
    const g = gradeGotIt({ ...w, box: 2 }, now);
    expect(g.box).toBe(3);
    expect(g.dueAt).toBe(nextDayBoundary(now, 7));
  });
  it('got it in box 3 masters the word', () => {
    expect(gradeGotIt({ ...w, box: 3 }, now).status).toBe('mastered');
  });
  it('missed: back to box 1 tomorrow, lapse counted', () => {
    const g = gradeMissed({ ...w, box: 3 }, now);
    expect(g).toMatchObject({ box: 1, lapses: 1 });
    expect(g.dueAt).toBe(nextDayBoundary(now, 1));
  });
  it('resetToLearning: learning box 1, due now', () => {
    const m = knownWordEntry('TIARA', 'a crown', 'api', now - 999);
    expect(resetToLearning(m, now)).toMatchObject({ status: 'learning', box: 1, dueAt: now });
  });
  it('unmaster: learning box 3, due now', () => {
    const m = knownWordEntry('TIARA', 'a crown', 'api', now - 999);
    expect(unmaster(m, now)).toMatchObject({ status: 'learning', box: 3, dueAt: now });
  });
});

describe('sessions', () => {
  const now = at(2026, 7, 12, 12);

  it('dueWords: only due learning words, box desc then dueAt asc', () => {
    const boxTwo = { ...newWordEntry('AAAA', '', 'none', now - 100), box: 2 as const };
    const laterBoxOne = newWordEntry('BBBB', '', 'none', now - 50);
    const earlierBoxOne = newWordEntry('CCCC', '', 'none', now - 200);
    const notDue = { ...newWordEntry('DDDD', '', 'none', now), dueAt: now + 1000 };
    const mastered = knownWordEntry('EEEE', '', 'none', now);
    const result = dueWords(db(boxTwo, laterBoxOne, earlierBoxOne, notDue, mastered), now);
    expect(result.map((w) => w.word)).toEqual(['AAAA', 'CCCC', 'BBBB']);
  });

  it('nextDueAt: earliest future due among learning words, null when none', () => {
    const soon = { ...newWordEntry('AAAA', '', 'none', now), dueAt: now + 1000 };
    const later = { ...newWordEntry('BBBB', '', 'none', now), dueAt: now + 5000 };
    expect(nextDueAt(db(soon, later), now)).toBe(now + 1000);
    expect(nextDueAt(db(), now)).toBeNull();
  });
});
