import { useState, type ChangeEvent } from 'react';
import { useVocab } from '../context/VocabProvider';
import { useToast } from '../components/Toast';
import { exportDb, mergeDb, parseBackup } from '../lib/storage';
import type { VocabDb } from '../lib/types';
import { clearMwApiKey, loadMwApiKey, saveMwApiKey, validateMwApiKey } from '../lib/dictionary';

function DictionarySourceSection() {
  const [keyInput, setKeyInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<'invalid' | 'network-error' | false>(false);
  const [active, setActive] = useState(() => loadMwApiKey() !== null);

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
  };

  const handleClear = () => {
    clearMwApiKey();
    setActive(false);
    setKeyInput('');
    setError(false);
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
        <button
          onClick={handleClear}
          className="w-full min-h-[44px] rounded-xl bg-slate-200 py-2 text-sm font-semibold"
        >
          Remove key, use free dictionary
        </button>
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

export default function DataScreen() {
  const { db, importBackup, resetDb } = useVocab();
  const toast = useToast();
  const [preview, setPreview] = useState<{ incoming: VocabDb; added: number; existing: number } | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const all = Object.values(db.words);
  const learning = all.filter((w) => w.status === 'learning');
  const perBox = (b: number) => learning.filter((w) => w.box === b).length;
  const lapses = all.reduce((n, w) => n + w.lapses, 0);

  const handleExport = () => {
    const blob = new Blob([exportDb(db)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beevocab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      toast.show('Not a valid BeeVocab backup file.');
      return;
    }
    const incoming = parseBackup(text);
    if (!incoming) {
      toast.show('Not a valid BeeVocab backup file.');
      return;
    }
    const { added, existing } = mergeDb(db, incoming);
    setPreview({ incoming, added, existing });
  };

  const applyImport = () => {
    if (!preview) return;
    importBackup(preview.incoming);
    toast.show(`Imported: ${preview.added} new, ${preview.existing} merged.`);
    setPreview(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold text-slate-700">Stats</h2>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><p className="text-xl font-black text-amber-500">{learning.length}</p><p className="text-[10px] font-bold uppercase text-slate-400">Learning</p></div>
          <div><p className="text-xl font-black text-emerald-500">{all.length - learning.length}</p><p className="text-[10px] font-bold uppercase text-slate-400">Mastered</p></div>
          <div><p className="text-xl font-black text-slate-500">{lapses}</p><p className="text-[10px] font-bold uppercase text-slate-400">Lapses</p></div>
        </div>
        <p className="mt-3 text-center text-xs text-slate-400">
          Box 1: {perBox(1)} · Box 2: {perBox(2)} · Box 3: {perBox(3)}
        </p>
      </section>

      <DictionarySourceSection />

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-bold text-slate-700">Backup</h2>
        <p className="mb-3 text-xs text-slate-400">
          The backup file contains your full progress. Import it on a new device to resume exactly where you left off.
        </p>
        <button
          onClick={handleExport}
          className="mb-3 w-full min-h-[44px] rounded-xl bg-amber-400 py-2 font-semibold"
        >
          Export backup
        </button>
        <label htmlFor="import" className="mb-1 block text-xs font-semibold text-slate-600">
          Import backup
        </label>
        <input
          id="import"
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          className="min-h-[44px] file:min-h-[44px] w-full text-sm text-slate-500 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-semibold"
        />
        {preview && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
            <p>
              {(() => {
                const count = Object.keys(preview.incoming.words).length;
                return `Backup contains ${count} ${count === 1 ? 'word' : 'words'}; ${preview.added} new, ${preview.existing} already present.`;
              })()}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setPreview(null)}
                className="min-h-[44px] flex-1 rounded-xl bg-slate-200 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={applyImport}
                className="min-h-[44px] flex-1 rounded-xl bg-amber-400 py-2 text-sm font-semibold"
              >
                Confirm import
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-red-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-bold text-red-700">Danger zone</h2>
        <label htmlFor="reset-confirm" className="mb-1 block text-xs text-slate-500">
          Type DELETE to confirm
        </label>
        <input
          id="reset-confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mb-2 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          disabled={confirmText !== 'DELETE'}
          onClick={() => {
            resetDb();
            setConfirmText('');
            toast.show('All data deleted.');
          }}
          className="w-full min-h-[44px] rounded-xl bg-red-500 py-2 font-semibold text-white disabled:opacity-40"
        >
          Reset everything
        </button>
      </section>

      <p className="text-center text-[10px] text-slate-300">
        Build {__COMMIT_SHA__} · {__BUILD_TIME__.slice(0, 10)}
      </p>
    </div>
  );
}
