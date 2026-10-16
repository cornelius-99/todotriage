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

Open the printed URL, then either paste your Todoist API token or click **Try it with demo data** to explore without touching your account.

Your token is in Todoist under **Settings → Integrations → Developer**. It's stored in this browser's `localStorage` and only sent to `api.todoist.com`.

### On your iPhone

1. Host the app somewhere (see [Deploying](#deploying)), or for a quick test on your Wi-Fi, run `npm run dev:lan` and open the "Network" URL on the phone.
2. Open it in Safari and paste your token.
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

Because each person pastes their own token, a public deployment is safe to share: nothing is stored server-side.

## Development

```bash
npm test        # unit tests for date math and queue logic (vitest)
npm run build   # typecheck + production build
npm run icons   # regenerate the PNG app icons
```

Code map:

- `src/api/todoist.ts`: the SDK wrapper (loading, close/reopen/delete/update/move, Sync-based rescheduling)
- `src/api/demo.ts`: the in-memory backend behind demo mode
- `src/store.ts`: app state (signals), optimistic actions, undo, delayed deletes
- `src/lib/queue.ts`: which tasks need triage and in what order
- `src/lib/dates.ts`: time zone-aware date math and presets
- `src/shortcuts.ts`: the keyboard map, which drives both the handler and the help sheet
- `src/components/TaskCard.tsx`: the card and its swipe gestures
