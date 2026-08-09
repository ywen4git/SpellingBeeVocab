import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFreeDictionary, parseFreeDictionaryAlternatives } from '../freeDictionary';

const entry = (pos: string, def: string) =>
  [{ meanings: [{ partOfSpeech: pos, definitions: [{ definition: def }] }] }];
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) });

afterEach(() => vi.unstubAllGlobals());

describe('parseFreeDictionaryAlternatives', () => {
  it('flattens every meaning across every entry', () => {
    const data = [
      { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }, { definition: 'A basket.' }] }] },
      { meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Fungal in nature.' }] }] },
    ];
    expect(parseFreeDictionaryAlternatives(data)).toEqual([
      { partOfSpeech: 'noun', definition: 'A fungus.' },
      { partOfSpeech: 'noun', definition: 'A basket.' },
      { partOfSpeech: 'adjective', definition: 'Fungal in nature.' },
    ]);
  });

  it('drops exact duplicate part-of-speech/definition pairs', () => {
    const data = [
      { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }] }] },
      { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }] }] },
    ];
    expect(parseFreeDictionaryAlternatives(data)).toEqual([{ partOfSpeech: 'noun', definition: 'A fungus.' }]);
  });

  it('returns an empty list for non-array data', () => {
    expect(parseFreeDictionaryAlternatives({})).toEqual([]);
  });
});

describe('fetchFreeDictionary', () => {
  it('fetches and normalizes a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(entry('noun', 'A fungus.'))));
    const result = await fetchFreeDictionary('AGARIC');
    expect(result).toEqual({ status: 'ok', alternatives: [{ partOfSpeech: 'noun', definition: 'A fungus.' }] });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.dictionaryapi.dev/api/v2/entries/en/agaric',
      expect.anything(),
    );
  });

  it('maps a 404 to not-found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(404)));
    expect(await fetchFreeDictionary('XYZZY')).toEqual({ status: 'not-found' });
  });

  it('maps a 429 to rate-limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(429)));
    expect(await fetchFreeDictionary('TIARA')).toEqual({ status: 'rate-limited' });
  });

  it('maps a network error to error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await fetchFreeDictionary('AGARIC')).toEqual({ status: 'error' });
  });

  it('rethrows AbortError instead of swallowing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }));
    await expect(fetchFreeDictionary('AGARIC')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
