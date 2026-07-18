import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { DB_KEY } from '../lib/storage';

it('shows the Study tab by default and switches tabs', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /bee vocab builder/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /all caught up/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^words$/i }));
  expect(screen.getByRole('heading', { name: 'Words' })).toBeInTheDocument();
});

it('quarantines corrupt storage and tells the user via toast', () => {
  localStorage.setItem(DB_KEY, '{broken');
  render(<App />);
  expect(screen.getByRole('status')).toHaveTextContent(/started fresh/i);
});
