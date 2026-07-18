import { render, screen } from '@testing-library/react';
import App from '../App';

it('renders the app header', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /bee vocab builder/i })).toBeInTheDocument();
});
