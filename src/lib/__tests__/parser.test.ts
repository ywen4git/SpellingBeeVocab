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

  it('skips a coincidental 7-letter chrome line (e.g. "Answers") with a repeated letter and finds the real hive row below it', () => {
    const r = parseCandidates('Answers\nJuly 24, 2026\nVAGILNT\nGALLIVANT', new Set());
    expect(r.hive).toEqual({ center: 'V', letters: ['V', 'A', 'G', 'I', 'L', 'N', 'T'] });
    expect(r.candidates).toEqual(['GALLIVANT']);
  });

  it('rejects a coincidental 7-unique-letter chrome line whose "hive" fits none of the words that follow it', () => {
    const r = parseCandidates('Playing\nEVOKING EKING ENOKI EVOKE GEEK', new Set());
    expect(r.hive).toBeNull();
    // "Playing" itself remains as unconsumed chrome text (same as any unblocklisted screen chrome)
    // rather than being wrongly promoted to the hive, since none of the real words fit it.
    expect(r.candidates).toEqual(['EKING', 'ENOKI', 'EVOKE', 'EVOKING', 'GEEK', 'PLAYING']);
    expect(r.filteredInvalidLetters).toEqual([]);
  });

  it('does not hide already-known words behind a rejected chrome "hive" match', () => {
    const known = new Set(['EKING', 'ENOKI', 'EVOKE', 'EVOKING', 'GEEK']);
    const r = parseCandidates('Playing\nEVOKING EKING ENOKI EVOKE GEEK', known);
    expect(r.hive).toBeNull();
    expect(r.alreadyKnown).toEqual(['EKING', 'ENOKI', 'EVOKE', 'EVOKING', 'GEEK']);
    expect(r.candidates).toEqual(['PLAYING']);
  });

  it('prefers the hive-row candidate closest to the answer list when an earlier line also happens to have 7 unique letters', () => {
    const r = parseCandidates('Playing\nVAGILNT\nGALLIVANT VITAL VITA', new Set());
    expect(r.hive).toEqual({ center: 'V', letters: ['V', 'A', 'G', 'I', 'L', 'N', 'T'] });
    expect(r.candidates).toEqual(['GALLIVANT', 'VITA', 'VITAL']);
  });

  it('recovers the hive letters from hiveText when the raw pass misread the (gold) center letter', () => {
    // Raw pass misread the center letter G as C ("CAGILNT"), which fits none of the real answers,
    // but the ink-isolated pass (hiveText) read it correctly and validates against the same words.
    const r = parseCandidates(
      'CAGILNT\nGALLIVANT VITAL VITA',
      new Set(),
      undefined,
      'VAGILNT',
    );
    expect(r.hive).toEqual({ center: 'V', letters: ['V', 'A', 'G', 'I', 'L', 'N', 'T'] });
    expect(r.candidates).toEqual(['GALLIVANT', 'VITA', 'VITAL']);
  });

  it('ignores hiveText when the raw-pass hive row already validates', () => {
    const r = parseCandidates('VAGILNT\nGALLIVANT VITAL VITA', new Set(), undefined, 'ZZZZZZZ');
    expect(r.hive).toEqual({ center: 'V', letters: ['V', 'A', 'G', 'I', 'L', 'N', 'T'] });
  });

  it('falls back to null when neither the raw pass nor hiveText produce a hive row that fits the answers', () => {
    const r = parseCandidates('Playing\nEVOKING EKING ENOKI EVOKE GEEK', new Set(), undefined, 'Working');
    expect(r.hive).toBeNull();
  });

  it('validates a hive candidate using words carried over from a second, concatenated screenshot', () => {
    // Screenshot 1 alone: too few of the words after the hive line actually fit it (page cut off
    // mid-list), so on its own this would fail validation and fall back to null.
    const page1 = 'VAGILNT\nPANDA TIARA GIANT';
    const page1Result = parseCandidates(page1, new Set());
    expect(page1Result.hive).toBeNull();

    // AddScreen concatenates OCR text from every uploaded screenshot before a single parseCandidates
    // call — screenshot 2 has no hive row of its own (continuation pages never repeat it), but its
    // extra real answers are enough to tip the same candidate line over the 50% validation threshold.
    const page2 = 'GALLIVANT VITAL VITA LIVING';
    const combinedResult = parseCandidates(`${page1}\n${page2}`, new Set());
    expect(combinedResult.hive).toEqual({ center: 'V', letters: ['V', 'A', 'G', 'I', 'L', 'N', 'T'] });
    expect(combinedResult.candidates).toEqual(['GALLIVANT', 'LIVING', 'VITA', 'VITAL']);
    expect(combinedResult.filteredInvalidLetters).toEqual(['GIANT', 'PANDA', 'TIARA']);
  });

  it('corrects a leading lowercase "l" to "I" when that is the only way the word fits a confirmed hive', () => {
    // Real case: "Iota" OCR'd as "lota" (capital I and lowercase l look identical in this font).
    const r = parseCandidates('IAMNOTZ\nManzanita lota Motion', new Set());
    expect(r.hive).toEqual({ center: 'I', letters: ['I', 'A', 'M', 'N', 'O', 'T', 'Z'] });
    expect(r.candidates).toEqual(['IOTA', 'MANZANITA', 'MOTION']);
    expect(r.corrections).toEqual([{ original: 'LOTA', corrected: 'IOTA' }]);
  });

  it('corrects a digit standing in for its letter look-alike anywhere in the token', () => {
    // "0" for "O" here; DIGIT_TO_LETTER also covers "1" for "I" and "5" for "S".
    const r = parseCandidates('IAMNOTZ\nManzanita N0tion Motion', new Set());
    expect(r.hive).toEqual({ center: 'I', letters: ['I', 'A', 'M', 'N', 'O', 'T', 'Z'] });
    expect(r.candidates).toEqual(['MANZANITA', 'MOTION', 'NOTION']);
    expect(r.corrections).toEqual([{ original: 'N0TION', corrected: 'NOTION' }]);
  });

  it('does not attempt corrections when no hive was confirmed, since there is no ground truth to justify one', () => {
    const r = parseCandidates('lota N0tion', new Set());
    expect(r.hive).toBeNull();
    expect(r.candidates).toEqual(['LOTA', 'N0TION']);
    expect(r.corrections).toEqual([]);
  });

  it('leaves a genuine lowercase "l" alone when it is not in the leading position', () => {
    const r = parseCandidates('IAMNOTZ\nManzanita Ballot Motion', new Set());
    // "Ballot" contains a B and a real (non-leading) "l" — neither hive-valid nor "correctable" —
    // so it's rejected outright rather than mangled into some other word.
    expect(r.filteredInvalidLetters).toContain('BALLOT');
    expect(r.corrections).toEqual([]);
  });

  it('does not report a correction when the raw OCR reading was already valid', () => {
    const r = parseCandidates('IAMNOTZ\nManzanita Iota Motion', new Set());
    expect(r.candidates).toEqual(['IOTA', 'MANZANITA', 'MOTION']);
    expect(r.corrections).toEqual([]);
  });
});
