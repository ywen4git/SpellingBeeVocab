import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMerriamWebster, parseMwAlternatives } from '../merriamWebster';

const mwEntry = (fl: string, ...shortdef: string[]) => ({ fl, shortdef });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) });

afterEach(() => vi.unstubAllGlobals());

describe('parseMwAlternatives', () => {
  it('reads fl (part of speech) and every shortdef entry', () => {
    const data = [mwEntry('noun', 'A story.', 'A long fictional narrative.'), mwEntry('adjective', 'New.')];
    expect(parseMwAlternatives(data)).toEqual([
      { partOfSpeech: 'noun', definition: 'A story.' },
      { partOfSpeech: 'noun', definition: 'A long fictional narrative.' },
      { partOfSpeech: 'adjective', definition: 'New.' },
    ]);
  });

  it('treats an array of spelling-suggestion strings as no real entries', () => {
    expect(parseMwAlternatives(['novle', 'novel', 'novels'])).toEqual([]);
  });

  it('returns an empty list for non-array data', () => {
    expect(parseMwAlternatives({ message: 'Invalid API key' })).toEqual([]);
  });
});

describe('fetchMerriamWebster', () => {
  it('fetches and normalizes a successful response, sending the key as a query param', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([mwEntry('noun', 'A fungus.')])));
    const result = await fetchMerriamWebster('AGARIC', 'test-key');
    expect(result).toEqual({ status: 'ok', alternatives: [{ partOfSpeech: 'noun', definition: 'A fungus.' }] });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.dictionaryapi.com/api/v3/references/collegiate/json/agaric?key=test-key',
      expect.anything(),
    );
  });

  it('maps a suggestions-only response to not-found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(['agar', 'agarics'])));
    expect(await fetchMerriamWebster('AGARIX', 'test-key')).toEqual({ status: 'not-found' });
  });

  it('maps a 429 to rate-limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(429)));
    expect(await fetchMerriamWebster('AGARIC', 'test-key')).toEqual({ status: 'rate-limited' });
  });

  it('maps any other non-ok status (e.g. an invalid key) to error, not not-found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(403)));
    expect(await fetchMerriamWebster('AGARIC', 'bad-key')).toEqual({ status: 'error' });
  });

  it('maps a network error to network-error, distinct from a rejected request (bad key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await fetchMerriamWebster('AGARIC', 'test-key')).toEqual({ status: 'network-error' });
  });

  it('rethrows AbortError instead of swallowing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }));
    await expect(fetchMerriamWebster('AGARIC', 'test-key')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
