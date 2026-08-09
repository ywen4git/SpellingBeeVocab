# Definition Lookup Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which specific words failed definition lookup, store/render up to 3 senses (one per part of speech) as paragraphs instead of a single flat sentence, and add an opt-in Merriam-Webster dictionary source behind a provider-adapter seam.

**Architecture:** `src/lib/dictionary.ts` becomes an orchestrator over two provider modules (`src/lib/dictionaryProviders/freeDictionary.ts`, the existing dictionaryapi.dev logic moved as-is, and `src/lib/dictionaryProviders/merriamWebster.ts`, new) that both normalize their raw API response into the same `DefinitionAlternative[]` shape. The orchestrator groups up to 3 distinct-part-of-speech senses, joins them with `"\n\n"`, and — when a Merriam-Webster key is configured (stored client-side only, `localStorage`, never in the `VocabDb` backup blob) — tries MW first per word, falling back to dictionaryapi.dev on a miss. Separately, `Toast` gains an optional collapsed word-list detail, and `WordsScreen`/`StudyScreen` render definitions with `whitespace-pre-line` so the `"\n\n"` group separators show as paragraphs.

**Tech Stack:** React 18 + TypeScript, Vitest + React Testing Library, no new dependencies.

## Global Constraints

- `lib/*` never imports React or touches `window`/`localStorage` except where it already does (`storage.ts`); the new `dictionary.ts` MW-key functions are a deliberate, spec-approved exception, matching `storage.ts`'s existing use of `localStorage`.
- All mutations to `VocabDb` go through `VocabProvider` actions — this plan touches no `VocabDb` fields, so no `VocabProvider` changes are needed.
- Minimum touch target 44px on all interactive elements (existing Tailwind convention: `min-h-[44px]`).
- No `alert()`/`confirm()` — use the shared `Toast` component and inline confirm patterns.
- The Merriam-Webster API key must never be written into the `VocabDb` envelope or appear in `exportDb`'s output.
- Existing public import paths must keep working: `import { fetchDefinitions, fetchAlternateDefinitions, formatDefinition, type DefinitionAlternative } from '../lib/dictionary'` (used by `DefinitionEditor.tsx`, `AddScreen.tsx`, and existing tests) must resolve unchanged after the refactor.

---

### Task 1: Toast — optional collapsed failure detail

**Files:**
- Modify: `src/components/Toast.tsx`
- Test: `src/components/__tests__/Toast.test.tsx` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ToastContextValue.show(message: string, options?: { detail?: string[] }): void` — used by Task 2 (`AddScreen.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/Toast.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { ToastProvider, useToast } from '../Toast';

function Trigger({ message, detail }: { message: string; detail?: string[] }) {
  const toast = useToast();
  useEffect(() => { toast.show(message, detail ? { detail } : undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function renderToast(message: string, detail?: string[]) {
  render(
    <ToastProvider>
      <Trigger message={message} detail={detail} />
    </ToastProvider>,
  );
}

it('shows a plain message with no detail affordance', async () => {
  renderToast('Saved.');
  expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
  expect(screen.queryByRole('button', { name: /show/i })).not.toBeInTheDocument();
});

it('collapses detail behind a Show toggle, then expands it on click', async () => {
  renderToast('3 without definitions', ['AGARIC', 'TIARA', 'NAIAD']);
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('3 without definitions');
  expect(screen.queryByText('AGARIC')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /show/i }));
  expect(screen.getByText('AGARIC')).toBeInTheDocument();
  expect(screen.getByText('TIARA')).toBeInTheDocument();
  expect(screen.getByText('NAIAD')).toBeInTheDocument();
});

it('a toast with detail is dismissed only by the close button, not a timer', async () => {
  vi.useFakeTimers();
  renderToast('3 without definitions', ['AGARIC']);
  expect(await screen.findByRole('status')).toBeInTheDocument();
  vi.advanceTimersByTime(10_000);
  expect(screen.getByRole('status')).toBeInTheDocument();
  await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
    screen.getByRole('button', { name: /dismiss/i }),
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  vi.useRealTimers();
});

it('a plain toast still auto-dismisses after 4s', async () => {
  vi.useFakeTimers();
  renderToast('Saved.');
  expect(await screen.findByRole('status')).toBeInTheDocument();
  vi.advanceTimersByTime(4001);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  vi.useRealTimers();
});
```

Add `import { vi } from 'vitest';` at the top alongside the RTL imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/__tests__/Toast.test.tsx`
Expected: FAIL — `show` doesn't accept a second argument yet, no "Show"/"Dismiss" buttons exist.

- [ ] **Step 3: Implement**

Replace the full contents of `src/components/Toast.tsx`:

```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastOptions {
  detail?: string[];
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; detail?: string[] } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback((message: string, options?: ToastOptions) => {
    window.clearTimeout(timer.current);
    setExpanded(false);
    setToast({ message, detail: options?.detail });
    const hasDetail = (options?.detail?.length ?? 0) > 0;
    if (!hasDetail) {
      timer.current = window.setTimeout(() => setToast(null), 4000);
    }
  }, []);

  const hasDetail = (toast?.detail?.length ?? 0) > 0;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          <div className="flex items-center gap-2">
            <span>{toast.message}</span>
            {hasDetail && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="shrink-0 font-semibold underline underline-offset-2"
              >
                Show
              </button>
            )}
            {hasDetail && (
              <button
                type="button"
                onClick={close}
                aria-label="Dismiss"
                className="ml-auto shrink-0 text-slate-400"
              >
                ×
              </button>
            )}
          </div>
          {expanded && toast.detail && (
            <div className="mt-2 flex flex-wrap gap-1">
              {toast.detail.map((word) => (
                <span key={word} className="rounded-lg bg-slate-800 px-2 py-0.5 text-xs">
                  {word}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/__tests__/Toast.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS — every existing `toast.show('some message')` call site still compiles (single-argument calls are unaffected since `options` is optional).

- [ ] **Step 6: Commit**

```bash
git add src/components/Toast.tsx src/components/__tests__/Toast.test.tsx
git commit -m "feat: let Toast carry collapsed detail that suspends auto-dismiss"
```

---

### Task 2: AddScreen — surface failed words in the import toast

**Files:**
- Modify: `src/screens/AddScreen.tsx:120-133`
- Test: `src/screens/__tests__/AddScreen.test.tsx`

**Interfaces:**
- Consumes: `toast.show(message, { detail })` from Task 1.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test**

Add to `src/screens/__tests__/AddScreen.test.tsx` (reuses the existing `uploadShot`/`seedTiaraMastered` helpers already in that file; override the module-level `fetchDefinitions` mock for this one test with `vi.mocked`):

```tsx
import { fetchDefinitions } from '../../lib/dictionary';

it('shows which specific words failed definition lookup', async () => {
  vi.mocked(fetchDefinitions).mockImplementationOnce(async (words: string[]) =>
    words.map((word) => (
      word === 'AGARIC'
        ? { word, definition: 'No definition found — tap to edit.', source: 'none' as const }
        : { word, definition: `def of ${word}`, source: 'api' as const }
    )));
  seedTiaraMastered();
  await uploadShot();
  await userEvent.click(screen.getByRole('checkbox', { name: 'NAIAD' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /TIARA/ }));
  await userEvent.click(screen.getByRole('button', { name: /add 2 words/i }));
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('1 without definitions');
  await userEvent.click(screen.getByRole('button', { name: /show/i }));
  expect(screen.getByText('AGARIC')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/__tests__/AddScreen.test.tsx -t "shows which specific words failed"`
Expected: FAIL — no "Show" button appears (toast currently gets only a plain string).

- [ ] **Step 3: Implement**

In `src/screens/AddScreen.tsx`, find the commit handler (around line 120-133):

```ts
    const missing = results.filter((r) => r.source === 'none').length;
    const parts = [
      learn.length > 0 && `${learn.length} added to learning`,
      known.length > 0 && `${known.length} marked known`,
      resets.length > 0 && `${resets.length} reset to learning`,
      missing > 0 && `${missing} without definitions`,
    ].filter(Boolean);
    toast.show(parts.join(', '));
```

Replace with:

```ts
    const missingWords = results.filter((r) => r.source === 'none').map((r) => r.word);
    const parts = [
      learn.length > 0 && `${learn.length} added to learning`,
      known.length > 0 && `${known.length} marked known`,
      resets.length > 0 && `${resets.length} reset to learning`,
      missingWords.length > 0 && `${missingWords.length} without definitions`,
    ].filter(Boolean);
    toast.show(parts.join(', '), missingWords.length > 0 ? { detail: missingWords } : undefined);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/screens/__tests__/AddScreen.test.tsx`
Expected: PASS — all AddScreen tests, including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/screens/AddScreen.tsx src/screens/__tests__/AddScreen.test.tsx
git commit -m "feat: show which specific words failed definition lookup"
```

---

### Task 3: Render multi-paragraph definitions

**Files:**
- Modify: `src/screens/WordsScreen.tsx:81`
- Modify: `src/screens/StudyScreen.tsx:77`
- Test: `src/screens/__tests__/WordsScreen.test.tsx`, `src/screens/__tests__/StudyScreen.test.tsx`

**Interfaces:**
- Consumes: nothing new (works on whatever `\n\n`-joined string ends up in `VocabWord.definition` — Task 6 is what starts producing one from a real fetch, but this task is independently testable by seeding a word with a `\n\n` definition directly).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

Add to `src/screens/__tests__/WordsScreen.test.tsx`, using the file's existing `seed`/`openWords` helpers (same pattern as the neighboring `'edits a definition from the list'` test):

```tsx
it('renders a multi-sense definition as separate paragraphs', async () => {
  seed(newWordEntry('AGARIC', '(noun) A fungus.\n\n(verb) To forage for fungus.', 'api', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  const definition = screen.getByText(/A fungus\./);
  expect(definition).toHaveClass('whitespace-pre-line');
  expect(definition).toHaveTextContent('(noun) A fungus.');
  expect(definition).toHaveTextContent('(verb) To forage for fungus.');
});
```

Add the equivalent to `src/screens/__tests__/StudyScreen.test.tsx`, flipping the card the same way the file's existing `'flips the card and "Got it" advances the session'` test does (click the word's heading):

```tsx
it('renders a multi-sense definition as separate paragraphs', async () => {
  seed(newWordEntry('AGARIC', '(noun) A fungus.\n\n(verb) To forage for fungus.', 'api', Date.now() - 1000));
  render(<App />);
  await userEvent.click(screen.getByRole('heading', { name: 'AGARIC' }));
  const definition = screen.getByText(/A fungus\./);
  expect(definition).toHaveClass('whitespace-pre-line');
  expect(definition).toHaveTextContent('(verb) To forage for fungus.');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/screens/__tests__/WordsScreen.test.tsx src/screens/__tests__/StudyScreen.test.tsx -t "multi-sense"`
Expected: FAIL — `toHaveClass('whitespace-pre-line')` fails, class isn't present yet.

- [ ] **Step 3: Implement**

In `src/screens/WordsScreen.tsx:81`, change:

```tsx
                  <p className="text-sm text-slate-700">{w.definition}</p>
```
to:
```tsx
                  <p className="whitespace-pre-line text-sm text-slate-700">{w.definition}</p>
```

In `src/screens/StudyScreen.tsx:77`, change:

```tsx
            <p className="text-base font-medium leading-relaxed text-slate-700">{current.definition}</p>
```
to:
```tsx
            <p className="whitespace-pre-line text-base font-medium leading-relaxed text-slate-700">{current.definition}</p>
```

Leave `WordsScreen.tsx:75` (the `truncate` collapsed-list preview) untouched — truncation on a multi-paragraph string is expected to just show the first line, cut off.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/screens/__tests__/WordsScreen.test.tsx src/screens/__tests__/StudyScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/WordsScreen.tsx src/screens/StudyScreen.tsx src/screens/__tests__/WordsScreen.test.tsx src/screens/__tests__/StudyScreen.test.tsx
git commit -m "feat: render multi-sense definitions as separate paragraphs"
```

---

### Task 4: Extract abort-error helpers to a shared module

**Files:**
- Create: `src/lib/abortError.ts`
- Modify: `src/lib/dictionary.ts:18-30` (remove the two functions, import them instead)
- Test: `src/lib/__tests__/abortError.test.ts` (new)

**Interfaces:**
- Produces: `abortError(): DOMException`, `isAbortError(err: unknown): boolean` — consumed by Task 5 (`freeDictionary.ts`), Task 7 (`merriamWebster.ts`), and `dictionary.ts` itself.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/abortError.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { abortError, isAbortError } from '../abortError';

describe('isAbortError', () => {
  it('recognizes a DOMException named AbortError', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
  });

  it('recognizes an Error named AbortError (jsdom fetch abort shape)', () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });

  it('rejects other errors', () => {
    expect(isAbortError(new TypeError('offline'))).toBe(false);
    expect(isAbortError('not an error')).toBe(false);
  });
});

describe('abortError', () => {
  it('produces a DOMException named AbortError', () => {
    const err = abortError();
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe('AbortError');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/abortError.test.ts`
Expected: FAIL — `../abortError` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/lib/abortError.ts`:

```ts
export function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/**
 * A real `fetch()` abort throws a DOMException named "AbortError" — which extends Error in actual
 * browsers, but NOT under jsdom (Node's test environment), so `err instanceof Error` alone is an
 * environment-dependent check that silently fails in tests. Checking DOMException too makes this
 * correct regardless of which runtime threw it.
 */
export function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError';
}
```

In `src/lib/dictionary.ts`, delete the existing `abortError`/`isAbortError` functions (lines 18-30) and add near the top:

```ts
import { abortError, isAbortError } from './abortError';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/abortError.test.ts src/lib/__tests__/dictionary.test.ts`
Expected: PASS — `dictionary.test.ts` is unaffected since `dictionary.ts`'s public behavior didn't change, only where the helpers live.

- [ ] **Step 5: Commit**

```bash
git add src/lib/abortError.ts src/lib/dictionary.ts src/lib/__tests__/abortError.test.ts
git commit -m "refactor: extract abort-error helpers into their own module"
```

---

### Task 5: Extract the dictionaryapi.dev provider

**Files:**
- Create: `src/lib/dictionaryProviders/types.ts`
- Create: `src/lib/dictionaryProviders/freeDictionary.ts`
- Modify: `src/lib/dictionary.ts` (use the extracted provider; behavior unchanged)
- Test: `src/lib/dictionaryProviders/__tests__/freeDictionary.test.ts` (new)

**Interfaces:**
- Produces (`types.ts`): `DefinitionAlternative { partOfSpeech: string; definition: string }`, `ProviderResult = { status: 'ok'; alternatives: DefinitionAlternative[] } | { status: 'not-found' } | { status: 'rate-limited' } | { status: 'error' }`.
- Produces (`freeDictionary.ts`): `parseFreeDictionaryAlternatives(data: unknown): DefinitionAlternative[]`, `fetchFreeDictionary(word: string, signal?: AbortSignal): Promise<ProviderResult>`.
- Consumed by: Task 6 (grouping in the orchestrator), Task 8 (fallback chain).

- [ ] **Step 1: Write the failing test**

Create `src/lib/dictionaryProviders/__tests__/freeDictionary.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFreeDictionary, parseFreeDictionaryAlternatives } from '../freeDictionary';

const entry = (pos: string, def: string) =>
  [{ meanings: [{ partOfSpeech: pos, definitions: [{ definition: def }] }] }];
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) });

afterEach(() => vi.unstubAllGlobals());

describe('parseFreeDictionaryAlternatives', () => {
  it('flattens every meaning across every entry', () => {
    const data = [
      { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }, { definition: 'A basket.' }] }] },
      { meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Fungal in nature.' }] }] },
    ];
    expect(parseFreeDictionaryAlternatives(data)).toEqual([
      { partOfSpeech: 'noun', definition: 'A fungus.' },
      { partOfSpeech: 'noun', definition: 'A basket.' },
      { partOfSpeech: 'adjective', definition: 'Fungal in nature.' },
    ]);
  });

  it('drops exact duplicate part-of-speech/definition pairs', () => {
    const data = [
      { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }] }] },
      { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }] }] },
    ];
    expect(parseFreeDictionaryAlternatives(data)).toEqual([{ partOfSpeech: 'noun', definition: 'A fungus.' }]);
  });

  it('returns an empty list for non-array data', () => {
    expect(parseFreeDictionaryAlternatives({})).toEqual([]);
  });
});

describe('fetchFreeDictionary', () => {
  it('fetches and normalizes a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(entry('noun', 'A fungus.'))));
    const result = await fetchFreeDictionary('AGARIC');
    expect(result).toEqual({ status: 'ok', alternatives: [{ partOfSpeech: 'noun', definition: 'A fungus.' }] });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.dictionaryapi.dev/api/v2/entries/en/agaric',
      expect.anything(),
    );
  });

  it('maps a 404 to not-found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(404)));
    expect(await fetchFreeDictionary('XYZZY')).toEqual({ status: 'not-found' });
  });

  it('maps a 429 to rate-limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(429)));
    expect(await fetchFreeDictionary('TIARA')).toEqual({ status: 'rate-limited' });
  });

  it('maps a network error to error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await fetchFreeDictionary('AGARIC')).toEqual({ status: 'error' });
  });

  it('rethrows AbortError instead of swallowing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }));
    await expect(fetchFreeDictionary('AGARIC')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/dictionaryProviders/__tests__/freeDictionary.test.ts`
Expected: FAIL — `../freeDictionary` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/lib/dictionaryProviders/types.ts`:

```ts
export interface DefinitionAlternative {
  partOfSpeech: string;
  definition: string;
}

export type ProviderResult =
  | { status: 'ok'; alternatives: DefinitionAlternative[] }
  | { status: 'not-found' }
  | { status: 'rate-limited' }
  | { status: 'error' };
```

Create `src/lib/dictionaryProviders/freeDictionary.ts`:

```ts
import { isAbortError } from '../abortError';
import type { DefinitionAlternative, ProviderResult } from './types';

const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

type RawEntry = { meanings?: Array<{ partOfSpeech?: unknown; definitions?: Array<{ definition?: unknown }> }> };

/**
 * dictionaryapi.dev (a Wiktionary wrapper) returns every meaning it has for a word, not just the
 * common one — order reflects the source data's own structure (sometimes historical, sometimes by
 * part of speech), not frequency of use. This flattens every entry/meaning/definition so callers can
 * group or offer alternatives instead of silently discarding them.
 */
export function parseFreeDictionaryAlternatives(data: unknown): DefinitionAlternative[] {
  if (!Array.isArray(data)) return [];
  const out: DefinitionAlternative[] = [];
  const seen = new Set<string>();
  for (const entry of data as RawEntry[]) {
    for (const meaning of entry?.meanings ?? []) {
      const partOfSpeech = typeof meaning.partOfSpeech === 'string' ? meaning.partOfSpeech : '';
      for (const d of meaning.definitions ?? []) {
        const definition = d?.definition;
        if (typeof definition !== 'string' || definition.length === 0) continue;
        const key = `${partOfSpeech} ${definition}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ partOfSpeech, definition });
      }
    }
  }
  return out;
}

export async function fetchFreeDictionary(word: string, signal?: AbortSignal): Promise<ProviderResult> {
  try {
    const res = await fetch(API + word.toLowerCase(), { signal });
    if (res.status === 429) return { status: 'rate-limited' };
    if (!res.ok) return { status: 'not-found' };
    const alternatives = parseFreeDictionaryAlternatives(await res.json());
    return alternatives.length > 0 ? { status: 'ok', alternatives } : { status: 'not-found' };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { status: 'error' };
  }
}
```

Now update `src/lib/dictionary.ts`. Remove `parseAlternatives`, `formatDefinition`... *(keep `formatDefinition` — it stays in `dictionary.ts`, only the parsing/fetching moves)*, `extractDefinition`, the free-dictionary `fetchOne`, and the `API` constant; replace with the extracted provider. The full new contents of `dictionary.ts` (this is the intermediate state — Task 6 adds grouping on top of this, Task 8 adds the MW branch):

```ts
import { abortError, isAbortError } from './abortError';
import { fetchFreeDictionary } from './dictionaryProviders/freeDictionary';
import type { DefinitionAlternative } from './dictionaryProviders/types';
import { PLACEHOLDER_DEFINITION } from './types';

export type { DefinitionAlternative };

export interface DefinitionResult {
  word: string;
  definition: string;
  source: 'api' | 'none';
}

export interface FetchOptions {
  signal?: AbortSignal;
  gapMs?: number;
  retryMs?: number;
  onProgress?: (done: number, total: number) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

/** Formats an alternative the same way fetchDefinitions() formats its chosen definition. */
export function formatDefinition(alt: DefinitionAlternative): string {
  return alt.partOfSpeech ? `(${alt.partOfSpeech}) ${alt.definition}` : alt.definition;
}

/**
 * Fetches every meaning available for a single word, for a user to browse and pick from when the
 * definition fetchDefinitions() picked turns out to be the wrong sense. Unlike fetchDefinitions(),
 * this is meant to be called on demand from the definition editor — no retry/backoff, a failure just
 * yields no alternatives.
 */
export async function fetchAlternateDefinitions(
  word: string,
  signal?: AbortSignal,
): Promise<DefinitionAlternative[]> {
  const result = await fetchFreeDictionary(word, signal);
  return result.status === 'ok' ? result.alternatives : [];
}

interface Attempt { definition: string; source: 'api' | 'none' }

const NOT_FOUND: Attempt = { definition: PLACEHOLDER_DEFINITION, source: 'none' };

async function fetchOne(word: string, signal: AbortSignal | undefined, retryMs: number): Promise<Attempt> {
  let result = await fetchFreeDictionary(word, signal);
  if (result.status === 'rate-limited') {
    await sleep(retryMs, signal);
    result = await fetchFreeDictionary(word, signal);
  }
  if (result.status !== 'ok') return NOT_FOUND;
  const [first] = result.alternatives;
  return first ? { definition: formatDefinition(first), source: 'api' } : NOT_FOUND;
}

export async function fetchDefinitions(
  words: string[],
  opts: FetchOptions = {},
): Promise<DefinitionResult[]> {
  const { signal, gapMs = 300, retryMs = 2000, onProgress } = opts;
  const results: DefinitionResult[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i > 0) await sleep(gapMs, signal);
    const attempt = await fetchOne(words[i], signal, retryMs);
    results.push({ word: words[i], definition: attempt.definition, source: attempt.source });
    onProgress?.(i + 1, words.length);
  }
  return results;
}
```

Note `isAbortError` is imported but not directly referenced in this intermediate file — that's expected and temporary, `fetchOne`'s error handling now lives inside `fetchFreeDictionary`. Remove the unused `isAbortError` import from this file's import line if your editor/linter flags it (keep `abortError`, which `sleep` uses).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dictionaryProviders/__tests__/freeDictionary.test.ts src/lib/__tests__/dictionary.test.ts`
Expected: PASS — `dictionary.test.ts` passes unchanged, since `fetchDefinitions`/`fetchAlternateDefinitions` behavior (URLs, retry counts, error mapping, abort propagation) is identical to before the refactor.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no unused-import errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dictionaryProviders/types.ts src/lib/dictionaryProviders/freeDictionary.ts src/lib/dictionary.ts src/lib/dictionaryProviders/__tests__/freeDictionary.test.ts
git commit -m "refactor: extract dictionaryapi.dev into its own provider module"
```

---

### Task 6: Group up to 3 senses (one per part of speech)

**Files:**
- Modify: `src/lib/dictionary.ts`
- Test: `src/lib/__tests__/dictionary.test.ts`

**Interfaces:**
- Produces: internal `groupTopSensesByPartOfSpeech(alternatives: DefinitionAlternative[], maxGroups?: number): DefinitionAlternative[]` (not exported — used only inside `dictionary.ts`; Task 8's MW branch reuses it too).
- Consumes: `DefinitionAlternative` from Task 5.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/__tests__/dictionary.test.ts` (the existing `entry()` helper only builds one meaning; add a second helper for multi-meaning fixtures):

```ts
const multiEntry = (...pairs: Array<[string, string]>) =>
  [{ meanings: pairs.map(([pos, def]) => ({ partOfSpeech: pos, definitions: [{ definition: def }] })) }];

it('groups up to 3 senses, one per distinct part of speech, joined by blank lines', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ok(multiEntry(
    ['noun', 'A story.'],
    ['noun', 'A second noun sense, dropped — only the first per part of speech is kept.'],
    ['adjective', 'New and not previously known.'],
    ['verb', 'To write as a novel.'],
    ['interjection', 'A fourth part of speech, dropped — capped at 3 groups.'],
  ))));
  const [r] = await fetchDefinitions(['NOVEL'], opts);
  expect(r.definition).toBe(
    '(noun) A story.\n\n(adjective) New and not previously known.\n\n(verb) To write as a novel.',
  );
});

it('keeps a single-sense definition exactly as before (no trailing separators)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ok(entry('noun', 'A fungus.'))));
  const [r] = await fetchDefinitions(['AGARIC'], opts);
  expect(r.definition).toBe('(noun) A fungus.');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/dictionary.test.ts -t "groups up to 3 senses"`
Expected: FAIL — current `fetchOne` only keeps `result.alternatives[0]`.

- [ ] **Step 3: Implement**

In `src/lib/dictionary.ts`, add the grouping helper above `fetchOne` and use it there:

```ts
function groupTopSensesByPartOfSpeech(
  alternatives: DefinitionAlternative[],
  maxGroups = 3,
): DefinitionAlternative[] {
  const out: DefinitionAlternative[] = [];
  const seenPartsOfSpeech = new Set<string>();
  for (const alt of alternatives) {
    if (seenPartsOfSpeech.has(alt.partOfSpeech)) continue;
    seenPartsOfSpeech.add(alt.partOfSpeech);
    out.push(alt);
    if (out.length >= maxGroups) break;
  }
  return out;
}

function formatGroupedDefinition(alternatives: DefinitionAlternative[]): string {
  return alternatives.map(formatDefinition).join('\n\n');
}
```

Change `fetchOne`'s success branch from:

```ts
  if (result.status !== 'ok') return NOT_FOUND;
  const [first] = result.alternatives;
  return first ? { definition: formatDefinition(first), source: 'api' } : NOT_FOUND;
```
to:
```ts
  if (result.status !== 'ok') return NOT_FOUND;
  const grouped = groupTopSensesByPartOfSpeech(result.alternatives);
  return grouped.length > 0 ? { definition: formatGroupedDefinition(grouped), source: 'api' } : NOT_FOUND;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/dictionary.test.ts`
Expected: PASS — including the pre-existing `'extracts the first definition, prefixed with part of speech'` test, which only has one sense in its fixture and so is unaffected by grouping.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dictionary.ts src/lib/__tests__/dictionary.test.ts
git commit -m "feat: group up to 3 senses (one per part of speech) into a definition"
```

---

### Task 7: Merriam-Webster provider module

**Files:**
- Create: `src/lib/dictionaryProviders/merriamWebster.ts`
- Test: `src/lib/dictionaryProviders/__tests__/merriamWebster.test.ts` (new)

**Interfaces:**
- Produces: `parseMwAlternatives(data: unknown): DefinitionAlternative[]`, `fetchMerriamWebster(word: string, apiKey: string, signal?: AbortSignal): Promise<ProviderResult>`.
- Consumed by: Task 8 (orchestrator fetch chain + settings-validation).

- [ ] **Step 1: Write the failing test**

Create `src/lib/dictionaryProviders/__tests__/merriamWebster.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMerriamWebster, parseMwAlternatives } from '../merriamWebster';

const mwEntry = (fl: string, ...shortdef: string[]) => ({ fl, shortdef });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) });

afterEach(() => vi.unstubAllGlobals());

describe('parseMwAlternatives', () => {
  it('reads fl (part of speech) and every shortdef entry', () => {
    const data = [mwEntry('noun', 'A story.', 'A long fictional narrative.'), mwEntry('adjective', 'New.')];
    expect(parseMwAlternatives(data)).toEqual([
      { partOfSpeech: 'noun', definition: 'A story.' },
      { partOfSpeech: 'noun', definition: 'A long fictional narrative.' },
      { partOfSpeech: 'adjective', definition: 'New.' },
    ]);
  });

  it('treats an array of spelling-suggestion strings as no real entries', () => {
    expect(parseMwAlternatives(['novle', 'novel', 'novels'])).toEqual([]);
  });

  it('returns an empty list for non-array data', () => {
    expect(parseMwAlternatives({ message: 'Invalid API key' })).toEqual([]);
  });
});

describe('fetchMerriamWebster', () => {
  it('fetches and normalizes a successful response, sending the key as a query param', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([mwEntry('noun', 'A fungus.')])));
    const result = await fetchMerriamWebster('AGARIC', 'test-key');
    expect(result).toEqual({ status: 'ok', alternatives: [{ partOfSpeech: 'noun', definition: 'A fungus.' }] });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.dictionaryapi.com/api/v3/references/collegiate/json/agaric?key=test-key',
      expect.anything(),
    );
  });

  it('maps a suggestions-only response to not-found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(['agar', 'agarics'])));
    expect(await fetchMerriamWebster('AGARIX', 'test-key')).toEqual({ status: 'not-found' });
  });

  it('maps a 429 to rate-limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(429)));
    expect(await fetchMerriamWebster('AGARIC', 'test-key')).toEqual({ status: 'rate-limited' });
  });

  it('maps any other non-ok status (e.g. an invalid key) to error, not not-found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(403)));
    expect(await fetchMerriamWebster('AGARIC', 'bad-key')).toEqual({ status: 'error' });
  });

  it('maps a network error to error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await fetchMerriamWebster('AGARIC', 'test-key')).toEqual({ status: 'error' });
  });

  it('rethrows AbortError instead of swallowing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }));
    await expect(fetchMerriamWebster('AGARIC', 'test-key')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/dictionaryProviders/__tests__/merriamWebster.test.ts`
Expected: FAIL — `../merriamWebster` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/lib/dictionaryProviders/merriamWebster.ts`:

```ts
import { isAbortError } from '../abortError';
import type { DefinitionAlternative, ProviderResult } from './types';

const API = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json/';

interface MwEntry {
  fl?: unknown;
  shortdef?: unknown;
}

/**
 * When Merriam-Webster has no entry for a word it returns a 200 with an array of plain spelling-
 * suggestion strings instead of entry objects (never a 404) — so "not found" has to be detected from
 * response shape, not HTTP status. Non-object array items are exactly that case and are skipped.
 */
export function parseMwAlternatives(data: unknown): DefinitionAlternative[] {
  if (!Array.isArray(data)) return [];
  const out: DefinitionAlternative[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { fl, shortdef } = entry as MwEntry;
    const partOfSpeech = typeof fl === 'string' ? fl : '';
    const shortdefs = Array.isArray(shortdef) ? shortdef : [];
    for (const definition of shortdefs) {
      if (typeof definition !== 'string' || definition.length === 0) continue;
      const key = `${partOfSpeech} ${definition}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ partOfSpeech, definition });
    }
  }
  return out;
}

export async function fetchMerriamWebster(
  word: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ProviderResult> {
  try {
    const res = await fetch(`${API}${word.toLowerCase()}?key=${encodeURIComponent(apiKey)}`, { signal });
    if (res.status === 429) return { status: 'rate-limited' };
    // A non-2xx here means the request itself was rejected (bad key, server error) — MW signals a
    // genuine "no entry" with a 200 + suggestions array, never a 404, so this is never "not found".
    if (!res.ok) return { status: 'error' };
    const alternatives = parseMwAlternatives(await res.json());
    return alternatives.length > 0 ? { status: 'ok', alternatives } : { status: 'not-found' };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { status: 'error' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dictionaryProviders/__tests__/merriamWebster.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dictionaryProviders/merriamWebster.ts src/lib/dictionaryProviders/__tests__/merriamWebster.test.ts
git commit -m "feat: add Merriam-Webster provider module"
```

---

### Task 8: Wire Merriam-Webster into the orchestrator (key storage, fetch chain)

**Files:**
- Modify: `src/lib/dictionary.ts`
- Test: `src/lib/__tests__/dictionary.test.ts`

**Interfaces:**
- Produces: `MW_API_KEY_STORAGE_KEY: string` (exported constant, mirrors `storage.ts`'s `DB_KEY` export pattern), `loadMwApiKey(): string | null`, `saveMwApiKey(key: string): void`, `clearMwApiKey(): void`, `validateMwApiKey(key: string, signal?: AbortSignal): Promise<boolean>` — all consumed by Task 9 (`DataScreen.tsx`).
- Consumes: `fetchMerriamWebster` from Task 7, `groupTopSensesByPartOfSpeech`/`formatGroupedDefinition` from Task 6.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/__tests__/dictionary.test.ts`. `src/test-setup.ts`'s global `afterEach` already calls `localStorage.clear()` after every test, so no MW-key state leaks between tests — no new `beforeEach` needed. Add the new imports:

```ts
import {
  clearMwApiKey, fetchAlternateDefinitions, fetchDefinitions, loadMwApiKey, saveMwApiKey, validateMwApiKey,
} from '../dictionary';
```

```ts
describe('Merriam-Webster key storage', () => {
  it('round-trips through save/load/clear', () => {
    expect(loadMwApiKey()).toBeNull();
    saveMwApiKey('abc123');
    expect(loadMwApiKey()).toBe('abc123');
    clearMwApiKey();
    expect(loadMwApiKey()).toBeNull();
  });
});

describe('validateMwApiKey', () => {
  it('is valid when MW answers with a real entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ fl: 'noun', shortdef: ['a check'] }])));
    expect(await validateMwApiKey('good-key')).toBe(true);
  });

  it('is valid even when MW has no entry for the probe word (key itself was accepted)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(['test', 'tests'])));
    expect(await validateMwApiKey('good-key')).toBe(true);
  });

  it('is invalid when MW rejects the request (bad key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(403)));
    expect(await validateMwApiKey('bad-key')).toBe(false);
  });
});

describe('fetchDefinitions with a Merriam-Webster key configured', () => {
  it('uses Merriam-Webster when it has the word', async () => {
    saveMwApiKey('good-key');
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ fl: 'noun', shortdef: ['A crown.'] }])));
    const [r] = await fetchDefinitions(['TIARA'], opts);
    expect(r).toEqual({ word: 'TIARA', definition: '(noun) A crown.', source: 'api' });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.dictionaryapi.com/api/v3/references/collegiate/json/tiara?key=good-key',
      expect.anything(),
    );
  });

  it('falls back to dictionaryapi.dev when Merriam-Webster has no entry', async () => {
    saveMwApiKey('good-key');
    const f = vi.fn()
      .mockResolvedValueOnce(ok(['tiaras'])) // MW: suggestions only, not found
      .mockResolvedValueOnce(ok(entry('noun', 'A crown (free dictionary).')));
    vi.stubGlobal('fetch', f);
    const [r] = await fetchDefinitions(['TIARA'], opts);
    expect(r).toEqual({ word: 'TIARA', definition: '(noun) A crown (free dictionary).', source: 'api' });
    expect(f).toHaveBeenNthCalledWith(1, expect.stringContaining('dictionaryapi.com'), expect.anything());
    expect(f).toHaveBeenNthCalledWith(2, expect.stringContaining('dictionaryapi.dev'), expect.anything());
  });

  it('retries a rate-limited Merriam-Webster request before falling back', async () => {
    saveMwApiKey('good-key');
    const f = vi.fn()
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(ok([{ fl: 'noun', shortdef: ['A crown.'] }]));
    vi.stubGlobal('fetch', f);
    const [r] = await fetchDefinitions(['TIARA'], opts);
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('api');
  });

  it('does not call Merriam-Webster when no key is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(entry('noun', 'A crown.'))));
    await fetchDefinitions(['TIARA'], opts);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('dictionaryapi.dev'), expect.anything());
  });
});

describe('fetchAlternateDefinitions with a Merriam-Webster key configured', () => {
  it('uses Merriam-Webster when it has the word', async () => {
    saveMwApiKey('good-key');
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ fl: 'noun', shortdef: ['A fungus.', 'A basket.'] }])));
    const alts = await fetchAlternateDefinitions('AGARIC');
    expect(alts).toEqual([
      { partOfSpeech: 'noun', definition: 'A fungus.' },
      { partOfSpeech: 'noun', definition: 'A basket.' },
    ]);
  });

  it('falls back to dictionaryapi.dev when Merriam-Webster has no entry', async () => {
    saveMwApiKey('good-key');
    const f = vi.fn()
      .mockResolvedValueOnce(ok(['agarics']))
      .mockResolvedValueOnce(ok(entry('noun', 'A fungus (free dictionary).')));
    vi.stubGlobal('fetch', f);
    const alts = await fetchAlternateDefinitions('AGARIC');
    expect(alts).toEqual([{ partOfSpeech: 'noun', definition: 'A fungus (free dictionary).' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/dictionary.test.ts -t "Merriam-Webster"`
Expected: FAIL — `loadMwApiKey`/`saveMwApiKey`/`clearMwApiKey`/`validateMwApiKey` don't exist yet, and `fetchOne`/`fetchAlternateDefinitions` never call MW.

- [ ] **Step 3: Implement**

In `src/lib/dictionary.ts`, add the import and key-storage functions:

```ts
import { fetchMerriamWebster } from './dictionaryProviders/merriamWebster';

export const MW_API_KEY_STORAGE_KEY = 'beevocab.mwApiKey';

export function loadMwApiKey(): string | null {
  return localStorage.getItem(MW_API_KEY_STORAGE_KEY);
}

export function saveMwApiKey(key: string): void {
  localStorage.setItem(MW_API_KEY_STORAGE_KEY, key);
}

export function clearMwApiKey(): void {
  localStorage.removeItem(MW_API_KEY_STORAGE_KEY);
}

/** A well-formed key always gets a 200 from Merriam-Webster (an unknown word is still a 200, just
 * with suggestions instead of entries) — only a rejected request (bad key) maps to 'error'. */
export async function validateMwApiKey(key: string, signal?: AbortSignal): Promise<boolean> {
  const result = await fetchMerriamWebster('test', key, signal);
  return result.status !== 'error';
}
```

Add a small helper that tries a provider fetch with the existing retry-once-on-429 behavior, generalized over which provider function is passed in:

```ts
async function fetchWithRetry(
  fetchFn: () => ReturnType<typeof fetchFreeDictionary>,
  signal: AbortSignal | undefined,
  retryMs: number,
) {
  let result = await fetchFn();
  if (result.status === 'rate-limited') {
    await sleep(retryMs, signal);
    result = await fetchFn();
  }
  return result;
}
```

Replace `fetchOne` with:

```ts
async function fetchOne(word: string, signal: AbortSignal | undefined, retryMs: number): Promise<Attempt> {
  const mwKey = loadMwApiKey();
  if (mwKey) {
    const mwResult = await fetchWithRetry(() => fetchMerriamWebster(word, mwKey, signal), signal, retryMs);
    if (mwResult.status === 'ok') {
      const grouped = groupTopSensesByPartOfSpeech(mwResult.alternatives);
      if (grouped.length > 0) return { definition: formatGroupedDefinition(grouped), source: 'api' };
    }
  }
  const freeResult = await fetchWithRetry(() => fetchFreeDictionary(word, signal), signal, retryMs);
  if (freeResult.status !== 'ok') return NOT_FOUND;
  const grouped = groupTopSensesByPartOfSpeech(freeResult.alternatives);
  return grouped.length > 0 ? { definition: formatGroupedDefinition(grouped), source: 'api' } : NOT_FOUND;
}
```

Replace `fetchAlternateDefinitions` with:

```ts
export async function fetchAlternateDefinitions(
  word: string,
  signal?: AbortSignal,
): Promise<DefinitionAlternative[]> {
  const mwKey = loadMwApiKey();
  if (mwKey) {
    const mwResult = await fetchMerriamWebster(word, mwKey, signal);
    if (mwResult.status === 'ok') return mwResult.alternatives;
  }
  const freeResult = await fetchFreeDictionary(word, signal);
  return freeResult.status === 'ok' ? freeResult.alternatives : [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/dictionary.test.ts`
Expected: PASS — all existing tests (which run with no MW key set, since the global `afterEach` clears `localStorage`) plus every new Merriam-Webster test.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/dictionary.ts src/lib/__tests__/dictionary.test.ts
git commit -m "feat: try Merriam-Webster first when a key is configured, fall back on a miss"
```

---

### Task 9: Data screen — Merriam-Webster key settings

**Files:**
- Modify: `src/screens/DataScreen.tsx`
- Test: `src/screens/__tests__/DataScreen.test.tsx`

**Interfaces:**
- Consumes: `loadMwApiKey`, `saveMwApiKey`, `clearMwApiKey`, `validateMwApiKey` from Task 8.

- [ ] **Step 1: Write the failing tests**

Add to `src/screens/__tests__/DataScreen.test.tsx`. Mock `../../lib/dictionary`'s `validateMwApiKey` (the only network call this screen makes) at the top of the file:

```tsx
import { validateMwApiKey } from '../../lib/dictionary';

vi.mock('../../lib/dictionary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/dictionary')>()),
  validateMwApiKey: vi.fn(),
}));
```

```tsx
it('defaults to the free dictionary with no key configured', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  expect(screen.getByText(/using the free dictionary/i)).toBeInTheDocument();
});

it('rejects an invalid Merriam-Webster key without saving it', async () => {
  vi.mocked(validateMwApiKey).mockResolvedValueOnce(false);
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  await userEvent.type(screen.getByPlaceholderText(/merriam-webster api key/i), 'bad-key');
  await userEvent.click(screen.getByRole('button', { name: /save key/i }));
  expect(await screen.findByText(/couldn't verify that key/i)).toBeInTheDocument();
  expect(screen.getByText(/using the free dictionary/i)).toBeInTheDocument();
});

it('saves a valid Merriam-Webster key and switches the active source', async () => {
  vi.mocked(validateMwApiKey).mockResolvedValueOnce(true);
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  await userEvent.type(screen.getByPlaceholderText(/merriam-webster api key/i), 'good-key');
  await userEvent.click(screen.getByRole('button', { name: /save key/i }));
  expect(await screen.findByText(/using merriam-webster/i)).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/merriam-webster api key/i)).not.toBeInTheDocument();
});

it('clears a configured key and reverts to the free dictionary', async () => {
  vi.mocked(validateMwApiKey).mockResolvedValueOnce(true);
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  await userEvent.type(screen.getByPlaceholderText(/merriam-webster api key/i), 'good-key');
  await userEvent.click(screen.getByRole('button', { name: /save key/i }));
  await screen.findByText(/using merriam-webster/i);
  await userEvent.click(screen.getByRole('button', { name: /remove key/i }));
  expect(screen.getByText(/using the free dictionary/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/screens/__tests__/DataScreen.test.tsx -t "Merriam-Webster\|free dictionary"`
Expected: FAIL — no "Dictionary source" section exists yet.

- [ ] **Step 3: Implement**

In `src/screens/DataScreen.tsx`, add the import and a new component + section. Add near the top imports:

```ts
import { useState } from 'react';
import { clearMwApiKey, loadMwApiKey, saveMwApiKey, validateMwApiKey } from '../lib/dictionary';
```

(`useState` is likely already imported — merge with the existing import line instead of duplicating it.)

Add this component in the same file, above `export default function DataScreen()`:

```tsx
function DictionarySourceSection() {
  const [keyInput, setKeyInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(() => loadMwApiKey() !== null);

  const handleSave = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setChecking(true);
    setError(false);
    const valid = await validateMwApiKey(trimmed);
    setChecking(false);
    if (!valid) {
      setError(true);
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
          {error && <p className="mt-2 text-xs text-red-500">Couldn't verify that key — check it and try again.</p>}
        </>
      )}
    </section>
  );
}
```

In `DataScreen`'s returned JSX, add `<DictionarySourceSection />` right after the closing `</section>` of the "Stats" block and before the "Backup" `<section>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/screens/__tests__/DataScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/screens/DataScreen.tsx src/screens/__tests__/DataScreen.test.tsx
git commit -m "feat: add Merriam-Webster API key settings to the Data screen"
```

---

## Final verification

- [ ] Run `npx vitest run && npx tsc --noEmit` once more from a clean state to confirm every task's changes compose correctly together.
- [ ] Manually smoke-test in the browser (per the design spec's manual checklist, §11): upload a screenshot, commit an import with at least one likely-missing word (e.g. an obscure OCR-mangled token), confirm the toast's "Show" reveals it; open a word with a common multi-part-of-speech word (e.g. "novel") and confirm the definition shows as separate paragraphs; go to Data, paste a deliberately wrong Merriam-Webster key and confirm the error message, then (if you have a real key) paste a valid one and confirm a subsequent import uses it.
