import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastOptions {
  detail?: string[];
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; detail?: string[] } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback((message: string, options?: ToastOptions) => {
    window.clearTimeout(timer.current);
    setExpanded(false);
    setToast({ message, detail: options?.detail });
    const hasDetail = (options?.detail?.length ?? 0) > 0;
    if (!hasDetail) {
      timer.current = window.setTimeout(() => setToast(null), 4000);
    }
  }, []);

  const hasDetail = (toast?.detail?.length ?? 0) > 0;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          <div className="flex items-center gap-2">
            <span>{toast.message}</span>
            {hasDetail && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="inline-flex min-h-[44px] items-center shrink-0 font-semibold underline underline-offset-2"
              >
                Show
              </button>
            )}
            {hasDetail && (
              <button
                type="button"
                onClick={close}
                aria-label="Dismiss"
                className="inline-flex min-h-[44px] items-center ml-auto shrink-0 text-slate-400"
              >
                ×
              </button>
            )}
          </div>
          {expanded && toast.detail && (
            <div className="mt-2 flex flex-wrap gap-1">
              {toast.detail.map((word) => (
                <span key={word} className="rounded-lg bg-slate-800 px-2 py-0.5 text-xs">
                  {word}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
