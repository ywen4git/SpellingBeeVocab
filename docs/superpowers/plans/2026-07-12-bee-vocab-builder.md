# Bee Vocab Builder Implementation Plan

> **Status (2026-07-27): historical.** This plan's 13 tasks built the original v1
> app and are all complete — the checkboxes and embedded code below describe that
> v1 snapshot, not the current codebase. Since v1 shipped, `parser.ts`, `ocr.ts`,
> `dictionary.ts`, `AddScreen.tsx`, and `StudyScreen.tsx` have all changed
> substantially (hive-detection cross-validation, a third gold-aware OCR pass,
> OCR misread correction, multi-screenshot upload, pangram grouping, alternate
> dictionary definitions, a Study "Skip" button — see the design spec's §6–8 for
> what's actually there now). This file is kept only as a record of how v1 was
> originally built via TDD, not updated task-by-task as the app evolves — for
> current behavior, read `docs/superpowers/specs/2026-07-12-spelling-bee-pwa-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the offline-first PWA specified in `docs/superpowers/specs/2026-07-12-spelling-bee-pwa-design.md`: NYT Spelling Bee answer screenshots → in-browser OCR → reviewed word list → auto-fetched definitions → Leitner-box flashcards, with export/import backup.

**Architecture:** Pure TypeScript logic core (`src/lib/`: leitner, parser, storage, dictionary, ocr) with no React dependencies, unit-tested with Vitest. Thin React screens on top, all state owned by one `VocabProvider` context that persists to a single versioned `localStorage` key. Static hosting on GitHub Pages at `/SpellingBeeVocab/`.

**Tech Stack:** React 18 + TypeScript (strict) + Vite, Tailwind CSS v4 (`@tailwindcss/vite`), tesseract.js (self-hosted WASM assets), vite-plugin-pwa, Vitest + React Testing Library, GitHub Actions.

## Global Constraints

- Vite `base: '/SpellingBeeVocab/'` — everywhere, from Task 1 on.
- React pinned to 18 (`react@18`, `react-dom@18`, matching `@types`).
- TypeScript `strict: true`; `npm run typecheck` (`tsc --noEmit`) must pass at every commit.
- Storage keys exactly: `beevocab.db.v1` (live), `beevocab.db.corrupt` (quarantine), `spelling_bee_vocab` (legacy draft-app key, migrated then removed).
- Word keys are UPPERCASE strings; `schemaVersion: 1`.
- Leitner intervals: Box 1 = 1 day, Box 2 = 3 days, Box 3 = 7 days; day boundary at 4:00 AM local time.
- Placeholder definition copy, exactly: `No definition found — tap to edit.`
- Dictionary API: `https://api.dictionaryapi.dev/api/v2/entries/en/{word.toLowerCase()}`; 300 ms gap between requests; on HTTP 429 wait 2 s and retry once.
- No `alert()`/`confirm()`/`prompt()` anywhere — use the `Toast` component and inline confirms.
- Touch targets ≥ 44 px (`min-h-[44px]` on interactive controls).
- `src/lib/` modules never import React; `leitner.ts` and `parser.ts` take explicit `now`/input params (no hidden `Date.now()`).
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (shown as a second `-m` flag below).
- Node 22 in CI. Package manager: npm.

---

### Task 1: Scaffold the Vite + React + TypeScript + Tailwind app

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/index.css`, `src/main.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: nothing (first code task).
- Produces: a building app shell; `npm run build`, `npm run dev`, `npm run typecheck` scripts; `src/App.tsx` default-exports `App` (rewritten in Task 7 — later tasks may replace it freely as long as the `🐝 Bee Vocab Builder` header stays).

- [ ] **Step 1: Write `.gitignore`**

```gitignore
node_modules/
dist/
dev-dist/
public/tesseract/
*.local
```

- [ ] **Step 2: Write `package.json` skeleton**

```json
{
  "name": "spelling-bee-vocab",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run:
```bash
npm install react@18 react-dom@18
npm install -D typescript vite @vitejs/plugin-react tailwindcss @tailwindcss/vite @types/react@18 @types/react-dom@18
```
Expected: both commands exit 0; `package.json` now lists the deps with resolved versions.

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 5: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/SpellingBeeVocab/',
  plugins: [react(), tailwindcss()],
});
```

- [ ] **Step 6: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#f59e0b" />
    <title>Bee Vocab Builder</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Write `src/index.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 8: Write `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Write minimal `src/App.tsx`**

```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 p-4 text-center text-slate-800">
      <h1 className="text-2xl font-bold text-amber-500">🐝 Bee Vocab Builder</h1>
    </div>
  );
}
```

- [ ] **Step 10: Verify the build**

Run: `npm run build`
Expected: exits 0, ends with `✓ built in …` and a `dist/` directory containing `index.html` whose asset URLs start with `/SpellingBeeVocab/`.
Check: `grep -o '/SpellingBeeVocab/[^"]*' dist/index.html` prints at least one JS and one CSS path.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold Vite + React 18 + TS + Tailwind app shell with GitHub Pages base path" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Test infrastructure and GitHub Actions workflows

**Files:**
- Modify: `vite.config.ts`, `tsconfig.json`, `package.json` (scripts)
- Create: `src/test-setup.ts`, `src/__tests__/App.smoke.test.tsx`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: Task 1 shell.
- Produces: `npm test` (vitest run, jsdom, RTL, jest-dom matchers, auto `cleanup()` + `localStorage.clear()` after each test); CI on every push/PR; Pages deploy on push to `main`. All later test files rely on the automatic localStorage cleanup.

- [ ] **Step 1: Install test dependencies**

Run:
```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
Expected: exit 0.

- [ ] **Step 2: Wire vitest into `vite.config.ts`** (replace full file)

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/SpellingBeeVocab/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    globals: true,
  },
});
```

- [ ] **Step 3: Update `tsconfig.json` types line**

Change the `"types"` entry to:
```json
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
```

- [ ] **Step 4: Add test scripts to `package.json`**

Add to `"scripts"`:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 5: Write `src/test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
```

- [ ] **Step 6: Write the failing smoke test `src/__tests__/App.smoke.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import App from '../App';

it('renders the app header', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /bee vocab builder/i })).toBeInTheDocument();
});
```

- [ ] **Step 7: Run the test**

Run: `npm test`
Expected: PASS — `Test Files  1 passed`. (It passes immediately; this step verifies the harness itself works. If it errors on config, fix config, not the test.)

- [ ] **Step 8: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 9: Write `.github/workflows/deploy.yml`**

```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

(Deploy can only be exercised once the repo is pushed to GitHub with Pages source set to "GitHub Actions" — note this in the README in Task 13. Local verification is YAML validity + `npm run build` passing.)

- [ ] **Step 10: Verify typecheck + test + build all pass**

Run: `npm run typecheck && npm test && npm run build`
Expected: all exit 0.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add Vitest+RTL test infra and GitHub Actions CI/Pages workflows" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Core types and Leitner scheduling (`types.ts`, `leitner.ts`)

**Files:**
- Create: `src/lib/types.ts`, `src/lib/leitner.ts`
- Test: `src/lib/__tests__/leitner.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later task):
  - `types.ts`: `WordStatus`, `DefinitionSource`, `Box`, `VocabWord`, `VocabDb`, `SCHEMA_VERSION` (=1), `PLACEHOLDER_DEFINITION`, `emptyDb(): VocabDb`
  - `leitner.ts`: `BOX_INTERVAL_DAYS: Record<Box, number>`; `nextDayBoundary(now: number, days: number): number`; `newWordEntry(word: string, definition: string, definitionSource: DefinitionSource, now: number): VocabWord`; `knownWordEntry(...same signature...): VocabWord` (mastered on import); `gradeGotIt(w: VocabWord, now: number): VocabWord`; `gradeMissed(w, now): VocabWord`; `resetToLearning(w, now): VocabWord`; `unmaster(w, now): VocabWord`; `dueWords(db: VocabDb, now: number): VocabWord[]`; `nextDueAt(db: VocabDb, now: number): number | null`

- [ ] **Step 1: Write `src/lib/types.ts`**

```ts
export type WordStatus = 'learning' | 'mastered';
export type DefinitionSource = 'api' | 'manual' | 'none';
export type Box = 1 | 2 | 3;

export interface VocabWord {
  word: string;                 // UPPERCASE, unique key
  definition: string;
  definitionSource: DefinitionSource;
  status: WordStatus;
  box: Box;                     // meaningful while learning; stays at 3 after mastery
  dueAt: number;                // epoch ms; ignored when mastered
  addedAt: number;              // epoch ms
  lapses: number;               // demotions to box 1
}

export interface VocabDb {
  schemaVersion: 1;
  words: Record<string, VocabWord>;
}

export const SCHEMA_VERSION = 1 as const;
export const PLACEHOLDER_DEFINITION = 'No definition found — tap to edit.';

export function emptyDb(): VocabDb {
  return { schemaVersion: SCHEMA_VERSION, words: {} };
}
```

- [ ] **Step 2: Write the failing tests `src/lib/__tests__/leitner.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  BOX_INTERVAL_DAYS, dueWords, gradeGotIt, gradeMissed, knownWordEntry,
  newWordEntry, nextDayBoundary, nextDueAt, resetToLearning, unmaster,
} from '../leitner';
import type { VocabDb, VocabWord } from '../types';

const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

function db(...words: VocabWord[]): VocabDb {
  return { schemaVersion: 1, words: Object.fromEntries(words.map((w) => [w.word, w])) };
}

describe('nextDayBoundary (4 AM local study-day boundary)', () => {
  it('11 PM + 1 day -> 4 AM next morning', () => {
    expect(nextDayBoundary(at(2026, 7, 12, 23), 1)).toBe(at(2026, 7, 13, 4));
  });
  it('2 AM still belongs to the previous study day', () => {
    expect(nextDayBoundary(at(2026, 7, 13, 2), 1)).toBe(at(2026, 7, 13, 4));
  });
  it('7 AM + 1 day -> 4 AM the next calendar day', () => {
    expect(nextDayBoundary(at(2026, 7, 13, 7), 1)).toBe(at(2026, 7, 14, 4));
  });
  it('supports multi-day intervals', () => {
    expect(nextDayBoundary(at(2026, 7, 12, 12), 3)).toBe(at(2026, 7, 15, 4));
  });
});

describe('grading', () => {
  const now = at(2026, 7, 12, 12);
  const w = newWordEntry('AGARIC', 'a mushroom', 'api', now);

  it('new words start learning, box 1, due immediately', () => {
    expect(w).toMatchObject({ status: 'learning', box: 1, dueAt: now, lapses: 0 });
  });
  it('known words import as mastered', () => {
    expect(knownWordEntry('TIARA', 'a crown', 'api', now)).toMatchObject({
      status: 'mastered', box: 3, addedAt: now,
    });
  });
  it('got it: box 1 -> 2 with a 3-day interval', () => {
    const g = gradeGotIt(w, now);
    expect(g.box).toBe(2);
    expect(g.dueAt).toBe(nextDayBoundary(now, BOX_INTERVAL_DAYS[2]));
  });
  it('got it: box 2 -> 3 with a 7-day interval', () => {
    const g = gradeGotIt({ ...w, box: 2 }, now);
    expect(g.box).toBe(3);
    expect(g.dueAt).toBe(nextDayBoundary(now, 7));
  });
  it('got it in box 3 masters the word', () => {
    expect(gradeGotIt({ ...w, box: 3 }, now).status).toBe('mastered');
  });
  it('missed: back to box 1 tomorrow, lapse counted', () => {
    const g = gradeMissed({ ...w, box: 3 }, now);
    expect(g).toMatchObject({ box: 1, lapses: 1 });
    expect(g.dueAt).toBe(nextDayBoundary(now, 1));
  });
  it('resetToLearning: learning box 1, due now', () => {
    const m = knownWordEntry('TIARA', 'a crown', 'api', now - 999);
    expect(resetToLearning(m, now)).toMatchObject({ status: 'learning', box: 1, dueAt: now });
  });
  it('unmaster: learning box 3, due now', () => {
    const m = knownWordEntry('TIARA', 'a crown', 'api', now - 999);
    expect(unmaster(m, now)).toMatchObject({ status: 'learning', box: 3, dueAt: now });
  });
});

describe('sessions', () => {
  const now = at(2026, 7, 12, 12);

  it('dueWords: only due learning words, box asc then dueAt asc', () => {
    const boxTwo = { ...newWordEntry('AAAA', '', 'none', now - 100), box: 2 as const };
    const laterBoxOne = newWordEntry('BBBB', '', 'none', now - 50);
    const earlierBoxOne = newWordEntry('CCCC', '', 'none', now - 200);
    const notDue = { ...newWordEntry('DDDD', '', 'none', now), dueAt: now + 1000 };
    const mastered = knownWordEntry('EEEE', '', 'none', now);
    const result = dueWords(db(boxTwo, laterBoxOne, earlierBoxOne, notDue, mastered), now);
    expect(result.map((w) => w.word)).toEqual(['CCCC', 'BBBB', 'AAAA']);
  });

  it('nextDueAt: earliest future due among learning words, null when none', () => {
    const soon = { ...newWordEntry('AAAA', '', 'none', now), dueAt: now + 1000 };
    const later = { ...newWordEntry('BBBB', '', 'none', now), dueAt: now + 5000 };
    expect(nextDueAt(db(soon, later), now)).toBe(now + 1000);
    expect(nextDueAt(db(), now)).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/leitner.test.ts`
Expected: FAIL — cannot resolve `../leitner`.

- [ ] **Step 4: Write `src/lib/leitner.ts`**

```ts
import type { Box, DefinitionSource, VocabDb, VocabWord } from './types';

export const BOX_INTERVAL_DAYS: Record<Box, number> = { 1: 1, 2: 3, 3: 7 };

const HOUR = 3_600_000;
const DAY_START_HOUR = 4;

/** 4 AM local-time boundary `days` study-days after `now`. A study day runs 4 AM → 4 AM. */
export function nextDayBoundary(now: number, days: number): number {
  const shifted = new Date(now - DAY_START_HOUR * HOUR);
  return new Date(
    shifted.getFullYear(), shifted.getMonth(), shifted.getDate() + days,
    DAY_START_HOUR, 0, 0, 0,
  ).getTime();
}

export function newWordEntry(
  word: string, definition: string, definitionSource: DefinitionSource, now: number,
): VocabWord {
  return {
    word, definition, definitionSource,
    status: 'learning', box: 1, dueAt: now, addedAt: now, lapses: 0,
  };
}

/** "Already know" import: straight to mastered, present in stats but never scheduled. */
export function knownWordEntry(
  word: string, definition: string, definitionSource: DefinitionSource, now: number,
): VocabWord {
  return {
    word, definition, definitionSource,
    status: 'mastered', box: 3, dueAt: now, addedAt: now, lapses: 0,
  };
}

export function gradeGotIt(w: VocabWord, now: number): VocabWord {
  if (w.box === 3) return { ...w, status: 'mastered' };
  const box = (w.box + 1) as Box;
  return { ...w, box, dueAt: nextDayBoundary(now, BOX_INTERVAL_DAYS[box]) };
}

export function gradeMissed(w: VocabWord, now: number): VocabWord {
  return { ...w, box: 1, dueAt: nextDayBoundary(now, 1), lapses: w.lapses + 1 };
}

export function resetToLearning(w: VocabWord, now: number): VocabWord {
  return { ...w, status: 'learning', box: 1, dueAt: now };
}

export function unmaster(w: VocabWord, now: number): VocabWord {
  return { ...w, status: 'learning', box: 3, dueAt: now };
}

export function dueWords(db: VocabDb, now: number): VocabWord[] {
  return Object.values(db.words)
    .filter((w) => w.status === 'learning' && w.dueAt <= now)
    .sort((a, b) => a.box - b.box || a.dueAt - b.dueAt || a.word.localeCompare(b.word));
}

export function nextDueAt(db: VocabDb, now: number): number | null {
  let min: number | null = null;
  for (const w of Object.values(db.words)) {
    if (w.status === 'learning' && w.dueAt > now && (min === null || w.dueAt < min)) {
      min = w.dueAt;
    }
  }
  return min;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/lib/__tests__/leitner.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/lib
git commit -m "feat: core vocab types and Leitner scheduling with 4 AM study-day boundary" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: OCR text parser (`parser.ts`)

**Files:**
- Create: `src/lib/parser.ts`, `src/lib/__fixtures__/nyt-answers-ocr.txt`
- Test: `src/lib/__tests__/parser.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `UI_BLOCKLIST: ReadonlySet<string>`; `interface ParseResult { candidates: string[]; alreadyKnown: string[]; filteredUi: string[] }`; `parseCandidates(rawText: string, existingWords: ReadonlySet<string>): ParseResult` — all three lists UPPERCASE, deduped, alphabetized. Task 10's AddScreen consumes `ParseResult` directly.

- [ ] **Step 1: Write the fixture `src/lib/__fixtures__/nyt-answers-ocr.txt`**

This mimics tesseract output for an NYT app "Yesterday's Answers" screenshot (UI chrome plus a two-section word list). If you later run a real screenshot through the app, paste the actual OCR text over this file and update the expected list — the test contract stays the same.

```text
Yesterday’s Answers
Saturday, July 11, 2026

PANGRAM
ABANDON

AGARIC   ANTIC    ARIA
CAIRN    NAIAD    NUANCE
RADIAN   TIARA    TRAIN

You found 23 words
GENIUS · 158 points
```

- [ ] **Step 2: Write the failing tests `src/lib/__tests__/parser.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseCandidates, UI_BLOCKLIST } from '../parser';
import fixture from '../__fixtures__/nyt-answers-ocr.txt?raw';

describe('parseCandidates', () => {
  it('extracts 4+ letter words, uppercased, deduped, sorted', () => {
    const r = parseCandidates('naiad agaric Agaric ant', new Set());
    expect(r.candidates).toEqual(['AGARIC', 'NAIAD']);
  });

  it('filters NYT UI chrome, month and day names into filteredUi', () => {
    const r = parseCandidates('PANGRAM GENIUS JULY SATURDAY AGARIC', new Set());
    expect(r.candidates).toEqual(['AGARIC']);
    expect(r.filteredUi).toEqual(expect.arrayContaining(['GENIUS', 'JULY', 'PANGRAM', 'SATURDAY']));
  });

  it('splits words already in the collection into alreadyKnown', () => {
    const r = parseCandidates('AGARIC TIARA', new Set(['TIARA']));
    expect(r.candidates).toEqual(['AGARIC']);
    expect(r.alreadyKnown).toEqual(['TIARA']);
  });

  it('handles a realistic answers-page OCR dump', () => {
    const r = parseCandidates(fixture, new Set(['TIARA']));
    expect(r.candidates).toEqual([
      'ABANDON', 'AGARIC', 'ANTIC', 'ARIA', 'CAIRN', 'NAIAD', 'NUANCE', 'RADIAN', 'TRAIN',
    ]);
    expect(r.alreadyKnown).toEqual(['TIARA']);
    expect(r.candidates).not.toContain('PANGRAM');
    expect(r.candidates).not.toContain('WORDS');
  });

  it('exports the blocklist for reuse', () => {
    expect(UI_BLOCKLIST.has('PANGRAM')).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/parser.test.ts`
Expected: FAIL — cannot resolve `../parser`.

- [ ] **Step 4: Write `src/lib/parser.ts`**

```ts
const NYT_CHROME = [
  'PANGRAM', 'ANSWERS', 'YESTERDAY', 'YESTERDAYS', 'TODAY', 'TODAYS',
  'WORDS', 'POINTS', 'GENIUS', 'QUEEN', 'SPELLING', 'GAMES', 'EDITED',
  'FOUND', 'RANKINGS',
];
const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'JUNE', 'JULY',
  'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]; // MAY is 3 letters and never matches anyway
const DAYS = [
  'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
];

/** NYT app UI words that must not become flashcards. Extend here when new junk shows up. */
export const UI_BLOCKLIST: ReadonlySet<string> = new Set([...NYT_CHROME, ...MONTHS, ...DAYS]);

export interface ParseResult {
  candidates: string[];
  alreadyKnown: string[];
  filteredUi: string[];
}

export function parseCandidates(
  rawText: string,
  existingWords: ReadonlySet<string>,
): ParseResult {
  const matches = rawText.toUpperCase().match(/[A-Z]{4,}/g) ?? [];
  const candidates: string[] = [];
  const alreadyKnown: string[] = [];
  const filteredUi: string[] = [];
  for (const word of new Set(matches)) {
    if (UI_BLOCKLIST.has(word)) filteredUi.push(word);
    else if (existingWords.has(word)) alreadyKnown.push(word);
    else candidates.push(word);
  }
  candidates.sort();
  alreadyKnown.sort();
  filteredUi.sort();
  return { candidates, alreadyKnown, filteredUi };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/lib/__tests__/parser.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/lib
git commit -m "feat: OCR text parser with NYT UI blocklist and already-known split" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Persistence, migration, backup merge (`storage.ts`)

**Files:**
- Create: `src/lib/storage.ts`
- Test: `src/lib/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `types.ts` (`VocabDb`, `emptyDb`, `SCHEMA_VERSION`), `leitner.ts` (`newWordEntry`, `knownWordEntry`).
- Produces: `DB_KEY = 'beevocab.db.v1'`, `CORRUPT_KEY = 'beevocab.db.corrupt'`, `LEGACY_KEY = 'spelling_bee_vocab'`; `interface LoadResult { db: VocabDb; recoveredFromCorrupt: boolean; migratedLegacy: boolean }`; `loadDb(now: number): LoadResult`; `saveDb(db: VocabDb): boolean` (false on quota errors, never throws); `exportDb(db: VocabDb): string`; `parseBackup(text: string): VocabDb | null`; `interface MergeResult { merged: VocabDb; added: number; existing: number }`; `mergeDb(current: VocabDb, incoming: VocabDb): MergeResult`.

- [ ] **Step 1: Write the failing tests `src/lib/__tests__/storage.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CORRUPT_KEY, DB_KEY, LEGACY_KEY, exportDb, loadDb, mergeDb, parseBackup, saveDb,
} from '../storage';
import { emptyDb } from '../types';
import { knownWordEntry, newWordEntry } from '../leitner';

const NOW = 1_750_000_000_000;

beforeEach(() => localStorage.clear());

function sampleDb() {
  const db = emptyDb();
  db.words.AGARIC = newWordEntry('AGARIC', 'a mushroom', 'api', NOW);
  return db;
}

describe('loadDb', () => {
  it('returns an empty db on first run', () => {
    expect(loadDb(NOW)).toEqual({ db: emptyDb(), recoveredFromCorrupt: false, migratedLegacy: false });
  });

  it('round-trips through saveDb', () => {
    const db = sampleDb();
    expect(saveDb(db)).toBe(true);
    expect(loadDb(NOW).db).toEqual(db);
  });

  it('quarantines corrupt data instead of deleting it', () => {
    localStorage.setItem(DB_KEY, 'not json{');
    const r = loadDb(NOW);
    expect(r.recoveredFromCorrupt).toBe(true);
    expect(r.db).toEqual(emptyDb());
    expect(localStorage.getItem(CORRUPT_KEY)).toBe('not json{');
    expect(localStorage.getItem(DB_KEY)).toBeNull();
  });

  it('migrates the legacy draft-app key once', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({
      new: [{ word: 'AGARIC', definition: 'a mushroom', timestamp: 1 }],
      mastered: [{ word: 'TIARA', definition: 'a crown', timestamp: 2 }],
    }));
    const r = loadDb(NOW);
    expect(r.migratedLegacy).toBe(true);
    expect(r.db.words.AGARIC).toMatchObject({ status: 'learning', box: 1, dueAt: NOW, definitionSource: 'api' });
    expect(r.db.words.TIARA).toMatchObject({ status: 'mastered' });
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(loadDb(NOW).db.words.AGARIC).toBeDefined(); // persisted under the new key
  });
});

describe('saveDb', () => {
  it('reports quota failures instead of throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(saveDb(sampleDb())).toBe(false);
    spy.mockRestore();
  });
});

describe('parseBackup', () => {
  it('accepts its own export', () => {
    const db = sampleDb();
    expect(parseBackup(exportDb(db))).toEqual(db);
  });

  it.each([
    'not json{',
    '{"schemaVersion":99,"words":{}}',
    '{"schemaVersion":1}',
    '{"schemaVersion":1,"words":[]}',
    '{"schemaVersion":1,"words":{"A":{"word":"A","status":"nope"}}}',
  ])('rejects invalid input: %s', (text) => {
    expect(parseBackup(text)).toBeNull();
  });
});

describe('mergeDb', () => {
  it('adds unknown words and counts them', () => {
    const r = mergeDb(emptyDb(), sampleDb());
    expect(r.added).toBe(1);
    expect(r.existing).toBe(0);
    expect(r.merged.words.AGARIC).toBeDefined();
  });

  it('newer addedAt wins for words present in both', () => {
    const older = newWordEntry('AGARIC', 'old def', 'api', NOW - 10);
    const newer = { ...newWordEntry('AGARIC', 'new def', 'api', NOW), box: 2 as const };
    const r = mergeDb(
      { schemaVersion: 1, words: { AGARIC: older } },
      { schemaVersion: 1, words: { AGARIC: newer } },
    );
    expect(r.merged.words.AGARIC).toMatchObject({ definition: 'new def', box: 2 });
    expect(r.existing).toBe(1);
  });

  it('mastered on either side always wins', () => {
    const masteredOld = knownWordEntry('TIARA', 'a crown', 'api', NOW - 10);
    const learningNew = newWordEntry('TIARA', 'a crown', 'api', NOW);
    const r = mergeDb(
      { schemaVersion: 1, words: { TIARA: masteredOld } },
      { schemaVersion: 1, words: { TIARA: learningNew } },
    );
    expect(r.merged.words.TIARA.status).toBe('mastered');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/storage.test.ts`
Expected: FAIL — cannot resolve `../storage`.

- [ ] **Step 3: Write `src/lib/storage.ts`**

```ts
import type { VocabDb } from './types';
import { emptyDb, SCHEMA_VERSION } from './types';
import { knownWordEntry, newWordEntry } from './leitner';

export const DB_KEY = 'beevocab.db.v1';
export const CORRUPT_KEY = 'beevocab.db.corrupt';
export const LEGACY_KEY = 'spelling_bee_vocab';

export interface LoadResult {
  db: VocabDb;
  recoveredFromCorrupt: boolean;
  migratedLegacy: boolean;
}

export function loadDb(now: number): LoadResult {
  const raw = localStorage.getItem(DB_KEY);
  if (raw !== null) {
    const db = parseBackup(raw);
    if (db) return { db, recoveredFromCorrupt: false, migratedLegacy: false };
    // Never silently discard user data: quarantine it, then start fresh.
    localStorage.setItem(CORRUPT_KEY, raw);
    localStorage.removeItem(DB_KEY);
    return { db: emptyDb(), recoveredFromCorrupt: true, migratedLegacy: false };
  }
  const legacy = readLegacy(now);
  if (legacy) {
    localStorage.removeItem(LEGACY_KEY);
    saveDb(legacy);
    return { db: legacy, recoveredFromCorrupt: false, migratedLegacy: true };
  }
  return { db: emptyDb(), recoveredFromCorrupt: false, migratedLegacy: false };
}

interface LegacyItem { word?: unknown; definition?: unknown }

function readLegacy(now: number): VocabDb | null {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw) as { new?: LegacyItem[]; mastered?: LegacyItem[] };
    if (!Array.isArray(data.new) || !Array.isArray(data.mastered)) return null;
    const db = emptyDb();
    for (const item of data.new) {
      if (typeof item.word !== 'string') continue;
      db.words[item.word] = newWordEntry(
        item.word, typeof item.definition === 'string' ? item.definition : '', 'api', now,
      );
    }
    for (const item of data.mastered) {
      if (typeof item.word !== 'string') continue;
      db.words[item.word] = knownWordEntry(
        item.word, typeof item.definition === 'string' ? item.definition : '', 'api', now,
      );
    }
    return db;
  } catch {
    return null;
  }
}

export function saveDb(db: VocabDb): boolean {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return true;
  } catch {
    return false; // quota exceeded — caller warns the user
  }
}

export function exportDb(db: VocabDb): string {
  return JSON.stringify(db, null, 2);
}

export function parseBackup(text: string): VocabDb | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof d.words !== 'object' || d.words === null || Array.isArray(d.words)) return null;
  for (const entry of Object.values(d.words as Record<string, unknown>)) {
    const w = entry as Record<string, unknown> | null;
    if (
      w === null || typeof w.word !== 'string' ||
      (w.status !== 'learning' && w.status !== 'mastered')
    ) {
      return null;
    }
  }
  return data as VocabDb;
}

export interface MergeResult {
  merged: VocabDb;
  added: number;
  existing: number;
}

export function mergeDb(current: VocabDb, incoming: VocabDb): MergeResult {
  const words = { ...current.words };
  let added = 0;
  let existing = 0;
  for (const [key, inc] of Object.entries(incoming.words)) {
    const cur = words[key];
    if (!cur) {
      words[key] = inc;
      added += 1;
      continue;
    }
    existing += 1;
    const winner = inc.addedAt > cur.addedAt ? inc : cur;
    const anyMastered = inc.status === 'mastered' || cur.status === 'mastered';
    words[key] = anyMastered && winner.status !== 'mastered'
      ? { ...winner, status: 'mastered' } // never un-master via import
      : winner;
  }
  return { merged: { schemaVersion: SCHEMA_VERSION, words }, added, existing };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/__tests__/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib
git commit -m "feat: versioned localStorage persistence with corrupt quarantine, legacy migration, backup merge" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Definition fetching (`dictionary.ts`)

**Files:**
- Create: `src/lib/dictionary.ts`
- Test: `src/lib/__tests__/dictionary.test.ts`

**Interfaces:**
- Consumes: `types.ts` (`PLACEHOLDER_DEFINITION`).
- Produces: `interface DefinitionResult { word: string; definition: string; source: 'api' | 'none' }`; `interface FetchOptions { signal?: AbortSignal; gapMs?: number; retryMs?: number; onProgress?: (done: number, total: number) => void }`; `fetchDefinitions(words: string[], opts?: FetchOptions): Promise<DefinitionResult[]>` — sequential, 300 ms default gap, one 2 s-delayed retry on 429, per-word fallback to placeholder, rejects with `AbortError` when `signal` aborts.

- [ ] **Step 1: Write the failing tests `src/lib/__tests__/dictionary.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDefinitions } from '../dictionary';
import { PLACEHOLDER_DEFINITION } from '../types';

const entry = (pos: string, def: string) =>
  [{ meanings: [{ partOfSpeech: pos, definitions: [{ definition: def }] }] }];
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) });
const opts = { gapMs: 0, retryMs: 0 };

afterEach(() => vi.unstubAllGlobals());

describe('fetchDefinitions', () => {
  it('extracts the first definition, prefixed with part of speech', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(entry('noun', 'A fungus.'))));
    const [r] = await fetchDefinitions(['AGARIC'], opts);
    expect(r).toEqual({ word: 'AGARIC', definition: '(noun) A fungus.', source: 'api' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.dictionaryapi.dev/api/v2/entries/en/agaric',
      expect.anything(),
    );
  });

  it('404 falls back to the editable placeholder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(404)));
    const [r] = await fetchDefinitions(['XYZZY'], opts);
    expect(r).toEqual({ word: 'XYZZY', definition: PLACEHOLDER_DEFINITION, source: 'none' });
  });

  it('retries once on 429', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(ok(entry('noun', 'A crown.')));
    vi.stubGlobal('fetch', f);
    const [r] = await fetchDefinitions(['TIARA'], opts);
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('api');
  });

  it('a second 429 becomes not-found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(429)));
    const [r] = await fetchDefinitions(['TIARA'], opts);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('none');
  });

  it('network errors do not block the rest of the batch', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(ok(entry('noun', 'A crown.')));
    vi.stubGlobal('fetch', f);
    const rs = await fetchDefinitions(['XYZZY', 'TIARA'], opts);
    expect(rs[0].source).toBe('none');
    expect(rs[1].source).toBe('api');
  });

  it('reports progress after each word', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(404)));
    const seen: Array<[number, number]> = [];
    await fetchDefinitions(['AAAA', 'BBBB'], { ...opts, onProgress: (d, t) => seen.push([d, t]) });
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });

  it('abort rejects with AbortError', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    }));
    await expect(
      fetchDefinitions(['AAAA', 'BBBB'], { ...opts, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/dictionary.test.ts`
Expected: FAIL — cannot resolve `../dictionary`.

- [ ] **Step 3: Write `src/lib/dictionary.ts`**

```ts
import { PLACEHOLDER_DEFINITION } from './types';

export interface DefinitionResult {
  word: string;
  definition: string;
  source: 'api' | 'none';
}

export interface FetchOptions {
  signal?: AbortSignal;
  gapMs?: number;    // pause between words; dictionaryapi.dev throttles bursts
  retryMs?: number;  // pause before the single 429 retry
  onProgress?: (done: number, total: number) => void;
}

const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
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

function extractDefinition(data: unknown): string | null {
  if (!Array.isArray(data)) return null;
  const meaning = (data[0] as { meanings?: Array<{ partOfSpeech?: unknown; definitions?: Array<{ definition?: unknown }> }> })?.meanings?.[0];
  const def = meaning?.definitions?.[0]?.definition;
  if (typeof def !== 'string' || def.length === 0) return null;
  const pos = meaning?.partOfSpeech;
  return typeof pos === 'string' && pos.length > 0 ? `(${pos}) ${def}` : def;
}

interface Attempt { definition: string; source: 'api' | 'none'; rateLimited: boolean }

const NOT_FOUND: Attempt = { definition: PLACEHOLDER_DEFINITION, source: 'none', rateLimited: false };

async function fetchOne(word: string, signal?: AbortSignal): Promise<Attempt> {
  try {
    const res = await fetch(API + word.toLowerCase(), { signal });
    if (res.status === 429) return { ...NOT_FOUND, rateLimited: true };
    if (!res.ok) return NOT_FOUND;
    const definition = extractDefinition(await res.json());
    return definition ? { definition, source: 'api', rateLimited: false } : NOT_FOUND;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return NOT_FOUND; // per-word network failure never blocks the batch
  }
}

export async function fetchDefinitions(
  words: string[],
  opts: FetchOptions = {},
): Promise<DefinitionResult[]> {
  const { signal, gapMs = 300, retryMs = 2000, onProgress } = opts;
  const results: DefinitionResult[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i > 0) await sleep(gapMs, signal);
    let attempt = await fetchOne(words[i], signal);
    if (attempt.rateLimited) {
      await sleep(retryMs, signal);
      attempt = await fetchOne(words[i], signal);
    }
    results.push({ word: words[i], definition: attempt.definition, source: attempt.source });
    onProgress?.(i + 1, words.length);
  }
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/__tests__/dictionary.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib
git commit -m "feat: sequential dictionary fetching with 429 backoff and per-word fallback" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Toast, TabBar, VocabProvider, App shell with stub screens

**Files:**
- Create: `src/components/Toast.tsx`, `src/components/TabBar.tsx`, `src/context/VocabProvider.tsx`, `src/screens/StudyScreen.tsx`, `src/screens/AddScreen.tsx`, `src/screens/WordsScreen.tsx`, `src/screens/DataScreen.tsx`
- Modify: `src/App.tsx` (full rewrite)
- Test: `src/__tests__/App.test.tsx` (delete `src/__tests__/App.smoke.test.tsx` — superseded)

**Interfaces:**
- Consumes: `storage.ts` (`loadDb`, `saveDb`, `mergeDb`), `leitner.ts` (grading/entry functions), `types.ts`, `dictionary.ts` (`DefinitionResult` type only).
- Produces (all later screen tasks build on these):
  - `Toast.tsx`: `ToastProvider`, `useToast(): { show(message: string): void }` — renders a `role="status"` element for 4 s.
  - `TabBar.tsx`: `type Tab = 'study' | 'add' | 'words' | 'data'`; `TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void })`.
  - `VocabProvider.tsx`: `VocabProvider`, `useVocab(): VocabContextValue`, `interface ImportSelection { learn: DefinitionResult[]; known: DefinitionResult[]; resets: string[] }`, where `VocabContextValue` is `{ db: VocabDb; commitImport(sel: ImportSelection): void; gradeWord(word: string, gotIt: boolean): void; editDefinition(word: string, definition: string): void; deleteWord(word: string): void; unmasterWord(word: string): void; importBackup(incoming: VocabDb): void; resetDb(): void }`.
  - Screen files: default exports; Task 7 versions are stubs rendering `<h2>` headings (`Study`, `Add`, `Words`, `Data`) that Tasks 8/10/11/12 replace.

- [ ] **Step 1: Write the failing test `src/__tests__/App.test.tsx`** (and delete `App.smoke.test.tsx`)

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { DB_KEY } from '../lib/storage';

it('shows the Study tab by default and switches tabs', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /bee vocab builder/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Study' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^words$/i }));
  expect(screen.getByRole('heading', { name: 'Words' })).toBeInTheDocument();
});

it('quarantines corrupt storage and tells the user via toast', () => {
  localStorage.setItem(DB_KEY, '{broken');
  render(<App />);
  expect(screen.getByRole('status')).toHaveTextContent(/started fresh/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/App.test.tsx`
Expected: FAIL — `App` has no tabs, provider, or toast yet, so the `Words` button and the `role="status"` element are missing.

- [ ] **Step 3: Write `src/components/Toast.tsx`**

```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastContextValue {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {message && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {message}
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

- [ ] **Step 4: Write `src/components/TabBar.tsx`**

```tsx
export type Tab = 'study' | 'add' | 'words' | 'data';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'study', label: 'Study', icon: '🃏' },
  { id: 'add', label: 'Add', icon: '📷' },
  { id: 'words', label: 'Words', icon: '📚' },
  { id: 'data', label: 'Data', icon: '💾' },
];

export function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-md">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex min-h-[44px] flex-1 flex-col items-center py-2 text-xs font-semibold ${
              tab === t.id ? 'text-amber-600' : 'text-slate-500'
            }`}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
```

- [ ] **Step 5: Write `src/context/VocabProvider.tsx`**

```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import type { VocabDb, VocabWord } from '../lib/types';
import { emptyDb } from '../lib/types';
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
    editDefinition: (word, definition) =>
      updateWord(word, (w) => ({ ...w, definition, definitionSource: 'manual' })),
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
```

- [ ] **Step 6: Write the four stub screens**

`src/screens/StudyScreen.tsx`:
```tsx
export default function StudyScreen() {
  return <h2 className="text-lg font-bold">Study</h2>;
}
```

`src/screens/AddScreen.tsx`:
```tsx
export default function AddScreen() {
  return <h2 className="text-lg font-bold">Add</h2>;
}
```

`src/screens/WordsScreen.tsx`:
```tsx
export default function WordsScreen() {
  return <h2 className="text-lg font-bold">Words</h2>;
}
```

`src/screens/DataScreen.tsx`:
```tsx
export default function DataScreen() {
  return <h2 className="text-lg font-bold">Data</h2>;
}
```

- [ ] **Step 7: Rewrite `src/App.tsx`**

```tsx
import { useState } from 'react';
import { ToastProvider } from './components/Toast';
import { TabBar, type Tab } from './components/TabBar';
import { VocabProvider } from './context/VocabProvider';
import StudyScreen from './screens/StudyScreen';
import AddScreen from './screens/AddScreen';
import WordsScreen from './screens/WordsScreen';
import DataScreen from './screens/DataScreen';

export default function App() {
  const [tab, setTab] = useState<Tab>('study');
  return (
    <ToastProvider>
      <VocabProvider>
        <div className="min-h-screen bg-slate-50 text-slate-800">
          <header className="mx-auto max-w-md px-4 pb-2 pt-6 text-center">
            <h1 className="text-2xl font-bold text-amber-500">🐝 Bee Vocab Builder</h1>
          </header>
          <main className="mx-auto max-w-md px-4 pb-24">
            {tab === 'study' && <StudyScreen />}
            {tab === 'add' && <AddScreen />}
            {tab === 'words' && <WordsScreen />}
            {tab === 'data' && <DataScreen />}
          </main>
          <TabBar tab={tab} onChange={setTab} />
        </div>
      </VocabProvider>
    </ToastProvider>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all test files green (smoke test file deleted, App test passing).

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: app shell with tab navigation, toast system, and persistent VocabProvider" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Study screen with flip card and grading

**Files:**
- Create: `src/lib/format.ts`, `src/components/DefinitionEditor.tsx`
- Modify: `src/screens/StudyScreen.tsx` (replace stub)
- Test: `src/lib/__tests__/format.test.ts`, `src/screens/__tests__/StudyScreen.test.tsx`

**Interfaces:**
- Consumes: `useVocab` (`db`, `gradeWord`, `editDefinition`), `leitner.ts` (`dueWords`, `nextDueAt`), `types.ts`.
- Produces: `format.ts`: `formatUntil(ms: number): string` (e.g. `in 5 min`, `in 3 h`, `tomorrow`, `in 3 days`); `DefinitionEditor({ word, initial, onDone }: { word: string; initial: string; onDone: () => void })` — textarea + Save/Cancel, saves via `useVocab().editDefinition` (Task 11 reuses it).

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/format.test.ts`:
```ts
import { expect, it } from 'vitest';
import { formatUntil } from '../format';

it('formats durations for the next-due message', () => {
  expect(formatUntil(5 * 60_000)).toBe('in 5 min');
  expect(formatUntil(3 * 3_600_000)).toBe('in 3 h');
  expect(formatUntil(30 * 3_600_000)).toBe('tomorrow');
  expect(formatUntil(72 * 3_600_000)).toBe('in 3 days');
});
```

`src/screens/__tests__/StudyScreen.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { newWordEntry } from '../../lib/leitner';
import { SCHEMA_VERSION } from '../../lib/types';
import type { VocabWord } from '../../lib/types';

function seed(...words: VocabWord[]) {
  localStorage.setItem(DB_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    words: Object.fromEntries(words.map((w) => [w.word, w])),
  }));
}

it('flips the card and "Got it" advances the session', async () => {
  seed(newWordEntry('AGARIC', 'a gilled mushroom', 'api', Date.now() - 1000));
  render(<App />);
  expect(screen.getByRole('heading', { name: 'AGARIC' })).toBeInTheDocument();
  expect(screen.queryByText(/gilled mushroom/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('heading', { name: 'AGARIC' }));
  expect(screen.getByText(/gilled mushroom/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /got it/i }));
  expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC.box).toBe(2);
});

it('"Missed" sends the word back to box 1 and counts a lapse', async () => {
  seed({ ...newWordEntry('NUANCE', 'subtle difference', 'api', Date.now() - 1000), box: 2 });
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /missed/i }));
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.NUANCE).toMatchObject({ box: 1, lapses: 1 });
});

it('editing a definition from the card back marks it manual', async () => {
  seed(newWordEntry('AGARIC', 'a gilled mushroom', 'api', Date.now() - 1000));
  render(<App />);
  await userEvent.click(screen.getByRole('heading', { name: 'AGARIC' }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  const box = screen.getByRole('textbox', { name: /definition for AGARIC/i });
  await userEvent.clear(box);
  await userEvent.type(box, 'a gilled fungus');
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC).toMatchObject({
    definition: 'a gilled fungus',
    definitionSource: 'manual',
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/format.test.ts src/screens/__tests__/StudyScreen.test.tsx`
Expected: FAIL — `../format` unresolved; StudyScreen stub has no card.

- [ ] **Step 3: Write `src/lib/format.ts`**

```ts
export function formatUntil(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours <= 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}
```

- [ ] **Step 4: Write `src/components/DefinitionEditor.tsx`**

```tsx
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
```

- [ ] **Step 5: Replace `src/screens/StudyScreen.tsx`**

```tsx
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

  const due = dueWords(db, now);
  const current = due[0];
  const all = Object.values(db.words);
  const learning = all.filter((w) => w.status === 'learning').length;
  const mastered = all.length - learning;

  const grade = (gotIt: boolean) => {
    gradeWord(current.word, gotIt);
    setFlipped(false);
    setEditing(false);
    setNow(Date.now());
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
            <p className="text-base font-medium leading-relaxed text-slate-700">{current.definition}</p>
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className="mt-4 min-h-[44px] text-xs font-semibold text-amber-600"
            >
              Edit definition
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <button onClick={() => grade(false)} className="min-h-[44px] rounded-xl bg-slate-200 py-3 font-semibold text-slate-700">
          ❌ Missed
        </button>
        <button onClick={() => grade(true)} className="min-h-[44px] rounded-xl bg-amber-400 py-3 font-semibold text-slate-950 shadow-sm">
          ✅ Got it
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all test files green.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: Study screen with flip card, Leitner grading, and inline definition editing" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Tesseract assets script and OCR wrapper (`ocr.ts`)

**Files:**
- Create: `scripts/setup-tesseract-assets.mjs`, `src/lib/ocr.ts`
- Modify: `package.json` (add `setup:tesseract` script)

**Interfaces:**
- Consumes: nothing from the app (tesseract.js package).
- Produces: `interface OcrProgress { label: string; progress: number }` (progress 0..1); `class OcrError extends Error`; `recognizeImage(file: File, onProgress: (p: OcrProgress) => void): Promise<string>` (raw OCR text; throws `OcrError` on failure); `terminateOcr(): Promise<void>`. Assets land in `public/tesseract/` (gitignored — already covered by Task 1's `.gitignore`).

No unit tests: the WASM worker cannot run in jsdom. Verification is the script's file output, typecheck, and the end-to-end phone/browser smoke test in Task 13.

- [ ] **Step 1: Install tesseract.js**

Run: `npm install tesseract.js`
Expected: exit 0.

- [ ] **Step 2: Write `scripts/setup-tesseract-assets.mjs`**

Self-hosts all OCR assets so the app works offline (spec §9): worker JS and WASM cores copied from node_modules, English language data downloaded once (~11 MB, gitignored).

```js
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectRoot, 'public', 'tesseract');
await mkdir(outDir, { recursive: true });

await copyFile(
  path.join(projectRoot, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  path.join(outDir, 'worker.min.js'),
);

const coreDir = path.join(projectRoot, 'node_modules', 'tesseract.js-core');
for (const f of await readdir(coreDir)) {
  if (f.endsWith('.js') || f.endsWith('.wasm')) {
    await copyFile(path.join(coreDir, f), path.join(outDir, f));
  }
}

const lang = path.join(outDir, 'eng.traineddata.gz');
if (!existsSync(lang)) {
  console.log('downloading eng.traineddata.gz (~11 MB, one-time)…');
  const res = await fetch('https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz');
  if (!res.ok) throw new Error(`traineddata download failed: HTTP ${res.status}`);
  await writeFile(lang, Buffer.from(await res.arrayBuffer()));
}
console.log('tesseract assets ready in public/tesseract/');
```

- [ ] **Step 3: Add the npm script**

Add to `package.json` `"scripts"`:
```json
    "setup:tesseract": "node scripts/setup-tesseract-assets.mjs"
```

- [ ] **Step 4: Run the script and verify output**

Run: `npm run setup:tesseract && ls public/tesseract/`
Expected: prints `tesseract assets ready…`; listing shows `worker.min.js`, one or more `tesseract-core*.js`/`.wasm` files, and `eng.traineddata.gz`. (If tesseract.js-core's file names differ in the installed version, that's fine — the script copies whatever `.js`/`.wasm` files the package ships, which is what the worker's `corePath` directory lookup expects.)

- [ ] **Step 5: Write `src/lib/ocr.ts`**

```ts
import { createWorker, type Worker } from 'tesseract.js';

export interface OcrProgress {
  label: string;
  progress: number; // 0..1
}

export class OcrError extends Error {}

let workerPromise: Promise<Worker> | null = null;
let currentOnProgress: ((p: OcrProgress) => void) | null = null;

const assetBase = `${import.meta.env.BASE_URL}tesseract/`;

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('eng', 1, {
    workerPath: `${assetBase}worker.min.js`,
    corePath: assetBase,
    langPath: assetBase,
    logger: (m) => {
      if (m.status === 'recognizing text') {
        currentOnProgress?.({ label: 'Reading words…', progress: m.progress });
      }
    },
  });
  return workerPromise;
}

/** Upscale small screenshots 2x — tesseract accuracy drops on small text. */
async function toRecognizable(file: File): Promise<File | HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  if (Math.min(bitmap.width, bitmap.height) >= 1000) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width * 2;
  canvas.height = bitmap.height * 2;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export async function recognizeImage(
  file: File,
  onProgress: (p: OcrProgress) => void,
): Promise<string> {
  onProgress({ label: 'Loading OCR engine…', progress: 0 });
  let worker: Worker;
  try {
    worker = await getWorker();
  } catch (err) {
    workerPromise = null; // allow retry after a failed load
    throw new OcrError(`OCR engine failed to load: ${String(err)}`);
  }
  currentOnProgress = onProgress;
  try {
    const input = await toRecognizable(file);
    const { data } = await worker.recognize(input);
    return data.text;
  } catch (err) {
    throw new OcrError(`Recognition failed: ${String(err)}`);
  } finally {
    currentOnProgress = null;
  }
}

/** Free the worker's memory when leaving the Add tab. */
export async function terminateOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) await (await p).terminate();
}
```

(If the installed tesseract.js major version has a different `createWorker` signature, adapt the options object to it — the requirements are: `eng` language, self-hosted `workerPath`/`corePath`/`langPath` under `assetBase`, and a logger that surfaces recognition progress.)

- [ ] **Step 6: Typecheck, full test run, commit**

Run: `npm run typecheck && npm test`
Expected: both pass.

```bash
git add -A
git commit -m "feat: self-hosted tesseract assets script and lazy OCR worker wrapper" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Add screen — upload → OCR → review → fetch → commit wizard

**Files:**
- Modify: `src/screens/AddScreen.tsx` (replace stub)
- Test: `src/screens/__tests__/AddScreen.test.tsx`

**Interfaces:**
- Consumes: `useVocab` (`db`, `commitImport`), `useToast`, `parseCandidates`, `recognizeImage`/`terminateOcr`, `fetchDefinitions`.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing tests `src/screens/__tests__/AddScreen.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { knownWordEntry } from '../../lib/leitner';
import { SCHEMA_VERSION } from '../../lib/types';

vi.mock('../../lib/ocr', () => ({
  recognizeImage: vi.fn(async () => 'AGARIC NAIAD PANGRAM TIARA'),
  terminateOcr: vi.fn(async () => {}),
}));

vi.mock('../../lib/dictionary', () => ({
  fetchDefinitions: vi.fn(async (words: string[]) =>
    words.map((word) => ({ word, definition: `def of ${word}`, source: 'api' as const }))),
}));

function seedTiaraMastered() {
  localStorage.setItem(DB_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    words: { TIARA: knownWordEntry('TIARA', 'a crown', 'api', 1) },
  }));
}

async function uploadShot() {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
  const input = screen.getByLabelText(/upload solution screenshot/i);
  await userEvent.upload(input, new File(['x'], 'shot.png', { type: 'image/png' }));
  await screen.findByText('AGARIC');
}

it('review commits checked words and reset selections', async () => {
  seedTiaraMastered();
  await uploadShot();
  expect(screen.queryByText('PANGRAM')).not.toBeInTheDocument(); // UI junk filtered
  await userEvent.click(screen.getByRole('checkbox', { name: 'NAIAD' }));  // uncheck OCR junk
  await userEvent.click(screen.getByRole('checkbox', { name: /TIARA/ })); // reset to learning
  await userEvent.click(screen.getByRole('button', { name: /add 2 words/i }));
  await screen.findByRole('status');
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC).toMatchObject({
    status: 'learning', box: 1, definition: 'def of AGARIC',
  });
  expect(stored.words.NAIAD).toBeUndefined();
  expect(stored.words.TIARA).toMatchObject({ status: 'learning', box: 1, definition: 'a crown' });
});

it('"already know" imports straight to mastered', async () => {
  seedTiaraMastered();
  await uploadShot();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC: learn/i }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'NAIAD' }));
  await userEvent.click(screen.getByRole('button', { name: /add 1 word/i }));
  await screen.findByRole('status');
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC).toMatchObject({ status: 'mastered', definition: 'def of AGARIC' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/screens/__tests__/AddScreen.test.tsx`
Expected: FAIL — the stub has no upload input.

- [ ] **Step 3: Replace `src/screens/AddScreen.tsx`**

```tsx
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useVocab } from '../context/VocabProvider';
import { useToast } from '../components/Toast';
import { parseCandidates } from '../lib/parser';
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

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhase({ name: 'ocr', progress: { label: 'Loading OCR engine…', progress: 0 } });
    try {
      const text = await recognizeImage(file, (progress) => setPhase({ name: 'ocr', progress }));
      const parsed = parseCandidates(text, new Set(Object.keys(db.words)));
      setPhase({
        name: 'review',
        candidates: parsed.candidates.map((word) => ({ word, checked: true, know: false })),
        known: parsed.alreadyKnown.map((word) => ({ word, reset: false, current: db.words[word] })),
        filteredCount: parsed.filteredUi.length,
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
          Upload solution screenshot
        </label>
        <input
          id="shot"
          type="file"
          accept="image/png,image/jpeg"
          onChange={handleFile}
          className="w-full text-sm text-slate-500 file:mr-4 file:rounded-xl file:border-0 file:bg-amber-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-amber-700"
        />
        <p className="mt-2 text-xs text-slate-400">
          Works best with the NYT app's “Yesterday's Answers” page.
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
      <p className="text-sm text-slate-500">
        {phase.candidates.length} new · {phase.known.length} already in collection · {phase.filteredCount} filtered as UI text
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
                    <label htmlFor={`cand-${c.word}`} className="flex-1 font-semibold">
                      {c.word}
                    </label>
                    {c.checked && (
                      <button
                        onClick={() => setCandidate(c.word, { know: !c.know })}
                        aria-label={`${c.word}: ${c.know ? 'already know' : 'learn'}`}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
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
                    <label htmlFor={`known-${k.word}`} className="flex-1">
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all test files green.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: Add wizard with OCR review, already-know toggle, reset-to-learning, and cancellable fetching" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Words screen — browse, search, edit, delete, unmaster

**Files:**
- Modify: `src/screens/WordsScreen.tsx` (replace stub)
- Test: `src/screens/__tests__/WordsScreen.test.tsx`

**Interfaces:**
- Consumes: `useVocab` (`db`, `deleteWord`, `unmasterWord`), `DefinitionEditor`.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing tests `src/screens/__tests__/WordsScreen.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { knownWordEntry, newWordEntry } from '../../lib/leitner';
import { SCHEMA_VERSION } from '../../lib/types';
import type { VocabWord } from '../../lib/types';

function seed(...words: VocabWord[]) {
  localStorage.setItem(DB_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    words: Object.fromEntries(words.map((w) => [w.word, w])),
  }));
}

async function openWords() {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^words$/i }));
}

it('searches the word list', async () => {
  seed(
    newWordEntry('AGARIC', 'a mushroom', 'api', 1),
    knownWordEntry('TIARA', 'a crown', 'api', 2),
  );
  await openWords();
  expect(screen.getByText('AGARIC')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox'), 'TIA');
  expect(screen.queryByText('AGARIC')).not.toBeInTheDocument();
  expect(screen.getByText('TIARA')).toBeInTheDocument();
});

it('filters by status', async () => {
  seed(
    newWordEntry('AGARIC', 'a mushroom', 'api', 1),
    knownWordEntry('TIARA', 'a crown', 'api', 2),
  );
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /^mastered$/i }));
  expect(screen.queryByText('AGARIC')).not.toBeInTheDocument();
  expect(screen.getByText('TIARA')).toBeInTheDocument();
});

it('edits a definition from the list', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  const box = screen.getByRole('textbox', { name: /definition for AGARIC/i });
  await userEvent.clear(box);
  await userEvent.type(box, 'a gilled fungus');
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({
    definition: 'a gilled fungus',
    definitionSource: 'manual',
  });
});

it('deletes only after inline confirm', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: /really delete/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toBeUndefined();
});

it('unmaster returns a word to learning box 3', async () => {
  seed(knownWordEntry('TIARA', 'a crown', 'api', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /TIARA/ }));
  await userEvent.click(screen.getByRole('button', { name: /unmaster/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.TIARA).toMatchObject({
    status: 'learning',
    box: 3,
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/screens/__tests__/WordsScreen.test.tsx`
Expected: FAIL — stub has no search box or rows.

- [ ] **Step 3: Replace `src/screens/WordsScreen.tsx`**

```tsx
import { useState } from 'react';
import { useVocab } from '../context/VocabProvider';
import { DefinitionEditor } from '../components/DefinitionEditor';

type Filter = 'all' | 'learning' | 'mastered';

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
        {rows.map((w) => (
          <li key={w.word} className="rounded-2xl border border-slate-200 bg-white">
            <button
              onClick={() => open(w.word)}
              className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2 text-left"
            >
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
                {editing ? (
                  <DefinitionEditor word={w.word} initial={w.definition} onDone={() => setEditing(false)} />
                ) : (
                  <p className="text-sm text-slate-700">{w.definition}</p>
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
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: Words screen with search, status filter, edit, inline-confirm delete, unmaster" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Data screen — stats, export, import with preview, reset

**Files:**
- Modify: `src/screens/DataScreen.tsx` (replace stub)
- Test: `src/screens/__tests__/DataScreen.test.tsx`

**Interfaces:**
- Consumes: `useVocab` (`db`, `importBackup`, `resetDb`), `useToast`, `storage.ts` (`exportDb`, `parseBackup`, `mergeDb`).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing tests `src/screens/__tests__/DataScreen.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { newWordEntry } from '../../lib/leitner';
import { SCHEMA_VERSION } from '../../lib/types';
import type { VocabWord } from '../../lib/types';

function seed(...words: VocabWord[]) {
  localStorage.setItem(DB_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    words: Object.fromEntries(words.map((w) => [w.word, w])),
  }));
}

async function openData() {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^data$/i }));
}

it('rejects an invalid backup file', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  const bad = new File(['{"nope":true}'], 'bad.json', { type: 'application/json' });
  await userEvent.upload(screen.getByLabelText(/import backup/i), bad);
  expect(await screen.findByRole('status')).toHaveTextContent(/not a valid/i);
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toBeDefined();
});

it('previews and applies a backup merge', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  const backup = {
    schemaVersion: SCHEMA_VERSION,
    words: { TIARA: newWordEntry('TIARA', 'a crown', 'api', 2) },
  };
  const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
  await userEvent.upload(screen.getByLabelText(/import backup/i), file);
  expect(await screen.findByText(/1 new, 0 already present/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /confirm import/i }));
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.TIARA).toBeDefined();
  expect(stored.words.AGARIC).toBeDefined();
});

it('reset requires typing DELETE', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  const btn = screen.getByRole('button', { name: /reset everything/i });
  expect(btn).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/type delete/i), 'DELETE');
  expect(btn).toBeEnabled();
  await userEvent.click(btn);
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words).toEqual({});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/screens/__tests__/DataScreen.test.tsx`
Expected: FAIL — stub has no import input.

- [ ] **Step 3: Replace `src/screens/DataScreen.tsx`**

```tsx
import { useState, type ChangeEvent } from 'react';
import { useVocab } from '../context/VocabProvider';
import { useToast } from '../components/Toast';
import { exportDb, mergeDb, parseBackup } from '../lib/storage';
import type { VocabDb } from '../lib/types';

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
    const incoming = parseBackup(await file.text());
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
          className="w-full text-sm text-slate-500 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-semibold"
        />
        {preview && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
            <p>
              Backup contains {Object.keys(preview.incoming.words).length} words; {preview.added} new, {preview.existing} already present.
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
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: Data screen with stats, export/import backup with merge preview, guarded reset" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: PWA — manifest, icons, precache (incl. tesseract), README

**Files:**
- Create: `assets/icon.svg`, `assets/icon-maskable.svg`, `scripts/generate-icons.mjs`, `public/icons/` (generated PNGs, committed), `README.md`
- Modify: `vite.config.ts`, `src/main.tsx`, `tsconfig.json`, `.github/workflows/deploy.yml`, `package.json`

**Interfaces:**
- Consumes: the built app; `public/tesseract/` assets from Task 9.
- Produces: installable offline-capable PWA; `dist/manifest.webmanifest` + `dist/sw.js` on build.

- [ ] **Step 1: Install dependencies**

Run: `npm install -D vite-plugin-pwa sharp`
Expected: exit 0.

- [ ] **Step 2: Write `assets/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#f59e0b"/>
  <polygon points="256,80 408,168 408,344 256,432 104,344 104,168" fill="#1e293b"/>
  <text x="256" y="318" font-family="Arial, Helvetica, sans-serif" font-size="180" font-weight="bold" fill="#fbbf24" text-anchor="middle">B</text>
</svg>
```

- [ ] **Step 3: Write `assets/icon-maskable.svg`** (full-bleed background, artwork inside the 80% safe zone)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f59e0b"/>
  <polygon points="256,116 376,186 376,326 256,396 136,326 136,186" fill="#1e293b"/>
  <text x="256" y="305" font-family="Arial, Helvetica, sans-serif" font-size="140" font-weight="bold" fill="#fbbf24" text-anchor="middle">B</text>
</svg>
```

- [ ] **Step 4: Write `scripts/generate-icons.mjs`**

```js
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'icons');
await mkdir(outDir, { recursive: true });

const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
];
for (const [src, out, size] of jobs) {
  await sharp(path.join(root, 'assets', src)).resize(size, size).png().toFile(path.join(outDir, out));
  console.log(out);
}
```

- [ ] **Step 5: Generate the icons**

Add to `package.json` `"scripts"`:
```json
    "icons": "node scripts/generate-icons.mjs"
```
Run: `npm run icons && ls public/icons/`
Expected: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`. These PNGs get committed (they are app source, unlike the gitignored tesseract blobs).

- [ ] **Step 6: Add VitePWA to `vite.config.ts`** (replace full file)

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/SpellingBeeVocab/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Bee Vocab Builder',
        short_name: 'BeeVocab',
        description: 'Turn NYT Spelling Bee answer screenshots into flashcards.',
        start_url: '/SpellingBeeVocab/',
        scope: '/SpellingBeeVocab/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf8f5',
        theme_color: '#f59e0b',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole shell INCLUDING the self-hosted tesseract worker/WASM/
        // traineddata so OCR works fully offline after first load (~15 MB total).
        globPatterns: ['**/*.{js,css,html,png,svg,wasm,gz}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    globals: true,
  },
});
```

- [ ] **Step 7: Register the service worker in `src/main.tsx`** (replace full file)

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

registerSW();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Add the PWA client types to `tsconfig.json`**

Change the `"types"` entry to:
```json
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom", "vite-plugin-pwa/client"]
```

- [ ] **Step 9: Add the tesseract setup step to `.github/workflows/deploy.yml`**

Insert between `npm ci` and `npm run build`:
```yaml
      - run: npm run setup:tesseract
```

- [ ] **Step 10: Verify the production build precaches everything**

Run: `npm run setup:tesseract && npm test && npm run build && ls dist/`
Expected: tests pass; `dist/` contains `sw.js`, `manifest.webmanifest`, `icons/`, and `tesseract/` (with `eng.traineddata.gz`).
Check: `grep -c 'tesseract' dist/sw.js` prints ≥ 1 (tesseract assets are in the precache manifest).

- [ ] **Step 11: Write `README.md`**

````markdown
# 🐝 Bee Vocab Builder

Offline-first PWA that turns NYT Spelling Bee answer screenshots into
Leitner-box flashcards. All data stays on-device; no backend.

Design spec: `docs/superpowers/specs/2026-07-12-spelling-bee-pwa-design.md`

## Development

```bash
npm install
npm run setup:tesseract   # one-time: self-host OCR assets (~15 MB, gitignored)
npm run dev               # http://localhost:5173/SpellingBeeVocab/
```

- `npm test` — unit + component tests (Vitest, jsdom)
- `npm run typecheck` — strict TypeScript
- `npm run build` / `npm run preview` — production build with service worker

## Deploying to GitHub Pages

1. Push this repo to GitHub as `SpellingBeeVocab` (the name must match the
   Vite `base` path in `vite.config.ts`).
2. In repo Settings → Pages, set **Source: GitHub Actions**.
3. Push to `main` — `.github/workflows/deploy.yml` builds and publishes to
   `https://<user>.github.io/SpellingBeeVocab/`.

## Manual smoke checklist (phone)

- [ ] Open the deployed URL in Chrome on Android; install to home screen;
      app launches standalone (no address bar), portrait.
- [ ] Upload a real "Yesterday's Answers" screenshot; review list shows the
      answer words; junk is uncheckable; definitions fetch with progress.
- [ ] Study a few cards: flip, Got it, Missed; counts update.
- [ ] Airplane mode: relaunch the app; Study works; uploading a screenshot
      still OCRs (definitions fall back to the editable placeholder).
- [ ] Data tab: export a backup; reset everything; import the backup;
      progress is fully restored.
````

- [ ] **Step 12: Final full verification and commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: everything green.

```bash
git add -A
git commit -m "feat: installable offline PWA with precached OCR assets, icons, and README" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 13: Manual verification in a real browser**

Run: `npm run preview` and open `http://localhost:4173/SpellingBeeVocab/` in a desktop browser.
Verify: app loads; DevTools → Application shows the manifest and an activated service worker; upload any screenshot image and confirm the OCR pipeline runs end-to-end (progress bar → review list). Then run the phone smoke checklist from the README after the first real deploy.

---

## Spec coverage map (self-review)

| Spec section | Task(s) |
|---|---|
| §2 Stack, base path | 1, 2 |
| §3 Architecture / module layout | 3–12 |
| §4 Data model, corrupt quarantine, legacy migration | 3, 5, 7 |
| §5 Leitner scheduling, 4 AM boundary | 3 |
| §6.1 Study screen | 8 |
| §6.2 Add wizard (review, already-know, resets, cancel, zero-candidates) | 10 |
| §6.3 Words screen (edit/delete/unmaster) | 11 |
| §6.4 Data screen (stats, export, import preview/merge, reset) | 12 |
| §7 OCR pipeline (upscale, blocklist, parse) | 4, 9 |
| §8 Definition fetching (gap, 429 retry, placeholder) | 6 |
| §9 PWA (manifest, precache incl. tesseract, autoUpdate) | 13 |
| §10 Error handling (toasts, quota, corrupt, invalid import) | 5, 7, 10, 12 |
| §11 Testing + CI + smoke checklist | 2–12, 13 (README) |
| §12 P2 backlog | intentionally not planned |
| §13 Milestones | tasks follow the same order |
