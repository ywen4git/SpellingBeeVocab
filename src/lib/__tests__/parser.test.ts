import { describe, expect, it } from 'vitest';
import { parseCandidates, UI_BLOCKLIST } from '../parser';
import fixture from '../__fixtures__/nyt-answers-ocr.txt?raw';
import wordListFixture from '../__fixtures__/nyt-word-list-ocr.txt?raw';

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

  it('drops chrome above the hive letter row (rendered as one unspaced token by OCR) and keeps valid answers', () => {
    const r = parseCandidates(wordListFixture, new Set());
    expect(r.candidates).not.toContain('GREAT');
    expect(r.candidates).not.toContain('GREATS');
    expect(r.candidates).not.toContain('KNEW');
    expect(r.candidates).toContain('INFALLIBLY');
    expect(r.candidates).toContain('NAIF');
    expect(r.filteredInvalidLetters).toEqual([]);
  });

  it('rejects words containing a letter outside the detected hive', () => {
    const r = parseCandidates('VAGILNT\nGALLIVANT PANDA', new Set());
    expect(r.candidates).toEqual(['GALLIVANT']);
    expect(r.filteredInvalidLetters).toEqual(['PANDA']);
  });

  it('rejects hive-letter words missing the center letter', () => {
    const r = parseCandidates('VAGILNT\nGALLIVANT GIANT', new Set());
    expect(r.candidates).toEqual(['GALLIVANT']);
    expect(r.filteredInvalidLetters).toEqual(['GIANT']);
  });

  it('does not filter by hive letters when no letter row is present', () => {
    const r = parseCandidates(fixture, new Set(['TIARA']));
    expect(r.filteredInvalidLetters).toEqual([]);
  });

  it('merges in a boosted-pass word recovered from a low-contrast original', () => {
    const r = parseCandidates('VAGILNT\nGALLIVANT', new Set(), 'GALLIVANT VITAL');
    expect(r.candidates).toEqual(['GALLIVANT', 'VITAL']);
  });

  it('ignores the boosted pass entirely when no hive was found in the original', () => {
    const r = parseCandidates('GALLIVANT', new Set(), 'VITAL');
    expect(r.candidates).toEqual(['GALLIVANT']);
  });

  it('still routes boosted-pass noise through hive validation, not straight to candidates', () => {
    const r = parseCandidates('VAGILNT\nGALLIVANT', new Set(), 'GALLIVANT PANDA');
    expect(r.candidates).toEqual(['GALLIVANT']);
    expect(r.filteredInvalidLetters).toEqual(['PANDA']);
  });

  it('reports the detected hive letters with the center letter first', () => {
    const r = parseCandidates('VAGILNT\nGALLIVANT', new Set());
    expect(r.hive).toEqual({ center: 'V', letters: ['V', 'A', 'G', 'I', 'L', 'N', 'T'] });
  });

  it('reports hive as null when no letter row is found', () => {
    const r = parseCandidates(fixture, new Set());
    expect(r.hive).toBeNull();
  });
});
