import { useEffect } from 'preact/hooks';
import { ActionPanel, EmptyState, Header, MobileBar, Progress, QueueList, Toasts } from './components/Chrome.tsx';
import { Icon } from './components/icons.tsx';
import { Setup } from './components/Setup.tsx';
import { Sheets } from './components/sheets.tsx';
import { ExitGhost, TaskCard } from './components/TaskCard.tsx';
import { handleKey } from './shortcuts.ts';
import { current, list, load, loadError, phase, signOut } from './store.ts';

function Stage() {
  const task = current.value;
  const after = task ? list.value.length - list.value.indexOf(task.id) - 1 : 0;
  return (
    <div class="stage">
      {task ? (
        <div class="deck">
          {after > 1 && <div class="peek peek-2" aria-hidden="true" />}
          {after > 0 && <div class="peek peek-1" aria-hidden="true" />}
          <TaskCard key={task.id} task={task} />
          <ExitGhost />
        </div>
      ) : (
        <div class="deck">
          <EmptyState />
          <ExitGhost />
        </div>
      )}
      <p class="gesture-hint">Swipe → done · ← schedule · ↑ skip</p>
    </div>
  );
}

export function App() {
  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  if (phase.value === 'setup') return <Setup />;
  if (phase.value === 'loading')
    return (
      <main class="center-screen">
        <div class="spinner" aria-label="Loading" />
        <p class="muted">Loading your tasks…</p>
      </main>
    );
  if (phase.value === 'error')
    return (
      <main class="center-screen">
        <Icon name="x" size={28} />
        <p>{loadError.value || 'Something went wrong.'}</p>
        <div class="row">
          <button class="btn primary" onClick={() => void load(true)}>
            Try again
          </button>
          <button class="btn" onClick={signOut}>
            Use a different token
          </button>
        </div>
      </main>
    );

  return (
    <div class="app">
      <Header />
      <Progress />
      <div class="layout">
        <QueueList />
        <main class="main">
          <Stage />
          <ActionPanel />
        </main>
      </div>
      <MobileBar />
      <Toasts />
      <Sheets />
    </div>
  );
}
