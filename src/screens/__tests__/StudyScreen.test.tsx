import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { newWordEntry } from '../../lib/leitner';
import { SCHEMA_VERSION } from '../../lib/types';
import type { VocabWord } from '../../lib/types';

function seed(...words: VocabWord[]) {
  localStorage.setItem(DB_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    words: Object.fromEntries(words.map((w) => [w.word, w])),
  }));
}

it('flips the card and "Got it" advances the session', async () => {
  seed(newWordEntry('AGARIC', 'a gilled mushroom', 'api', Date.now() - 1000));
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
  seed({ ...newWordEntry('NUANCE', 'subtle difference', 'api', Date.now() - 1000), box: 2 });
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /missed/i }));
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.NUANCE).toMatchObject({ box: 1, lapses: 1 });
});

it('editing a definition from the card back marks it manual', async () => {
  seed(newWordEntry('AGARIC', 'a gilled mushroom', 'api', Date.now() - 1000));
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
    definitionSource: 'manual',
  });
});
