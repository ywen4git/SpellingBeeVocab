import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../../App';
import { DB_KEY } from '../../lib/storage';
import { newWordEntry } from '../../lib/leitner';
import { SCHEMA_VERSION } from '../../lib/types';
import type { VocabWord } from '../../lib/types';
import { validateMwApiKey } from '../../lib/dictionary';

vi.mock('../../lib/dictionary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/dictionary')>()),
  validateMwApiKey: vi.fn(),
}));

function seed(...words: VocabWord[]) {
  localStorage.setItem(DB_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    words: Object.fromEntries(words.map((w) => [w.word, w])),
  }));
}

async function openData() {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^data$/i }));
}

it('rejects an invalid backup file', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  const bad = new File(['{"nope":true}'], 'bad.json', { type: 'application/json' });
  await userEvent.upload(screen.getByLabelText(/import backup/i), bad);
  expect(await screen.findByRole('status')).toHaveTextContent(/not a valid/i);
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words.AGARIC).toBeDefined();
});

it('previews and applies a backup merge', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  const backup = {
    schemaVersion: SCHEMA_VERSION,
    words: { TIARA: newWordEntry('TIARA', 'a crown', 'api', 2) },
  };
  const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
  await userEvent.upload(screen.getByLabelText(/import backup/i), file);
  expect(await screen.findByText(/1 new, 0 already present/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /confirm import/i }));
  const stored = JSON.parse(localStorage.getItem(DB_KEY)!);
  expect(stored.words.TIARA).toBeDefined();
  expect(stored.words.AGARIC).toBeDefined();
});

it('shows a build info footer with the commit and build date', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  expect(screen.getByText(new RegExp(`Build ${__COMMIT_SHA__} · ${__BUILD_TIME__.slice(0, 10)}`))).toBeInTheDocument();
});

it('reset requires typing DELETE', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  const btn = screen.getByRole('button', { name: /reset everything/i });
  expect(btn).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/type delete/i), 'DELETE');
  expect(btn).toBeEnabled();
  await userEvent.click(btn);
  expect(JSON.parse(localStorage.getItem(DB_KEY)!).words).toEqual({});
});

it('defaults to the free dictionary with no key configured', async () => {
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  expect(screen.getByText(/using the free dictionary/i)).toBeInTheDocument();
});

it('rejects an invalid Merriam-Webster key without saving it', async () => {
  vi.mocked(validateMwApiKey).mockResolvedValueOnce('invalid');
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  await userEvent.type(screen.getByPlaceholderText(/merriam-webster api key/i), 'bad-key');
  await userEvent.click(screen.getByRole('button', { name: /save key/i }));
  expect(await screen.findByText(/couldn't verify that key/i)).toBeInTheDocument();
  expect(screen.getByText(/using the free dictionary/i)).toBeInTheDocument();
});

it('reports a connection problem separately from an invalid key when MW is unreachable', async () => {
  vi.mocked(validateMwApiKey).mockResolvedValueOnce('network-error');
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  await userEvent.type(screen.getByPlaceholderText(/merriam-webster api key/i), 'good-key');
  await userEvent.click(screen.getByRole('button', { name: /save key/i }));
  expect(await screen.findByText(/couldn't reach merriam-webster/i)).toBeInTheDocument();
  expect(screen.queryByText(/couldn't verify that key/i)).not.toBeInTheDocument();
  expect(screen.getByText(/using the free dictionary/i)).toBeInTheDocument();
});

it('saves a valid Merriam-Webster key and switches the active source', async () => {
  vi.mocked(validateMwApiKey).mockResolvedValueOnce('valid');
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  await userEvent.type(screen.getByPlaceholderText(/merriam-webster api key/i), 'good-key');
  await userEvent.click(screen.getByRole('button', { name: /save key/i }));
  expect(await screen.findByText(/using merriam-webster/i)).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/merriam-webster api key/i)).not.toBeInTheDocument();
});

it('clears a configured key and reverts to the free dictionary', async () => {
  vi.mocked(validateMwApiKey).mockResolvedValueOnce('valid');
  seed(newWordEntry('AGARIC', 'a mushroom', 'api', 1));
  await openData();
  await userEvent.type(screen.getByPlaceholderText(/merriam-webster api key/i), 'good-key');
  await userEvent.click(screen.getByRole('button', { name: /save key/i }));
  await screen.findByText(/using merriam-webster/i);
  await userEvent.click(screen.getByRole('button', { name: /remove key/i }));
  expect(screen.getByText(/using the free dictionary/i)).toBeInTheDocument();
});
