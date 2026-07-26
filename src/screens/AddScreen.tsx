import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useVocab } from '../context/VocabProvider';
import { useToast } from '../components/Toast';
import { parseCandidates, type ParseResult } from '../lib/parser';
import { recognizeImage, terminateOcr, type OcrProgress } from '../lib/ocr';
import { fetchDefinitions, type DefinitionResult } from '../lib/dictionary';
import type { VocabWord } from '../lib/types';

interface CandidateRow { word: string; checked: boolean; know: boolean }
interface KnownRow { word: string; reset: boolean; current: VocabWord }

type ReviewPhase = {
  name: 'review';
  candidates: CandidateRow[];
  known: KnownRow[];
  filteredCount: number;
  hive: ParseResult['hive'];
};

type Phase =
  | { name: 'upload' }
  | { name: 'ocr'; progress: OcrProgress }
  | ReviewPhase
  | { name: 'fetching'; done: number; total: number };

export default function AddScreen() {
  const { db, commitImport } = useVocab();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ name: 'upload' });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    void terminateOcr();
    abortRef.current?.abort();
  }, []);

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setPhase({ name: 'ocr', progress: { label: 'Loading OCR engine…', progress: 0 } });
    try {
      // Multiple screenshots (e.g. a long answer list split across several pages) are treated as one
      // combined page: only the first typically has the puzzle-letters row, later ones just contribute
      // more answer words, and parseCandidates finds the hive by cross-checking against all of them at
      // once — the more real words it has to validate against, the more reliable that detection is.
      const texts: string[] = [];
      const boostedTexts: string[] = [];
      const hiveTexts: string[] = [];
      for (const [i, file] of files.entries()) {
        const result = await recognizeImage(file, (progress) => {
          const label = files.length > 1 ? `${progress.label} (screenshot ${i + 1} of ${files.length})` : progress.label;
          setPhase({ name: 'ocr', progress: { label, progress: (i + progress.progress) / files.length } });
        });
        texts.push(result.text);
        boostedTexts.push(result.boostedText);
        hiveTexts.push(result.hiveText);
      }
      const parsed = parseCandidates(
        texts.join('\n'),
        new Set(Object.keys(db.words)),
        boostedTexts.join('\n'),
        hiveTexts.join('\n'),
      );
      setPhase({
        name: 'review',
        candidates: parsed.candidates.map((word) => ({ word, checked: true, know: false })),
        known: parsed.alreadyKnown.map((word) => ({ word, reset: false, current: db.words[word] })),
        filteredCount: parsed.filteredUi.length + parsed.filteredInvalidLetters.length,
        hive: parsed.hive,
      });
    } catch {
      toast.show('Could not read that image — try again with a clearer screenshot.');
      setPhase({ name: 'upload' });
    }
  };

  const handleCommit = async (review: ReviewPhase) => {
    const learnWords = review.candidates.filter((c) => c.checked && !c.know).map((c) => c.word);
    const knowWords = review.candidates.filter((c) => c.checked && c.know).map((c) => c.word);
    const resets = review.known.filter((k) => k.reset).map((k) => k.word);
    const toFetch = [...learnWords, ...knowWords];

    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ name: 'fetching', done: 0, total: toFetch.length });
    let results: DefinitionResult[];
    try {
      results = await fetchDefinitions(toFetch, {
        signal: controller.signal,
        onProgress: (done, total) => setPhase({ name: 'fetching', done, total }),
      });
    } catch {
      setPhase(review); // cancelled — nothing committed, selections kept
      return;
    }

    const byWord = new Map(results.map((r) => [r.word, r]));
    const learn = learnWords.map((w) => byWord.get(w)!);
    const known = knowWords.map((w) => byWord.get(w)!);
    commitImport({ learn, known, resets });

    const missing = results.filter((r) => r.source === 'none').length;
    const parts = [
      learn.length > 0 && `${learn.length} added to learning`,
      known.length > 0 && `${known.length} marked known`,
      resets.length > 0 && `${resets.length} reset to learning`,
      missing > 0 && `${missing} without definitions`,
    ].filter(Boolean);
    toast.show(parts.join(', '));
    setPhase({ name: 'upload' });
  };

  if (phase.name === 'upload') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <label htmlFor="shot" className="mb-2 block text-sm font-semibold text-slate-700">
          Upload solution screenshot(s)
        </label>
        <input
          id="shot"
          type="file"
          accept="image/png,image/jpeg"
          multiple
          onChange={handleFiles}
          className="min-h-[44px] file:min-h-[44px] w-full text-sm text-slate-500 file:mr-4 file:rounded-xl file:border-0 file:bg-amber-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-amber-700"
        />
        <p className="mt-2 text-xs text-slate-400">
          Works best with the NYT app's "Yesterday's Answers" page. If the list didn't fit on one screen,
          select all the screenshots together and they'll be combined.
        </p>
      </div>
    );
  }

  if (phase.name === 'ocr') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm font-medium text-amber-600">{phase.progress.label}</p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded bg-slate-100">
          <div
            className="h-full bg-amber-400 transition-all"
            style={{ width: `${Math.round(phase.progress.progress * 100)}%` }}
          />
        </div>
      </div>
    );
  }

  if (phase.name === 'fetching') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm font-medium text-amber-600">
          Fetching definitions… {phase.done}/{phase.total}
        </p>
        <button
          onClick={() => abortRef.current?.abort()}
          className="mt-4 min-h-[44px] rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold"
        >
          Cancel
        </button>
      </div>
    );
  }

  const selectedCount =
    phase.candidates.filter((c) => c.checked).length +
    phase.known.filter((k) => k.reset).length;
  const setCandidate = (word: string, patch: Partial<CandidateRow>) =>
    setPhase({
      ...phase,
      candidates: phase.candidates.map((c) => (c.word === word ? { ...c, ...patch } : c)),
    });
  const setKnown = (word: string, reset: boolean) =>
    setPhase({
      ...phase,
      known: phase.known.map((k) => (k.word === word ? { ...k, reset } : k)),
    });

  return (
    <div className="flex flex-col gap-4">
      {phase.hive ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Puzzle letters detected</p>
          <p className="mt-1 text-xl font-black tracking-widest text-slate-700">
            {phase.hive.letters.map((l, i) => (
              <span key={l} className={l === phase.hive!.center ? 'text-amber-500' : undefined}>
                {l}
                {i < phase.hive!.letters.length - 1 ? ' ' : ''}
              </span>
            ))}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            New candidates below use only these letters, always including {phase.hive.center}.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-center text-xs text-red-600">
          Couldn't detect the puzzle's 7 letters — new candidates aren't letter-checked, so review them carefully.
        </div>
      )}

      <p className="text-sm text-slate-500">
        {phase.candidates.length} new · {phase.known.length} already in collection · {phase.filteredCount} filtered out
      </p>

      {phase.candidates.length === 0 && phase.known.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          Couldn't find words — try a tighter crop of the answers list.
          <button
            onClick={() => setPhase({ name: 'upload' })}
            className="mt-4 block w-full min-h-[44px] rounded-xl bg-amber-400 py-2 font-semibold"
          >
            Try another screenshot
          </button>
        </div>
      ) : (
        <>
          {phase.candidates.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-bold text-slate-700">New candidates</h2>
              <ul>
                {phase.candidates.map((c) => (
                  <li key={c.word} className="flex min-h-[44px] items-center gap-3">
                    <input
                      type="checkbox"
                      id={`cand-${c.word}`}
                      checked={c.checked}
                      onChange={(e) => setCandidate(c.word, { checked: e.target.checked })}
                      className="h-5 w-5 accent-amber-500"
                    />
                    <label htmlFor={`cand-${c.word}`} className="flex min-h-[44px] flex-1 items-center font-semibold">
                      {c.word}
                    </label>
                    {c.checked && (
                      <button
                        onClick={() => setCandidate(c.word, { know: !c.know })}
                        aria-label={`${c.word}: ${c.know ? 'already know' : 'learn'}`}
                        className={`min-h-[44px] rounded-full px-3 py-1 text-xs font-semibold ${
                          c.know ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {c.know ? 'Know' : 'Learn'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {phase.known.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="mb-1 text-sm font-bold text-slate-700">Already in your collection</h2>
              <p className="mb-2 text-xs text-slate-400">Check a word to reset it to learning (Box 1).</p>
              <ul>
                {phase.known.map((k) => (
                  <li key={k.word} className="flex min-h-[44px] items-center gap-3">
                    <input
                      type="checkbox"
                      id={`known-${k.word}`}
                      checked={k.reset}
                      onChange={(e) => setKnown(k.word, e.target.checked)}
                      className="h-5 w-5 accent-amber-500"
                    />
                    <label htmlFor={`known-${k.word}`} className="flex min-h-[44px] flex-1 items-center gap-1">
                      <span className="font-semibold">{k.word}</span>{' '}
                      <span className="text-xs text-slate-400">
                        {k.current.status === 'mastered' ? 'mastered' : `Box ${k.current.box}`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setPhase({ name: 'upload' })}
              className="min-h-[44px] rounded-xl bg-slate-200 py-3 font-semibold"
            >
              Start over
            </button>
            <button
              onClick={() => handleCommit(phase)}
              disabled={selectedCount === 0}
              className="min-h-[44px] rounded-xl bg-amber-400 py-3 font-semibold disabled:opacity-50"
            >
              Add {selectedCount} {selectedCount === 1 ? 'word' : 'words'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
