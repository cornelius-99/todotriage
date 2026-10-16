// Todoist sign-in without a backend: OAuth 2 authorization code flow with PKCE, using an
// OAuth Client ID Metadata Document (public/oauth-client.json) as the client id. Public
// clients have no secret, so the whole exchange can run in the browser.

/** The URL of the client metadata document. Todoist fetches it to learn our name and redirect URIs. */
export const CLIENT_ID: string = import.meta.env?.VITE_TODOIST_CLIENT_ID || 'https://cornelius-99.github.io/todotriage/oauth-client.json';

const AUTHORIZE_URL = 'https://todoist.com/oauth/authorize';
const TOKEN_URL = 'https://todoist.com/oauth/access_token';
const REVOKE_URL = 'https://api.todoist.com/api/v1/revoke';
const SCOPES = 'data:read_write,data:delete';

const AUTH_KEY = 'todotriage.auth';
const LEGACY_TOKEN_KEY = 'todotriage.token';
const PENDING_KEY = 'todotriage.oauth-pending';
/** Refresh this long before the access token expires. */
const REFRESH_MARGIN = 2 * 60_000;

export interface Auth {
  kind: 'oauth' | 'token';
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms; absent for tokens that don't expire. */
  expiresAt?: number;
}

export class AuthError extends Error {}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable; the session just won't persist
  }
}

export function loadAuth(): Auth | null {
  try {
    const raw = read(AUTH_KEY);
    if (raw) {
      const a = JSON.parse(raw) as Auth;
      if (a?.accessToken) return a;
    }
  } catch {
    // corrupt entry; fall through
  }
  const legacy = read(LEGACY_TOKEN_KEY);
  if (legacy) {
    const a: Auth = { kind: 'token', accessToken: legacy };
    saveAuth(a);
    return a;
  }
  return null;
}

export function saveAuth(auth: Auth | null) {
  write(AUTH_KEY, auth ? JSON.stringify(auth) : null);
  write(LEGACY_TOKEN_KEY, null);
}

/** Where Todoist sends the user back: the app's own URL, without query or file name. */
export function redirectUri(href = location.href): string {
  const url = new URL('./', href);
  url.search = '';
  url.hash = '';
  return url.href;
}

/** PKCE needs WebCrypto, which browsers only expose on HTTPS and localhost. */
export function canSignIn(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!globalThis.crypto?.subtle;
}

export function base64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function authorizeUrl(p: { state: string; challenge: string; redirect: string; clientId?: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: p.clientId ?? CLIENT_ID,
    scope: SCOPES,
    state: p.state,
    redirect_uri: p.redirect,
    response_type: 'code',
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.href;
}

interface Pending {
  state: string;
  verifier: string;
  redirect: string;
  at: number;
}

/** Send the browser to Todoist's consent screen. */
export async function startSignIn() {
  const pending: Pending = { state: randomString(24), verifier: randomString(48), redirect: redirectUri(), at: Date.now() };
  // localStorage rather than sessionStorage: on iOS the round trip can land in a fresh browsing context.
  write(PENDING_KEY, JSON.stringify(pending));
  location.assign(authorizeUrl({ state: pending.state, challenge: await codeChallenge(pending.verifier), redirect: pending.redirect }));
}

/**
 * If this page load is Todoist redirecting back to us, finish the sign-in.
 * Returns null when the URL isn't an OAuth callback.
 */
export async function finishSignIn(): Promise<Auth | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return null;

  // Don't leave the one-time code in the address bar or history.
  history.replaceState(history.state, '', redirectUri() + location.hash);
  let pending: Pending | null = null;
  try {
    pending = JSON.parse(read(PENDING_KEY) ?? 'null');
  } catch {
    pending = null;
  }
  write(PENDING_KEY, null);

  if (error) {
    throw new AuthError(error === 'access_denied' ? 'Sign-in was cancelled.' : `Todoist sign-in failed: ${params.get('error_description') || error}`);
  }
  if (!pending || pending.state !== params.get('state') || Date.now() - pending.at > 30 * 60_000) {
    throw new AuthError('That sign-in link expired or was started in another window. Please try again.');
  }
  return tokenRequest({
    grant_type: 'authorization_code',
    code: code!,
    code_verifier: pending.verifier,
    redirect_uri: pending.redirect,
    client_id: CLIENT_ID,
  });
}

async function tokenRequest(params: Record<string, string>, previous?: Auth): Promise<Auth> {
  // A form post is a CORS "simple request", so there's no preflight to worry about.
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams(params) });
  } catch {
    throw new AuthError('Could not reach Todoist. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new AuthError(`Todoist sign-in failed: ${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  // Legacy-style tokens report a ~10 year lifetime; treat those as non-expiring.
  const expiresIn = Number(data.expires_in);
  return {
    kind: 'oauth',
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous?.refreshToken,
    expiresAt: expiresIn > 0 && expiresIn < 365 * 86_400 ? Date.now() + expiresIn * 1000 : undefined,
  };
}

/** Best effort: tell Todoist to forget the token on sign-out. */
export function revoke(auth: Auth) {
  if (auth.kind !== 'oauth') return;
  void fetch(REVOKE_URL, {
    method: 'POST',
    body: new URLSearchParams({ token: auth.refreshToken ?? auth.accessToken, token_type_hint: auth.refreshToken ? 'refresh_token' : 'access_token', client_id: CLIENT_ID }),
  }).catch(() => {});
}

/** Hands out a valid access token, refreshing (once, even under concurrent calls) when needed. */
export class TokenSource {
  private auth: Auth;
  private readonly onChange: (auth: Auth) => void;
  private inflight: Promise<Auth> | null = null;

  constructor(auth: Auth, onChange: (auth: Auth) => void = saveAuth) {
    this.auth = auth;
    this.onChange = onChange;
  }

  get canRefresh() {
    return !!this.auth.refreshToken;
  }

  get current(): Auth {
    return this.auth;
  }

  async token(force = false): Promise<string> {
    const stale = this.auth.expiresAt !== undefined && this.auth.expiresAt - Date.now() < REFRESH_MARGIN;
    if (this.canRefresh && (force || stale)) await this.refresh();
    return this.auth.accessToken;
  }

  private refresh(): Promise<Auth> {
    this.inflight ??= (async () => {
      // Another tab may have refreshed already; refresh tokens rotate, so reuse its result.
      const stored = loadAuth();
      if (stored && stored.refreshToken !== this.auth.refreshToken && (!stored.expiresAt || stored.expiresAt - Date.now() > REFRESH_MARGIN)) {
        return stored;
      }
      return tokenRequest({ grant_type: 'refresh_token', refresh_token: this.auth.refreshToken!, client_id: CLIENT_ID }, this.auth);
    })()
      .then((fresh) => {
        this.auth = fresh;
        this.onChange(fresh);
        return fresh;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
