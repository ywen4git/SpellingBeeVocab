export type WordStatus = 'learning' | 'mastered';
export type DefinitionSource = 'api' | 'manual' | 'none';
export type Box = 1 | 2 | 3;

export interface VocabWord {
  word: string;                 // UPPERCASE, unique key
  definition: string;
  definitionSource: DefinitionSource;
  status: WordStatus;
  box: Box;                     // meaningful while learning; stays at 3 after mastery
  dueAt: number;                // epoch ms; ignored when mastered
  addedAt: number;              // epoch ms
  lapses: number;               // demotions to box 1
}

export interface VocabDb {
  schemaVersion: 1;
  words: Record<string, VocabWord>;
}

export const SCHEMA_VERSION = 1 as const;
export const PLACEHOLDER_DEFINITION = 'No definition found — tap to edit.';

export function emptyDb(): VocabDb {
  return { schemaVersion: SCHEMA_VERSION, words: {} };
}
