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

it('keeps the context value referentially stable so a consumer effect keyed on it never re-fires', () => {
  // Regression test: a consumer that calls toast.show() from a useEffect keyed on the toast
  // context value (as VocabProvider does for its corrupt-storage/legacy-migration toasts) used to
  // infinite-loop — each show() re-rendered ToastProvider, which handed consumers a brand-new
  // `{ show }` object, which re-triggered the effect, forever. This asserts the value's identity
  // is stable across re-renders instead of re-running that unbounded loop.
  const seenValues: unknown[] = [];
  function Trigger() {
    const toast = useToast();
    useEffect(() => { seenValues.push(toast); }, [toast]);
    return null;
  }
  function Wrapper({ n }: { n: number }) {
    return (
      <ToastProvider>
        <Trigger />
        <span>{n}</span>
      </ToastProvider>
    );
  }
  const { rerender } = render(<Wrapper n={0} />);
  rerender(<Wrapper n={1} />);
  rerender(<Wrapper n={2} />);
  expect(seenValues).toHaveLength(1);
});
