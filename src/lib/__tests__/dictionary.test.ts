import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDefinitions } from '../dictionary';
import { PLACEHOLDER_DEFINITION } from '../types';

const entry = (pos: string, def: string) =>
  [{ meanings: [{ partOfSpeech: pos, definitions: [{ definition: def }] }] }];
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
});
