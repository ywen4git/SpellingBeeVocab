import { useState } from 'react';
import { useVocab } from '../context/VocabProvider';
import { DefinitionEditor } from '../components/DefinitionEditor';
import { formatDate } from '../lib/format';
import type { VocabWord } from '../lib/types';

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
  const { db, deleteWord, unmasterWord } = useVocab();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const open = (word: string) => {
    setExpanded(expanded === word ? null : word);
    setEditing(false);
    setConfirmingDelete(false);
  };

  const rows = Object.values(db.words)
    .filter((w) => filter === 'all' || w.status === filter)
    .filter((w) => w.word.includes(query.trim().toUpperCase()))
    .sort((a, b) => a.word.localeCompare(b.word));

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
