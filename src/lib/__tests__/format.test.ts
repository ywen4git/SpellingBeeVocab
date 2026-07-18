import { expect, it } from 'vitest';
import { formatUntil } from '../format';

it('formats durations for the next-due message', () => {
  expect(formatUntil(5 * 60_000)).toBe('in 5 min');
  expect(formatUntil(3 * 3_600_000)).toBe('in 3 h');
  expect(formatUntil(30 * 3_600_000)).toBe('tomorrow');
  expect(formatUntil(72 * 3_600_000)).toBe('in 3 days');
});
