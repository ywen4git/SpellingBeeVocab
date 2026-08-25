import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { knownWordEntry } from '../../lib/leitner';
import { SCHEMA_VERSION } from '../../lib/types';
import { recognizeImage } from '../../lib/ocr';
import { fetchDefinitions } from '../../lib/dictionary';

vi.mock('../../lib/ocr', () => ({
  recognizeImage: vi.fn(async () => ({ text: 'AGARIC NAIAD PANGRAM TIARA', boostedText: '', hiveText: '' })),
  terminateOcr: vi.fn(async () => {}),
}));

vi.mock('../../lib/dictionary', () => ({
  fetchDefinitions: vi.fn(async (words: string[]) =>
    words.map((word) => ({ word, definition: `def of ${word}`, source: 'free-dictionary' as const }))),
}));

function seedTiaraMastered() {
  localStorage.setItem(DB_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    words: { TIARA: knownWordEntry('TIARA', 'a crown', 'free-dictionary', 1) },
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

it('groups new candidates with pangrams (words using all 7 letters) first, under a divider', async () => {
  vi.mocked(recognizeImage).mockResolvedValueOnce({
    text: 'VAGILNT\nGALLIVANT VITAL', boostedText: '', hiveText: '',
  });
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
  await userEvent.upload(
    screen.getByLabelText(/upload solution screenshot/i),
    new File(['x'], 'shot.png', { type: 'image/png' }),
  );
  await screen.findByText('GALLIVANT'); // uses all 7 hive letters — the pangram
  expect(screen.getByText('Uses all 7 letters')).toBeInTheDocument();
  expect(screen.getByText('Other words')).toBeInTheDocument();
  expect(screen.getByText('VITAL')).toBeInTheDocument();
});

it('lists a low-confidence OCR correction separately, unchecked, noting what it was corrected to', async () => {
  vi.mocked(recognizeImage).mockResolvedValueOnce({
    text: 'IAMNOTZ\nAtomization Motion lota', boostedText: '', hiveText: '',
  });
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
  await userEvent.upload(
    screen.getByLabelText(/upload solution screenshot/i),
    new File(['x'], 'shot.png', { type: 'image/png' }),
  );
  await screen.findByText('IOTA'); // the corrected spelling is the real, checked-by-default candidate
  expect(screen.getByText('Uncertain OCR readings')).toBeInTheDocument();
  expect(screen.getByText('LOTA')).toBeInTheDocument();
  expect(screen.getByText('read as "IOTA" above')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /LOTA/ })).not.toBeChecked();
});

it('can add a correction\'s raw OCR spelling instead, if the guessed fix looks wrong', async () => {
  vi.mocked(recognizeImage).mockResolvedValueOnce({
    text: 'IAMNOTZ\nAtomization Motion lota', boostedText: '', hiveText: '',
  });
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
  await userEvent.upload(
    screen.getByLabelText(/upload solution screenshot/i),
    new File(['x'], 'shot.png', { type: 'image/png' }),
  );
  await screen.findByText('IOTA');
  await userEvent.click(screen.getByRole('checkbox', { name: /LOTA/ }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'ATOMIZATION' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'MOTION' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'IOTA' }));
  await userEvent.click(screen.getByRole('button', { name: /add 1 word/i }));
  await screen.findByRole('status');
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.LOTA).toMatchObject({ status: 'learning' });
  expect(stored.words.IOTA).toBeUndefined();
});

it('shows which specific words failed definition lookup', async () => {
  vi.mocked(fetchDefinitions).mockImplementationOnce(async (words: string[]) =>
    words.map((word) => (
      word === 'AGARIC'
        ? { word, definition: 'No definition found — tap to edit.', source: 'none' as const }
        : { word, definition: `def of ${word}`, source: 'free-dictionary' as const }
    )));
  seedTiaraMastered();
  await uploadShot();
  await userEvent.click(screen.getByRole('checkbox', { name: 'NAIAD' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /TIARA/ }));
  await userEvent.click(screen.getByRole('button', { name: /add 2 words/i }));
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('1 without definitions');
  await userEvent.click(screen.getByRole('button', { name: /show/i }));
  expect(screen.getByText('AGARIC')).toBeInTheDocument();
});
