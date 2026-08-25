import { expect, it } from 'vitest';
import { formatUntil, formatDate } from '../format';

it('formats durations for the next-due message', () => {
  expect(formatUntil(5 * 60_000)).toBe('in 5 min');
  expect(formatUntil(3 * 3_600_000)).toBe('in 3 h');
  expect(formatUntil(30 * 3_600_000)).toBe('tomorrow');
  expect(formatUntil(72 * 3_600_000)).toBe('in 3 days');
});

it('formats an epoch ms timestamp as "Mon D, YYYY"', () => {
  expect(formatDate(new Date(2026, 7, 24, 10, 30).getTime())).toBe('Aug 24, 2026');
});

it('does not zero-pad single-digit days', () => {
  expect(formatDate(new Date(2026, 0, 5).getTime())).toBe('Jan 5, 2026');
});
