# Bee Vocab Builder — Full Design Spec

**Date:** 2026-07-12 (originally); kept in sync with the shipped app — last reviewed 2026-08-24
**Status:** Implemented (v1) and actively extended; this document tracks current behavior, not just the original v1 plan
**Supersedes:** `spelling-bee-pwa-plan.md` (original draft; kept for reference)

> **Note on `docs/superpowers/plans/2026-07-12-bee-vocab-builder.md`:** that file is a
> historical, already-executed TDD build script for the original v1 implementation
> (Tasks 1–13). It is not updated task-by-task as the app evolves — this spec is the
> living source of truth for current behavior; the plan is kept only as a record of
> how v1 was originally built. Sections below marked with dates past 2026-07-12
> describe behavior added after that plan was executed.

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
- Manual word entry (see §12, P2 backlog).

## 2. Tech stack

| Concern | Choice |
|---|---|
| Framework | React 18 + TypeScript, Vite |
| Styling | Tailwind CSS, mobile-first |
| OCR | `tesseract.js` (WASM, in-browser, `eng` model) |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`) |
| Storage | `localStorage`, single versioned key |
| Dictionary | `https://api.dictionaryapi.dev/api/v2/entries/en/{word}` (default), optional Merriam-Webster Collegiate API (§8.3) |
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
    parser.ts       # OCR text -> hive letters + classified words (§7.2)
    dictionary.ts   # sequential definition fetching w/ backoff + alternates (§8)
    definitionDiff.ts # sense-level diff between an old and a re-fetched definition (§8.4)
    storage.ts      # load/save/migrate localStorage envelope, export/import merge
    ocr.ts          # tesseract worker wrapper (image -> 3 OCR passes + progress, §7.1)
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
// The provider that last successfully answered a fetch for this word — 'none' if
// the last attempt (or the only attempt ever made) found nothing. Independent of
// whether a human has since hand-edited the text (see manuallyEdited below).
type DefinitionSource = 'merriam-webster' | 'free-dictionary' | 'none';

interface VocabWord {
  word: string;                 // UPPERCASE, unique key
  definition: string;           // placeholder text when definition is empty
  definitionSource: DefinitionSource;
  manuallyEdited: boolean;      // true once a human has typed and saved definition text
  definitionUpdatedAt: number | null; // epoch ms of the last fetch or manual save; null
                                // if the word has never had real definition text
  status: WordStatus;
  box: 1 | 2 | 3;               // meaningful while status === 'learning';
                                // stays at 3 after mastery (harmless, kept for stats)
  dueAt: number;                // epoch ms; ignored when mastered
  addedAt: number;              // epoch ms
  lapses: number;               // count of demotions to box 1
}

interface VocabDb {
  schemaVersion: 2;
  words: Record<string, VocabWord>;   // keyed by word
}
```

Persistence: `localStorage['beevocab.db.v1']` holds `JSON.stringify(VocabDb)`.
`storage.load()` returns an empty db if the key is missing, and runs migrations if
`schemaVersion` is older than current. A corrupt/unparseable value is not silently
discarded: it is copied to `beevocab.db.corrupt` before starting fresh, and a toast
tells the user.

**v1 → v2 migration** *(added 2026-08-24, see §8.4)*: introduced by
`manuallyEdited`/`definitionUpdatedAt` and the narrower `DefinitionSource`. Applies
transparently wherever a v1 payload can enter the app — normal page load
(`loadDb`) and importing an old backup file (`parseBackup` → `mergeDb`) — so
neither path rejects a real user's pre-upgrade data as corrupt:

| v1 `definitionSource` | v2 `definitionSource` | v2 `manuallyEdited` | v2 `definitionUpdatedAt` |
|---|---|---|---|
| `'api'` | `'free-dictionary'` (MW support postdates every pre-migration word, so this is accurate, not a guess, for real installs) | `false` | `addedAt` (best available approximation — the true last-update time isn't recoverable either) |
| `'manual'` | `'none'` (the pre-edit source, if any, isn't recoverable) | `true` | `addedAt` (same approximation — the word had real, hand-edited text at some point) |
| `'none'` | `'none'` | `false` | `null` (the word never had real definition text, so `null` is exact here, not an approximation — same contract a freshly-created never-fetched word gets) |

`schemaVersion` is rewritten to `2`; every subsequent save writes v2.

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
  box descending (box 3 first, closest to Mastered), then `dueAt` ascending — so a
  backlog banks graduations before fresh box-1 words. The Study screen consumes
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
- Buttons (three, equal width): **Missed** (neutral), **Skip** (outline/tertiary),
  **Got it** (amber, primary). Grading advances to the next due word and resets
  the card to front side.
- **Skip** *(added 2026-07-27)*: defers the current card behind the rest of
  today's due queue without touching its `box`, `dueAt`, or `lapses` — it never
  costs a review the way "Missed" does, it just means "show me this one again in
  a bit." Implemented as session-local component state (an ordered list of
  skipped words layered on top of `dueWords()`'s output, not persisted to the
  db), so it resets if you leave the Study tab. Skipping the same card again
  pushes it further back rather than no-op'ing. Disabled when only one word is
  due, since there'd be nothing to defer behind.
- Empty state (nothing due): 🎉 "All caught up", the next-due time from
  `nextDueAt`, and a shortcut to the Add tab.
- **Audio pronunciation** *(added 2026-08-30)*: a 🔊 button next to the word on
  the card front (before flipping) speaks it via the browser's
  `speechSynthesis` API (`src/lib/speech.ts`), `lang: 'en-US'`. Hidden when
  `isSpeechSupported()` is false (feature-detects `window.speechSynthesis` —
  absent in some older/embedded browsers), rather than showing a button that
  would silently do nothing. Tapping it stops propagation so it doesn't flip
  the card, and cancels any in-flight utterance first so rapid taps don't
  queue up overlapping speech. Resolves the "audio pronunciation" P2 backlog
  item (§12); Merriam-Webster's recorded audio (§8.3) was considered and
  declined in favor of `speechSynthesis` working the same for every user.

### 6.2 Add (wizard, 3 steps in one screen)

1. **Upload:** file input, `accept="image/png,image/jpeg"`, **`multiple`**
   *(added 2026-07-26)* — a long answer list that didn't fit one screenshot can
   be selected as several files at once. Each file is OCR'd in turn (progress
   label includes "screenshot N of M" when there's more than one), and all
   their `text`/`boostedText`/`hiveText` are concatenated (newline-joined, in
   selection order) before a **single** `parseCandidates` call — see §7 for why
   this makes hive detection more reliable, not less, with more pages.
2. **Review:** a puzzle-letters banner first, then up to four sections, with a
   sub-line of counts ("12 new · 3 already in collection · 2 uncertain · 5
   filtered out"). If there's nothing in any section, show guidance ("Couldn't
   find words — try a tighter crop of the answers list").
   - **Puzzle-letters banner:** if `parseCandidates`'s `hive` came back
     non-null, show the 7 detected letters (center letter visually
     highlighted) with a note that new candidates below are limited to them —
     lets the user sanity-check OCR correctness at a glance instead of trusting
     the filtering blindly. If `hive` is null (no letter row detected), show a
     warning instead: candidates aren't letter-checked in that case (§7), so
     this surfaces exactly the failure mode that otherwise fails silently.
   - **New candidates:** checkbox list, all checked by default (uncheck = OCR
     junk, not imported). Each checked word has a two-value toggle, default
     **Learn**; switching to **Already know** imports it directly as
     `mastered` — it joins the collection and stats and won't reappear as a
     candidate, but is never shown as a flashcard.
     **Pangrams first** *(added 2026-07-26)*: words using all 7 hive letters
     are listed first under a small "Uses all 7 letters" divider, then the
     rest under "Other words" (each group still alphabetized) — mirrors the
     NYT page's own bolded-pangrams-on-top convention instead of one flat
     alphabetical list. Same grouping applied to **Already in your
     collection** below, for consistency.
   - **Already in your collection:** words the OCR found that are already in the
     database, listed with their current status/box badge, **unchecked by
     default** (unchecked = no change). Checking one resets it to learning,
     box 1, due now (its definition and `lapses` are kept; no re-fetch).
   - **Uncertain OCR readings** *(added 2026-07-27)*: entries from
     `parseCandidates`'s `corrections` list — words only recognized after
     correcting a likely OCR misread (see §7). Shows the **raw** OCR spelling
     (e.g. "LOTA") with a note that it was read as the corrected word already
     listed above ("IOTA"), **unchecked by default**. This is a sanity-check
     surface, not a second candidate: if the guessed correction looks wrong,
     checking the row lets the user add the raw spelling as its own word
     instead (with its own Learn/Know toggle), rather than silently trusting
     either the correction or the raw OCR text.
3. **Commit:** button "Add N words". Definitions are fetched sequentially with a
   per-word progress line ("Fetching definitions… 7/12") for all newly imported
   words — including "Already know" ones, so the Words browser still shows their
   definitions. When done, a toast summarizes: "10 added to learning, 2 marked
   known, 1 reset to learning, 2 without definitions". Words with failed lookups
   are committed anyway with the placeholder (§8). Commit is atomic at the end
   of fetching (single db write), but fetching is interruptible: a Cancel button
   commits nothing (including resets).
   - **Failed-word detail** *(added 2026-08-08)*: the "N without definitions"
     toast carries the specific failed words as collapsed detail — a "Show"
     toggle expands a chip list of them inline. Any toast carrying detail
     suspends the normal 4s auto-dismiss (replaced by an explicit close), since
     reading a word list against a countdown isn't fair; plain toasts elsewhere
     in the app are unaffected.

### 6.3 Words

- Search box (substring match on word), filter chips: All / Learning / Mastered.
- Each row: word, box/mastered badge, a small colored **provenance dot**
  (§8.4 — amber for Merriam-Webster, slate for the free dictionary, none for a
  manually-edited or still-empty definition), first line of definition, lapses
  count.
- Tapping a row expands it: a provenance label + "Added {date}" / "Updated
  {date}" line (§8.4), full definition, **Edit definition** (textarea → save
  sets `manuallyEdited: true`, `definitionUpdatedAt: now`, and leaves
  `definitionSource` as whichever provider it last came from — or reverts
  fully to the empty/placeholder state if left empty, resetting
  `definitionSource: 'none'` and `manuallyEdited: false` too — see §8.2; see
  §8.1 for the alternate-definition picker and Google lookup link available
  inside that editor), **Check for updated definition** (§8.4 — single-word
  re-fetch with a diff-and-adopt flow), **Delete** (inline confirm), and for
  mastered words an **Unmaster** action (back to learning, box 3, due now) in
  case something was graduated prematurely.
- **Bulk "fix missing definitions" mode** *(added 2026-08-24, see §8.4)*: when
  any word has `definitionSource === 'none'` and empty (placeholder) text, a
  "Fix N missing definitions" button appears above the list. Tapping it
  switches the list into a select-mode scoped to just those words (checkboxes,
  pre-checked) with a "Fetch selected" action.

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

**Input assumption (per user):** screenshots of the NYT app's word-list/reveal
screen — dark serif answer words in two columns, with the 7 hive letters (center
letter first, distinct gold color) shown as a heading above the list, and
whatever nav chrome/rank-dialog text happened to be on screen above that. Word
casing in the raw screenshot is consistently title-case: capital first letter,
lowercase after (this becomes load-bearing for OCR correction below). A long
answer list may span multiple screenshots — only the first typically has the
hive-letters row; later ones are just more answer words, possibly overlapping
words already seen on an earlier page (§6.2's multi-file upload).

### 7.1 `ocr.ts` — three OCR passes per screenshot

`createWorker('eng')` on demand (lazy — never at app startup), reused across
uploads within a session, terminated on tab switch away from Add. Recognizes at
the screenshot's native resolution — an earlier version upscaled anything under
1000px on the assumption that small text hurts tesseract's accuracy, but real
screenshots (~768px wide is a typical *common* phone screenshot width, not an
edge case) showed upscaling actively destroys the hive row's low-contrast gold
glyph under every interpolation kernel tried, with no measurable benefit
elsewhere; removed once verified against real screenshots.

Runs OCR **three times** per upload, returning `{ text, boostedText, hiveText }`:

1. **`text`** — pass over the untouched image. Used for the primary word list
   and as the first source for hive-row detection.
2. **`boostedText`** — pass over a grayscale + contrast-stretched +
   hard-thresholded copy (`boostContrast()`) that recovers faint/low-contrast
   text, e.g. a word rendered mid-fade-in right as the user found it, that
   pass 1 misses. The same luminance threshold that recovers faint text also
   erases the hive row's gold letter (gold has *high* luminance under the
   standard grayscale formula, so it gets thresholded to background-white,
   not merely misread) — this pass is always additive to pass 1's words,
   never a source for hive detection.
3. **`hiveText`** *(added 2026-07-25)* — pass over a **gold-aware ink mask**
   (`isolateInk()`): a pixel counts as ink if it's dark (ordinary black text,
   luminance-based, same as before) **or** distinctly gold-hued
   (`min(R,G) - B > 60`, catching gold's high-R/high-G/low-B signature that
   luminance alone treats as background). This is what lets a gold center
   letter that pass 1 misreads (e.g. "K" read as "W") get read correctly
   instead, without which pass 2's erasure would be the only alternative.
   Used exclusively as a fallback source of letters for hive-row detection
   (§7.2) — never merged into the general word pool, since it isn't tuned for
   ordinary body text.

Progress callback surfaces all three passes across a 0–33% / 33–66% / 66–100%
split, with labels ("Reading words…" / "Reading faint words…" / "Reading
puzzle letters…"). Errors reject with a typed `OcrError`.

### 7.2 `parser.ts` — hive detection, then word classification

`parseCandidates(rawText, existingWords: Set<string>, boostedText?, hiveText?)`
returns `{ candidates, alreadyKnown, filteredUi, filteredInvalidLetters, hive,
corrections }` (the Add screen joins `alreadyKnown` against the db for status
badges, sums `filteredUi.length + filteredInvalidLetters.length` for the review
screen's "N filtered out" count, renders `hive` as the puzzle-letters banner,
and renders `corrections` as the "Uncertain OCR readings" section — §6.2).
`hive` is `{ center: string, letters: string[] }` (center letter first) when a
hive row was found, else `null`.

**Stage 1 — finding the hive row, with cross-validation** *(rewritten
2026-07-25, originally just "first matching line"; position search widened
2026-08-08, see step 1)*:

A line of exactly 7 unique letters (OCR renders the row as one unspaced run,
e.g. `VAGILNT`) is a *candidate*, but taking the first one found in the text is
not enough on its own — screen chrome above the real row can coincidentally be
exactly 7 letters too (the "Answers" screen title, e.g., which happens to also
have a repeated letter and so gets excluded at this step — but nothing
guarantees the next stray phrase will be so considerate). So instead:

1. Collect every line of **6-8** letters and nothing else in `rawText`, in
   document order — a wider net than "exactly 7," used only to locate
   *position*. The gold center letter's glyph, not just its color, is what the
   raw pass can misread, so it can corrupt the row's *length* too (e.g. the
   true `NACDEHL` read as 8-character `NWACDEHL`), not just a same-length
   letter substitution — a strict 7-letter match would make that row invisible
   to detection entirely, with no candidate for the later steps to even
   consider.
2. Walk them from the end of the text backward (closest to the answer list
   first — the true hive row is always immediately above the list, so
   whatever chrome coincidentally matches the shape sits *earlier* in the
   text, never later).
3. For each candidate, extract the 4+ letter words immediately after it and
   check what fraction of them actually fit that letter set (contain the
   candidate's first letter, use no letter outside the set) — only when the
   candidate is exactly 7 unique letters; a 6- or 8-letter candidate has no
   valid letter set of its own to test and exists purely to supply a
   position for step 4. If **≥50%** validate, accept it — a candidate whose
   "hive" doesn't explain the real words after it is chrome, not the letter
   row, no matter how plausible its shape looked.
4. If a positionally-right candidate's own letters don't produce an accepted
   hive (either its *content* is wrong — see the gold-letter misread in
   §7.1 — or, per step 1, it isn't 7 letters at all), fall back to `hiveText`:
   collect 7-unique-letter candidates from that pass instead, and re-validate
   each against the *same* word pool. The first one that clears 50% is
   accepted in the raw candidate's place.
5. If nothing clears the bar anywhere, `hive` is `null` — filtering is
   skipped entirely for every downstream word rather than trusting an
   unvalidated guess (this is also why a wrong-but-accepted hive would be
   worse than no hive: see the ordering note at the end of §7.2).

Everything in `rawText` before the accepted candidate's line (nav chrome,
rank-dialog text — vocabulary that can't be blocklisted by word) is dropped.
This same cross-validation is what makes concatenating multiple screenshots
(§6.2) *more* reliable, not less: only the first page can supply a real hive
candidate, but every page's words contribute to the validation fraction, so
detection only gets more confident with a longer combined answer list.

**Stage 2 — OCR correction, once a hive is confirmed** *(added 2026-07-27)*:

A confirmed hive (≥50% of real words already validated against it) is treated
as ground truth reliable enough to justify correcting individual words, not
just picking the hive line — so before classifying a word, `normalizeOcrToken`
is tried on it:

- **Leading lowercase "l" → "I".** Every answer word is title-cased (see the
  input assumption above), which is what makes this safe: a lowercase "l" can
  only legitimately appear *after* the first character (e.g. "Ballot"); one
  *in* the leading position is unambiguously a misread capital "I" (observed:
  "Iota" → "lota", "Ionization" → "lonization", both in the raw and
  boosted passes — the misread isn't a contrast/color problem like the gold
  letter, just a shape collision between two glyphs).
- **Any digit → its letter look-alike, at any position** (`0→O`, `1→I`,
  `5→S`). No digit is ever legitimate in an answer word regardless of
  position, so this needs no leading-character restriction.

A correction is only *used* if it changes the outcome: the corrected form
must pass hive validation while the original did not (an already-valid word
is left untouched, and nothing is attempted at all without a confirmed hive —
no ground truth, no correction). When used, the corrected spelling is what
gets classified in step 2 below; the original raw OCR spelling is recorded in
`corrections` for the review screen (§6.2) rather than silently discarded.
Token extraction preserves original case up to this point (uppercasing only
after the leading-position check) specifically so this distinction is
possible.

**Stage 3 — classifying every remaining word:**

1. Uppercase the (possibly corrected) token; dedupe.
2. Drop blocklist hits (exported constant `UI_BLOCKLIST`) into `filteredUi`:
   NYT chrome words — `PANGRAM, ANSWERS, YESTERDAY, TODAY, TODAYS, YESTERDAYS,
   WORDS, POINTS, GENIUS, QUEEN, SPELLING, GAMES, EDITED, FOUND, RANKINGS`,
   month names (`JANUARY…DECEMBER`), and day names (`SUNDAY…SATURDAY`).
   Then, if a hive was found, drop any word using a letter outside the hive
   or missing the center letter into `filteredInvalidLetters`. **This
   ordering matters**: a word only reaches "already known" if it first
   fits the hive, so a wrong-but-accepted hive could hide real known words
   behind `filteredInvalidLetters` — which is exactly why Stage 1 requires
   ≥50% validation before accepting a hive at all rather than falling back
   to this per-word check to catch a bad guess after the fact.
3. Split remaining words already in the database (any status) into
   `alreadyKnown` for the review screen's second section (§6.2). Everything
   else is a new `candidate`.
4. Sort each list alphabetically (`corrections` sorted by the raw spelling).
- `boostedText`, when a hive was found, is folded into the word pool for
  steps 1–3 above (its extra OCR noise is safe only because every word,
  chrome garbling included, still has to pass hive validation). If no hive
  row is found, `boostedText` is ignored entirely — without a hive to
  validate against, there's no safety net for its noise. `hiveText` is never
  folded into the word pool; it is only ever consulted during hive detection
  (Stage 1, step 4 above).
- The review checklist (§6.2) is the final filter for anything heuristics miss —
  the design deliberately prefers blocklist + hive validation + human review
  over cleverness that might eat real words. Blocklist entries are NYT chrome
  words that only rarely appear as puzzle answers, but collisions are possible
  (e.g. `QUEEN` or a month name could be a real answer); if that ever bites, P2
  can surface filtered words as unchecked-by-default candidates instead of
  hiding them.
- **Known residual gap:** an unpaired pangram word (one using all 7 hive
  letters) that happens to render alone on its own line — no second column
  entry, no "+" checkmark — is structurally indistinguishable from a true
  hive row by shape alone. In practice this is rare (pangrams normally share
  a line with another word) and, if it happens on a continuation screenshot
  with no real hive row present, the failure mode is losing one word (it
  gets treated as a consumed header) rather than corrupting the whole list.
  Not solved; noted here rather than silently accepted.

## 8. Definition fetching (`dictionary.ts`)

`fetchDefinitions(words, onProgress, signal)`:

- Sequential requests, one per word, with a **300 ms gap** between requests
  (dictionaryapi.dev rate-limits bursts; a 40-word puzzle finishes in ~15 s,
  acceptable behind a progress bar).
- **Provider adapter pattern** *(added 2026-08-08, see §8.3)*: each source
  (dictionaryapi.dev, optionally Merriam-Webster) has its own parser that
  normalizes that source's raw JSON into the shared shape
  `DefinitionAlternative[] = { partOfSpeech: string; definition: string }[]`.
  Everything downstream — sense grouping, formatting, the alternates picker
  (§8.1) — operates only on that normalized shape and has no source-specific
  branching. This is what lets Merriam-Webster be added as a second source
  without touching grouping/formatting/UI code, and what any future source
  would plug into the same way.
- **Sense grouping** *(added 2026-08-08)*: from a word's normalized
  alternatives (in source order), keep the first definition per distinct
  `partOfSpeech`, capped at **3** groups, joined with `"\n\n"` — each group
  formatted as before ("(noun) A mushroom with gills…"). Previously only
  `alternatives[0]` was kept; grouping exists because a single "first sense"
  is not necessarily the most common one — neither source orders strictly by
  frequency — and a word's common meaning often differs by part of speech
  (e.g. "novel" as adjective vs. noun), which a single pick can never
  capture. §8.1 (browsing every sense, not just the auto-picked ones) remains
  the mitigation for the *within-part-of-speech* case (grouping still only
  keeps one sense per part of speech).
- Rendered with `whitespace-pre-line` wherever a definition is shown in full
  (Study card back, Words row detail — not the Words list's truncated
  preview), so the `"\n\n"` group separators render as paragraph breaks
  instead of collapsing.
- **HTTP 429:** wait 2 s, retry once; second 429 → treat as not found.
- **404 / network error / abort of a single request:** word gets
  `definition: 'No definition found — tap to edit.'`, `definitionSource: 'none'`.
  Never blocks committing the word.
- `signal` (AbortSignal) supports the wizard's Cancel.
- Each result carries which specific provider answered —
  `definitionSource: 'merriam-webster' | 'free-dictionary'` on success,
  `'none'` on a miss (§8.4). A fetch never runs against a word that already
  has a real, human-entered definition unless the user explicitly triggers it
  (single re-fetch, §8.4) — the bulk import/bulk-missing-definitions paths
  only ever target words that are still empty.
- **Abort detection gotcha** *(fixed 2026-07-27)*: a real `fetch()` abort
  throws a `DOMException` named `"AbortError"`. Checking `err instanceof
  Error` to detect it works in real browsers (`DOMException` extends `Error`
  there) but silently returns `false` under jsdom, the test runtime — so the
  existing Cancel-button test only passed via an unrelated `sleep()`
  rejection on the *next* word, not because the check actually worked. Fixed
  by also checking `err instanceof DOMException`, which is correct regardless
  of runtime.

### 8.1 Alternate definitions and manual lookup *(added 2026-07-27)*

Surfaced inside the same definition editor used by both Study (§6.1) and
Words (§6.3):

- **`fetchAlternateDefinitions(word)`**: a separate, on-demand fetch (not part
  of the rate-limited import batch — no retry/backoff) against the **active
  provider** (§8.3 — Merriam-Webster if a key is configured, else
  dictionaryapi.dev, same as import), flattening *every* meaning/definition
  across *every* entry in the response, instead of just the grouped subset
  §8 auto-picks. Triggered by a "See other dictionary definitions" button in
  the editor; each alternative is listed with a **Use** button that drops it
  into the textarea (the currently-showing text is filtered out of the list).
  A "No other definitions found" message covers the empty/error case.
- **"Look up on Google" link**: a plain `<a target="_blank">` to
  `google.com/search?q=define+{word}`, not a fetch — there's no public Google
  definitions API, and scraping Google's search HTML would hit CORS in this
  client-only PWA (no backend to proxy through) as well as being fragile/ToS-
  risky. This is a manual fallback alongside the API-backed alternatives
  above, not a replacement for them.
- Using either path still goes through the normal Save button, which sets
  `manuallyEdited: true` and `definitionUpdatedAt: now` — same as any other
  hand-edit (§8.4); `definitionSource` is left as whichever provider the text
  last actually came from.

### 8.2 Placeholder-aware editing *(added 2026-08-04)*

When a word's definition is the "not found" placeholder
(`PLACEHOLDER_DEFINITION`, `definitionSource: 'none'`), opening the editor
starts the textarea empty instead of pre-filled with the placeholder text —
so the common case (pasting a definition in after OCR/API lookup came up
empty) doesn't require manually selecting and deleting the placeholder first.
Saving is symmetric: if the textarea is empty (or whitespace-only) on Save,
`editDefinition` writes the placeholder back and resets to the full blank
state — `definitionSource: 'none'`, `manuallyEdited: false`,
`definitionUpdatedAt: null` — rather than persisting an empty string as a
manually-edited definition.

### 8.3 Optional Merriam-Webster source *(added 2026-08-08)*

dictionaryapi.dev (a Wiktionary wrapper) remains the zero-setup default: no
key, no signup, unchanged behavior for anyone who doesn't opt in. Merriam-
Webster's Collegiate Dictionary API (free registration at dictionaryapi.com)
is an opt-in alternative — its senses are curated/ordered by commonality
rather than Wiktionary's etymological/internal ordering, which is the direct
fix for "definitions are often the uncommon meaning."

- **Settings UI:** a new "Dictionary source" section in the Data screen
  (§6.4) — a masked API-key input, Save/Clear buttons, and status text
  showing which source is currently active. Save performs one lightweight
  lookup (e.g. the word "test") before accepting the key, so a typo surfaces
  immediately rather than silently degrading every future import.
  **Test key** *(added 2026-08-24)*: once a key is saved, a "Test key" button
  re-runs that same lookup+parse check on demand (key rotation, MW-side
  outages, or a key that's since been revoked can all make a previously-valid
  key stop working silently) — reuses `validateMwApiKey` and shows the same
  valid/invalid/network-error outcomes inline as the original save-time check.
- **Key storage:** its own `localStorage` entry (`beevocab.mwApiKey`),
  separate from the `VocabDb` envelope (§4) — deliberately **excluded** from
  `exportDb`/`importBackup` (§6.4). Backups are meant to move between devices
  or be handed off; a secret shouldn't ride along in that file. The key never
  leaves the device otherwise (no backend to send it to).
- **Provider parser:** `parseMwAlternatives(data)` normalizes MW's response
  into the same `DefinitionAlternative[]` shape §8 already defines (MW
  returns an array of plain strings, not entry objects, when it only has
  spelling suggestions for an unmatched word — that shape is treated as "not
  found," same as dictionaryapi.dev's 404). Because grouping/formatting/UI
  are already written against that shared shape (§8's adapter pattern), no
  other code changes when this provider is added.
- **Fetch chain:** when a key is configured, `fetchOne(word)` tries MW first
  (with its own §8 429-retry-once applied to just the MW request); if MW
  still has no result after that (no entry, error, or a second 429), it
  falls back to dictionaryapi.dev for that same word — same 429-retry-once
  behavior applied there too — before giving up. Maximizes success rate at
  the cost of up to one extra request on MW misses. No key configured →
  behavior is unchanged (dictionaryapi.dev only).
- **`definitionSource`** distinguishes which provider actually answered
  (`'merriam-webster' | 'free-dictionary'`) — see §8.4 for how that's surfaced.
- **File layout:** `dictionary.ts` grows a provider seam —
  `lib/dictionaryProviders/freeDictionary.ts` (existing dictionaryapi.dev
  logic, moved as-is) and `lib/dictionaryProviders/merriamWebster.ts` (new),
  each exporting a parser to the shared `DefinitionAlternative[]` shape.
  `dictionary.ts` itself becomes the orchestrator: fetch sequencing,
  429 retry/backoff, sense grouping, the provider fallback chain, and MW key
  load/save/clear. This mirrors the existing `lib/` convention of small,
  single-purpose, framework-free modules (§3).
- **Out of scope here:** MW's response also includes recorded-audio
  pronunciation references — not wired up. §6.1's audio pronunciation
  (added 2026-08-30) uses `speechSynthesis` only, deliberately, so it works
  the same for every user regardless of whether an MW key is configured.

### 8.4 Definition provenance, dates, and re-fetching *(added 2026-08-24)*

Resolves the "bulk re-fetch of definitions for existing words" backlog item
that previously sat in §12 (added there 2026-08-08, removed now that it's
designed here). Builds on §4's `definitionSource` / `manuallyEdited` /
`definitionUpdatedAt` fields.

- **Provenance badges (Words screen, §6.3):** display precedence is
  `manuallyEdited` first — a hand-edited word always shows "Manual" (list-row:
  no dot; detail: "Manual" label) regardless of what `definitionSource` says,
  since that field only tracks the *last fetch*, not the current text.
  Otherwise the badge reflects `definitionSource`: amber dot / "Merriam-
  Webster" for `'merriam-webster'`, slate dot / "Free dictionary" for
  `'free-dictionary'`, no dot / no label for `'none'` (nothing fetched, still
  the placeholder). The detail view also shows "Added {date}" (`addedAt`,
  always present) and "Updated {date}" (`definitionUpdatedAt`, omitted when
  `null`).
- **"Missing definition"** means `definition === PLACEHOLDER_DEFINITION` —
  **not** `definitionSource === 'none'` alone. A word can have
  `definitionSource: 'none'` (nothing was ever successfully fetched for it)
  while still holding real, manually-typed content (`manuallyEdited: true`,
  text no longer the placeholder) — that word has real content and must not
  be treated as missing. Every "missing" check in this section (the bulk mode
  below, and its badge/dot) uses the placeholder-text comparison.
- **Bulk re-fetch of missing definitions (§6.3):** entering select-mode shows
  every word with a missing definition, all pre-checked; "Fetch selected"
  runs the existing `fetchDefinitions` (same gap/retry/backoff/progress as the
  Add wizard, §8) against just that list. On completion, each successfully
  fetched word gets `definitionSource` set to whichever provider answered,
  `definitionUpdatedAt: now`, `manuallyEdited: false`; words still not found
  are left as `'none'`/placeholder. A toast reports "{X} updated, {Y} failed"
  (failed = still missing afterward), mirroring the Add wizard's existing
  summary-toast pattern (§6.2 step 3).
- **Single-word re-fetch with diff (§6.3):** "Check for updated definition"
  calls a newly-exported single-word fetch (`fetchOne`'s existing MW→fallback
  logic, made public instead of module-private) regardless of whether the
  word currently has content — this is the one path allowed to re-fetch over
  an existing manually-edited definition, since it's an explicit, one-word,
  user-initiated action with a preview/confirm step, not a background bulk
  operation.
  - If the fetched text exactly matches the current definition: "Already up
    to date," no further UI.
  - If it differs: `definitionDiff.ts` splits both the current and fetched
    text on `"\n\n"` into their sense-paragraphs (§8's grouping already
    produces this shape) and diffs the two arrays with an LCS-based algorithm
    — senses only in the current version render struck-through on a red
    background, senses only in the fetched version render on a green
    background, unchanged senses render plain. Two actions: **Adopt new**
    (commits the fetched text, `definitionSource` set to whichever provider
    answered, `definitionUpdatedAt: now`, `manuallyEdited: false`) or **Keep
    current** (discards the fetched result; nothing changes, including
    `definitionUpdatedAt`).

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
  - `parser.ts`: fixture files of real OCR output from NYT answers screenshots
    (checked into `src/lib/__fixtures__/`), blocklist, dedupe, already-known
    split; hive cross-validation (coincidental-chrome rejection, proximity
    preference, hiveText fallback), multi-screenshot validation using words
    carried over from a second concatenated page, and OCR correction (leading
    `l`→`I`, digit→letter, corrections left unattempted without a confirmed
    hive, already-valid words never flagged).
  - `storage.ts`: empty load, round-trip, corrupt-value quarantine, legacy-key
    migration, import merge rules (newer wins, mastered wins), **v1→v2
    migration** (§4/§8.4: each `definitionSource` mapping, `manuallyEdited`
    derivation, `definitionUpdatedAt` backfill, on both load and import).
  - `dictionary.ts`: mocked fetch — success shape, 404, 429-retry, abort;
    `fetchAlternateDefinitions` flattening/deduping across entries, 404/network
    error/abort handling; **provider-specific `definitionSource`** in
    `fetchOne`/`fetchDefinitions` results (`'merriam-webster'` vs
    `'free-dictionary'` vs `'none'`, §8.4).
  - `definitionDiff.ts` *(new, §8.4)*: identical text → no diff entries;
    sense added/removed/reordered/unchanged, empty-to-populated and
    populated-to-empty edge cases.
- **Component (RTL):** Add-wizard review flow (uncheck → commit count,
  "Already know" → mastered, reset-to-learning checkbox, multi-file upload
  combining into one parse, pangram grouping/divider, uncertain-corrections
  section and its own commit path), Study (grade-advances-card, Skip
  defers-without-scheduling and resets card to front, Skip disabled with only
  one word due), Words (edit/delete, alternate-definition preview/swap,
  Google-lookup link, "no other definitions" state, **provenance badge per
  source/manual/empty state, bulk missing-definitions select-and-fetch with
  success/fail toast, single-word re-fetch's up-to-date / diff / adopt /
  reject paths, §8.4**), Data (**MW "Test key" button's
  valid/invalid/network-error outcomes, §8.3**).
- **Manual smoke checklist** (in README): install to Android home screen,
  airplane-mode OCR, real screenshot end-to-end, export → reset → import.
- CI: GitHub Actions runs typecheck + tests on push; deploy job publishes `dist/`
  to Pages on `main`.

## 12. P2 backlog (explicitly out of v1)

Resolves the "audio pronunciation" backlog item that previously sat here
(added 2026-07-12, removed now that it's designed in §6.1, added 2026-08-30).

1. **Manual word entry** — type a word, fetch its definition, commit to box 1.
2. Automatic same-session re-show of a **missed** word specifically (still
   unimplemented: missing a card still sends it to box 1, due tomorrow, same
   as always). **Note:** this is distinct from the voluntary **Skip** button
   added 2026-07-27 (§6.1), which defers a card *before* grading it and never
   touches its schedule — Skip doesn't retire this backlog item.
3. Surfacing blocklist-filtered words (`filteredUi`) as unchecked-by-default
   candidates instead of hiding them entirely; per-day review stats/streaks.
4. Persisting the Study "Skip" order across a reload (currently pure
   session/component state — see §6.1).
5. The pangram/continuation-page ambiguity noted at the end of §7.2 (an
   unpaired pangram word alone on its own line, on a screenshot with no real
   hive row, can be mistaken for one — known, low-frequency, not fixed).

## 13. Milestones (implementation-plan seeds)

1. **Scaffold:** Vite + React + TS + Tailwind + vite-plugin-pwa, base path, CI,
   Pages deploy of a hello-world shell.
2. **Core lib:** types, storage, leitner, parser — TDD, all unit tests green.
3. **Study loop:** VocabProvider + Study screen against seeded data.
4. **Add pipeline:** ocr.ts (self-hosted assets), dictionary.ts, Add wizard.
5. **Words + Data screens:** browse/edit/delete, export/import, reset.
6. **PWA polish:** icons, precache incl. tesseract, offline verification, phone
   smoke test.
