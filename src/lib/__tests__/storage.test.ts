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
      definitionSource: 'none', manuallyEdited: false, definitionUpdatedAt: null,
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
