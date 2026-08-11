import { abortError } from './abortError';
import { fetchFreeDictionary } from './dictionaryProviders/freeDictionary';
import { fetchMerriamWebster } from './dictionaryProviders/merriamWebster';
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

/** Formats an alternative the same way fetchDefinitions() formats its chosen definition. */
export function formatDefinition(alt: DefinitionAlternative): string {
  return alt.partOfSpeech ? `(${alt.partOfSpeech}) ${alt.definition}` : alt.definition;
}

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
  const mwKey = loadMwApiKey();
  if (mwKey) {
    const mwResult = await fetchMerriamWebster(word, mwKey, signal);
    if (mwResult.status === 'ok') return mwResult.alternatives;
  }
  const freeResult = await fetchFreeDictionary(word, signal);
  return freeResult.status === 'ok' ? freeResult.alternatives : [];
}

interface Attempt { definition: string; source: 'api' | 'none' }

const NOT_FOUND: Attempt = { definition: PLACEHOLDER_DEFINITION, source: 'none' };

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
