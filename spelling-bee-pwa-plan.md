# Spec & Implementation Guide: NYT Spelling Bee Vocab Builder PWA

Use this specification to build a lightweight, offline-first Progressive Web App (PWA) that extracts words from NYT Spelling Bee screenshot solutions, fetches definitions, and provides a flashcard system to master them.

---

## 1. Tech Stack Requirements

- **Framework:** React + Vite (TypeScript preferred but JavaScript acceptable)
- **Styling:** Tailwind CSS for a modern, clean, mobile-first UI
- **OCR Engine:** `tesseract.js` (runs client-side via WebAssembly)
- **Local Database:** `localStorage` or `IndexedDB` (completely offline, zero backend needed)
- **Hosting Target:** Vercel, Netlify, or GitHub Pages (Free tier static hosting)

---

## 2. Core Functional Requirements

### Phase 1: Screenshot Upload & OCR Parsing
- **Input:** A mobile image uploader accepting `.png`, `.jpg`, `.jpeg`.
- **Processing:** Pass the uploaded file directly to `tesseract.js` inside the browser thread.
- **Filtering Logic:** 
  - Standardize all extracted text to uppercase.
  - Use regex to capture all words containing 4 or more letters: `/[A-Z]{4,}/g`.
  - Deduplicate the resulting array.
- **Definition Fetching:** Fetch dictionary data using the Free Dictionary API:
  `https://api.dictionaryapi.dev/api/v2/entries/en/{word}`
  - Extract the first definition found: `data[0].meanings[0].definitions[0].definition`.
  - If the API fails or the word is an obscure Spelling Bee specific word, default to `"Definition not found automatically (Tap to edit)."`.

### Phase 2: Word Pipeline & State Management
Store words in local state and serialize to `localStorage` under a schema matching this structure:
```json
{
  "new": [
    { "word": "AGARIC", "definition": "A mushroom with gills...", "timestamp": 1718214300 }
  ],
  "mastered": [
    { "word": "XALAPA", "definition": "An alternate spelling of Jalapa...", "timestamp": 1718215500 }
  ]
}
```
- Users should be able to look at the newly parsed list and manually delete false-positive OCR scans before committing them to the `"new"` deck.

### Phase 3: Spaced Repetition / Flashcard Interface
- Provide a clean, swipeable or tap-to-flip card component.
- **Front side:** Display the Word loudly and clearly.
- **Back side:** Toggle state to reveal the Definition.
- **Actions:** 
  - **"Mastered" Button:** Moves the item from the `"new"` array to the `"mastered"` array.
  - **"Keep Practicing" Button:** Cycles the current word to the very back of the `"new"` queue (`new.push(new.shift())`).
- Provide a clear statistics matrix showing total new vs. mastered counts.

---

## 3. Complete Source Implementation (`App.jsx`)

Provide the following exact file template as a foundational implementation guide:

```jsx
import React, { useState, useEffect } from 'react';
import { createWorker } from 'tesseract.js';

export default function App() {
  const [db, setDb] = useState(() => {
    const saved = localStorage.getItem('spelling_bee_vocab');
    return saved ? JSON.parse(saved) : { new: [], mastered: [] };
  });
  
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [isFlipped, setIsFlipped] = useState(false);

  useEffect(() => {
    localStorage.setItem('spelling_bee_vocab', JSON.stringify(db));
  }, [db]);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setLoadingStatus('Initializing local OCR engine...');
    
    try {
      const worker = await createWorker('eng');
      setLoadingStatus('Scanning image text...');
      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();

      setLoadingStatus('Filtering and fetching definitions...');
      const rawWords = text.toUpperCase().match(/[A-Z]{4,}/g) || [];
      const uniqueWords = Array.from(new Set(rawWords));

      const existingWords = new Set([...db.new, ...db.mastered].map(w => w.word));
      const newlyDiscovered = [];

      for (const word of uniqueWords) {
        if (!existingWords.has(word)) {
          let definition = 'Definition not found automatically.';
          try {
            const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/\${word.toLowerCase()}`);
            if (res.ok) {
              const data = await res.json();
              definition = data[0]?.meanings[0]?.definitions[0]?.definition || definition;
            }
          } catch (err) {
            // Silently catch network failures for specific words
          }
          newlyDiscovered.push({ word, definition, timestamp: Date.now() });
        }
      }

      if (newlyDiscovered.length > 0) {
        setDb(prev => ({ ...prev, new: [...prev.new, ...newlyDiscovered] }));
        alert(`Successfully added \${newlyDiscovered.length} unique words to your collection!`);
      } else {
        alert('No new unique words found in this image.');
      }
    } catch (error) {
      console.error(error);
      alert('Error parsing image.');
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  };

  const handleMastered = () => {
    if (db.new.length === 0) return;
    const current = db.new[0];
    setDb(prev => ({
      new: prev.new.slice(1),
      mastered: [...prev.mastered, current]
    }));
    setIsFlipped(false);
  };

  const handleRepeat = () => {
    if (db.new.length <= 1) return;
    setDb(prev => {
      const updatedNew = [...prev.new];
      const current = updatedNew.shift();
      updatedNew.push(current);
      return { ...prev, new: updatedNew };
    });
    setIsFlipped(false);
  };

  const currentWord = db.new[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8 flex flex-col items-center">
      <header className="w-full max-w-md text-center mb-6">
        <h1 className="text-2xl font-bold text-amber-500">🐝 Bee Vocab Builder</h1>
        <p className="text-xs text-slate-500">Extract, review, and master obscure words offline</p>
      </header>

      <main className="w-full max-w-md flex-1 flex flex-col gap-6">
        {/* Upload Container */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
          <label className="block text-sm font-semibold text-slate-700 mb-2">Upload Daily Solution Screenshot</label>
          <input 
            type="file" 
            accept="image/*" 
            onChange={handleImageUpload} 
            disabled={loading}
            className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100 disabled:opacity-50"
          />
          {loading && (
            <p className="text-sm text-amber-600 mt-2 animate-pulse font-medium">⏳ {loadingStatus}</p>
          )}
        </div>

        {/* Study Zone */}
        <div className="flex-1 flex flex-col justify-center min-h-[300px]">
          {currentWord ? (
            <div className="flex flex-col gap-4">
              <div 
                onClick={() => setIsFlipped(!isFlipped)}
                className="bg-white border border-slate-200 rounded-3xl p-8 min-h-[200px] shadow-sm flex flex-col items-center justify-center text-center cursor-pointer hover:border-amber-300 transition-colors"
              >
                {!isFlipped ? (
                  <>
                    <h2 className="text-3xl font-black tracking-wide text-slate-900">{currentWord.word}</h2>
                    <p className="text-xs text-slate-400 mt-4 font-medium uppercase tracking-wider">Tap to reveal definition</p>
                  </>
                ) : (
                  <>
                    <p className="text-base text-slate-700 leading-relaxed font-medium">{currentWord.definition}</p>
                    <p className="text-xs text-slate-400 mt-4 font-medium uppercase tracking-wider">Tap to hide</p>
                  </>
                )}
              </div>

              {/* Controls */}
              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={handleRepeat}
                  className="py-3 px-4 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-700 font-semibold rounded-xl transition"
                >
                  ❌ Keep Practicing
                </button>
                <button 
                  onClick={handleMastered}
                  className="py-3 px-4 bg-amber-400 hover:bg-amber-500 active:bg-amber-600 text-slate-950 font-semibold rounded-xl transition shadow-sm"
                >
                  ✅ Mastered
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-3xl border border-slate-100 p-6">
              <span className="text-4xl">🎉</span>
              <h3 className="text-lg font-bold text-slate-800 mt-2">All Caught Up!</h3>
              <p className="text-sm text-slate-500 max-w-xs mx-auto mt-1">Upload a new screenshot from your past day's solution grid to discover more words.</p>
            </div>
          )}
        </div>

        {/* Stats Matrix */}
        <footer className="bg-slate-900 text-white p-4 rounded-2xl flex justify-around text-center shadow-md mt-auto">
          <div>
            <p className="text-2xl font-black text-amber-400">{db.new.length}</p>
            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">New Queue</p>
          </div>
          <div className="border-r border-slate-700 h-8 self-center"></div>
          <div>
            <p className="text-2xl font-black text-emerald-400">{db.mastered.length}</p>
            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Mastered Words</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
```

---

## 4. PWA Manifest & Service Worker Specification

To ensure this can be saved directly onto an Android phone home screen via Chrome and launch without address bars:

### `manifest.json` configuration
Ensure the AI sets up these specific parameters in your builder config:
- `display: "standalone"`
- `orientation: "portrait"`
- `background_color: "#faf8f5"`
- Include valid `src` icon pathways for standard Android `192x192` and `512x512` device resolutions.

