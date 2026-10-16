import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeUrl, base64Url, codeChallenge, redirectUri, TokenSource, type Auth } from './auth.ts';

describe('PKCE helpers', () => {
  it('base64url-encodes without padding', () => {
    expect(base64Url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(base64Url(new Uint8Array([1]))).toBe('AQ');
  });

  it('derives the S256 challenge (checked against openssl)', async () => {
    expect(await codeChallenge('abcdefghijklmnopqrstuvwxyz0123456789-._~ABCDEFGHIJKLMNOPQ')).toBe('6GLD3QWnaLCQBv0Yi_OSFw5xG1Rqf1QVKSBm8t6fw-M');
  });

  it('builds the authorize URL', () => {
    const url = new URL(authorizeUrl({ state: 's1', challenge: 'c1', redirect: 'https://x.test/app/', clientId: 'https://x.test/app/oauth-client.json' }));
    expect(url.origin + url.pathname).toBe('https://todoist.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'https://x.test/app/oauth-client.json',
      scope: 'data:read_write,data:delete',
      state: 's1',
      redirect_uri: 'https://x.test/app/',
      response_type: 'code',
      code_challenge: 'c1',
      code_challenge_method: 'S256',
    });
  });

  it('uses the app directory as redirect URI', () => {
    expect(redirectUri('https://cornelius-99.github.io/todotriage/?code=1&state=2#x')).toBe('https://cornelius-99.github.io/todotriage/');
    expect(redirectUri('https://cornelius-99.github.io/todotriage/index.html')).toBe('https://cornelius-99.github.io/todotriage/');
    expect(redirectUri('http://localhost:5173/?code=1')).toBe('http://localhost:5173/');
  });
});

describe('TokenSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  const tokenResponse = (n: number) => new Response(JSON.stringify({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600 }), { status: 200 });

  it('returns a valid token without refreshing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const src = new TokenSource({ kind: 'oauth', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }, () => {});
    expect(await src.token()).toBe('a');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes once for concurrent callers and stores the rotated tokens', async () => {
    let n = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(init.body as URLSearchParams);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('r0');
      expect(body.has('client_secret')).toBe(false);
      return tokenResponse(++n);
    });
    vi.stubGlobal('fetch', fetchMock);
    const saved: Auth[] = [];
    const src = new TokenSource({ kind: 'oauth', accessToken: 'a0', refreshToken: 'r0', expiresAt: Date.now() + 10_000 }, (a) => saved.push(a));
    const [t1, t2] = await Promise.all([src.token(), src.token()]);
    expect([t1, t2]).toEqual(['access-1', 'access-1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].refreshToken).toBe('refresh-1');
    expect(saved[0].expiresAt).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it('never refreshes personal tokens', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const src = new TokenSource({ kind: 'token', accessToken: 'p' }, () => {});
    expect(await src.token(true)).toBe('p');
    expect(src.canRefresh).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a failed refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const src = new TokenSource({ kind: 'oauth', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() - 1 }, () => {});
    await expect(src.token()).rejects.toThrow(/invalid_grant/);
  });
});
