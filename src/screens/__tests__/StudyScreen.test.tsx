import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { newWordEntry } from '../../lib/leitner';
import { SCHEMA_VERSION } from '../../lib/types';
import type { VocabWord } from '../../lib/types';

const { speakWord, isSpeechSupported } = vi.hoisted(() => ({
  speakWord: vi.fn(),
  isSpeechSupported: vi.fn(() => true),
}));
vi.mock('../../lib/speech', () => ({ speakWord, isSpeechSupported }));

beforeEach(() => {
  speakWord.mockClear();
  isSpeechSupported.mockReturnValue(true);
});

function seed(...words: VocabWord[]) {
  localStorage.setItem(DB_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    words: Object.fromEntries(words.map((w) => [w.word, w])),
  }));
}

it('flips the card and "Got it" advances the session', async () => {
  seed(newWordEntry('AGARIC', 'a gilled mushroom', 'free-dictionary', Date.now() - 1000));
  render(<App />);
  expect(screen.getByRole('heading', { name: 'AGARIC' })).toBeInTheDocument();
  expect(screen.queryByText(/gilled mushroom/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('heading', { name: 'AGARIC' }));
  expect(screen.getByText(/gilled mushroom/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /got it/i }));
  expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC.box).toBe(2);
});

it('"Missed" sends the word back to box 1 and counts a lapse', async () => {
  seed({ ...newWordEntry('NUANCE', 'subtle difference', 'free-dictionary', Date.now() - 1000), box: 2 });
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /missed/i }));
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.NUANCE).toMatchObject({ box: 1, lapses: 1 });
});

it('"Skip" defers a card behind the other due words without touching its schedule', async () => {
  const now = Date.now() - 1000;
  seed(
    { ...newWordEntry('AGARIC', 'a gilled mushroom', 'free-dictionary', now), box: 2 },
    { ...newWordEntry('NUANCE', 'a subtle difference', 'free-dictionary', now), box: 1 },
  );
  render(<App />);
  // box desc, so AGARIC (box 2) sorts before NUANCE (box 1)
  expect(screen.getByRole('heading', { name: 'AGARIC' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /skip/i }));
  expect(screen.getByRole('heading', { name: 'NUANCE' })).toBeInTheDocument();
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC).toMatchObject({ box: 2, dueAt: now, lapses: 0 });
});

it('"Skip" resets the card to its front, unflipped', async () => {
  const now = Date.now() - 1000;
  seed(
    { ...newWordEntry('AGARIC', 'a gilled mushroom', 'free-dictionary', now), box: 2 },
    { ...newWordEntry('NUANCE', 'a subtle difference', 'free-dictionary', now), box: 1 },
  );
  render(<App />);
  await userEvent.click(screen.getByRole('heading', { name: 'AGARIC' })); // flip
  await userEvent.click(screen.getByRole('button', { name: /skip/i }));
  expect(screen.queryByText(/subtle difference/)).not.toBeInTheDocument();
  expect(screen.getByText(/tap to reveal/i)).toBeInTheDocument();
});

it('disables "Skip" when there is nothing else due to skip to', async () => {
  seed(newWordEntry('AGARIC', 'a gilled mushroom', 'free-dictionary', Date.now() - 1000));
  render(<App />);
  expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();
});

it('editing a definition from the card back marks it manual', async () => {
  seed(newWordEntry('AGARIC', 'a gilled mushroom', 'free-dictionary', Date.now() - 1000));
  render(<App />);
  await userEvent.click(screen.getByRole('heading', { name: 'AGARIC' }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  const box = screen.getByRole('textbox', { name: /definition for AGARIC/i });
  await userEvent.clear(box);
  await userEvent.type(box, 'a gilled fungus');
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC).toMatchObject({
    definition: 'a gilled fungus',
    manuallyEdited: true,
  });
});

it('renders a multi-sense definition as separate paragraphs', async () => {
  seed(newWordEntry('AGARIC', '(noun) A fungus.\n\n(verb) To forage for fungus.', 'free-dictionary', Date.now() - 1000));
  render(<App />);
  await userEvent.click(screen.getByRole('heading', { name: 'AGARIC' }));
  const definition = screen.getByText(/A fungus\./);
  expect(definition).toHaveClass('whitespace-pre-line');
  expect(definition).toHaveTextContent('(verb) To forage for fungus.');
});

it('speaks the word without flipping the card when the speaker button is tapped', async () => {
  seed(newWordEntry('AGARIC', 'a gilled mushroom', 'free-dictionary', Date.now() - 1000));
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /pronounce/i }));
  expect(speakWord).toHaveBeenCalledWith('AGARIC');
  expect(screen.queryByText(/gilled mushroom/)).not.toBeInTheDocument();
});

it('hides the speaker button when the browser has no speech synthesis support', async () => {
  isSpeechSupported.mockReturnValue(false);
  seed(newWordEntry('AGARIC', 'a gilled mushroom', 'free-dictionary', Date.now() - 1000));
  render(<App />);
  expect(screen.queryByRole('button', { name: /pronounce/i })).not.toBeInTheDocument();
});
