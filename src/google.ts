/// <reference types="@maxim_mazurok/gapi.client.calendar-v3" />
import { computed, signal } from '@preact/signals';
import { addDays, zonedToUtc } from './lib/dates.ts';
import { toCalendar, toEvent, type ApiCalendar, type ApiEvent, type GCalendar, type GEvent } from './lib/gcal.ts';
import { today, tz } from './store.ts';

// Read-only Google Calendar, so the schedule view can draw your events. Google's own browser
// libraries do the work: Identity Services signs in (a popup) and hands out an access token, and
// the API client (gapi) makes the Calendar calls. Browser tokens last an hour with no refresh
// token, and Google only hands out a new one through its popup, which browsers allow only from a
// tap. So once it's run out, the first tap anywhere quietly asks for a new one; if Google wants
// the user to sign in again, the settings offer Reconnect.

export const GOOGLE_CLIENT_ID: string = import.meta.env?.VITE_GOOGLE_CLIENT_ID || '510994130241-bvrkbrsu4mngbb2f82jp98ro7q7lt16v.apps.googleusercontent.com';

const IDENTITY_JS = 'https://accounts.google.com/gsi/client';
const API_JS = 'https://apis.google.com/js/api.js';
// Discovery doc URL, as in Google's Calendar quickstart.
const DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const AUTH_KEY = 'todotriage.google';
const SHOWN_KEY = 'todotriage.google.shown';
/** Renew on a tap when the token has less than this left, so it doesn't run out mid-use. */
const RENEW_AHEAD = 5 * 60_000;
/** Away from the app this long, coming back counts as opening it again. */
const AWAY = 60_000;
/** Reload events when the calendar opens and they're older than this. */
const STALE = 3 * 60_000;
/** Days fetched around today. */
const BEFORE = 1;
const AFTER = 28;

interface GoogleAuth {
  accessToken?: string;
  expiresAt?: number;
  /** The account's address (its primary calendar), used as a login hint when reconnecting. */
  email?: string;
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable; the connection just won't persist
  }
}

const auth = signal<GoogleAuth | null>(read<GoogleAuth>(AUTH_KEY));
/** Per-calendar overrides of Google's own "selected" flag. */
const shownOverride = signal<Record<string, boolean>>(read(SHOWN_KEY) ?? {});

export const calendars = signal<GCalendar[]>([]);
export const events = signal<GEvent[]>([]);
export const calendarError = signal('');
export const calendarLoading = signal(false);
/** Both of Google's libraries are loaded, so the sign-in popup can open straight from a tap. */
export const googleReady = signal(false);
/** Google only accepts sign-ins from https pages or localhost, never a plain-http LAN address. */
export const canUseGoogle = typeof window !== 'undefined' && window.isSecureContext;
let loadedAt = 0;

/** off: never connected. on: a working token. expired: connected before, needs Google again. */
export const googleState = computed<'off' | 'on' | 'expired'>(() => {
  const a = auth.value;
  if (!a) return 'off';
  return a.accessToken && (a.expiresAt ?? 0) > Date.now() ? 'on' : 'expired';
});
export const googleEmail = computed(() => auth.value?.email ?? '');

export const isShown = (c: GCalendar) => shownOverride.value[c.id] ?? c.selected;

/** Events of the calendars that are switched on. */
export const shownEvents = computed(() => {
  const on = new Set(calendars.value.filter(isShown).map((c) => c.id));
  return events.value.filter((e) => on.has(e.calendarId));
});

function setAuth(next: GoogleAuth | null) {
  auth.value = next;
  write(AUTH_KEY, next);
  if (googleReady.value) gapi.client.setToken(next?.accessToken ? { access_token: next.accessToken } : null);
}

const LOAD_TIMEOUT = 20_000;

function script(src: string, what: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Couldn't load ${what}. Check your connection or content blocker.`));
    document.head.append(el);
  });
}

let tokenClient: google.accounts.oauth2.TokenClient | null = null;
let libs: Promise<void> | null = null;
/** The token request under way: a quiet renewal on a tap, or a sign-in from the settings. */
let request: 'renew' | 'sign-in' | null = null;
/** A quiet renewal failed since the app was last opened, so taps leave Google alone until the next time. */
let renewFailed = false;

function renewalFailed() {
  request = null;
  renewFailed = true;
}

// Set up the way Google's Calendar JavaScript quickstart does: api.js → gapi.load('client') →
// gapi.client.init with the discovery doc, and Identity Services' token client for sign-in.
// The quickstart's API key is left out: OAuth-authorized calls don't need one.
async function initGapi() {
  await script(API_JS, "Google's API client");
  await new Promise<void>((resolve, reject) => gapi.load('client', { callback: resolve, onerror: reject }));
  await gapi.client.init({ discoveryDocs: [DISCOVERY] });
}

async function initGis() {
  await script(IDENTITY_JS, "Google's sign-in");
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPE,
    callback: (res) => {
      const renewing = request === 'renew';
      request = null;
      if (res.error !== undefined) {
        // A quiet renewal fails when Google wants to show a screen; Reconnect in the settings covers that.
        if (renewing) renewalFailed();
        else calendarError.value = `Google sign-in failed: ${res.error_description || res.error}`;
        return;
      }
      calendarError.value = '';
      setAuth({ ...auth.value, accessToken: res.access_token, expiresAt: Date.now() + Number(res.expires_in) * 1000 });
      void loadCalendar(true);
    },
    error_callback: (err) => {
      if (request === 'renew') return renewalFailed();
      request = null;
      if (err.type !== 'popup_closed') calendarError.value = `Google sign-in failed: ${err.message || err.type}`;
    },
  });
}

/** Load both libraries once. The sign-in popup must open within the tap, so this runs before it. */
export function loadGoogle(): Promise<void> {
  const timeout = () =>
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Couldn't load Google's libraries. A content blocker may be stopping them.")), LOAD_TIMEOUT),
    );
  libs ??= Promise.race([Promise.all([initGapi(), initGis()]), timeout()])
    .then(() => {
      googleReady.value = true;
      setAuth(auth.value);
    })
    .catch((e) => {
      libs = null;
      calendarError.value = e instanceof Error ? e.message : String(e);
    });
  return libs;
}

/** Open Google's sign-in popup. Call it straight from a tap, once `googleReady` is true. */
export function connectGoogle() {
  if (!tokenClient) return;
  const email = auth.value?.email;
  request = 'sign-in';
  // As in the quickstart: ask for consent on a first sign-in, skip the account chooser and consent after that.
  tokenClient.requestAccessToken(auth.value ? { prompt: '', login_hint: email } : { prompt: 'consent' });
}

/** Connected before, and the token has run out or is about to. */
function wantsRenewal() {
  const a = auth.value;
  return !!a && (!a.accessToken || (a.expiresAt ?? 0) - Date.now() < RENEW_AHEAD);
}

/**
 * Any tap in the app: if the token has run out, ask Google for a new one right in the tap, since a
 * popup opened any other time gets blocked. `prompt: 'none'` keeps Google from showing a screen, so
 * the popup closes by itself; if Google needs the user, it fails and the settings offer Reconnect.
 * Taps on the Connect and Reconnect buttons are left to them.
 */
function renewOnTap(e: MouseEvent) {
  if (!tokenClient || request || renewFailed || !wantsRenewal()) return;
  if (e.target instanceof Element && e.target.closest('[data-google-sign-in]')) return;
  request = 'renew';
  tokenClient.requestAccessToken({ prompt: 'none', login_hint: auth.value?.email });
}

export function disconnectGoogle() {
  const token = auth.value?.accessToken;
  if (token && googleReady.value) google.accounts.oauth2.revoke(token, () => {});
  setAuth(null);
  renewFailed = false;
  calendars.value = [];
  events.value = [];
  calendarError.value = '';
  loadedAt = 0;
}

export function setShown(c: GCalendar, on: boolean) {
  const next = { ...shownOverride.value };
  if (on === c.selected) delete next[c.id];
  else next[c.id] = on;
  shownOverride.value = next;
  write(SHOWN_KEY, next);
  // Events for a calendar that was off weren't fetched.
  if (on) void loadCalendar(true);
}

/** At startup: if Google was connected, get the libraries ready and fetch events while the token lasts. */
export function bootGoogle() {
  document.addEventListener('click', renewOnTap, true);
  // Coming back to the app after a while counts as opening it again, so a failed renewal gets
  // another try. A short absence doesn't: on a phone, Google's popup itself hides the app.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (Date.now() - hiddenAt > AWAY) renewFailed = false;
  });
  if (!auth.value) return;
  void loadGoogle().then(() => loadCalendar(true));
}

class Expired extends Error {}

/** Run a gapi request; a 401 means the token ran out. */
async function call<T>(req: gapi.client.Request<T>): Promise<T> {
  try {
    return (await req).result;
  } catch (e) {
    const err = e as { status?: number; result?: { error?: { message?: string } } };
    if (err.status === 401) {
      setAuth({ ...auth.value, accessToken: undefined, expiresAt: undefined });
      throw new Expired();
    }
    throw new Error(err.result?.error?.message || `HTTP ${err.status ?? '?'}`);
  }
}

async function pages<T>(fetchPage: (pageToken?: string) => gapi.client.Request<{ items?: T[]; nextPageToken?: string }>): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await call(fetchPage(pageToken));
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

let inflight: Promise<void> | null = null;

/** Fetch the calendar list and the coming weeks' events. Without `force`, only when what we have is stale. */
export function loadCalendar(force = false): Promise<void> {
  if (googleState.value !== 'on') return Promise.resolve();
  if (!force && Date.now() - loadedAt < STALE) return Promise.resolve();
  inflight ??= (async () => {
    calendarLoading.value = true;
    try {
      await loadGoogle();
      if (!googleReady.value) return;
      const zone = tz.value;
      const api = gapi.client.calendar;
      const list = (await pages<ApiCalendar>((pageToken) => api.calendarList.list({ pageToken }))).filter((c) => !c.deleted).map(toCalendar);
      const primary = list.find((c) => c.primary);
      if (primary && auth.value && auth.value.email !== primary.id) setAuth({ ...auth.value, email: primary.id });
      calendars.value = list;

      const timeMin = zonedToUtc(addDays(today.value, -BEFORE), '00:00', zone).toISOString();
      const timeMax = zonedToUtc(addDays(today.value, AFTER), '00:00', zone).toISOString();
      const found = await Promise.all(
        list.filter(isShown).map(async (c) => {
          const items = await pages<ApiEvent>((pageToken) =>
            api.events.list({ calendarId: c.id, timeMin, timeMax, timeZone: zone, singleEvents: true, orderBy: 'startTime', maxResults: 250, pageToken }),
          );
          return items.map((e) => toEvent(e, c, zone)).filter((e): e is GEvent => !!e);
        }),
      );
      events.value = found.flat();
      loadedAt = Date.now();
      calendarError.value = '';
    } catch (e) {
      if (!(e instanceof Expired)) calendarError.value = `Couldn't load Google Calendar: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      calendarLoading.value = false;
      inflight = null;
    }
  })();
  return inflight;
}
