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
}

export function parseCandidates(
  rawText: string,
  existingWords: ReadonlySet<string>,
): ParseResult {
  const matches = rawText.toUpperCase().match(/[A-Z]{4,}/g) ?? [];
  const candidates: string[] = [];
  const alreadyKnown: string[] = [];
  const filteredUi: string[] = [];
  for (const word of new Set(matches)) {
    if (UI_BLOCKLIST.has(word)) filteredUi.push(word);
    else if (existingWords.has(word)) alreadyKnown.push(word);
    else candidates.push(word);
  }
  candidates.sort();
  alreadyKnown.sort();
  filteredUi.sort();
  return { candidates, alreadyKnown, filteredUi };
}
