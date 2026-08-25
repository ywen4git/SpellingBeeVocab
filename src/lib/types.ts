export type WordStatus = 'learning' | 'mastered';
// The provider that last successfully answered a fetch for this word — 'none' if the last
// attempt (or the only attempt ever made) found nothing. Independent of whether a human has
// since hand-edited the text (see manuallyEdited below).
export type DefinitionSource = 'merriam-webster' | 'free-dictionary' | 'none';
export type Box = 1 | 2 | 3;

export interface VocabWord {
  word: string;                 // UPPERCASE, unique key
  definition: string;
  definitionSource: DefinitionSource;
  manuallyEdited: boolean;      // true once a human has typed and saved definition text
  definitionUpdatedAt: number | null; // epoch ms of the last fetch or manual save; null if
                                       // the word has never had real definition text
  status: WordStatus;
  box: Box;                     // meaningful while learning; stays at 3 after mastery
  dueAt: number;                // epoch ms; ignored when mastered
  addedAt: number;              // epoch ms
  lapses: number;               // demotions to box 1
}

export interface VocabDb {
  schemaVersion: 2;
  words: Record<string, VocabWord>;
}

export const SCHEMA_VERSION = 2 as const;
export const PLACEHOLDER_DEFINITION = 'No definition found — tap to edit.';

export function emptyDb(): VocabDb {
  return { schemaVersion: SCHEMA_VERSION, words: {} };
}

export function hasNoDefinition(w: VocabWord): boolean {
  return w.definition === PLACEHOLDER_DEFINITION;
}
