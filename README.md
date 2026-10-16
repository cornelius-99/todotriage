# Todo Triage

A focused triage screen for Todoist. It walks you through your **Overdue**, **Today** and **Inbox** tasks one card at a time so you can decide on each one: done, reschedule, move, relabel, reprioritise, delete or keep.

- **On a computer:** every action has a single-key shortcut, Superhuman/Gmail style.
- **On an iPhone:** big thumb-reachable buttons and Mailbox-style swipe gestures. Add it to the Home Screen and it runs full-screen like an app.

It's a static web app (Preact + Vite) that talks to Todoist directly from the browser through the official [`@doist/todoist-sdk`](https://www.npmjs.com/package/@doist/todoist-sdk). There's no backend.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173 and click **Continue with Todoist**, or **Try it with demo data** to explore without touching your account. A personal API token (Todoist → **Settings → Integrations → Developer**) also works, under "Use an API token instead".

## Sign-in (OAuth without a backend)

"Continue with Todoist" uses the OAuth 2 authorization code flow with **PKCE**. The OAuth client is a **Client ID Metadata Document**: the client ID is the URL of [`public/oauth-client.json`](public/oauth-client.json), which the site hosts itself. Todoist fetches that file to learn the app's name, logo and allowed redirect URIs. Metadata clients are public clients, so there's **no client secret** and no server. The whole exchange runs in the browser:

1. The app stores a random `state` and PKCE verifier, then redirects to `todoist.com/oauth/authorize`.
2. Todoist redirects back to the app with `?code=…&state=…`.
3. The app checks `state`, then exchanges the code plus verifier at `todoist.com/oauth/access_token`.
4. The access token (and the refresh token, if Todoist issues one) is kept in `localStorage`. Tokens are refreshed shortly before they expire, or after a 401. Signing out revokes them.

Redirect URIs are listed in the metadata file, not in the Todoist App Console. They must match exactly:

- `https://cornelius-99.github.io/todotriage/` (production)
- `http://localhost:5173/` (local dev; `npm run dev` pins this port)

Sign-in needs a secure context (HTTPS or localhost) for WebCrypto. On a LAN address like `http://192.168…`, use the API token instead.

**Hosting it elsewhere or forking:** change the URLs in `public/oauth-client.json`. `client_id` must be the file's own public URL, and `redirect_uris` must list your site. Then build with `VITE_TODOIST_CLIENT_ID=<that URL>`.

### On your iPhone

1. Host the app somewhere (see [Deploying](#deploying)), or for a quick test on your Wi-Fi, run `npm run dev:lan` and open the "Network" URL on the phone.
2. Open it in Safari and tap **Continue with Todoist**. (On a LAN dev address, paste an API token instead.)
3. Choose **Share → Add to Home Screen**. It launches standalone, with no browser bars.

## How triage works

| Queue   | What's in it                                    | A card leaves the queue when…                      |
| ------- | ----------------------------------------------- | -------------------------------------------------- |
| Overdue | Todoist filter `overdue`                         | you complete, delete or pick any date for it       |
| Today   | Todoist filter `today` (not overdue)             | you complete, delete or pick any date for it       |
| Inbox   | Every task in your Inbox project                 | you complete, delete or move it out of the Inbox   |
| All     | All of the above, in that order                  | none of its reasons apply anymore                  |

**Skip** keeps a task as it is and moves on. At the end of the queue you can go through the skipped ones again. Changing priority, labels or the title keeps the card in focus, so you can stack decisions on one task: for example, set P2, add `@waiting`, then move it to a project.

Within a queue, overdue tasks are sorted oldest first, today's timed tasks by time and then priority, and inbox tasks oldest first. Subtasks ride along on their parent's card.

## Keyboard shortcuts

| Key              | Action                         |
| ---------------- | ------------------------------ |
| `E` / `D`        | Done                           |
| `J` / `→`        | Skip (keep as is)              |
| `⌫` / `Delete`   | Delete (undoable)              |
| `Z` / `⌘Z`       | Undo                           |
| `T`              | Today                          |
| `M`              | Tomorrow                       |
| `W`              | This weekend                   |
| `N`              | Next week                      |
| `S`              | Pick a date (natural language) |
| `V` / `P`        | Move to project / section      |
| `L`              | Labels                         |
| `1`–`4`          | Priority P1–P4                 |
| `R` / `↵`        | Edit title & description       |
| `O`              | Open in Todoist                |
| `K` / `←`        | Previous task                  |
| `G` then `A/O/T/I` | Go to All / Overdue / Today / Inbox |
| `Q`              | Next queue                     |
| `⇧R`             | Refresh                        |
| `?`              | Show all shortcuts             |

In the pickers, `↑`/`↓` and `↵` choose, `Esc` closes, and typing filters. The date picker sends whatever you type to Todoist's own parser, so `fri 3pm`, `in 2 weeks` and `every other monday` all work.

## Gestures (phone)

| Gesture           | Action             |
| ----------------- | ------------------ |
| Swipe right       | Done               |
| Long swipe right  | Delete             |
| Swipe left        | Schedule…          |
| Long swipe left   | Move to project…   |
| Swipe up          | Skip               |

The bottom bar has one-tap **Today / Tomorrow / Weekend / Next week** buttons, along with **Skip, Move, Done, Date…** and **More**. More holds priority, labels, edit, delete and undo.

## Safety nets

- **Undo** works for every action: complete, reschedule, move, priority, labels, edit and delete. The toast has an Undo button, and `Z` pops the history.
- **Deletes are delayed** by 8 seconds so they can be undone. They're flushed right away if you close or background the app.
- **Recurring tasks keep their recurrence.** Picking a preset date moves the next occurrence through the Sync API's `item_update` (date plus the original recurrence string) instead of overwriting the due string. Times of day and fixed time zones are preserved too.
- Changes are optimistic. If Todoist rejects one, the card is restored and an error is shown.

## Deploying

`npm run build` produces a fully static `dist/` folder with relative asset paths, so it can be served from any host or sub-path.

A GitHub Pages workflow is included in `.github/workflows/deploy.yml`. Push to `main`, then enable **Settings → Pages → Source: GitHub Actions** on the repository. Netlify, Vercel, Cloudflare Pages or any static file server work just as well. Use HTTPS so the iPhone treats it as an installable web app.

Each person signs in with their own Todoist account, and nothing is stored server-side, so a public deployment is safe to share.

## Development

```bash
npm test        # unit tests: date math, queue logic, PKCE and token refresh (vitest)
npm run build   # typecheck + production build
npm run icons   # regenerate the PNG app icons
```

Code map:

- `src/auth.ts`: OAuth sign-in (PKCE), token storage and refresh
- `src/api/todoist.ts`: the SDK wrapper (loading, close/reopen/delete/update/move, Sync-based rescheduling, refresh-and-retry on 401)
- `src/api/demo.ts`: the in-memory backend behind demo mode
- `src/store.ts`: app state (signals), optimistic actions, undo, delayed deletes
- `src/lib/queue.ts`: which tasks need triage and in what order
- `src/lib/dates.ts`: time zone-aware date math and presets
- `src/shortcuts.ts`: the keyboard map, which drives both the handler and the help sheet
- `src/components/TaskCard.tsx`: the card and its swipe gestures
