import { describe, expect, it } from 'vitest';
import { abortError, isAbortError } from '../abortError';

describe('isAbortError', () => {
  it('recognizes a DOMException named AbortError', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
  });

  it('recognizes an Error named AbortError (jsdom fetch abort shape)', () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });

  it('rejects other errors', () => {
    expect(isAbortError(new TypeError('offline'))).toBe(false);
    expect(isAbortError('not an error')).toBe(false);
  });
});

describe('abortError', () => {
  it('produces a DOMException named AbortError', () => {
    const err = abortError();
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe('AbortError');
  });
});
