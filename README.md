# 🐝 Bee Vocab Builder

Offline-first PWA that turns NYT Spelling Bee answer screenshots into
Leitner-box flashcards. All data stays on-device; no backend.

Design spec: `docs/superpowers/specs/2026-07-12-spelling-bee-pwa-design.md`

## Development

```bash
npm install
npm run setup:tesseract   # one-time: self-host OCR assets (~54 MB currently, gitignored — a fast-follow will prune unused WASM variants)
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
