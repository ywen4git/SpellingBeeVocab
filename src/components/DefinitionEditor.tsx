import { useState } from 'react';
import { useVocab } from '../context/VocabProvider';
import { fetchAlternateDefinitions, formatDefinition, type DefinitionAlternative } from '../lib/dictionary';

type Alternatives =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; options: DefinitionAlternative[] };

export function DefinitionEditor({
  word, initial, onDone,
}: { word: string; initial: string; onDone: () => void }) {
  const { editDefinition } = useVocab();
  const [text, setText] = useState(initial);
  const [alternatives, setAlternatives] = useState<Alternatives>({ status: 'idle' });

  const loadAlternatives = async () => {
    setAlternatives({ status: 'loading' });
    try {
      const options = await fetchAlternateDefinitions(word);
      setAlternatives(options.length > 0 ? { status: 'loaded', options } : { status: 'error' });
    } catch {
      setAlternatives({ status: 'error' });
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        aria-label={`Definition for ${word}`}
        className="w-full rounded-xl border border-slate-300 p-2 text-sm"
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <a
          href={`https://www.google.com/search?q=${encodeURIComponent(`define ${word}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-amber-700 underline underline-offset-2"
        >
          Look up on Google ↗
        </a>
        <button
          type="button"
          onClick={loadAlternatives}
          disabled={alternatives.status === 'loading'}
          className="font-semibold text-amber-700 underline underline-offset-2 disabled:opacity-50"
        >
          {alternatives.status === 'loading' ? 'Checking dictionary…' : 'See other dictionary definitions'}
        </button>
      </div>

      {alternatives.status === 'error' && (
        <p className="text-xs text-slate-400">No other definitions found.</p>
      )}

      {alternatives.status === 'loaded' && (
        <ul className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2">
          {alternatives.options
            .filter((alt) => formatDefinition(alt) !== text.trim())
            .map((alt) => {
              const formatted = formatDefinition(alt);
              return (
                <li key={formatted} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setText(formatted)}
                    className="min-h-[32px] shrink-0 rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700"
                  >
                    Use
                  </button>
                  <span className="pt-1.5 text-xs text-slate-600">{formatted}</span>
                </li>
              );
            })}
        </ul>
      )}

      <div className="flex gap-2">
        <button onClick={onDone} className="min-h-[44px] flex-1 rounded-xl bg-slate-200 py-2 text-sm font-semibold">
          Cancel
        </button>
        <button
          onClick={() => { editDefinition(word, text.trim()); onDone(); }}
          className="min-h-[44px] flex-1 rounded-xl bg-amber-400 py-2 text-sm font-semibold"
        >
          Save
        </button>
      </div>
    </div>
  );
}
