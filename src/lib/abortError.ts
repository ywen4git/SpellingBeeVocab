export function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/**
 * A real `fetch()` abort throws a DOMException named "AbortError" — which extends Error in actual
 * browsers, but NOT under jsdom (Node's test environment), so `err instanceof Error` alone is an
 * environment-dependent check that silently fails in tests. Checking DOMException too makes this
 * correct regardless of which runtime threw it.
 */
export function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError';
}
