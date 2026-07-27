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

/**
 * A real `fetch()` abort throws a DOMException named "AbortError" — which extends Error in actual
 * browsers, but NOT under jsdom (Node's test environment), so `err instanceof Error` alone is an
 * environment-dependent check that silently fails in tests. Checking DOMException too makes this
 * correct regardless of which runtime threw it.
 */
function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError';
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

export interface DefinitionAlternative {
  partOfSpeech: string;
  definition: string;
}

type RawEntry = { meanings?: Array<{ partOfSpeech?: unknown; definitions?: Array<{ definition?: unknown }> }> };

/**
 * dictionaryapi.dev (a Wiktionary wrapper) returns every meaning it has for a word, not just the
 * common one — order reflects the source data's own structure (sometimes historical, sometimes by
 * part of speech), not frequency of use, so the "first" sense can be the obscure one. This flattens
 * every entry/meaning/definition in the response so callers can offer the rest as alternatives
 * instead of silently discarding them.
 */
function parseAlternatives(data: unknown): DefinitionAlternative[] {
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

/** Formats an alternative the same way fetchDefinitions() formats its chosen definition. */
export function formatDefinition(alt: DefinitionAlternative): string {
  return alt.partOfSpeech ? `(${alt.partOfSpeech}) ${alt.definition}` : alt.definition;
}

function extractDefinition(data: unknown): string | null {
  const first = parseAlternatives(data)[0];
  return first ? formatDefinition(first) : null;
}

/**
 * Fetches every meaning dictionaryapi.dev has for a single word, for a user to browse and pick from
 * when the definition fetchDefinitions() picked (the first one) turns out to be the wrong sense.
 * Unlike fetchDefinitions(), this is meant to be called on demand from the definition editor, not as
 * part of a rate-limited import batch — so no retry/backoff here; a failure just yields no alternatives.
 */
export async function fetchAlternateDefinitions(
  word: string,
  signal?: AbortSignal,
): Promise<DefinitionAlternative[]> {
  try {
    const res = await fetch(API + word.toLowerCase(), { signal });
    if (!res.ok) return [];
    return parseAlternatives(await res.json());
  } catch (err) {
    if (isAbortError(err)) throw err;
    return [];
  }
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
    if (isAbortError(err)) throw err;
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
