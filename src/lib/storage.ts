import type { VocabDb } from './types';
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
    localStorage.setItem(CORRUPT_KEY, raw);
    localStorage.removeItem(DB_KEY);
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
        item.word, typeof item.definition === 'string' ? item.definition : '', 'api', now,
      );
    }
    for (const item of data.mastered) {
      if (typeof item.word !== 'string') continue;
      db.words[item.word] = knownWordEntry(
        item.word, typeof item.definition === 'string' ? item.definition : '', 'api', now,
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

export function parseBackup(text: string): VocabDb | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof d.words !== 'object' || d.words === null || Array.isArray(d.words)) return null;
  for (const entry of Object.values(d.words as Record<string, unknown>)) {
    const w = entry as Record<string, unknown> | null;
    if (
      w === null || typeof w.word !== 'string' ||
      (w.status !== 'learning' && w.status !== 'mastered')
    ) {
      return null;
    }
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
      ? { ...winner, status: 'mastered' } // never un-master via import
      : winner;
  }
  return { merged: { schemaVersion: SCHEMA_VERSION, words }, added, existing };
}
