import { useState } from 'react';
import { useVocab } from '../context/VocabProvider';

export function DefinitionEditor({
  word, initial, onDone,
}: { word: string; initial: string; onDone: () => void }) {
  const { editDefinition } = useVocab();
  const [text, setText] = useState(initial);
  return (
    <div className="flex w-full flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        aria-label={`Definition for ${word}`}
        className="w-full rounded-xl border border-slate-300 p-2 text-sm"
      />
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
