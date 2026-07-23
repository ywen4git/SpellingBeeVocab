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
}

interface HiveLetters {
  center: string;
  letters: ReadonlySet<string>;
}

/**
 * The NYT app's word-list screen shows the 7 hive letters (center letter
 * first) as a single run of 7 letters on its own line, e.g. "VAGILNT" —
 * OCR renders them with no spaces even though the app displays the center
 * letter in a different color. Content above that row is screen chrome
 * (nav bar, rank dialog) with no fixed vocabulary, so it can't be
 * blocklisted by word — instead we locate the letter row and drop
 * everything before it.
 */
function findHiveLetters(text: string): { hive: HiveLetters; rest: string } | null {
  const match = /^[ \t]*([A-Za-z]{7})[ \t]*$/m.exec(text);
  if (!match) return null;
  const letters = match[1].toUpperCase().split('');
  const unique = new Set(letters);
  if (unique.size !== 7) return null;
  return { hive: { center: letters[0], letters: unique }, rest: text.slice(match.index + match[0].length) };
}

/** A valid Spelling Bee answer uses only hive letters and includes the center letter. */
function isValidForHive(word: string, hive: HiveLetters): boolean {
  return word.includes(hive.center) && [...word].every((ch) => hive.letters.has(ch));
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
): ParseResult {
  const found = findHiveLetters(rawText);
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
  return { candidates, alreadyKnown, filteredUi, filteredInvalidLetters };
}
