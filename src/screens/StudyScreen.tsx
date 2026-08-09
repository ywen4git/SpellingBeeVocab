import { useState } from 'react';
import { useVocab } from '../context/VocabProvider';
import { dueWords, nextDueAt } from '../lib/leitner';
import { formatUntil } from '../lib/format';
import { DefinitionEditor } from '../components/DefinitionEditor';

export default function StudyScreen() {
  const { db, gradeWord } = useVocab();
  const [now, setNow] = useState(() => Date.now());
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  // Session-only: defers a card to the back of today's queue without touching its box/dueAt, so
  // skipping never costs a review or counts as a lapse. Not persisted — leaving Study resets it.
  const [skipped, setSkipped] = useState<string[]>([]);

  const due = dueWords(db, now);
  const dueWordSet = new Set(due.map((w) => w.word));
  const deferred = skipped.filter((word) => dueWordSet.has(word));
  const queue = [...due.filter((w) => !deferred.includes(w.word)), ...deferred.map((word) => db.words[word])];
  const current = queue[0];
  const all = Object.values(db.words);
  const learning = all.filter((w) => w.status === 'learning').length;
  const mastered = all.length - learning;

  const grade = (gotIt: boolean) => {
    gradeWord(current.word, gotIt);
    setSkipped((prev) => prev.filter((w) => w !== current.word));
    setFlipped(false);
    setEditing(false);
    setNow(Date.now());
  };

  const skip = () => {
    setSkipped((prev) => [...prev.filter((w) => w !== current.word), current.word]);
    setFlipped(false);
    setEditing(false);
  };

  if (!current) {
    const next = nextDueAt(db, now);
    return (
      <div className="rounded-3xl border border-slate-100 bg-white p-8 text-center">
        <span className="text-4xl" aria-hidden>🎉</span>
        <h2 className="mt-2 text-lg font-bold">All caught up!</h2>
        <p className="mt-1 text-sm text-slate-500">
          {next
            ? `Next review ${formatUntil(next - now)}.`
            : 'Upload a screenshot on the Add tab to start learning.'}
        </p>
        <p className="mt-4 text-xs text-slate-400">{learning} learning · {mastered} mastered</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-sm text-slate-500">
        {due.length} due · {learning} learning · {mastered} mastered
      </p>

      <div
        onClick={() => { if (!editing) setFlipped(!flipped); }}
        className="flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm"
      >
        <span className="mb-3 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
          Box {current.box}
        </span>
        {!flipped ? (
          <>
            <h2 className="text-3xl font-black tracking-wide text-slate-900">{current.word}</h2>
            <p className="mt-4 text-xs font-medium uppercase tracking-wider text-slate-400">Tap to reveal</p>
          </>
        ) : editing ? (
          <DefinitionEditor word={current.word} initial={current.definition} onDone={() => setEditing(false)} />
        ) : (
          <>
            <p className="whitespace-pre-line text-base font-medium leading-relaxed text-slate-700">{current.definition}</p>
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className="mt-4 min-h-[44px] text-xs font-semibold text-amber-600"
            >
              Edit definition
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <button onClick={() => grade(false)} className="min-h-[44px] rounded-xl bg-slate-200 py-3 font-semibold text-slate-700">
          ❌ Missed
        </button>
        <button
          onClick={skip}
          disabled={due.length <= 1}
          className="min-h-[44px] rounded-xl border border-slate-300 bg-white py-3 font-semibold text-slate-500 disabled:opacity-50"
        >
          ⏭️ Skip
        </button>
        <button onClick={() => grade(true)} className="min-h-[44px] rounded-xl bg-amber-400 py-3 font-semibold text-slate-950 shadow-sm">
          ✅ Got it
        </button>
      </div>
    </div>
  );
}
