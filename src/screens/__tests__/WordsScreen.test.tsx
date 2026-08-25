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
    newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1),
    knownWordEntry('TIARA', 'a crown', 'free-dictionary', 2),
  );
  await openWords();
  expect(screen.getByText('AGARIC')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox'), 'TIA');
  expect(screen.queryByText('AGARIC')).not.toBeInTheDocument();
  expect(screen.getByText('TIARA')).toBeInTheDocument();
});

it('filters by status', async () => {
  seed(
    newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1),
    knownWordEntry('TIARA', 'a crown', 'free-dictionary', 2),
  );
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /^mastered$/i }));
  expect(screen.queryByText('AGARIC')).not.toBeInTheDocument();
  expect(screen.getByText('TIARA')).toBeInTheDocument();
});

it('edits a definition from the list', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  const box = screen.getByRole('textbox', { name: /definition for AGARIC/i });
  await userEvent.clear(box);
  await userEvent.type(box, 'a gilled fungus');
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({
    definition: 'a gilled fungus',
    manuallyEdited: true,
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
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  await userEvent.clear(screen.getByRole('textbox', { name: /definition for AGARIC/i }));
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toMatchObject({
    definition: PLACEHOLDER_DEFINITION,
    definitionSource: 'none',
    manuallyEdited: false,
  });
});

it('links out to Google to look up the word being edited', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  const link = screen.getByRole('link', { name: /look up on google/i });
  expect(link).toHaveAttribute('href', 'https://www.google.com/search?q=define%20AGARIC');
  expect(link).toHaveAttribute('target', '_blank');
});

it('lets the user preview and swap in an alternate dictionary definition', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
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
    manuallyEdited: true,
  });
});

it('filters an already-shown sense out of a multi-sense definition, keeping the rest', async () => {
  seed(newWordEntry('AGARIC', '(noun) A fungus.\n\n(verb) To forage.', 'free-dictionary', 1));
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [{
      meanings: [
        { partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }] },
        { partOfSpeech: 'adjective', definitions: [{ definition: 'Fungal in nature.' }] },
      ],
    }],
  })));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  await userEvent.click(screen.getByRole('button', { name: /see other dictionary definitions/i }));
  await screen.findByText('(adjective) Fungal in nature.');
  expect(screen.queryByText('(noun) A fungus.')).not.toBeInTheDocument();
});

it('shows a message when no other definitions are found', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /edit definition/i }));
  await userEvent.click(screen.getByRole('button', { name: /see other dictionary definitions/i }));
  await screen.findByText('No other definitions found.');
});

it('deletes only after inline confirm', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: /really delete/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toBeUndefined();
});

it('unmaster returns a word to learning box 3', async () => {
  seed(knownWordEntry('TIARA', 'a crown', 'free-dictionary', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /TIARA/ }));
  await userEvent.click(screen.getByRole('button', { name: /unmaster/i }));
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.TIARA).toMatchObject({
    status: 'learning',
    box: 3,
  });
});

it('renders a multi-sense definition as separate paragraphs', async () => {
  seed(newWordEntry('AGARIC', '(noun) A fungus.\n\n(verb) To forage for fungus.', 'free-dictionary', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  const definition = screen.getByText(/A fungus\./);
  expect(definition).toHaveClass('whitespace-pre-line');
  expect(definition).toHaveTextContent('(noun) A fungus.');
  expect(definition).toHaveTextContent('(verb) To forage for fungus.');
});

it('shows a source badge for a Merriam-Webster definition', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'merriam-webster', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  expect(screen.getByText('Merriam-Webster')).toBeInTheDocument();
});

it('shows a manual badge even when the last fetch came from a provider', async () => {
  seed({ ...newWordEntry('AGARIC', 'a hand-typed definition', 'free-dictionary', 1), manuallyEdited: true });
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  expect(screen.getByText('Manual')).toBeInTheDocument();
});

it('shows added and updated dates', async () => {
  const addedAt = new Date(2026, 0, 5).getTime();
  const updatedAt = new Date(2026, 0, 10).getTime();
  seed({ ...newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', addedAt), definitionUpdatedAt: updatedAt });
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  expect(screen.getByText(/Added Jan 5, 2026/)).toBeInTheDocument();
  expect(screen.getByText(/Updated Jan 10, 2026/)).toBeInTheDocument();
});

it('omits the updated date when a definition has never been fetched or edited', async () => {
  seed(newWordEntry('AGARIC', PLACEHOLDER_DEFINITION, 'none', 1));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /AGARIC/ }));
  expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
});

it('offers to fix missing definitions and reports success/failure counts', async () => {
  seed(
    newWordEntry('AGARIC', PLACEHOLDER_DEFINITION, 'none', 1),
    newWordEntry('TIARA', PLACEHOLDER_DEFINITION, 'none', 2),
    newWordEntry('NUANCE', 'already has one', 'free-dictionary', 3),
  );
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('agaric')) {
      return {
        ok: true, status: 200,
        json: async () => [{ meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fungus.' }] }] }],
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /fix 2 missing definitions/i }));
  await userEvent.click(screen.getByRole('button', { name: /fetch 2 selected/i }));
  expect(await screen.findByRole('status')).toHaveTextContent('1 updated, 1 failed');
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.AGARIC).toMatchObject({ definition: '(noun) A fungus.', definitionSource: 'free-dictionary' });
  expect(stored.words.TIARA).toMatchObject({ definitionSource: 'none' });
});

it('lets the user deselect a word before bulk-fetching', async () => {
  seed(
    newWordEntry('AGARIC', PLACEHOLDER_DEFINITION, 'none', 1),
    newWordEntry('TIARA', PLACEHOLDER_DEFINITION, 'none', 2),
  );
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
  await openWords();
  await userEvent.click(screen.getByRole('button', { name: /fix 2 missing definitions/i }));
  await userEvent.click(screen.getByRole('checkbox', { name: /tiara/i }));
  await userEvent.click(screen.getByRole('button', { name: /fetch 1 selected/i }));
  expect(await screen.findByRole('status')).toHaveTextContent('0 updated, 1 failed');
});

it('does not show the bulk-fix button when nothing is missing', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'free-dictionary', 1));
  await openWords();
  expect(screen.queryByRole('button', { name: /fix.*missing definition/i })).not.toBeInTheDocument();
});
