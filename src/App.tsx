import { useState } from 'react';
import { ToastProvider } from './components/Toast';
import { TabBar, type Tab } from './components/TabBar';
import { VocabProvider } from './context/VocabProvider';
import StudyScreen from './screens/StudyScreen';
import AddScreen from './screens/AddScreen';
import WordsScreen from './screens/WordsScreen';
import DataScreen from './screens/DataScreen';

export default function App() {
  const [tab, setTab] = useState<Tab>('study');
  return (
    <ToastProvider>
      <VocabProvider>
        <div className="min-h-screen bg-slate-50 text-slate-800">
          <header className="mx-auto max-w-md px-4 pb-2 pt-6 text-center">
            <h1 className="text-2xl font-bold text-amber-500">🐝 Bee Vocab Builder</h1>
          </header>
          <main className="mx-auto max-w-md px-4 pb-24">
            {tab === 'study' && <StudyScreen />}
            {tab === 'add' && <AddScreen />}
            {tab === 'words' && <WordsScreen />}
            {tab === 'data' && <DataScreen />}
          </main>
          <TabBar tab={tab} onChange={setTab} />
        </div>
      </VocabProvider>
    </ToastProvider>
  );
}
