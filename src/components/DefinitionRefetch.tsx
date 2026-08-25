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
