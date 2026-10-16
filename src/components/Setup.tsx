import { useState } from 'preact/hooks';
import { connect, loadError, startDemo } from '../store.ts';
import { Icon } from './icons.tsx';

export function Setup() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    loadError.value = '';
    const ok = await connect(token);
    setBusy(false);
    if (!ok && !loadError.value) loadError.value = 'Could not reach Todoist.';
  };

  return (
    <main class="setup">
      <div class="setup-card">
        <div class="logo" aria-hidden="true">
          <Icon name="check" size={30} />
        </div>
        <h1>Todo Triage</h1>
        <p class="lede">Clear your Todoist Inbox, Overdue and Today lists one task at a time — with single-key shortcuts on your computer and swipes on your phone.</p>
        <form onSubmit={submit}>
          <label for="token">Todoist API token</label>
          <input
            id="token"
            type="password"
            autocomplete="off"
            spellcheck={false}
            placeholder="Paste your token"
            value={token}
            onInput={(e) => setToken((e.target as HTMLInputElement).value)}
          />
          {loadError.value && <p class="form-error">{loadError.value}</p>}
          <button class="btn primary big" disabled={busy || !token.trim()}>
            {busy ? 'Connecting…' : 'Connect to Todoist'}
          </button>
        </form>
        <p class="fine">
          Find it in Todoist under{' '}
          <a href="https://app.todoist.com/app/settings/integrations/developer" target="_blank" rel="noopener noreferrer">
            Settings → Integrations → Developer
          </a>
          . It is stored only in this browser and sent only to api.todoist.com.
        </p>
        <div class="divider">
          <span>or</span>
        </div>
        <button class="btn big" onClick={startDemo}>
          Try it with demo data
        </button>
      </div>
    </main>
  );
}
