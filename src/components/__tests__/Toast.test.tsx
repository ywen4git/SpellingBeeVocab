import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { vi } from 'vitest';
import { ToastProvider, useToast } from '../Toast';

function Trigger({ message, detail }: { message: string; detail?: string[] }) {
  const toast = useToast();
  useEffect(() => { toast.show(message, detail ? { detail } : undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function renderToast(message: string, detail?: string[]) {
  render(
    <ToastProvider>
      <Trigger message={message} detail={detail} />
    </ToastProvider>,
  );
}

it('shows a plain message with no detail affordance', async () => {
  renderToast('Saved.');
  expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
  expect(screen.queryByRole('button', { name: /show/i })).not.toBeInTheDocument();
});

it('collapses detail behind a Show toggle, then expands it on click', async () => {
  renderToast('3 without definitions', ['AGARIC', 'TIARA', 'NAIAD']);
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('3 without definitions');
  expect(screen.queryByText('AGARIC')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /show/i }));
  expect(screen.getByText('AGARIC')).toBeInTheDocument();
  expect(screen.getByText('TIARA')).toBeInTheDocument();
  expect(screen.getByText('NAIAD')).toBeInTheDocument();
});

it('a toast with detail is dismissed only by the close button, not a timer', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderToast('3 without definitions', ['AGARIC']);
  expect(await screen.findByRole('status')).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(screen.getByRole('status')).toBeInTheDocument();
  await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
    screen.getByRole('button', { name: /dismiss/i }),
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  vi.useRealTimers();
});

it('a plain toast still auto-dismisses after 4s', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderToast('Saved.');
  expect(await screen.findByRole('status')).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(4001);
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  vi.useRealTimers();
});
