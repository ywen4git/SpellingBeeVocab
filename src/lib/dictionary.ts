import { abortError } from './abortError';
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
  const grouped = groupTopSensesByPartOfSpeech(result.alternatives);
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
