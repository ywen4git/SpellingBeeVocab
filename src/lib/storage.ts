import type { DefinitionSource, VocabDb } from './types';
import { emptyDb, SCHEMA_VERSION } from './types';
import { knownWordEntry, newWordEntry } from './leitner';

export const DB_KEY = 'beevocab.db.v1';
export const CORRUPT_KEY = 'beevocab.db.corrupt';
export const LEGACY_KEY = 'spelling_bee_vocab';

export interface LoadResult {
  db: VocabDb;
  recoveredFromCorrupt: boolean;
  migratedLegacy: boolean;
}

export function loadDb(now: number): LoadResult {
  const raw = localStorage.getItem(DB_KEY);
  if (raw !== null) {
    const db = parseBackup(raw);
    if (db) return { db, recoveredFromCorrupt: false, migratedLegacy: false };
    // Never silently discard user data: quarantine it, then start fresh.
    try {
      localStorage.setItem(CORRUPT_KEY, raw);
      localStorage.removeItem(DB_KEY);
    } catch {
      // Quota full: leave the unreadable payload in place rather than destroy it.
    }
    return { db: emptyDb(), recoveredFromCorrupt: true, migratedLegacy: false };
  }
  const legacy = readLegacy(now);
  if (legacy) {
    localStorage.removeItem(LEGACY_KEY);
    saveDb(legacy);
    return { db: legacy, recoveredFromCorrupt: false, migratedLegacy: true };
  }
  return { db: emptyDb(), recoveredFromCorrupt: false, migratedLegacy: false };
}

interface LegacyItem { word?: unknown; definition?: unknown }

function readLegacy(now: number): VocabDb | null {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw) as { new?: LegacyItem[]; mastered?: LegacyItem[] };
    if (!Array.isArray(data.new) || !Array.isArray(data.mastered)) return null;
    const db = emptyDb();
    for (const item of data.new) {
      if (typeof item.word !== 'string') continue;
      db.words[item.word] = newWordEntry(
        item.word, typeof item.definition === 'string' ? item.definition : '', 'free-dictionary', now,
      );
    }
    for (const item of data.mastered) {
      if (typeof item.word !== 'string') continue;
      db.words[item.word] = knownWordEntry(
        item.word, typeof item.definition === 'string' ? item.definition : '', 'free-dictionary', now,
      );
    }
    return db;
  } catch {
    return null;
  }
}

export function saveDb(db: VocabDb): boolean {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return true;
  } catch {
    return false; // quota exceeded — caller warns the user
  }
}

export function exportDb(db: VocabDb): string {
  return JSON.stringify(db, null, 2);
}

/**
 * v1 predates manuallyEdited/definitionUpdatedAt and the provider-specific DefinitionSource.
 * v1 'api' meant "fetched, from whichever source existed then" — always the free dictionary,
 * since Merriam-Webster support postdates every pre-migration word, so this is accurate, not a
 * guess, for real installs. v1 'manual' meant a hand-edit whose original fetched source (if any)
 * isn't recoverable, so it maps to source 'none'. definitionUpdatedAt is backfilled to addedAt for
 * 'api'/'manual' words (best available approximation — the true last-update time isn't recoverable
 * either), but stays null for 'none' words: those never had real definition text, so null is exact,
 * matching the same contract freshly-created never-fetched words get from initialDefinitionUpdatedAt.
 */
function migrateWordV1ToV2(w: Record<string, unknown>): Record<string, unknown> {
  const v1Source = w.definitionSource;
  const definitionSource: DefinitionSource = v1Source === 'api' ? 'free-dictionary' : 'none';
  const manuallyEdited = v1Source === 'manual';
  const addedAt = typeof w.addedAt === 'number' ? w.addedAt : 0;
  const definitionUpdatedAt = v1Source === 'api' || v1Source === 'manual' ? addedAt : null;
  return { ...w, definitionSource, manuallyEdited, definitionUpdatedAt };
}

export function parseBackup(text: string): VocabDb | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.schemaVersion !== 1 && d.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof d.words !== 'object' || d.words === null || Array.isArray(d.words)) return null;
  const rawWords = d.words as Record<string, unknown>;
  for (const entry of Object.values(rawWords)) {
    const w = entry as Record<string, unknown> | null;
    if (
      w === null || typeof w.word !== 'string' ||
      (w.status !== 'learning' && w.status !== 'mastered')
    ) {
      return null;
    }
  }
  if (d.schemaVersion === 1) {
    const words = Object.fromEntries(
      Object.entries(rawWords).map(([key, w]) => [key, migrateWordV1ToV2(w as Record<string, unknown>)]),
    );
    return { schemaVersion: SCHEMA_VERSION, words } as unknown as VocabDb;
  }
  return data as VocabDb;
}

export interface MergeResult {
  merged: VocabDb;
  added: number;
  existing: number;
}

export function mergeDb(current: VocabDb, incoming: VocabDb): MergeResult {
  const words = { ...current.words };
  let added = 0;
  let existing = 0;
  for (const [key, inc] of Object.entries(incoming.words)) {
    const cur = words[key];
    if (!cur) {
      words[key] = inc;
      added += 1;
      continue;
    }
    existing += 1;
    const winner = inc.addedAt > cur.addedAt ? inc : cur;
    const anyMastered = inc.status === 'mastered' || cur.status === 'mastered';
    words[key] = anyMastered && winner.status !== 'mastered'
      ? { ...winner, status: 'mastered', box: 3 } // never un-master via import
      : winner;
  }
  return { merged: { schemaVersion: SCHEMA_VERSION, words }, added, existing };
}
