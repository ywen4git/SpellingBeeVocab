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
 * first) as a run of single-character tokens, e.g. "V A G I L N T". Content
 * above that row is screen chrome (nav bar, dialog title) with no fixed
 * vocabulary, so it can't be blocklisted by word — instead we locate the
 * letter row and drop everything before it.
 */
function findHiveLetters(text: string): { hive: HiveLetters; rest: string } | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i + 7 <= tokens.length; i++) {
    const slice = tokens.slice(i, i + 7);
    if (!slice.every((t) => /^[A-Za-z]$/.test(t))) continue;
    const letters = slice.map((t) => t.toUpperCase());
    const unique = new Set(letters);
    if (unique.size !== 7) continue;
    return { hive: { center: letters[0], letters: unique }, rest: tokens.slice(i + 7).join(' ') };
  }
  return null;
}

/** A valid Spelling Bee answer uses only hive letters and includes the center letter. */
function isValidForHive(word: string, hive: HiveLetters): boolean {
  return word.includes(hive.center) && [...word].every((ch) => hive.letters.has(ch));
}

export function parseCandidates(
  rawText: string,
  existingWords: ReadonlySet<string>,
): ParseResult {
  const found = findHiveLetters(rawText);
  const text = found ? found.rest : rawText;
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
