import { useEffect } from 'preact/hooks';
import { ActionPanel, EmptyState, Header, MobileBar, Progress, QueueList, Toasts } from './components/Chrome.tsx';
import { PickOverlay } from './components/DragPick.tsx';
import { Icon } from './components/icons.tsx';
import { ScheduleOverlay } from './components/ScheduleDrag.tsx';
import { Setup } from './components/Setup.tsx';
import { Sheets } from './components/sheets.tsx';
import { ExitGhost, PeekCard, TaskCard } from './components/TaskCard.tsx';
import { handleKey } from './shortcuts.ts';
import { current, list, load, loadError, loadingText, phase, signOut, upNext } from './store.ts';

function Stage() {
  const task = current.value;
  const next = upNext.value;
  const after = task ? list.value.length - list.value.indexOf(task.id) - 1 : 0;
  return (
    <div class="stage">
      {task ? (
        <div class="deck">
          {after > 1 && <div class="peek" aria-hidden="true" />}
          {next && <PeekCard key={next.id} task={next} />}
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
        <p class="muted">{loadingText.value}</p>
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
          <button class="btn" onClick={() => signOut()}>
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
      <ScheduleOverlay />
      <PickOverlay />
      <Toasts />
      <Sheets />
    </div>
  );
}
