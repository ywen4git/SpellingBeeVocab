import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { knownWordEntry } from '../../lib/leitner';
import { SCHEMA_VERSION } from '../../lib/types';
import { recognizeImage } from '../../lib/ocr';

vi.mock('../../lib/ocr', () => ({
  recognizeImage: vi.fn(async () => ({ text: 'AGARIC NAIAD PANGRAM TIARA', boostedText: '', hiveText: '' })),
  terminateOcr: vi.fn(async () => {}),
}));

vi.mock('../../lib/dictionary', () => ({
  fetchDefinitions: vi.fn(async (words: string[]) =>
    words.map((word) => ({ word, definition: `def of ${word}`, source: 'api' as const }))),
}));

function seedTiaraMastered() {
  localStorage.setItem(DB_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    words: { TIARA: knownWordEntry('TIARA', 'a crown', 'api', 1) },
  }));
}

async function uploadShot() {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
  const input = screen.getByLabelText(/upload solution screenshot/i);
  await userEvent.upload(input, new File(['x'], 'shot.png', { type: 'image/png' }));
  await screen.findByText('AGARIC');
}

it('review commits checked words and reset selections', async () => {
  seedTiaraMastered();
  await uploadShot();
  expect(screen.queryByText('PANGRAM')).not.toBeInTheDocument(); // UI junk filtered
  await userEvent.click(screen.getByRole('checkbox', { name: 'NAIAD' }));  // uncheck OCR junk
  await userEvent.click(screen.getByRole('checkbox', { name: /TIARA/ })); // reset to learning
  await userEvent.click(screen.getByRole('button', { name: /add 2 words/i }));
  await screen.findByRole('status');
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC).toMatchObject({
    status: 'learning', box: 1, definition: 'def of AGARIC',
  });
  expect(stored.words.NAIAD).toBeUndefined();
  expect(stored.words.TIARA).toMatchObject({ status: 'learning', box: 1, definition: 'a crown' });
});

it('"already know" imports straight to mastered', async () => {
  seedTiaraMastered();
  await uploadShot();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC: learn/i }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'NAIAD' }));
  await userEvent.click(screen.getByRole('button', { name: /add 1 word/i }));
  await screen.findByRole('status');
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC).toMatchObject({ status: 'mastered', definition: 'def of AGARIC' });
});

it('shows the detected puzzle letters when a hive row is found', async () => {
  vi.mocked(recognizeImage).mockResolvedValueOnce({ text: 'VAGILNT\nGALLIVANT', boostedText: '', hiveText: '' });
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
  await userEvent.upload(
    screen.getByLabelText(/upload solution screenshot/i),
    new File(['x'], 'shot.png', { type: 'image/png' }),
  );
  await screen.findByText('GALLIVANT');
  expect(screen.getByText('Puzzle letters detected')).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'V A G I L N T')).toBeInTheDocument();
});

it('warns when no hive row is detected, since candidates are unfiltered by letter', async () => {
  await uploadShot(); // default mock has no hive row
  expect(screen.getByText(/Couldn't detect the puzzle's 7 letters/)).toBeInTheDocument();
});

it('combines multiple screenshots (e.g. a long answer list split across pages) into one parse', async () => {
  vi.mocked(recognizeImage)
    .mockResolvedValueOnce({ text: 'VAGILNT\nGALLIVANT', boostedText: '', hiveText: '' })
    .mockResolvedValueOnce({ text: 'VITAL VITA', boostedText: '', hiveText: '' });
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
  const input = screen.getByLabelText(/upload solution screenshot/i);
  await userEvent.upload(input, [
    new File(['x'], 'shot1.png', { type: 'image/png' }),
    new File(['x'], 'shot2.png', { type: 'image/png' }),
  ]);
  await screen.findByText('GALLIVANT');
  expect(screen.getByText('VITAL')).toBeInTheDocument();
  expect(screen.getByText('VITA')).toBeInTheDocument();
  expect(screen.getByText('Puzzle letters detected')).toBeInTheDocument();
});
