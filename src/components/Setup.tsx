import { useState } from 'preact/hooks';
import { canSignIn } from '../auth.ts';
import { connect, loadError, signIn, startDemo } from '../store.ts';
import { Icon } from './icons.tsx';

export function Setup() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'oauth' | 'token' | null>(null);
  const oauth = canSignIn();

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy('token');
    loadError.value = '';
    const ok = await connect(token);
    setBusy(null);
    if (!ok && !loadError.value) loadError.value = 'Could not reach Todoist.';
  };

  const login = () => {
    setBusy('oauth');
    void signIn().finally(() => setBusy(null));
  };

  return (
    <main class="setup">
      <div class="setup-card">
        <div class="logo" aria-hidden="true">
          <Icon name="check" size={30} />
        </div>
        <h1>Todo Triage</h1>
        <p class="lede">Clear your Todoist Inbox, Overdue and Today lists one task at a time — with single-key shortcuts on your computer and swipes on your phone.</p>

        {loadError.value && <p class="form-error banner">{loadError.value}</p>}

        <button class="btn primary big" onClick={login} disabled={!oauth || busy !== null}>
          {busy === 'oauth' ? 'Opening Todoist…' : 'Continue with Todoist'}
        </button>
        <p class="fine">
          {oauth
            ? 'You sign in on todoist.com. The access it grants stays in this browser and is only sent to Todoist.'
            : 'Signing in with Todoist needs a secure (https) address. Open the hosted app, or use an API token below.'}
        </p>

        <details class="token-details" open={!oauth}>
          <summary>Use an API token instead</summary>
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
            <button class="btn big" disabled={busy !== null || !token.trim()}>
              {busy === 'token' ? 'Connecting…' : 'Connect with token'}
            </button>
            <p class="fine">
              Find it under{' '}
              <a href="https://app.todoist.com/app/settings/integrations/developer" target="_blank" rel="noopener noreferrer">
                Settings → Integrations → Developer
              </a>
              .
            </p>
          </form>
        </details>

        <div class="divider">
          <span>or</span>
        </div>
        <button class="btn big" onClick={startDemo} disabled={busy !== null}>
          Try it with demo data
        </button>
      </div>
    </main>
  );
}
