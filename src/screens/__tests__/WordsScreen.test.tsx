import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { knownWordEntry, newWordEntry } from '../../lib/leitner';
import { SCHEMA_VERSION } from '../../lib/types';
import type { VocabWord } from '../../lib/types';

function seed(...words: VocabWord[]) {
  localStorage.setItem(DB_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    words: Object.fromEntries(words.map((w) => [w.word, w])),
  }));
}

async function openWords() {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^words$/i }));
}

it('searches the word list', async () => {
  seed(
    newWordEntry('AGARIC', 'a mushroom', 'api', 1),
    knownWordEntry('TIARA', 'a crown', 'api', 2),
  );
  await openWords();
  expect(screen.getByText('AGARIC')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox'), 'TIA');
  expect(screen.queryByText('AGARIC')).not.toBeInTheDocument();
  expect(screen.getByText('TIARA')).toBeInTheDocument();
});

it('filters by status', async () => {
  seed(
    newWordEntry('AGARIC', 'a mushroom', 'api', 1),
    knownWordEntry('TIARA', 'a crown', 'api', 2),
  );
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /^mastered$/i }));
  expect(screen.queryByText('AGARIC')).not.toBeInTheDocument();
  expect(screen.getByText('TIARA')).toBeInTheDocument();
});

it('edits a definition from the list', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  const box = screen.getByRole('textbox', { name: /definition for AGARIC/i });
  await userEvent.clear(box);
  await userEvent.type(box, 'a gilled fungus');
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({
    definition: 'a gilled fungus',
    definitionSource: 'manual',
  });
});

it('deletes only after inline confirm', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: /really delete/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toBeUndefined();
});

it('unmaster returns a word to learning box 3', async () => {
  seed(knownWordEntry('TIARA', 'a crown', 'api', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /TIARA/ }));
  await userEvent.click(screen.getByRole('button', { name: /unmaster/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.TIARA).toMatchObject({
    status: 'learning',
    box: 3,
  });
});
