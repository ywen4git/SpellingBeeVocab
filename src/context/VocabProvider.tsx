import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import type { VocabDb, VocabWord } from '../lib/types';
import { emptyDb, PLACEHOLDER_DEFINITION } from '../lib/types';
import {
  gradeGotIt, gradeMissed, knownWordEntry, newWordEntry, resetToLearning, unmaster,
} from '../lib/leitner';
import { loadDb, mergeDb, saveDb } from '../lib/storage';
import type { DefinitionResult } from '../lib/dictionary';
import { useToast } from '../components/Toast';

export interface ImportSelection {
  learn: DefinitionResult[];
  known: DefinitionResult[];
  resets: string[];
}

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

const VocabContext = createContext<VocabContextValue | null>(null);

export function VocabProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [initial] = useState(() => loadDb(Date.now()));
  const [db, setDb] = useState(initial.db);
  const storageFailed = useRef(false);

  useEffect(() => {
    if (initial.recoveredFromCorrupt) {
      toast.show('Stored data was unreadable — saved a copy and started fresh.');
    } else if (initial.migratedLegacy) {
      toast.show('Imported your words from the previous app version.');
    }
  }, [initial, toast]);

  useEffect(() => {
    const ok = saveDb(db);
    if (!ok && !storageFailed.current) {
      storageFailed.current = true;
      toast.show('Storage is full — export a backup from the Data tab.');
    }
    if (ok) storageFailed.current = false;
  }, [db, toast]);

  const updateWord = useCallback((word: string, fn: (w: VocabWord) => VocabWord) => {
    setDb((prev) => {
      const cur = prev.words[word];
      if (!cur) return prev;
      return { ...prev, words: { ...prev.words, [word]: fn(cur) } };
    });
  }, []);

  const value = useMemo<VocabContextValue>(() => ({
    db,
    commitImport: ({ learn, known, resets }) => {
      const now = Date.now();
      setDb((prev) => {
        const words = { ...prev.words };
        for (const r of learn) words[r.word] = newWordEntry(r.word, r.definition, r.source, now);
        for (const r of known) words[r.word] = knownWordEntry(r.word, r.definition, r.source, now);
        for (const w of resets) if (words[w]) words[w] = resetToLearning(words[w], now);
        return { ...prev, words };
      });
    },
    gradeWord: (word, gotIt) =>
      updateWord(word, (w) => (gotIt ? gradeGotIt(w, Date.now()) : gradeMissed(w, Date.now()))),
    editDefinition: (word, definition) => {
      const trimmed = definition.trim();
      return updateWord(word, (w) => (trimmed
        ? { ...w, definition: trimmed, manuallyEdited: true, definitionUpdatedAt: Date.now() }
        : {
          ...w, definition: PLACEHOLDER_DEFINITION, definitionSource: 'none',
          manuallyEdited: false, definitionUpdatedAt: null,
        }));
    },
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
    deleteWord: (word) =>
      setDb((prev) => {
        const words = { ...prev.words };
        delete words[word];
        return { ...prev, words };
      }),
    unmasterWord: (word) => updateWord(word, (w) => unmaster(w, Date.now())),
    importBackup: (incoming) => setDb((prev) => mergeDb(prev, incoming).merged),
    resetDb: () => setDb(emptyDb()),
  }), [db, updateWord]);

  return <VocabContext.Provider value={value}>{children}</VocabContext.Provider>;
}

export function useVocab(): VocabContextValue {
  const ctx = useContext(VocabContext);
  if (!ctx) throw new Error('useVocab must be used inside VocabProvider');
  return ctx;
}
