import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearMwApiKey, fetchAlternateDefinitions, fetchDefinitions, loadMwApiKey, saveMwApiKey, validateMwApiKey,
} from '../dictionary';
import { PLACEHOLDER_DEFINITION } from '../types';

const entry = (pos: string, def: string) =>
  [{ meanings: [{ partOfSpeech: pos, definitions: [{ definition: def }] }] }];
const multiEntry = (...pairs: Array<[string, string]>) =>
  [{ meanings: pairs.map(([pos, def]) => ({ partOfSpeech: pos, definitions: [{ definition: def }] })) }];
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) });
const opts = { gapMs: 0, retryMs: 0 };

afterEach(() => vi.unstubAllGlobals());

describe('fetchDefinitions', () => {
  it('extracts the first definition, prefixed with part of speech', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(entry('noun', 'A fungus.'))));
    const [r] = await fetchDefinitions(['AGARIC'], opts);
    expect(r).toEqual({ word: 'AGARIC', definition: '(noun) A fungus.', source: 'api' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.dictionaryapi.dev/api/v2/entries/en/agaric',
      expect.anything(),
    );
  });

  it('404 falls back to the editable placeholder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(404)));
    const [r] = await fetchDefinitions(['XYZZY'], opts);
    expect(r).toEqual({ word: 'XYZZY', definition: PLACEHOLDER_DEFINITION, source: 'none' });
  });

  it('retries once on 429', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(ok(entry('noun', 'A crown.')));
    vi.stubGlobal('fetch', f);
    const [r] = await fetchDefinitions(['TIARA'], opts);
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('api');
  });

  it('a second 429 becomes not-found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(429)));
    const [r] = await fetchDefinitions(['TIARA'], opts);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('none');
  });

  it('network errors do not block the rest of the batch', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(ok(entry('noun', 'A crown.')));
    vi.stubGlobal('fetch', f);
    const rs = await fetchDefinitions(['XYZZY', 'TIARA'], opts);
    expect(rs[0].source).toBe('none');
    expect(rs[1].source).toBe('api');
  });

  it('reports progress after each word', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(404)));
    const seen: Array<[number, number]> = [];
    await fetchDefinitions(['AAAA', 'BBBB'], { ...opts, onProgress: (d, t) => seen.push([d, t]) });
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });

  it('abort rejects with AbortError', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    }));
    await expect(
      fetchDefinitions(['AAAA', 'BBBB'], { ...opts, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('groups up to 3 senses, one per distinct part of speech, joined by blank lines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(multiEntry(
      ['noun', 'A story.'],
      ['noun', 'A second noun sense, dropped — only the first per part of speech is kept.'],
      ['adjective', 'New and not previously known.'],
      ['verb', 'To write as a novel.'],
      ['interjection', 'A fourth part of speech, dropped — capped at 3 groups.'],
    ))));
    const [r] = await fetchDefinitions(['NOVEL'], opts);
    expect(r.definition).toBe(
      '(noun) A story.\n\n(adjective) New and not previously known.\n\n(verb) To write as a novel.',
    );
  });

  it('keeps a single-sense definition exactly as before (no trailing separators)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(entry('noun', 'A fungus.'))));
    const [r] = await fetchDefinitions(['AGARIC'], opts);
    expect(r.definition).toBe('(noun) A fungus.');
  });
});

describe('fetchAlternateDefinitions', () => {
  it('flattens every meaning across every entry, not just the first', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([
      { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }, { definition: 'A basket.' }] }] },
      { meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Fungal in nature.' }] }] },
    ])));
    const alts = await fetchAlternateDefinitions('AGARIC');
    expect(alts).toEqual([
      { partOfSpeech: 'noun', definition: 'A fungus.' },
      { partOfSpeech: 'noun', definition: 'A basket.' },
      { partOfSpeech: 'adjective', definition: 'Fungal in nature.' },
    ]);
  });

  it('drops exact duplicate part-of-speech/definition pairs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([
      { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }] }] },
      { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }] }] },
    ])));
    const alts = await fetchAlternateDefinitions('AGARIC');
    expect(alts).toEqual([{ partOfSpeech: 'noun', definition: 'A fungus.' }]);
  });

  it('returns an empty list on a 404 instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(404)));
    await expect(fetchAlternateDefinitions('XYZZY')).resolves.toEqual([]);
  });

  it('returns an empty list on a network error instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(fetchAlternateDefinitions('AGARIC')).resolves.toEqual([]);
  });

  it('still rejects with AbortError on abort, rather than swallowing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('Aborted', 'AbortError');
    }));
    await expect(fetchAlternateDefinitions('AGARIC')).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Merriam-Webster key storage', () => {
  it('round-trips through save/load/clear', () => {
    expect(loadMwApiKey()).toBeNull();
    saveMwApiKey('abc123');
    expect(loadMwApiKey()).toBe('abc123');
    clearMwApiKey();
    expect(loadMwApiKey()).toBeNull();
  });
});

describe('validateMwApiKey', () => {
  it('is valid when MW answers with a real entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ fl: 'noun', shortdef: ['a check'] }])));
    expect(await validateMwApiKey('good-key')).toBe(true);
  });

  it('is valid even when MW has no entry for the probe word (key itself was accepted)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(['test', 'tests'])));
    expect(await validateMwApiKey('good-key')).toBe(true);
  });

  it('is invalid when MW rejects the request (bad key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(403)));
    expect(await validateMwApiKey('bad-key')).toBe(false);
  });
});

describe('fetchDefinitions with a Merriam-Webster key configured', () => {
  it('uses Merriam-Webster when it has the word', async () => {
    saveMwApiKey('good-key');
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ fl: 'noun', shortdef: ['A crown.'] }])));
    const [r] = await fetchDefinitions(['TIARA'], opts);
    expect(r).toEqual({ word: 'TIARA', definition: '(noun) A crown.', source: 'api' });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.dictionaryapi.com/api/v3/references/collegiate/json/tiara?key=good-key',
      expect.anything(),
    );
  });

  it('falls back to dictionaryapi.dev when Merriam-Webster has no entry', async () => {
    saveMwApiKey('good-key');
    const f = vi.fn()
      .mockResolvedValueOnce(ok(['tiaras'])) // MW: suggestions only, not found
      .mockResolvedValueOnce(ok(entry('noun', 'A crown (free dictionary).')));
    vi.stubGlobal('fetch', f);
    const [r] = await fetchDefinitions(['TIARA'], opts);
    expect(r).toEqual({ word: 'TIARA', definition: '(noun) A crown (free dictionary).', source: 'api' });
    expect(f).toHaveBeenNthCalledWith(1, expect.stringContaining('dictionaryapi.com'), expect.anything());
    expect(f).toHaveBeenNthCalledWith(2, expect.stringContaining('dictionaryapi.dev'), expect.anything());
  });

  it('retries a rate-limited Merriam-Webster request before falling back', async () => {
    saveMwApiKey('good-key');
    const f = vi.fn()
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(ok([{ fl: 'noun', shortdef: ['A crown.'] }]));
    vi.stubGlobal('fetch', f);
    const [r] = await fetchDefinitions(['TIARA'], opts);
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('api');
  });

  it('does not call Merriam-Webster when no key is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(entry('noun', 'A crown.'))));
    await fetchDefinitions(['TIARA'], opts);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('dictionaryapi.dev'), expect.anything());
  });
});

describe('fetchAlternateDefinitions with a Merriam-Webster key configured', () => {
  it('uses Merriam-Webster when it has the word', async () => {
    saveMwApiKey('good-key');
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ fl: 'noun', shortdef: ['A fungus.', 'A basket.'] }])));
    const alts = await fetchAlternateDefinitions('AGARIC');
    expect(alts).toEqual([
      { partOfSpeech: 'noun', definition: 'A fungus.' },
      { partOfSpeech: 'noun', definition: 'A basket.' },
    ]);
  });

  it('falls back to dictionaryapi.dev when Merriam-Webster has no entry', async () => {
    saveMwApiKey('good-key');
    const f = vi.fn()
      .mockResolvedValueOnce(ok(['agarics']))
      .mockResolvedValueOnce(ok(entry('noun', 'A fungus (free dictionary).')));
    vi.stubGlobal('fetch', f);
    const alts = await fetchAlternateDefinitions('AGARIC');
    expect(alts).toEqual([{ partOfSpeech: 'noun', definition: 'A fungus (free dictionary).' }]);
  });
});
