import { describe, expect, it } from 'vitest';
import { parseCandidates, UI_BLOCKLIST } from '../parser';
import fixture from '../__fixtures__/nyt-answers-ocr.txt?raw';

describe('parseCandidates', () => {
  it('extracts 4+ letter words, uppercased, deduped, sorted', () => {
    const r = parseCandidates('naiad agaric Agaric ant', new Set());
    expect(r.candidates).toEqual(['AGARIC', 'NAIAD']);
  });

  it('filters NYT UI chrome, month and day names into filteredUi', () => {
    const r = parseCandidates('PANGRAM GENIUS JULY SATURDAY AGARIC', new Set());
    expect(r.candidates).toEqual(['AGARIC']);
    expect(r.filteredUi).toEqual(expect.arrayContaining(['GENIUS', 'JULY', 'PANGRAM', 'SATURDAY']));
  });

  it('splits words already in the collection into alreadyKnown', () => {
    const r = parseCandidates('AGARIC TIARA', new Set(['TIARA']));
    expect(r.candidates).toEqual(['AGARIC']);
    expect(r.alreadyKnown).toEqual(['TIARA']);
  });

  it('handles a realistic answers-page OCR dump', () => {
    const r = parseCandidates(fixture, new Set(['TIARA']));
    expect(r.candidates).toEqual([
      'ABANDON', 'AGARIC', 'ANTIC', 'ARIA', 'CAIRN', 'NAIAD', 'NUANCE', 'RADIAN', 'TRAIN',
    ]);
    expect(r.alreadyKnown).toEqual(['TIARA']);
    expect(r.candidates).not.toContain('PANGRAM');
    expect(r.candidates).not.toContain('WORDS');
  });

  it('exports the blocklist for reuse', () => {
    expect(UI_BLOCKLIST.has('PANGRAM')).toBe(true);
  });
});
