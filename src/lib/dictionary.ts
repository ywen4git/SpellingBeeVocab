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
