const NYT_CHROME = [
  'PANGRAM', 'ANSWERS', 'YESTERDAY', 'YESTERDAYS', 'TODAY', 'TODAYS',
  'WORDS', 'POINTS', 'GENIUS', 'QUEEN', 'SPELLING', 'GAMES', 'EDITED',
  'FOUND', 'RANKINGS',
];
const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'JUNE', 'JULY',
  'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]; // MAY is 3 letters and never matches anyway
const DAYS = [
  'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
];

/** NYT app UI words that must not become flashcards. Extend here when new junk shows up. */
export const UI_BLOCKLIST: ReadonlySet<string> = new Set([...NYT_CHROME, ...MONTHS, ...DAYS]);

export interface ParseResult {
  candidates: string[];
  alreadyKnown: string[];
  filteredUi: string[];
  filteredInvalidLetters: string[];
  /** The 7 hive letters detected in the screenshot (center letter first), or null if none was found. */
  hive: { center: string; letters: string[] } | null;
}

interface HiveLetters {
  center: string;
  letters: ReadonlySet<string>;
}

/** A valid Spelling Bee answer uses only hive letters and includes the center letter. */
function isValidForHive(word: string, hive: HiveLetters): boolean {
  return word.includes(hive.center) && [...word].every((ch) => hive.letters.has(ch));
}

/** Share of the words following a candidate line that must fit it before we trust it as the real hive row. */
const VALID_FRACTION_THRESHOLD = 0.5;

/** Lines that are exactly 7 unique letters and nothing else, in document order. */
function sevenLetterLines(text: string): { letters: string[]; end: number }[] {
  const regex = /^[ \t]*([A-Za-z]{7})[ \t]*$/gm;
  const out: { letters: string[]; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const letters = match[1].toUpperCase().split('');
    if (new Set(letters).size === 7) out.push({ letters, end: match.index + match[0].length });
  }
  return out;
}

function validFraction(hive: HiveLetters, words: string[]): number {
  if (words.length === 0) return 0;
  return words.filter((w) => isValidForHive(w, hive)).length / words.length;
}

/**
 * The NYT app's word-list screen shows the 7 hive letters (center letter
 * first) as a single run of 7 letters on its own line, e.g. "VAGILNT" —
 * OCR renders them with no spaces even though the app displays the center
 * letter in a different color. Content above that row is screen chrome
 * (nav bar, rank dialog, screen title) with no fixed vocabulary, so it
 * can't be blocklisted by word.
 *
 * A plain "line of exactly 7 letters" match isn't enough on its own: screen
 * chrome can coincidentally be 7 letters too (e.g. the "Answers" screen
 * title — that particular case also happens to have a repeated letter, but
 * nothing guarantees the next one will). The hive row is always the one
 * immediately above the answer list, so instead of taking the first
 * matching line found, we walk candidate lines from the end of `rawText`
 * backward (closest to the list first) and check each one against the
 * words that actually follow it — a candidate whose letters don't explain
 * those words is chrome, not the letter row.
 *
 * That position is reliable even when a candidate's own letters aren't: the
 * gold center letter is rendered in a color distinct enough that the plain
 * OCR pass can misread it (e.g. "WEGINOV" for the true "KEGINOV") while
 * still correctly placing the line itself right above the answer list. When
 * a positionally-right candidate fails validation, `hiveText` — a separate
 * OCR pass over a gold-aware ink mask (see isolateInk() in ocr.ts) that
 * recovers that letter instead of erasing it — is checked for a
 * differently-read version of the same row, re-validated against the same
 * word pool before being trusted.
 */
function findHiveLetters(
  rawText: string,
  hiveText?: string,
): { hive: HiveLetters; rest: string } | null {
  const rawCandidates = sevenLetterLines(rawText);
  const inkCandidates = hiveText ? sevenLetterLines(hiveText) : [];
  for (let i = rawCandidates.length - 1; i >= 0; i--) {
    const { letters, end } = rawCandidates[i];
    const rest = rawText.slice(end);
    const words = rest.toUpperCase().match(/[A-Z]{4,}/g) ?? [];
    if (words.length === 0) continue;

    const rawHive: HiveLetters = { center: letters[0], letters: new Set(letters) };
    if (validFraction(rawHive, words) >= VALID_FRACTION_THRESHOLD) return { hive: rawHive, rest };

    for (const ink of inkCandidates) {
      const inkHive: HiveLetters = { center: ink.letters[0], letters: new Set(ink.letters) };
      if (validFraction(inkHive, words) >= VALID_FRACTION_THRESHOLD) return { hive: inkHive, rest };
    }
  }
  return null;
}

/**
 * `boostedText` is a second OCR pass over a contrast-boosted copy of the
 * same image, which recovers faint/low-contrast answer words (e.g. one
 * mid-fade-in on the app's reveal screen) that the original pass misses.
 * That contrast boost also destroys the hive letter row itself, so it's
 * only folded in once the hive has already been found in `rawText` — the
 * hive-letter validation below is what makes the boosted pass's extra OCR
 * noise safe to merge in; without a confirmed hive there's no such net,
 * so an unmatched `boostedText` is ignored entirely rather than risking
 * new false-positive candidates.
 */
export function parseCandidates(
  rawText: string,
  existingWords: ReadonlySet<string>,
  boostedText?: string,
  hiveText?: string,
): ParseResult {
  const found = findHiveLetters(rawText, hiveText);
  let text = found ? found.rest : rawText;
  if (found && boostedText) text += `\n${boostedText}`;
  const matches = text.toUpperCase().match(/[A-Z]{4,}/g) ?? [];
  const candidates: string[] = [];
  const alreadyKnown: string[] = [];
  const filteredUi: string[] = [];
  const filteredInvalidLetters: string[] = [];
  for (const word of new Set(matches)) {
    if (UI_BLOCKLIST.has(word)) filteredUi.push(word);
    else if (found && !isValidForHive(word, found.hive)) filteredInvalidLetters.push(word);
    else if (existingWords.has(word)) alreadyKnown.push(word);
    else candidates.push(word);
  }
  candidates.sort();
  alreadyKnown.sort();
  filteredUi.sort();
  filteredInvalidLetters.sort();
  const hive = found ? { center: found.hive.center, letters: [...found.hive.letters] } : null;
  return { candidates, alreadyKnown, filteredUi, filteredInvalidLetters, hive };
}
