# Definition Provenance, Dates, Test Key & Re-fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five features to the Words/Data screens: an on-demand Merriam-Webster key test, per-word provenance badges (Merriam-Webster / free dictionary / manual), added/updated timestamps, bulk re-fetch of missing definitions, and single-word re-fetch with a sense-level diff and adopt/reject flow — while safely migrating existing users' stored data to the new schema.

**Architecture:** Extend `VocabWord` with a provider-specific `definitionSource`, a `manuallyEdited` flag, and a `definitionUpdatedAt` timestamp (schema v1 → v2, migrated transparently in `storage.ts`). Add a small pure diff module (`definitionDiff.ts`) and a single-word fetch export in `dictionary.ts`. All new UI lives in `WordsScreen.tsx` (+ one new `DefinitionRefetch` component) and `DataScreen.tsx`, wired through two new/changed `VocabProvider` actions.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind, Vitest + React Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-12-spelling-bee-pwa-design.md` (§4 data model & v1→v2 migration, §6.3 Words, §8.3 Test key, §8.4 provenance/dates/re-fetching)

## Global Constraints

- Minimum touch target `min-h-[44px]` on every interactive element (existing convention, `spec §6`).
- No `alert()`/`confirm()` — use the existing `Toast` component (`useToast().show(...)`) and inline confirm patterns.
- Tailwind only, matching existing amber/slate palette and `rounded-2xl`/`rounded-xl` card conventions.
- `lib/*` modules stay framework-free (no React/DOM imports) except `storage.ts` (localStorage) — pure functions, explicit `now`/inputs, no hidden `Date.now()` inside `lib/*` (screens/context may call `Date.now()` directly, matching existing `VocabProvider` style).
- All state mutations go through `VocabProvider` actions — screens/components never write `localStorage` directly.
- `localStorage['beevocab.db.v1']` (constant `DB_KEY`) is unchanged — schema version is tracked by the `schemaVersion` field inside the stored JSON, not the key name.
- Every step that touches test files must leave `npm test` and `npm run typecheck` fully green before moving to the next step.
- TDD: write/adjust the failing test before the implementation for every new behavior; mechanical rename steps (adjusting literals to satisfy the new type) don't need a red step first, just a green run after.

---

## Task 1: Data model v2 — provider-specific source, manual-edit flag, update timestamp, v1→v2 migration

This is a foundational, wide-reaching type change (`DefinitionSource` narrows from `'api' | 'manual' | 'none'` to `'merriam-webster' | 'free-dictionary' | 'none'`, plus two new `VocabWord` fields). It touches every file that constructs or asserts on a `VocabWord`. All steps in this task must land together — the codebase will not typecheck in between.

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/leitner.ts`
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/dictionary.ts` (source-literal values only, not yet the new `fetchSingleDefinition` export — that's Task 2)
- Modify: `src/context/VocabProvider.tsx` (`editDefinition` only)
- Test: `src/lib/__tests__/leitner.test.ts`
- Test: `src/lib/__tests__/storage.test.ts`
- Test: `src/lib/__tests__/dictionary.test.ts`
- Test: `src/screens/__tests__/WordsScreen.test.tsx`
- Test: `src/screens/__tests__/DataScreen.test.tsx`
- Test: `src/screens/__tests__/AddScreen.test.tsx`
- Test: `src/screens/__tests__/StudyScreen.test.tsx`

**Interfaces:**
- Produces: `DefinitionSource = 'merriam-webster' | 'free-dictionary' | 'none'` (`src/lib/types.ts`); `VocabWord.manuallyEdited: boolean`; `VocabWord.definitionUpdatedAt: number | null`; `VocabDb.schemaVersion: 2`; `SCHEMA_VERSION = 2`.
- Consumes: nothing (this is the base layer every later task builds on).

- [ ] **Step 1: Update `src/lib/types.ts`**

Replace the whole file:

```ts
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
```

- [ ] **Step 2: Update `src/lib/leitner.ts`'s entry constructors**

Modify (replace `newWordEntry`/`knownWordEntry`, `src/lib/leitner.ts:17-34`):

```ts
/** A freshly created word has never been hand-edited; it only has a real definitionUpdatedAt if a
 * fetch actually produced content — 'none' means it's still the placeholder. */
function initialDefinitionUpdatedAt(definitionSource: DefinitionSource, now: number): number | null {
  return definitionSource === 'none' ? null : now;
}

export function newWordEntry(
  word: string, definition: string, definitionSource: DefinitionSource, now: number,
): VocabWord {
  return {
    word, definition, definitionSource,
    manuallyEdited: false,
    definitionUpdatedAt: initialDefinitionUpdatedAt(definitionSource, now),
    status: 'learning', box: 1, dueAt: now, addedAt: now, lapses: 0,
  };
}

/** "Already know" import: straight to mastered, present in stats but never scheduled. */
export function knownWordEntry(
  word: string, definition: string, definitionSource: DefinitionSource, now: number,
): VocabWord {
  return {
    word, definition, definitionSource,
    manuallyEdited: false,
    definitionUpdatedAt: initialDefinitionUpdatedAt(definitionSource, now),
    status: 'mastered', box: 3, dueAt: now, addedAt: now, lapses: 0,
  };
}
```

- [ ] **Step 3: Rewrite `src/lib/__tests__/leitner.test.ts`**

Replace the whole file:

```ts
import { describe, expect, it } from 'vitest';
import {
  BOX_INTERVAL_DAYS, dueWords, gradeGotIt, gradeMissed, knownWordEntry,
  newWordEntry, nextDayBoundary, nextDueAt, resetToLearning, unmaster,
} from '../leitner';
import { SCHEMA_VERSION } from '../types';
import type { VocabDb, VocabWord } from '../types';

const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

function db(...words: VocabWord[]): VocabDb {
  return { schemaVersion: SCHEMA_VERSION, words: Object.fromEntries(words.map((w) => [w.word, w])) };
}

describe('nextDayBoundary (4 AM local study-day boundary)', () => {
  it('11 PM + 1 day -> 4 AM next morning', () => {
    expect(nextDayBoundary(at(2026, 7, 12, 23), 1)).toBe(at(2026, 7, 13, 4));
  });
  it('2 AM still belongs to the previous study day', () => {
    expect(nextDayBoundary(at(2026, 7, 13, 2), 1)).toBe(at(2026, 7, 13, 4));
  });
  it('7 AM + 1 day -> 4 AM the next calendar day', () => {
    expect(nextDayBoundary(at(2026, 7, 13, 7), 1)).toBe(at(2026, 7, 14, 4));
  });
  it('supports multi-day intervals', () => {
    expect(nextDayBoundary(at(2026, 7, 12, 12), 3)).toBe(at(2026, 7, 15, 4));
  });
});

describe('grading', () => {
  const now = at(2026, 7, 12, 12);
  const w = newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', now);

  it('new words start learning, box 1, due immediately', () => {
    expect(w).toMatchObject({ status: 'learning', box: 1, dueAt: now, lapses: 0 });
  });
  it('known words import as mastered', () => {
    expect(knownWordEntry('TIARA', 'a crown', 'free-dictionary', now)).toMatchObject({
      status: 'mastered', box: 3, addedAt: now,
    });
  });
  it('got it: box 1 -> 2 with a 3-day interval', () => {
    const g = gradeGotIt(w, now);
    expect(g.box).toBe(2);
    expect(g.dueAt).toBe(nextDayBoundary(now, BOX_INTERVAL_DAYS[2]));
  });
  it('got it: box 2 -> 3 with a 7-day interval', () => {
    const g = gradeGotIt({ ...w, box: 2 }, now);
    expect(g.box).toBe(3);
    expect(g.dueAt).toBe(nextDayBoundary(now, 7));
  });
  it('got it in box 3 masters the word', () => {
    expect(gradeGotIt({ ...w, box: 3 }, now).status).toBe('mastered');
  });
  it('missed: back to box 1 tomorrow, lapse counted', () => {
    const g = gradeMissed({ ...w, box: 3 }, now);
    expect(g).toMatchObject({ box: 1, lapses: 1 });
    expect(g.dueAt).toBe(nextDayBoundary(now, 1));
  });
  it('resetToLearning: learning box 1, due now', () => {
    const m = knownWordEntry('TIARA', 'a crown', 'free-dictionary', now - 999);
    expect(resetToLearning(m, now)).toMatchObject({ status: 'learning', box: 1, dueAt: now });
  });
  it('unmaster: learning box 3, due now', () => {
    const m = knownWordEntry('TIARA', 'a crown', 'free-dictionary', now - 999);
    expect(unmaster(m, now)).toMatchObject({ status: 'learning', box: 3, dueAt: now });
  });
});

describe('entry provenance defaults', () => {
  const now = at(2026, 7, 12, 12);

  it('a word with real fetched content is not manually edited and has an update timestamp', () => {
    const w = newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', now);
    expect(w).toMatchObject({ manuallyEdited: false, definitionUpdatedAt: now });
  });
  it('a word whose fetch found nothing has no update timestamp', () => {
    const w = newWordEntry('XYZZY', 'No definition found — tap to edit.', 'none', now);
    expect(w.definitionUpdatedAt).toBeNull();
  });
  it('knownWordEntry follows the same rule', () => {
    const found = knownWordEntry('TIARA', 'a crown', 'merriam-webster', now);
    const missing = knownWordEntry('TIARA', 'No definition found — tap to edit.', 'none', now);
    expect(found.definitionUpdatedAt).toBe(now);
    expect(missing.definitionUpdatedAt).toBeNull();
  });
});

describe('sessions', () => {
  const now = at(2026, 7, 12, 12);

  it('dueWords: only due learning words, box desc then dueAt asc', () => {
    const boxTwo = { ...newWordEntry('AAAA', '', 'none', now - 100), box: 2 as const };
    const laterBoxOne = newWordEntry('BBBB', '', 'none', now - 50);
    const earlierBoxOne = newWordEntry('CCCC', '', 'none', now - 200);
    const notDue = { ...newWordEntry('DDDD', '', 'none', now), dueAt: now + 1000 };
    const mastered = knownWordEntry('EEEE', '', 'none', now);
    const result = dueWords(db(boxTwo, laterBoxOne, earlierBoxOne, notDue, mastered), now);
    expect(result.map((w) => w.word)).toEqual(['AAAA', 'CCCC', 'BBBB']);
  });

  it('nextDueAt: earliest future due among learning words, null when none', () => {
    const soon = { ...newWordEntry('AAAA', '', 'none', now), dueAt: now + 1000 };
    const later = { ...newWordEntry('BBBB', '', 'none', now), dueAt: now + 5000 };
    expect(nextDueAt(db(soon, later), now)).toBe(now + 1000);
    expect(nextDueAt(db(), now)).toBeNull();
  });
});
```

- [ ] **Step 4: Run leitner tests, expect PASS**

Run: `npx vitest run src/lib/__tests__/leitner.test.ts`

- [ ] **Step 5: Update `src/lib/storage.ts`**

Replace the whole file:

```ts
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
 * isn't recoverable, so it maps to source 'none'. definitionUpdatedAt is backfilled to addedAt in
 * every case (best available approximation — the true last-update time isn't recoverable either).
 */
function migrateWordV1ToV2(w: Record<string, unknown>): Record<string, unknown> {
  const v1Source = w.definitionSource;
  const definitionSource: DefinitionSource = v1Source === 'api' ? 'free-dictionary' : 'none';
  const manuallyEdited = v1Source === 'manual';
  const addedAt = typeof w.addedAt === 'number' ? w.addedAt : 0;
  return { ...w, definitionSource, manuallyEdited, definitionUpdatedAt: addedAt };
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
    return { schemaVersion: SCHEMA_VERSION, words } as VocabDb;
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
```

- [ ] **Step 6: Rewrite `src/lib/__tests__/storage.test.ts`**

Replace the whole file:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CORRUPT_KEY, DB_KEY, LEGACY_KEY, exportDb, loadDb, mergeDb, parseBackup, saveDb,
} from '../storage';
import { SCHEMA_VERSION, emptyDb } from '../types';
import { knownWordEntry, newWordEntry } from '../leitner';

const NOW = 1_750_000_000_000;

beforeEach(() => localStorage.clear());

function sampleDb() {
  const db = emptyDb();
  db.words.AGARIC = newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', NOW);
  return db;
}

describe('loadDb', () => {
  it('returns an empty db on first run', () => {
    expect(loadDb(NOW)).toEqual({ db: emptyDb(), recoveredFromCorrupt: false, migratedLegacy: false });
  });

  it('round-trips through saveDb', () => {
    const db = sampleDb();
    expect(saveDb(db)).toBe(true);
    expect(loadDb(NOW).db).toEqual(db);
  });

  it('quarantines corrupt data instead of deleting it', () => {
    localStorage.setItem(DB_KEY, 'not json{');
    const r = loadDb(NOW);
    expect(r.recoveredFromCorrupt).toBe(true);
    expect(r.db).toEqual(emptyDb());
    expect(localStorage.getItem(CORRUPT_KEY)).toBe('not json{');
    expect(localStorage.getItem(DB_KEY)).toBeNull();
  });

  it('migrates the legacy draft-app key once', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({
      new: [{ word: 'AGARIC', definition: 'a mushroom', timestamp: 1 }],
      mastered: [{ word: 'TIARA', definition: 'a crown', timestamp: 2 }],
    }));
    const r = loadDb(NOW);
    expect(r.migratedLegacy).toBe(true);
    expect(r.db.words.AGARIC).toMatchObject({
      status: 'learning', box: 1, dueAt: NOW, definitionSource: 'free-dictionary',
    });
    expect(r.db.words.TIARA).toMatchObject({ status: 'mastered' });
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(loadDb(NOW).db.words.AGARIC).toBeDefined(); // persisted under the new key
  });

  it('does not throw when the quarantine write itself fails', () => {
    localStorage.setItem(DB_KEY, 'not json{');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const r = loadDb(NOW);
    spy.mockRestore();
    expect(r.recoveredFromCorrupt).toBe(true);
    expect(r.db).toEqual(emptyDb());
    expect(localStorage.getItem(DB_KEY)).toBe('not json{'); // original preserved
  });

  it('transparently migrates a v1 db on normal load, without quarantining it', () => {
    localStorage.setItem(DB_KEY, JSON.stringify({
      schemaVersion: 1,
      words: {
        AGARIC: {
          word: 'AGARIC', definition: 'a mushroom', definitionSource: 'api',
          status: 'learning', box: 1, dueAt: NOW, addedAt: NOW - 1000, lapses: 0,
        },
      },
    }));
    const r = loadDb(NOW);
    expect(r.recoveredFromCorrupt).toBe(false);
    expect(r.db.schemaVersion).toBe(2);
    expect(r.db.words.AGARIC).toMatchObject({
      definitionSource: 'free-dictionary', manuallyEdited: false, definitionUpdatedAt: NOW - 1000,
    });
  });
});

describe('saveDb', () => {
  it('reports quota failures instead of throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(saveDb(sampleDb())).toBe(false);
    spy.mockRestore();
  });
});

describe('parseBackup', () => {
  it('accepts its own export', () => {
    const db = sampleDb();
    expect(parseBackup(exportDb(db))).toEqual(db);
  });

  it.each([
    'not json{',
    '{"schemaVersion":99,"words":{}}',
    '{"schemaVersion":1}',
    '{"schemaVersion":1,"words":[]}',
    '{"schemaVersion":1,"words":{"A":{"word":"A","status":"nope"}}}',
  ])('rejects invalid input: %s', (text) => {
    expect(parseBackup(text)).toBeNull();
  });
});

describe('parseBackup v1 -> v2 migration', () => {
  const v1Word = (definitionSource: string, addedAt: number) => ({
    word: 'AGARIC', definition: 'a mushroom', definitionSource,
    status: 'learning', box: 1, dueAt: NOW, addedAt, lapses: 0,
  });

  it('maps a fetched (api) v1 word to free-dictionary, not manually edited', () => {
    const result = parseBackup(JSON.stringify({
      schemaVersion: 1, words: { AGARIC: v1Word('api', NOW - 5000) },
    }));
    expect(result?.schemaVersion).toBe(2);
    expect(result?.words.AGARIC).toMatchObject({
      definitionSource: 'free-dictionary', manuallyEdited: false, definitionUpdatedAt: NOW - 5000,
    });
  });

  it('maps a manually-edited v1 word to source none, manually edited', () => {
    const result = parseBackup(JSON.stringify({
      schemaVersion: 1, words: { AGARIC: v1Word('manual', NOW - 5000) },
    }));
    expect(result?.words.AGARIC).toMatchObject({
      definitionSource: 'none', manuallyEdited: true, definitionUpdatedAt: NOW - 5000,
    });
  });

  it('leaves a never-fetched v1 word as source none, not manually edited', () => {
    const result = parseBackup(JSON.stringify({
      schemaVersion: 1, words: { AGARIC: v1Word('none', NOW - 5000) },
    }));
    expect(result?.words.AGARIC).toMatchObject({
      definitionSource: 'none', manuallyEdited: false, definitionUpdatedAt: NOW - 5000,
    });
  });
});

describe('mergeDb', () => {
  it('adds unknown words and counts them', () => {
    const r = mergeDb(emptyDb(), sampleDb());
    expect(r.added).toBe(1);
    expect(r.existing).toBe(0);
    expect(r.merged.words.AGARIC).toBeDefined();
  });

  it('newer addedAt wins for words present in both', () => {
    const older = newWordEntry('AGARIC', 'old def', 'free-dictionary', NOW - 10);
    const newer = { ...newWordEntry('AGARIC', 'new def', 'free-dictionary', NOW), box: 2 as const };
    const r = mergeDb(
      { schemaVersion: SCHEMA_VERSION, words: { AGARIC: older } },
      { schemaVersion: SCHEMA_VERSION, words: { AGARIC: newer } },
    );
    expect(r.merged.words.AGARIC).toMatchObject({ definition: 'new def', box: 2 });
    expect(r.existing).toBe(1);
  });

  it('mastered on either side always wins', () => {
    const masteredOld = knownWordEntry('TIARA', 'a crown', 'free-dictionary', NOW - 10);
    const learningNew = newWordEntry('TIARA', 'a crown', 'free-dictionary', NOW);
    const r = mergeDb(
      { schemaVersion: SCHEMA_VERSION, words: { TIARA: masteredOld } },
      { schemaVersion: SCHEMA_VERSION, words: { TIARA: learningNew } },
    );
    expect(r.merged.words.TIARA.status).toBe('mastered');
  });

  it('forcing mastered on a learning winner also restores box 3', () => {
    const masteredOld = knownWordEntry('TIARA', 'a crown', 'free-dictionary', NOW - 10);
    const learningNew = newWordEntry('TIARA', 'a crown', 'free-dictionary', NOW);
    const r = mergeDb(
      { schemaVersion: SCHEMA_VERSION, words: { TIARA: masteredOld } },
      { schemaVersion: SCHEMA_VERSION, words: { TIARA: learningNew } },
    );
    expect(r.merged.words.TIARA).toMatchObject({ status: 'mastered', box: 3 });
  });
});
```

- [ ] **Step 7: Run storage tests, expect PASS**

Run: `npx vitest run src/lib/__tests__/storage.test.ts`

- [ ] **Step 8: Fix `src/lib/dictionary.ts`'s source literals**

Modify the import block at the top of the file (`src/lib/dictionary.ts:1-5`):

```ts
import { abortError } from './abortError';
import { fetchFreeDictionary } from './dictionaryProviders/freeDictionary';
import { fetchMerriamWebster } from './dictionaryProviders/merriamWebster';
import type { DefinitionAlternative } from './dictionaryProviders/types';
import { PLACEHOLDER_DEFINITION, type DefinitionSource } from './types';
```

Modify the `DefinitionResult` interface (`src/lib/dictionary.ts:9-13`):

```ts
export interface DefinitionResult {
  word: string;
  definition: string;
  source: DefinitionSource;
}
```

Modify `interface Attempt` (`src/lib/dictionary.ts:115`, was `{ definition: string; source: 'api' | 'none' }`):

```ts
interface Attempt { definition: string; source: DefinitionSource }
```

Modify `src/lib/dictionary.ts:132-145` (`fetchOne`) — replace both `source: 'api'` results:

```ts
async function fetchOne(word: string, signal: AbortSignal | undefined, retryMs: number): Promise<Attempt> {
  const mwKey = loadMwApiKey();
  if (mwKey) {
    const mwResult = await fetchWithRetry(() => fetchMerriamWebster(word, mwKey, signal), signal, retryMs);
    if (mwResult.status === 'ok') {
      const grouped = groupTopSensesByPartOfSpeech(mwResult.alternatives);
      if (grouped.length > 0) return { definition: formatGroupedDefinition(grouped), source: 'merriam-webster' };
    }
  }
  const freeResult = await fetchWithRetry(() => fetchFreeDictionary(word, signal), signal, retryMs);
  if (freeResult.status !== 'ok') return NOT_FOUND;
  const grouped = groupTopSensesByPartOfSpeech(freeResult.alternatives);
  return grouped.length > 0 ? { definition: formatGroupedDefinition(grouped), source: 'free-dictionary' } : NOT_FOUND;
}
```

- [ ] **Step 9: Fix `src/lib/__tests__/dictionary.test.ts`'s source-value expectations**

Modify these existing assertions (leave everything else in the file untouched):

`src/lib/__tests__/dictionary.test.ts:21` — free-dictionary success (no MW key configured in this test):
```ts
    expect(r).toEqual({ word: 'AGARIC', definition: '(noun) A fungus.', source: 'free-dictionary' });
```

`src/lib/__tests__/dictionary.test.ts:41` — retries once on 429, still free-dictionary:
```ts
    expect(r.source).toBe('free-dictionary');
```

`src/lib/__tests__/dictionary.test.ts:58` — network error recovers via free-dictionary:
```ts
    expect(rs[1].source).toBe('free-dictionary');
```

`src/lib/__tests__/dictionary.test.ts:194` (inside `'fetchDefinitions with a Merriam-Webster key configured'`, "uses Merriam-Webster when it has the word"):
```ts
    expect(r).toEqual({ word: 'TIARA', definition: '(noun) A crown.', source: 'merriam-webster' });
```

`src/lib/__tests__/dictionary.test.ts:208` ("falls back to dictionaryapi.dev when Merriam-Webster has no entry" — this is a fallback, so free-dictionary):
```ts
    expect(r).toEqual({ word: 'TIARA', definition: '(noun) A crown (free dictionary).', source: 'free-dictionary' });
```

`src/lib/__tests__/dictionary.test.ts:221` ("retries a rate-limited Merriam-Webster request before falling back" — both calls hit MW, the retry succeeds via MW itself, not a fallback):
```ts
    expect(r.source).toBe('merriam-webster');
```

(Lines 31, 48 already say `source: 'none'` / `.toBe('none')` — unchanged, that literal is still valid.)

- [ ] **Step 10: Run dictionary tests, expect PASS**

Run: `npx vitest run src/lib/__tests__/dictionary.test.ts`

- [ ] **Step 11: Fix `src/context/VocabProvider.tsx`'s `editDefinition`**

Modify `src/context/VocabProvider.tsx:77-82`:

```ts
    editDefinition: (word, definition) => {
      const trimmed = definition.trim();
      return updateWord(word, (w) => (trimmed
        ? { ...w, definition: trimmed, manuallyEdited: true, definitionUpdatedAt: Date.now() }
        : {
          ...w, definition: PLACEHOLDER_DEFINITION, definitionSource: 'none',
          manuallyEdited: false, definitionUpdatedAt: null,
        }));
    },
```

- [ ] **Step 12: Fix the remaining test files' `'api'` literals (mechanical — `'api'` → `'free-dictionary'` everywhere it appears as a `DefinitionSource`/`DefinitionResult.source` value)**

`src/screens/__tests__/WordsScreen.test.tsx` — replace every `newWordEntry(...'api'...)` / `knownWordEntry(...'api'...)` call's `'api'` argument with `'free-dictionary'` (13 occurrences: lines 26, 27, 38, 39, 48, 71, 84, 94, 119, 139, 149, 159, 170 — every `newWordEntry`/`knownWordEntry` call whose 3rd argument is `'api'`; leave the one at line 63 with `'none'` unchanged — that one isn't `'api'` and must stay as-is). Then fix the three behavioral assertions that used to check `definitionSource: 'manual'`:

`src/screens/__tests__/WordsScreen.test.tsx:56-59` (was checking `definitionSource: 'manual'`):
```ts
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({
    definition: 'a gilled fungus',
    manuallyEdited: true,
  });
```

`src/screens/__tests__/WordsScreen.test.tsx:77-80` (empty-save case — still resets source to `'none'`, now also asserts the new fields):
```ts
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({
    definition: PLACEHOLDER_DEFINITION,
    definitionSource: 'none',
    manuallyEdited: false,
  });
```

`src/screens/__tests__/WordsScreen.test.tsx:112-115` ("lets the user preview and swap in an alternate dictionary definition" — was checking `definitionSource: 'manual'`):
```ts
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({
    definition: '(noun) A gilled fungus, often edible.',
    manuallyEdited: true,
  });
```

`src/screens/__tests__/DataScreen.test.tsx` — replace every `'api'` argument to `newWordEntry(...)` with `'free-dictionary'` (10 occurrences: lines 29, 38, 54, 60, 71, 78, 88, 99, 109 inside `seed(...)` calls, plus line 42's `newWordEntry('TIARA', 'a crown', 'api', 2)` inside the `previews and applies a backup merge` test's inline `backup` object — no assertions reference the literal, purely mechanical).

`src/screens/__tests__/AddScreen.test.tsx` — 3 occurrences: line 18 and line 158 (`source: 'api' as const` inside the `vi.mock('../../lib/dictionary', ...)` implementation) become `source: 'free-dictionary' as const`; line 24 (`knownWordEntry('TIARA', 'a crown', 'api', 1)`) becomes `'free-dictionary'`.

`src/screens/__tests__/StudyScreen.test.tsx` — 9 occurrences, all `newWordEntry(..., 'api', ...)` seed calls (lines 17, 30, 40, 41, 55, 56, 66, 72, 88) become `'free-dictionary'` — purely mechanical, no assertions reference the literal.

- [ ] **Step 13: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck reports no errors.

- [ ] **Step 14: Commit**

```bash
git add src/lib/types.ts src/lib/leitner.ts src/lib/storage.ts src/lib/dictionary.ts \
  src/context/VocabProvider.tsx \
  src/lib/__tests__/leitner.test.ts src/lib/__tests__/storage.test.ts src/lib/__tests__/dictionary.test.ts \
  src/screens/__tests__/WordsScreen.test.tsx src/screens/__tests__/DataScreen.test.tsx \
  src/screens/__tests__/AddScreen.test.tsx src/screens/__tests__/StudyScreen.test.tsx
git commit -m "feat: extend VocabWord with provenance, manual-edit flag, and update timestamp

Narrows DefinitionSource to the specific provider that answered
('merriam-webster' | 'free-dictionary' | 'none'), adds manuallyEdited
and definitionUpdatedAt, bumps schemaVersion to 2, and migrates
existing v1 data transparently on load and import."
```

---

## Task 2: `dictionary.ts` — export `fetchSingleDefinition`

Additive only — no ripple effects on other files.

**Files:**
- Modify: `src/lib/dictionary.ts`
- Test: `src/lib/__tests__/dictionary.test.ts`

**Interfaces:**
- Consumes: `fetchOne(word, signal, retryMs): Promise<Attempt>` (private, defined in Task 1) — `PLACEHOLDER_DEFINITION` from `./types`.
- Produces: `fetchSingleDefinition(word: string, signal?: AbortSignal): Promise<DefinitionResult>` — used by Task 8's `DefinitionRefetch` component.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/__tests__/dictionary.test.ts` (new `describe` block, place after the `fetchDefinitions` describe block, before `fetchAlternateDefinitions`; add `fetchSingleDefinition` to the existing import list at the top of the file):

```ts
describe('fetchSingleDefinition', () => {
  it('fetches one word from the free dictionary when no key is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(entry('noun', 'A fungus.'))));
    const r = await fetchSingleDefinition('AGARIC');
    expect(r).toEqual({ word: 'AGARIC', definition: '(noun) A fungus.', source: 'free-dictionary' });
  });

  it('reports a miss as source none with the placeholder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(404)));
    const r = await fetchSingleDefinition('XYZZY');
    expect(r).toEqual({ word: 'XYZZY', definition: PLACEHOLDER_DEFINITION, source: 'none' });
  });

  it('uses Merriam-Webster first when a key is configured', async () => {
    saveMwApiKey('good-key');
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ fl: 'noun', shortdef: ['A crown.'] }])));
    const r = await fetchSingleDefinition('TIARA');
    expect(r).toEqual({ word: 'TIARA', definition: '(noun) A crown.', source: 'merriam-webster' });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/__tests__/dictionary.test.ts`
Expected: FAIL — `fetchSingleDefinition is not exported`

- [ ] **Step 3: Implement `fetchSingleDefinition`**

Modify `src/lib/dictionary.ts` — insert immediately after `fetchOne` (i.e. right before the existing `export async function fetchDefinitions` in the file from Task 1):

```ts
/** On-demand single-word fetch — same MW→fallback logic as the batch import path, but no
 * rate-limit gap or progress callback (used for the Words screen's "check for updated
 * definition" re-fetch, §8.4). */
export async function fetchSingleDefinition(word: string, signal?: AbortSignal): Promise<DefinitionResult> {
  const attempt = await fetchOne(word, signal, 2000);
  return { word, definition: attempt.definition, source: attempt.source };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/lib/__tests__/dictionary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dictionary.ts src/lib/__tests__/dictionary.test.ts
git commit -m "feat: export fetchSingleDefinition for on-demand single-word re-fetch"
```

---

## Task 3: `definitionDiff.ts` — sense-level diff module

New, pure, framework-free module.

**Files:**
- Create: `src/lib/definitionDiff.ts`
- Test: `src/lib/__tests__/definitionDiff.test.ts`

**Interfaces:**
- Produces: `type DiffEntry = { type: 'unchanged' | 'removed' | 'added'; text: string }`; `diffDefinitions(oldText: string, newText: string): DiffEntry[]` — used by Task 8's `DefinitionRefetch` component.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/definitionDiff.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diffDefinitions } from '../definitionDiff';

describe('diffDefinitions', () => {
  it('returns everything unchanged when the texts are identical', () => {
    const text = '(noun) A fungus.\n\n(verb) To forage.';
    expect(diffDefinitions(text, text)).toEqual([
      { type: 'unchanged', text: '(noun) A fungus.' },
      { type: 'unchanged', text: '(verb) To forage.' },
    ]);
  });

  it('marks a sense present only in the new text as added', () => {
    const result = diffDefinitions('(noun) A fungus.', '(noun) A fungus.\n\n(verb) To forage.');
    expect(result).toEqual([
      { type: 'unchanged', text: '(noun) A fungus.' },
      { type: 'added', text: '(verb) To forage.' },
    ]);
  });

  it('marks a sense present only in the old text as removed', () => {
    const result = diffDefinitions('(noun) A fungus.\n\n(verb) To forage.', '(noun) A fungus.');
    expect(result).toEqual([
      { type: 'unchanged', text: '(noun) A fungus.' },
      { type: 'removed', text: '(verb) To forage.' },
    ]);
  });

  it('diffs a fully replaced single-sense definition as removed then added', () => {
    const result = diffDefinitions('(noun) A fungus.', '(noun) A completely different meaning.');
    expect(result).toEqual([
      { type: 'removed', text: '(noun) A fungus.' },
      { type: 'added', text: '(noun) A completely different meaning.' },
    ]);
  });

  it('treats an empty old text as everything added', () => {
    expect(diffDefinitions('', '(noun) A fungus.')).toEqual([{ type: 'added', text: '(noun) A fungus.' }]);
  });

  it('treats an empty new text as everything removed', () => {
    expect(diffDefinitions('(noun) A fungus.', '')).toEqual([{ type: 'removed', text: '(noun) A fungus.' }]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/__tests__/definitionDiff.test.ts`
Expected: FAIL — cannot find module `../definitionDiff`

- [ ] **Step 3: Implement `definitionDiff.ts`**

Create `src/lib/definitionDiff.ts`:

```ts
export type DiffEntry =
  | { type: 'unchanged'; text: string }
  | { type: 'removed'; text: string }
  | { type: 'added'; text: string };

/**
 * Splits both texts into "\n\n"-separated senses (the shape dictionary.ts's sense grouping
 * already produces) and diffs the two sequences with an LCS backtrack, so a sense present in
 * both comes out 'unchanged' even when other senses around it were added or removed.
 */
export function diffDefinitions(oldText: string, newText: string): DiffEntry[] {
  const oldSenses = oldText.split('\n\n').filter(Boolean);
  const newSenses = newText.split('\n\n').filter(Boolean);
  return lcsDiff(oldSenses, newSenses);
}

function lcsDiff(a: string[], b: string[]): DiffEntry[] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const result: DiffEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: 'unchanged', text: a[i] });
      i++; j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      result.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < n) { result.push({ type: 'removed', text: a[i] }); i++; }
  while (j < m) { result.push({ type: 'added', text: b[j] }); j++; }
  return result;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/lib/__tests__/definitionDiff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/definitionDiff.ts src/lib/__tests__/definitionDiff.test.ts
git commit -m "feat: add sense-level diff module for definition re-fetch previews"
```

---

## Task 4: `format.ts` — `formatDate` helper

Additive, pure, no dependency on other tasks.

**Files:**
- Modify: `src/lib/format.ts`
- Test: `src/lib/__tests__/format.test.ts`

**Interfaces:**
- Produces: `formatDate(ms: number): string` — used by Task 6's WordsScreen provenance/date display.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/__tests__/format.test.ts` (append; keep the existing `formatUntil` import/test as-is, add `formatDate` to the import):

```ts
it('formats an epoch ms timestamp as "Mon D, YYYY"', () => {
  expect(formatDate(new Date(2026, 7, 24, 10, 30).getTime())).toBe('Aug 24, 2026');
});

it('does not zero-pad single-digit days', () => {
  expect(formatDate(new Date(2026, 0, 5).getTime())).toBe('Jan 5, 2026');
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/__tests__/format.test.ts`
Expected: FAIL — `formatDate is not exported`

- [ ] **Step 3: Implement `formatDate`**

Modify `src/lib/format.ts` — append:

```ts
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/lib/__tests__/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/__tests__/format.test.ts
git commit -m "feat: add formatDate for word added/updated timestamps"
```

---

## Task 5: Data screen — on-demand MW key test

Independent of the other UI tasks; only touches `DataScreen.tsx`.

**Files:**
- Modify: `src/screens/DataScreen.tsx`
- Test: `src/screens/__tests__/DataScreen.test.tsx`

**Interfaces:**
- Consumes: `validateMwApiKey(key, signal?): Promise<MwKeyValidation>`, `loadMwApiKey(): string | null`, `type MwKeyValidation = 'valid' | 'invalid' | 'network-error'` (all already exported from `src/lib/dictionary.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `src/screens/__tests__/DataScreen.test.tsx` (append; the file already `vi.mock`s `../../lib/dictionary` with `validateMwApiKey: vi.fn()`):

```ts
it('tests a saved key on demand and reports success', async () => {
  vi.mocked(validateMwApiKey).mockResolvedValueOnce('valid').mockResolvedValueOnce('valid');
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
  await openData();
  await userEvent.type(screen.getByPlaceholderText(/merriam-webster api key/i), 'good-key');
  await userEvent.click(screen.getByRole('button', { name: /save key/i }));
  await screen.findByText(/using merriam-webster/i);
  await userEvent.click(screen.getByRole('button', { name: /test key/i }));
  expect(await screen.findByText(/key works/i)).toBeInTheDocument();
});

it('reports an invalid key when testing an already-saved key', async () => {
  vi.mocked(validateMwApiKey).mockResolvedValueOnce('valid').mockResolvedValueOnce('invalid');
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
  await openData();
  await userEvent.type(screen.getByPlaceholderText(/merriam-webster api key/i), 'good-key');
  await userEvent.click(screen.getByRole('button', { name: /save key/i }));
  await screen.findByText(/using merriam-webster/i);
  await userEvent.click(screen.getByRole('button', { name: /test key/i }));
  expect(await screen.findByText(/couldn't verify that key/i)).toBeInTheDocument();
});

it('reports a network error when testing an already-saved key while offline', async () => {
  vi.mocked(validateMwApiKey).mockResolvedValueOnce('valid').mockResolvedValueOnce('network-error');
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
  await openData();
  await userEvent.type(screen.getByPlaceholderText(/merriam-webster api key/i), 'good-key');
  await userEvent.click(screen.getByRole('button', { name: /save key/i }));
  await screen.findByText(/using merriam-webster/i);
  await userEvent.click(screen.getByRole('button', { name: /test key/i }));
  expect(await screen.findByText(/couldn't reach merriam-webster/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/screens/__tests__/DataScreen.test.tsx`
Expected: FAIL — no "Test key" button exists yet

- [ ] **Step 3: Implement the Test key button**

Modify `src/screens/DataScreen.tsx:1-80` (the whole `DictionarySourceSection` function). Replace it with:

```tsx
import { useState, type ChangeEvent } from 'react';
import { useVocab } from '../context/VocabProvider';
import { useToast } from '../components/Toast';
import { exportDb, mergeDb, parseBackup } from '../lib/storage';
import type { VocabDb } from '../lib/types';
import {
  clearMwApiKey, loadMwApiKey, saveMwApiKey, validateMwApiKey, type MwKeyValidation,
} from '../lib/dictionary';

function DictionarySourceSection() {
  const [keyInput, setKeyInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<'invalid' | 'network-error' | false>(false);
  const [active, setActive] = useState(() => loadMwApiKey() !== null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MwKeyValidation | null>(null);

  const handleSave = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setChecking(true);
    setError(false);
    const result = await validateMwApiKey(trimmed);
    setChecking(false);
    if (result !== 'valid') {
      setError(result);
      return;
    }
    saveMwApiKey(trimmed);
    setKeyInput('');
    setActive(true);
    setTestResult(null);
  };

  const handleClear = () => {
    clearMwApiKey();
    setActive(false);
    setKeyInput('');
    setError(false);
    setTestResult(null);
  };

  const handleTest = async () => {
    const key = loadMwApiKey();
    if (!key) return;
    setTesting(true);
    setTestResult(null);
    const result = await validateMwApiKey(key);
    setTesting(false);
    setTestResult(result);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-bold text-slate-700">Dictionary source</h2>
      <p className="mb-3 text-xs text-slate-400">
        {active
          ? 'Using Merriam-Webster for new definitions.'
          : 'Using the free dictionary (default). Add a Merriam-Webster API key for definitions ordered by common usage.'}
      </p>
      {active ? (
        <div className="flex flex-col gap-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="w-full min-h-[44px] rounded-xl bg-slate-200 py-2 text-sm font-semibold disabled:opacity-40"
          >
            {testing ? 'Testing…' : 'Test key'}
          </button>
          <button
            onClick={handleClear}
            className="w-full min-h-[44px] rounded-xl bg-slate-200 py-2 text-sm font-semibold"
          >
            Remove key, use free dictionary
          </button>
          {testResult === 'valid' && (
            <p className="text-xs text-emerald-600">Key works — fetched a test entry successfully.</p>
          )}
          {testResult === 'invalid' && (
            <p className="text-xs text-red-500">Couldn't verify that key — check it and try again.</p>
          )}
          {testResult === 'network-error' && (
            <p className="text-xs text-red-500">
              Couldn't reach Merriam-Webster to verify that key — check your connection and try again.
            </p>
          )}
        </div>
      ) : (
        <>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Merriam-Webster API key"
            className="mb-2 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            onClick={handleSave}
            disabled={checking || !keyInput.trim()}
            className="w-full min-h-[44px] rounded-xl bg-amber-400 py-2 font-semibold disabled:opacity-40"
          >
            {checking ? 'Checking…' : 'Save key'}
          </button>
          {error === 'invalid' && (
            <p className="mt-2 text-xs text-red-500">Couldn't verify that key — check it and try again.</p>
          )}
          {error === 'network-error' && (
            <p className="mt-2 text-xs text-red-500">
              Couldn't reach Merriam-Webster to verify that key — check your connection and try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
```

(The rest of `DataScreen.tsx` — the default-exported `DataScreen` function and everything below it — is unchanged.)

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/screens/__tests__/DataScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/DataScreen.tsx src/screens/__tests__/DataScreen.test.tsx
git commit -m "feat: add on-demand Merriam-Webster key test button"
```

---

## Task 6: Words screen — provenance badges and added/updated dates

**Files:**
- Modify: `src/screens/WordsScreen.tsx`
- Test: `src/screens/__tests__/WordsScreen.test.tsx`

**Interfaces:**
- Consumes: `formatDate(ms: number): string` (Task 4); `VocabWord.definitionSource`/`manuallyEdited`/`addedAt`/`definitionUpdatedAt` (Task 1).
- Produces: `badgeFor(w: VocabWord): { dot: string; label: string } | null` (local helper, not exported — Task 7/8 don't need it).

- [ ] **Step 1: Write the failing tests**

Add to `src/screens/__tests__/WordsScreen.test.tsx` (append):

```ts
it('shows a source badge for a Merriam-Webster definition', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'merriam-webster', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  expect(screen.getByText('Merriam-Webster')).toBeInTheDocument();
});

it('shows a manual badge even when the last fetch came from a provider', async () => {
  seed({ ...newWordEntry('AGARIC', 'a hand-typed definition', 'free-dictionary', 1), manuallyEdited: true });
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  expect(screen.getByText('Manual')).toBeInTheDocument();
});

it('shows added and updated dates', async () => {
  const addedAt = new Date(2026, 0, 5).getTime();
  const updatedAt = new Date(2026, 0, 10).getTime();
  seed({ ...newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', addedAt), definitionUpdatedAt: updatedAt });
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  expect(screen.getByText(/Added Jan 5, 2026/)).toBeInTheDocument();
  expect(screen.getByText(/Updated Jan 10, 2026/)).toBeInTheDocument();
});

it('omits the updated date when a definition has never been fetched or edited', async () => {
  seed(newWordEntry('AGARIC', PLACEHOLDER_DEFINITION, 'none', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/screens/__tests__/WordsScreen.test.tsx`
Expected: FAIL — no badge/date text rendered yet

- [ ] **Step 3: Implement badges and dates**

Modify `src/screens/WordsScreen.tsx`. Add imports (top of file, alongside the existing ones):

```tsx
import { formatDate } from '../lib/format';
import type { VocabWord } from '../lib/types';
```

Add, above the `WordsScreen` component:

```tsx
const SOURCE_BADGE: Record<'merriam-webster' | 'free-dictionary', { dot: string; label: string }> = {
  'merriam-webster': { dot: 'bg-amber-400', label: 'Merriam-Webster' },
  'free-dictionary': { dot: 'bg-slate-400', label: 'Free dictionary' },
};

function badgeFor(w: VocabWord): { dot: string; label: string } | null {
  if (w.manuallyEdited) return { dot: 'bg-transparent', label: 'Manual' };
  if (w.definitionSource === 'none') return null;
  return SOURCE_BADGE[w.definitionSource];
}
```

In the `rows.map((w) => (...))` block, compute the badge and render it. Replace:

```tsx
        {rows.map((w) => (
          <li key={w.word} className="rounded-2xl border border-slate-200 bg-white">
            <button
              onClick={() => open(w.word)}
              className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2 text-left"
            >
              <span className="flex-1 font-semibold">{w.word}</span>
```

with:

```tsx
        {rows.map((w) => {
          const badge = badgeFor(w);
          return (
          <li key={w.word} className="rounded-2xl border border-slate-200 bg-white">
            <button
              onClick={() => open(w.word)}
              className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2 text-left"
            >
              {badge && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${badge.dot}`} />}
              <span className="flex-1 font-semibold">{w.word}</span>
```

And in the expanded-detail branch, replace:

```tsx
              <div className="flex flex-col gap-3 px-4 pb-4">
                {editing ? (
```

with:

```tsx
              <div className="flex flex-col gap-3 px-4 pb-4">
                {badge && <p className="text-xs font-semibold text-slate-500">{badge.label}</p>}
                <p className="text-xs text-slate-400">
                  Added {formatDate(w.addedAt)}
                  {w.definitionUpdatedAt !== null && ` · Updated ${formatDate(w.definitionUpdatedAt)}`}
                </p>
                {editing ? (
```

Finally, close the added arrow-function body: the `rows.map((w) => (...))` became `rows.map((w) => { const badge = ...; return (...); })`, so the closing of the `.map()` call changes from:

```tsx
          </li>
        ))}
      </ul>
```

to:

```tsx
          </li>
          );
        })}
      </ul>
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/screens/__tests__/WordsScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add src/screens/WordsScreen.tsx src/screens/__tests__/WordsScreen.test.tsx
git commit -m "feat: show definition source badge and added/updated dates per word"
```

---

## Task 7: Words screen — bulk re-fetch of missing definitions

**Files:**
- Modify: `src/lib/types.ts` (add `hasNoDefinition`)
- Modify: `src/context/VocabProvider.tsx` (add `applyFetchedDefinition`)
- Modify: `src/screens/WordsScreen.tsx`
- Test: `src/screens/__tests__/WordsScreen.test.tsx`

**Interfaces:**
- Produces: `hasNoDefinition(w: VocabWord): boolean` (`src/lib/types.ts`) — also used by Task 8 is not required, only Task 7.
- Produces: `applyFetchedDefinition(word: string, result: DefinitionResult): void` on `VocabContextValue` — reused by Task 8's adopt action.
- Consumes: `fetchDefinitions(words, opts): Promise<DefinitionResult[]>` (existing, unchanged signature).

- [ ] **Step 1: Add `hasNoDefinition` to `src/lib/types.ts`**

Modify `src/lib/types.ts` — append after `emptyDb`:

```ts
export function hasNoDefinition(w: VocabWord): boolean {
  return w.definition === PLACEHOLDER_DEFINITION;
}
```

- [ ] **Step 2: Add `applyFetchedDefinition` to `VocabProvider`**

Modify `src/context/VocabProvider.tsx` — add to the `VocabContextValue` interface (`src/context/VocabProvider.tsx:19-28`):

```ts
interface VocabContextValue {
  db: VocabDb;
  commitImport: (sel: ImportSelection) => void;
  gradeWord: (word: string, gotIt: boolean) => void;
  editDefinition: (word: string, definition: string) => void;
  applyFetchedDefinition: (word: string, result: DefinitionResult) => void;
  deleteWord: (word: string) => void;
  unmasterWord: (word: string) => void;
  importBackup: (incoming: VocabDb) => void;
  resetDb: () => void;
}
```

And add the implementation to the `value` object, right after `editDefinition`'s closing `},`:

```ts
    applyFetchedDefinition: (word, result) => {
      if (result.source === 'none') return; // still missing — leave the word untouched
      updateWord(word, (w) => ({
        ...w,
        definition: result.definition,
        definitionSource: result.source,
        manuallyEdited: false,
        definitionUpdatedAt: Date.now(),
      }));
    },
```

- [ ] **Step 3: Write the failing tests**

Add to `src/screens/__tests__/WordsScreen.test.tsx` (append; add `fetchDefinitions` availability isn't mocked in this file today, so these tests stub `global.fetch` directly like the existing alternate-definition tests do):

```ts
it('offers to fix missing definitions and reports success/failure counts', async () => {
  seed(
    newWordEntry('AGARIC', PLACEHOLDER_DEFINITION, 'none', 1),
    newWordEntry('TIARA', PLACEHOLDER_DEFINITION, 'none', 2),
    newWordEntry('NUANCE', 'already has one', 'free-dictionary', 3),
  );
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('agaric')) {
      return {
        ok: true, status: 200,
        json: async () => [{ meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }] }] }],
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /fix 2 missing definitions/i }));
  await userEvent.click(screen.getByRole('button', { name: /fetch 2 selected/i }));
  expect(await screen.findByRole('status')).toHaveTextContent('1 updated, 1 failed');
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC).toMatchObject({ definition: '(noun) A fungus.', definitionSource: 'free-dictionary' });
  expect(stored.words.TIARA).toMatchObject({ definitionSource: 'none' });
});

it('lets the user deselect a word before bulk-fetching', async () => {
  seed(
    newWordEntry('AGARIC', PLACEHOLDER_DEFINITION, 'none', 1),
    newWordEntry('TIARA', PLACEHOLDER_DEFINITION, 'none', 2),
  );
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /fix 2 missing definitions/i }));
  await userEvent.click(screen.getByRole('checkbox', { name: /tiara/i }));
  await userEvent.click(screen.getByRole('button', { name: /fetch 1 selected/i }));
  expect(await screen.findByRole('status')).toHaveTextContent('0 updated, 1 failed');
});

it('does not show the bulk-fix button when nothing is missing', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
  await openWords();
  expect(screen.queryByRole('button', { name: /fix.*missing definition/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run tests, verify they fail**

Run: `npx vitest run src/screens/__tests__/WordsScreen.test.tsx`
Expected: FAIL — no bulk-fix button exists yet

- [ ] **Step 5: Implement bulk-fetch mode**

Modify `src/screens/WordsScreen.tsx`. Add imports:

```tsx
import { useToast } from '../components/Toast';
import { fetchDefinitions } from '../lib/dictionary';
import { hasNoDefinition } from '../lib/types';
```

In the `WordsScreen` component, destructure `applyFetchedDefinition` and add `toast` + new state (alongside the existing `useState` calls):

```tsx
  const { db, deleteWord, unmasterWord, applyFetchedDefinition } = useVocab();
  const toast = useToast();
  // ...existing query/filter/expanded/editing/confirmingDelete state...
  const [bulkSelection, setBulkSelection] = useState<Set<string> | null>(null);
  const [bulkFetching, setBulkFetching] = useState<{ done: number; total: number } | null>(null);
```

Replace the existing `rows` computation (`const rows = Object.values(db.words)...`) with:

```tsx
  const allWords = Object.values(db.words);
  const missingWords = allWords.filter(hasNoDefinition);

  const rows = allWords
    .filter((w) => filter === 'all' || w.status === filter)
    .filter((w) => w.word.includes(query.trim().toUpperCase()))
    .sort((a, b) => a.word.localeCompare(b.word));
```

Add the bulk-mode handlers, right after the `open` function:

```tsx
  const startBulk = () => setBulkSelection(new Set(missingWords.map((w) => w.word)));

  const toggleBulk = (word: string) => {
    setBulkSelection((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(word)) next.delete(word); else next.add(word);
      return next;
    });
  };

  const runBulkFetch = async () => {
    if (!bulkSelection) return;
    const words = [...bulkSelection];
    setBulkFetching({ done: 0, total: words.length });
    const results = await fetchDefinitions(words, {
      onProgress: (done, total) => setBulkFetching({ done, total }),
    });
    for (const r of results) applyFetchedDefinition(r.word, r);
    const succeeded = results.filter((r) => r.source !== 'none').length;
    toast.show(`${succeeded} updated, ${results.length - succeeded} failed`);
    setBulkFetching(null);
    setBulkSelection(null);
  };
```

Add the bulk-mode early return, right before the component's main `return (`:

```tsx
  if (bulkSelection) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Fix missing definitions</h2>
        {bulkFetching ? (
          <p className="text-sm text-amber-600">
            Fetching definitions… {bulkFetching.done}/{bulkFetching.total}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {missingWords.map((w) => (
                <li
                  key={w.word}
                  className="flex min-h-[44px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4"
                >
                  <input
                    type="checkbox"
                    id={`bulk-${w.word}`}
                    checked={bulkSelection.has(w.word)}
                    onChange={() => toggleBulk(w.word)}
                    className="h-5 w-5 accent-amber-500"
                  />
                  <label htmlFor={`bulk-${w.word}`} className="flex min-h-[44px] flex-1 items-center font-semibold">
                    {w.word}
                  </label>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setBulkSelection(null)}
                className="min-h-[44px] rounded-xl bg-slate-200 py-3 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={runBulkFetch}
                disabled={bulkSelection.size === 0}
                className="min-h-[44px] rounded-xl bg-amber-400 py-3 font-semibold disabled:opacity-50"
              >
                Fetch {bulkSelection.size} selected
              </button>
            </div>
          </>
        )}
      </div>
    );
  }
```

Add the "Fix N missing definitions" button in the main view, right after the filter-chips `<div>` and before the `{rows.length === 0 && ...}` block:

```tsx
      {missingWords.length > 0 && (
        <button
          onClick={startBulk}
          className="min-h-[44px] rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-700"
        >
          Fix {missingWords.length} missing {missingWords.length === 1 ? 'definition' : 'definitions'}
        </button>
      )}
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `npx vitest run src/screens/__tests__/WordsScreen.test.tsx`
Expected: PASS

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all green

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/context/VocabProvider.tsx src/screens/WordsScreen.tsx \
  src/screens/__tests__/WordsScreen.test.tsx
git commit -m "feat: bulk re-fetch definitions for words that are still missing one"
```

---

## Task 8: Words screen — single-word re-fetch with diff and adopt/reject

**Files:**
- Create: `src/components/DefinitionRefetch.tsx`
- Modify: `src/screens/WordsScreen.tsx`
- Test: `src/screens/__tests__/WordsScreen.test.tsx`

**Interfaces:**
- Consumes: `fetchSingleDefinition(word, signal?): Promise<DefinitionResult>` (Task 2); `diffDefinitions(oldText, newText): DiffEntry[]` (Task 3); `applyFetchedDefinition(word, result): void` (Task 7, via `useVocab()`); `PLACEHOLDER_DEFINITION` (`src/lib/types.ts`).
- Produces: `DefinitionRefetch` component, `{ word: string; current: string }` props — rendered inside `WordsScreen.tsx`'s expanded, non-editing branch.

- [ ] **Step 1: Write the failing tests**

Add to `src/screens/__tests__/WordsScreen.test.tsx` (append):

```ts
it('reports up to date when a re-fetch matches the current definition', async () => {
  seed(newWordEntry('AGARIC', '(noun) A fungus.', 'free-dictionary', 1));
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => [{ meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }] }] }],
  })));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /check for updated definition/i }));
  expect(await screen.findByText(/already up to date/i)).toBeInTheDocument();
});

it('reports nothing found when a re-fetch comes back empty', async () => {
  seed(newWordEntry('AGARIC', '(noun) A fungus.', 'free-dictionary', 1));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /check for updated definition/i }));
  expect(await screen.findByText(/no definition found — nothing changed/i)).toBeInTheDocument();
});

it('shows a diff and lets the user adopt the fetched definition', async () => {
  seed(newWordEntry('AGARIC', '(noun) A fungus.', 'free-dictionary', 1));
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => [{
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A gilled fungus, often edible.' }] }],
    }],
  })));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /check for updated definition/i }));
  await screen.findByText('(noun) A gilled fungus, often edible.');
  await userEvent.click(screen.getByRole('button', { name: /^adopt new$/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({
    definition: '(noun) A gilled fungus, often edible.',
    definitionSource: 'free-dictionary',
    manuallyEdited: false,
  });
});

it('discards the fetched definition when the user keeps the current one', async () => {
  seed(newWordEntry('AGARIC', '(noun) A fungus.', 'free-dictionary', 1));
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => [{ meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A different meaning.' }] }] }],
  })));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /check for updated definition/i }));
  await screen.findByText('(noun) A different meaning.');
  await userEvent.click(screen.getByRole('button', { name: /keep current/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({ definition: '(noun) A fungus.' });
  expect(screen.getByRole('button', { name: /check for updated definition/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/screens/__tests__/WordsScreen.test.tsx`
Expected: FAIL — no "Check for updated definition" button exists yet

- [ ] **Step 3: Create `DefinitionRefetch`**

Create `src/components/DefinitionRefetch.tsx`:

```tsx
import { useState } from 'react';
import { useVocab } from '../context/VocabProvider';
import { fetchSingleDefinition } from '../lib/dictionary';
import { diffDefinitions, type DiffEntry } from '../lib/definitionDiff';
import { PLACEHOLDER_DEFINITION } from '../lib/types';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'up-to-date' }
  | { status: 'not-found' }
  | { status: 'diff'; definition: string; source: 'merriam-webster' | 'free-dictionary' };

export function DefinitionRefetch({ word, current }: { word: string; current: string }) {
  const { applyFetchedDefinition } = useVocab();
  const [state, setState] = useState<State>({ status: 'idle' });

  const check = async () => {
    setState({ status: 'loading' });
    const r = await fetchSingleDefinition(word);
    if (r.source === 'none') {
      setState({ status: 'not-found' });
      return;
    }
    if (r.definition === current) {
      setState({ status: 'up-to-date' });
      return;
    }
    setState({ status: 'diff', definition: r.definition, source: r.source });
  };

  const adopt = () => {
    if (state.status !== 'diff') return;
    applyFetchedDefinition(word, { word, definition: state.definition, source: state.source });
    setState({ status: 'idle' });
  };

  if (state.status === 'idle') {
    return (
      <button
        type="button"
        onClick={check}
        className="min-h-[44px] rounded-xl bg-slate-200 px-3 py-2 text-xs font-semibold"
      >
        Check for updated definition
      </button>
    );
  }
  if (state.status === 'loading') {
    return <p className="text-xs text-slate-400">Checking…</p>;
  }
  if (state.status === 'up-to-date') {
    return <p className="text-xs text-slate-400">Already up to date.</p>;
  }
  if (state.status === 'not-found') {
    return <p className="text-xs text-slate-400">No definition found — nothing changed.</p>;
  }

  const diff: DiffEntry[] = diffDefinitions(current === PLACEHOLDER_DEFINITION ? '' : current, state.definition);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
      <ul className="flex flex-col gap-1 text-xs">
        {diff.map((entry, i) => (
          <li
            key={i}
            className={
              entry.type === 'removed'
                ? 'rounded bg-red-50 px-1 text-red-700 line-through'
                : entry.type === 'added'
                  ? 'rounded bg-emerald-50 px-1 text-emerald-700'
                  : 'text-slate-600'
            }
          >
            {entry.text}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setState({ status: 'idle' })}
          className="min-h-[44px] flex-1 rounded-xl bg-slate-200 py-2 text-xs font-semibold"
        >
          Keep current
        </button>
        <button
          type="button"
          onClick={adopt}
          className="min-h-[44px] flex-1 rounded-xl bg-amber-400 py-2 text-xs font-semibold"
        >
          Adopt new
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `WordsScreen.tsx`**

Modify `src/screens/WordsScreen.tsx` — add the import:

```tsx
import { DefinitionRefetch } from '../components/DefinitionRefetch';
```

In the expanded, non-editing branch, add the component right before the action-buttons `<div className="flex flex-wrap gap-2">`. Replace:

```tsx
                {!editing && (
                  <div className="flex flex-wrap gap-2">
```

with:

```tsx
                {!editing && (
                  <>
                    <DefinitionRefetch word={w.word} current={w.definition} />
                    <div className="flex flex-wrap gap-2">
```

...and close the added fragment where that `<div>` currently closes (`src/screens/WordsScreen.tsx:115-116`, immediately after the Delete/Really-delete conditional block). Currently:

```tsx
                  </div>
                )}
```

becomes:

```tsx
                  </div>
                  </>
                )}
```

(i.e. one extra closing `</>` right before the `)}` that ends the `{!editing && (...)}` block — `</div>` stays at its original indentation since it's still the innermost close.)

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run src/screens/__tests__/WordsScreen.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add src/components/DefinitionRefetch.tsx src/screens/WordsScreen.tsx \
  src/screens/__tests__/WordsScreen.test.tsx
git commit -m "feat: single-word re-fetch with sense-level diff and adopt/reject"
```

---

## Final verification

- [ ] **Run the full suite once more from a clean state**

```bash
npm test && npm run typecheck
```

Expected: all tests PASS, no type errors.

- [ ] **Manual smoke check** (per the spec's existing manual checklist, §11): start the dev server (`npm run dev`), open the Data tab and confirm the Test key button appears once a key is saved, open the Words tab and confirm badges/dates render, trigger a bulk fix and a single re-fetch+diff against a real word.
