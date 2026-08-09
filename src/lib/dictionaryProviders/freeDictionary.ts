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
