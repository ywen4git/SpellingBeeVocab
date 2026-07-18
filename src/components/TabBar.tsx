export type Tab = 'study' | 'add' | 'words' | 'data';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'study', label: 'Study', icon: '🃏' },
  { id: 'add', label: 'Add', icon: '📷' },
  { id: 'words', label: 'Words', icon: '📚' },
  { id: 'data', label: 'Data', icon: '💾' },
];

export function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-md">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex min-h-[44px] flex-1 flex-col items-center py-2 text-xs font-semibold ${
              tab === t.id ? 'text-amber-600' : 'text-slate-500'
            }`}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
