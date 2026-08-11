import { isAbortError } from '../abortError';
import type { DefinitionAlternative, ProviderResult } from './types';

const API = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json/';

interface MwEntry {
  fl?: unknown;
  shortdef?: unknown;
}

/**
 * When Merriam-Webster has no entry for a word it returns a 200 with an array of plain spelling-
 * suggestion strings instead of entry objects (never a 404) — so "not found" has to be detected from
 * response shape, not HTTP status. Non-object array items are exactly that case and are skipped.
 */
export function parseMwAlternatives(data: unknown): DefinitionAlternative[] {
  if (!Array.isArray(data)) return [];
  const out: DefinitionAlternative[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { fl, shortdef } = entry as MwEntry;
    const partOfSpeech = typeof fl === 'string' ? fl : '';
    const shortdefs = Array.isArray(shortdef) ? shortdef : [];
    for (const definition of shortdefs) {
      if (typeof definition !== 'string' || definition.length === 0) continue;
      const key = `${partOfSpeech} ${definition}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ partOfSpeech, definition });
    }
  }
  return out;
}

export async function fetchMerriamWebster(
  word: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ProviderResult> {
  try {
    const res = await fetch(`${API}${word.toLowerCase()}?key=${encodeURIComponent(apiKey)}`, { signal });
    if (res.status === 429) return { status: 'rate-limited' };
    // A non-2xx here means the request itself was rejected (bad key, server error) — MW signals a
    // genuine "no entry" with a 200 + suggestions array, never a 404, so this is never "not found".
    if (!res.ok) return { status: 'error' };
    const alternatives = parseMwAlternatives(await res.json());
    return alternatives.length > 0 ? { status: 'ok', alternatives } : { status: 'not-found' };
  } catch (err) {
    if (isAbortError(err)) throw err;
    // The request never reached Merriam-Webster at all (offline, DNS, CORS, etc) — distinct from a
    // rejected request (bad key), which is a genuine 'error' above.
    return { status: 'network-error' };
  }
}
