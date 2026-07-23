# Bee Vocab Builder — Full Design Spec

**Date:** 2026-07-12
**Status:** Approved design, ready for implementation planning
**Supersedes:** `spelling-bee-pwa-plan.md` (original draft; kept for reference)

## 1. Overview

An installable, offline-first Progressive Web App for building vocabulary from the
NYT Spelling Bee. The user photographs or screenshots the NYT Games app's
"Yesterday's Answers" page; the app OCRs it entirely in the browser, lets the user
review the extracted candidate words, auto-fetches definitions, and then teaches the
words through a Leitner-box spaced-repetition flashcard system.

- **Users:** single user, personal tool. No accounts, no sync.
- **Backend:** none. All computation and storage happen on-device.
- **Hosting:** GitHub Pages (static), served from the `/SpellingBeeVocab/` subpath.
- **Primary device:** Android phone via Chrome, installed to home screen. Must also
  work in desktop browsers.

### Goals

1. Screenshot → reviewed word list → flashcards in under a minute of user effort.
2. Retention that actually works: due-date-driven Leitner review, not an endless queue.
3. Fully usable offline after first load, except definition fetching.
4. User data survives and travels: versioned schema, and export/import backup
   whose file is the exact persisted database (including every word's box, due
   date, status, and lapses) — importing it on a new device resumes progress
   exactly.

### Non-goals (v1)

- Multi-user, sync, or any server component.
- Solving the puzzle or validating words against the day's 7 letters.
- Audio pronunciation and manual word entry (see §12, P2 backlog).

## 2. Tech stack

| Concern | Choice |
|---|---|
| Framework | React 18 + TypeScript, Vite |
| Styling | Tailwind CSS, mobile-first |
| OCR | `tesseract.js` (WASM, in-browser, `eng` model) |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`) |
| Storage | `localStorage`, single versioned key |
| Dictionary | `https://api.dictionaryapi.dev/api/v2/entries/en/{word}` |
| Tests | Vitest + React Testing Library |
| Deploy | GitHub Actions → GitHub Pages |

Vite `base` is `'/SpellingBeeVocab/'` from day one; the PWA manifest `scope` and
`start_url` match. No state-management library: React state plus a single context
(`VocabProvider`) owning the database object.

## 3. Architecture

Pure-logic core modules (no React, no DOM, unit-testable) with thin UI on top:

```
src/
  lib/
    types.ts        # VocabWord, VocabDb, schema types
    leitner.ts      # pure scheduling: promote, demote, dueWords, session order
    parser.ts       # OCR text -> candidate words (regex, blocklist, dedupe)
    dictionary.ts   # sequential definition fetching w/ backoff
    storage.ts      # load/save/migrate localStorage envelope, export/import merge
    ocr.ts          # tesseract worker wrapper (image -> raw text + progress)
  components/       # shared UI: Card, TabBar, Toast, ProgressBar, ...
  screens/
    StudyScreen.tsx
    AddScreen.tsx   # upload -> OCR -> review -> fetch -> commit wizard
    WordsScreen.tsx
    DataScreen.tsx
  context/
    VocabProvider.tsx  # owns db state, persists on change, exposes actions
  App.tsx           # tab routing (simple state-based, no router library)
  main.tsx
```

Rules:

- `lib/*` never imports React or touches `window` except `storage.ts`
  (localStorage) and `ocr.ts` (tesseract worker). `leitner.ts` and `parser.ts` are
  100% pure functions taking explicit `now: number` params — no hidden `Date.now()`.
- All mutations go through `VocabProvider` actions
  (`commitWords`, `gradeWord`, `editDefinition`, `deleteWord`, `importDb`, `resetDb`);
  screens never write storage directly.

## 4. Data model

```ts
type WordStatus = 'learning' | 'mastered';
type DefinitionSource = 'api' | 'manual' | 'none';

interface VocabWord {
  word: string;                 // UPPERCASE, unique key
  definition: string;           // placeholder text when source === 'none'
  definitionSource: DefinitionSource;
  status: WordStatus;
  box: 1 | 2 | 3;               // meaningful while status === 'learning';
                                // stays at 3 after mastery (harmless, kept for stats)
  dueAt: number;                // epoch ms; ignored when mastered
  addedAt: number;              // epoch ms
  lapses: number;               // count of demotions to box 1
}

interface VocabDb {
  schemaVersion: 1;
  words: Record<string, VocabWord>;   // keyed by word
}
```

Persistence: `localStorage['beevocab.db.v1']` holds `JSON.stringify(VocabDb)`.
`storage.load()` returns an empty db if the key is missing, and runs migrations if
`schemaVersion` is older than current (v1 has none; the hook exists so v2 is a
pure function `migrate(v1Db): v2Db`). A corrupt/unparseable value is not silently
discarded: it is copied to `beevocab.db.corrupt` before starting fresh, and a toast
tells the user.

There is one legacy migration: if the original draft app's key
`spelling_bee_vocab` exists (`{new: [], mastered: []}` shape), import it on first
load (new → learning/box 1/due now; mastered → mastered) and remove the old key.
(Cheap to implement, and protects any data created while experimenting with the
draft template.)

## 5. Leitner scheduling (`leitner.ts`)

- Intervals: **Box 1 = 1 day, Box 2 = 3 days, Box 3 = 7 days.**
- New words: `status: 'learning'`, `box: 1`, `dueAt: now` (due immediately).
- **Got it:** box 1 → 2, box 2 → 3 (with `dueAt = now + interval(newBox)`);
  box 3 → `status: 'mastered'`.
- **Missed:** box → 1, `dueAt = now + 1 day`, `lapses += 1`. (Not "due now" —
  re-showing a missed word later in the same session is a P2 nicety; v1 keeps
  sessions strictly due-driven.)
- **Day boundary:** all "day" math snaps `dueAt` to **4:00 AM local time** on the
  target day, so a review at 11 PM and one at 7 AM the next morning count as
  different days, and a word due "tomorrow" becomes due at 4 AM. Helper:
  `nextDayBoundary(now, days): number`.
- **Session:** `dueWords(db, now)` = learning words with `dueAt <= now`, ordered by
  box ascending (box 1 first), then `dueAt` ascending. The Study screen consumes
  this list one word at a time; grading a word immediately persists and recomputes.
- `nextDueAt(db, now)`: earliest future `dueAt` among learning words, for the
  empty-state message ("Next review in 5h" / "tomorrow").

## 6. Screens & UX

Bottom tab bar, four tabs: **Study · Add · Words · Data**. Amber/bee-themed
Tailwind styling in the spirit of the original draft (amber accents, slate
neutrals, rounded-2xl cards). Minimum touch target 44px. No `alert()`/`confirm()`
anywhere — a shared `Toast` component for transient messages and an inline
confirm pattern for destructive actions.

### 6.1 Study

- Header: "N words due" plus compact lifetime stats (learning / mastered counts).
- Card: front = word, large and centered, with box badge ("Box 2"); tap to flip;
  back = definition (and "tap to edit" affordance opening the same definition
  editor used in Words).
- Buttons: **Missed** (neutral style) and **Got it** (amber, primary). Grading
  advances to the next due word and resets the card to front side.
- Empty state (nothing due): 🎉 "All caught up", the next-due time from
  `nextDueAt`, and a shortcut to the Add tab.

### 6.2 Add (wizard, 3 steps in one screen)

1. **Upload:** file input, `accept="image/*"` (`capture` omitted so the photo
   library is the default on Android). On selection, run OCR with a progress bar
   fed by tesseract's progress callbacks ("Loading OCR engine… / Recognizing…").
2. **Review:** two sections, alphabetized, with a sub-line of counts
   ("12 new · 3 already in collection · 5 filtered as UI text"). If zero new
   candidates, show guidance ("Couldn't find words — try a tighter crop of the
   answers list").
   - **New candidates:** checkbox list, all checked by default (uncheck = OCR
     junk, not imported). Each checked word has a two-value toggle, default
     **Learn**; switching to **Already know** imports it directly as
     `mastered` — it joins the collection and stats and won't reappear as a
     candidate, but is never shown as a flashcard.
   - **Already in your collection:** words the OCR found that are already in the
     database, listed with their current status/box badge, **unchecked by
     default** (unchecked = no change). Checking one resets it to learning,
     box 1, due now (its definition and `lapses` are kept; no re-fetch).
3. **Commit:** button "Add N words". Definitions are fetched sequentially with a
   per-word progress line ("Fetching definitions… 7/12") for all newly imported
   words — including "Already know" ones, so the Words browser still shows their
   definitions. When done, a toast summarizes: "10 added to learning, 2 marked
   known, 1 reset to learning, 2 without definitions". Words with failed lookups
   are committed anyway with the placeholder (§8). Commit is atomic at the end
   of fetching (single db write), but fetching is interruptible: a Cancel button
   commits nothing (including resets).

### 6.3 Words

- Search box (substring match on word), filter chips: All / Learning / Mastered.
- Each row: word, box/mastered badge, first line of definition, lapses count.
- Tapping a row expands it: full definition, **Edit definition** (textarea →
  save sets `definitionSource: 'manual'`), **Delete** (inline confirm), and for
  mastered words an **Unmaster** action (back to learning, box 3, due now) in
  case something was graduated prematurely.

### 6.4 Data

- Stats block: total words, learning per box, mastered, total lapses.
- **Export:** downloads `beevocab-backup-YYYY-MM-DD.json` (the exact `VocabDb`
  envelope) via a Blob URL.
- **Import:** file picker → validate (must parse, have a known `schemaVersion`,
  and a `words` record; invalid files get a clear error toast and change nothing)
  → preview line "Backup contains 214 words; 30 new, 184 already present" →
  confirm → **merge**: unknown words are added as-is; for words present in both,
  the record with the newer `addedAt` wins entirely, except `status: 'mastered'`
  on either side always wins (never un-master via import). Importing into a
  fresh install (the new-device flow) is therefore an exact restore — every
  word resumes with its saved box, due date, and stats.
- **Reset:** danger-zone button with inline type-to-confirm ("type DELETE"),
  clears the db key.
- **Build info footer:** subtle single line at the bottom of the screen,
  `Build {commitSha} · {buildDate}` in small muted text — lets you confirm
  which deploy is actually running on a device (useful given `autoUpdate`
  applies silently, §9). Values are baked in at build time via `vite.config.ts`
  (`git rev-parse --short HEAD` and the build timestamp, exposed as the
  `__COMMIT_SHA__` / `__BUILD_TIME__` globals declared in `src/vite-env.d.ts`),
  not read at runtime — no network call, no backend.

## 7. OCR pipeline (`ocr.ts` + `parser.ts`)

**Input assumption (per user):** screenshots of the NYT Games app answers page —
dark serif words in columns on a white/cream background. Cleanest-case OCR; no
binarization needed.

- **`ocr.ts`:** `createWorker('eng')` on demand (lazy — never at app startup),
  reused across uploads within a session, terminated on tab switch away from Add.
  Preprocessing: if the image's smaller dimension is under ~1000px, upscale 2× via
  canvas before recognition (tesseract accuracy drops on small text). Progress
  callback surfaces tesseract's `status`/`progress` to the UI. Errors reject with
  a typed `OcrError` so the screen can show a human message.
- **`parser.ts`:** `parseCandidates(rawText, existingWords: Set<string>)` returns
  `{ candidates: string[], alreadyKnown: string[], filteredUi: string[] }`
  (the Add screen joins `alreadyKnown` against the db for status badges):
  1. Uppercase the text; extract `/[A-Z]{4,}/g` matches; dedupe.
  2. Drop blocklist hits (exported constant `UI_BLOCKLIST`): NYT chrome words —
     `PANGRAM, ANSWERS, YESTERDAY, TODAY, TODAYS, YESTERDAYS, WORDS, POINTS,
     GENIUS, QUEEN, SPELLING, GAMES, EDITED, FOUND, RANKINGS`, month names
     (`JANUARY…DECEMBER`), and day names (`SUNDAY…SATURDAY`). The list lives in
     one place and is trivially extendable when new junk shows up.
  3. Split out words already in the database (any status) into `alreadyKnown`
     for the review screen's second section (§6.2).
  4. Sort each list alphabetically.
- The review checklist (§6.2) is the final filter for anything heuristics miss —
  the design deliberately prefers a light blocklist + human review over clever
  heuristics that might eat real words. Blocklist entries are NYT chrome words
  that only rarely appear as puzzle answers, but collisions are possible (e.g.
  `QUEEN` or a month name could be a real answer); if that ever bites, P2 can
  surface filtered words as unchecked-by-default candidates instead of hiding
  them.

## 8. Definition fetching (`dictionary.ts`)

`fetchDefinitions(words, onProgress, signal)`:

- Sequential requests to
  `https://api.dictionaryapi.dev/api/v2/entries/en/{word.toLowerCase()}` with a
  **300 ms gap** between requests (the API rate-limits bursts; a 40-word puzzle
  finishes in ~15 s, acceptable behind a progress bar).
- Extract `data[0].meanings[0].definitions[0].definition`. Prefix with the part
  of speech when present ("(noun) A mushroom with gills…").
- **HTTP 429:** wait 2 s, retry once; second 429 → treat as not found.
- **404 / network error / abort of a single request:** word gets
  `definition: 'No definition found — tap to edit.'`, `definitionSource: 'none'`.
  Never blocks committing the word.
- `signal` (AbortSignal) supports the wizard's Cancel.
- Each result: `definitionSource: 'api'` on success. Manual edits anywhere set
  `'manual'` and are never overwritten by re-fetches.

## 9. PWA

Via `vite-plugin-pwa`, `registerType: 'autoUpdate'` (new deploys activate on next
launch; no update-prompt UI in v1). Since this is silent, the Data screen's
build info footer (§6.4) is the way to confirm a given install actually picked
up a deploy.

- **Manifest:** `name: "Bee Vocab Builder"`, `short_name: "BeeVocab"`,
  `display: "standalone"`, `orientation: "portrait"`,
  `background_color: "#faf8f5"`, `theme_color: "#f59e0b"`,
  `start_url` and `scope` under `/SpellingBeeVocab/`; icons 192×192, 512×512,
  plus a 512 maskable variant (simple generated bee/amber glyph checked into
  `public/icons/`).
- **Precache:** the built app shell **and the tesseract assets** — worker JS, WASM
  core, and `eng.traineddata.gz` are self-hosted in `public/tesseract/` (not
  pulled from a CDN at runtime) and precached, so OCR works fully offline. This
  adds ~15 MB to the precache; acceptable for a personal tool and stated in the
  README. `createWorker` is configured with local `workerPath/corePath/langPath`.
- **Runtime:** dictionary API is network-only (no caching — definitions are
  stored in the db, not re-fetched). Offline behavior: everything works except
  definition fetching, which fails per-word into the editable placeholder.

## 10. Error handling summary

| Failure | Behavior |
|---|---|
| OCR engine load/recognize fails | Toast with message; wizard returns to upload step |
| Zero candidates after parsing | Inline guidance to re-crop and retry |
| Definition 404/429/network | Placeholder definition, word still committed (§8) |
| localStorage quota exceeded on save | Toast "Storage full — export a backup"; db state kept in memory so an immediate export still works |
| Corrupt stored db | Preserved at `beevocab.db.corrupt`, fresh start, toast (§4) |
| Invalid import file | Validation error toast, no changes (§6.4) |

## 11. Testing & verification

- **Unit (Vitest):**
  - `leitner.ts`: promotion/demotion paths, 4 AM boundary math (incl. late-night
    review), due ordering, `nextDueAt`.
  - `parser.ts`: fixture file of real OCR output from an NYT answers screenshot
    (checked into `src/lib/__fixtures__/`), blocklist, dedupe, already-known
    split.
  - `storage.ts`: empty load, round-trip, corrupt-value quarantine, legacy-key
    migration, import merge rules (newer wins, mastered wins).
  - `dictionary.ts`: mocked fetch — success shape, 404, 429-retry, abort.
- **Component (RTL):** Add-wizard review flow (uncheck → commit count,
  "Already know" → mastered, reset-to-learning checkbox), Study
  grade-advances-card, Words edit/delete.
- **Manual smoke checklist** (in README): install to Android home screen,
  airplane-mode OCR, real screenshot end-to-end, export → reset → import.
- CI: GitHub Actions runs typecheck + tests on push; deploy job publishes `dist/`
  to Pages on `main`.

## 12. P2 backlog (explicitly out of v1)

1. **Audio pronunciation** — speak the word on the card front via
   `speechSynthesis` (offline-capable).
2. **Manual word entry** — type a word, fetch its definition, commit to box 1.
3. Same-session re-show of missed words; surfacing blocklist-filtered words as
   unchecked candidates; per-day review stats/streaks.

## 13. Milestones (implementation-plan seeds)

1. **Scaffold:** Vite + React + TS + Tailwind + vite-plugin-pwa, base path, CI,
   Pages deploy of a hello-world shell.
2. **Core lib:** types, storage, leitner, parser — TDD, all unit tests green.
3. **Study loop:** VocabProvider + Study screen against seeded data.
4. **Add pipeline:** ocr.ts (self-hosted assets), dictionary.ts, Add wizard.
5. **Words + Data screens:** browse/edit/delete, export/import, reset.
6. **PWA polish:** icons, precache incl. tesseract, offline verification, phone
   smoke test.
