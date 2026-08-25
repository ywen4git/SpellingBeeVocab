import { useState } from 'react';
import { useVocab } from '../context/VocabProvider';
import { DefinitionEditor } from '../components/DefinitionEditor';
import { formatDate } from '../lib/format';
import type { VocabWord } from '../lib/types';
import { useToast } from '../components/Toast';
import { fetchDefinitions } from '../lib/dictionary';
import { hasNoDefinition } from '../lib/types';

type Filter = 'all' | 'learning' | 'mastered';

const SOURCE_BADGE: Record<'merriam-webster' | 'free-dictionary', { dot: string; label: string }> = {
  'merriam-webster': { dot: 'bg-amber-400', label: 'Merriam-Webster' },
  'free-dictionary': { dot: 'bg-slate-400', label: 'Free dictionary' },
};

function badgeFor(w: VocabWord): { dot: string; label: string } | null {
  if (w.manuallyEdited) return { dot: 'bg-transparent', label: 'Manual' };
  if (w.definitionSource === 'none') return null;
  return SOURCE_BADGE[w.definitionSource];
}

export default function WordsScreen() {
  const { db, deleteWord, unmasterWord, applyFetchedDefinition } = useVocab();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [bulkSelection, setBulkSelection] = useState<Set<string> | null>(null);
  const [bulkFetching, setBulkFetching] = useState<{ done: number; total: number } | null>(null);

  const open = (word: string) => {
    setExpanded(expanded === word ? null : word);
    setEditing(false);
    setConfirmingDelete(false);
  };

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

  const allWords = Object.values(db.words);
  const missingWords = allWords.filter(hasNoDefinition);

  const rows = allWords
    .filter((w) => filter === 'all' || w.status === filter)
    .filter((w) => w.word.includes(query.trim().toUpperCase()))
    .sort((a, b) => a.word.localeCompare(b.word));

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

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Words</h2>
      <input
        type="search"
        aria-label="Search words"
        placeholder="Search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        {(['all', 'learning', 'mastered'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`min-h-[44px] rounded-full px-3 py-1 text-xs font-semibold capitalize ${
              filter === f ? 'bg-amber-400 text-slate-900' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {missingWords.length > 0 && (
        <button
          onClick={startBulk}
          className="min-h-[44px] rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-700"
        >
          Fix {missingWords.length} missing {missingWords.length === 1 ? 'definition' : 'definitions'}
        </button>
      )}

      {rows.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-400">No words here yet.</p>
      )}

      <ul className="flex flex-col gap-2">
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
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  w.status === 'mastered'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {w.status === 'mastered' ? 'Mastered' : `Box ${w.box}`}
              </span>
            </button>
            {expanded !== w.word ? (
              <p className="truncate px-4 pb-3 text-xs text-slate-400">{w.definition}</p>
            ) : (
              <div className="flex flex-col gap-3 px-4 pb-4">
                {badge && <p className="text-xs font-semibold text-slate-500">{badge.label}</p>}
                <p className="text-xs text-slate-400">
                  Added {formatDate(w.addedAt)}
                  {w.definitionUpdatedAt !== null && ` · Updated ${formatDate(w.definitionUpdatedAt)}`}
                </p>
                {editing ? (
                  <DefinitionEditor word={w.word} initial={w.definition} onDone={() => setEditing(false)} />
                ) : (
                  <p className="whitespace-pre-line text-sm text-slate-700">{w.definition}</p>
                )}
                <p className="text-xs text-slate-400">{w.lapses} lapses</p>
                {!editing && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setEditing(true)}
                      className="min-h-[44px] rounded-xl bg-slate-200 px-3 py-2 text-xs font-semibold"
                    >
                      Edit definition
                    </button>
                    {w.status === 'mastered' && (
                      <button
                        onClick={() => unmasterWord(w.word)}
                        className="min-h-[44px] rounded-xl bg-slate-200 px-3 py-2 text-xs font-semibold"
                      >
                        Unmaster
                      </button>
                    )}
                    {confirmingDelete ? (
                      <button
                        onClick={() => deleteWord(w.word)}
                        className="min-h-[44px] rounded-xl bg-red-500 px-3 py-2 text-xs font-semibold text-white"
                      >
                        Really delete?
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfirmingDelete(true)}
                        className="min-h-[44px] rounded-xl bg-red-100 px-3 py-2 text-xs font-semibold text-red-700"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}
