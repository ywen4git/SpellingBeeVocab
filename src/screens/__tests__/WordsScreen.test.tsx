import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { knownWordEntry, newWordEntry } from '../../lib/leitner';
import { PLACEHOLDER_DEFINITION, SCHEMA_VERSION } from '../../lib/types';
import type { VocabWord } from '../../lib/types';

afterEach(() => vi.unstubAllGlobals());

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

it('starts the editor empty when the definition is the "not found" placeholder', async () => {
  seed(newWordEntry('AGARIC', PLACEHOLDER_DEFINITION, 'none', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  expect(screen.getByRole('textbox', { name: /definition for AGARIC/i })).toHaveValue('');
});

it('saving an empty definition reverts to the "not found" placeholder', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  await userEvent.clear(screen.getByRole('textbox', { name: /definition for AGARIC/i }));
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({
    definition: PLACEHOLDER_DEFINITION,
    definitionSource: 'none',
  });
});

it('links out to Google to look up the word being edited', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  const link = screen.getByRole('link', { name: /look up on google/i });
  expect(link).toHaveAttribute('href', 'https://www.google.com/search?q=define%20AGARIC');
  expect(link).toHaveAttribute('target', '_blank');
});

it('lets the user preview and swap in an alternate dictionary definition', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [{
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A gilled fungus, often edible.' }] }],
    }],
  })));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  await userEvent.click(screen.getByRole('button', { name: /see other dictionary definitions/i }));
  await screen.findByText('(noun) A gilled fungus, often edible.');
  await userEvent.click(screen.getByRole('button', { name: /^use$/i }));
  expect(screen.getByRole('textbox', { name: /definition for AGARIC/i })).toHaveValue(
    '(noun) A gilled fungus, often edible.',
  );
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({
    definition: '(noun) A gilled fungus, often edible.',
    definitionSource: 'manual',
  });
});

it('shows a message when no other definitions are found', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  await userEvent.click(screen.getByRole('button', { name: /see other dictionary definitions/i }));
  await screen.findByText('No other definitions found.');
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

it('renders a multi-sense definition as separate paragraphs', async () => {
  seed(newWordEntry('AGARIC', '(noun) A fungus.\n\n(verb) To forage for fungus.', 'api', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  const definition = screen.getByText(/A fungus\./);
  expect(definition).toHaveClass('whitespace-pre-line');
  expect(definition).toHaveTextContent('(noun) A fungus.');
  expect(definition).toHaveTextContent('(verb) To forage for fungus.');
});
