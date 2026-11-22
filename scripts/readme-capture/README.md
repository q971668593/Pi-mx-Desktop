# README capture

Re-shoots every visual used by `README.md` / `README.zh-CN.md` / `README.en.md`:

```bash
npm run readme:capture                       # every step, both languages
npm run readme:capture -- --only screens     # stills only (no ffmpeg needed)
```

Screenshots and GIFs come from the real app; the overview, architecture and theme visuals are HTML pages under `renders/` composed from those screenshots and rendered offscreen. All outputs are overwritten in place:

| Step (`--only`) | Output in `doc/assets/readme/<lang>/` | What it shows |
|---|---|---|
| `screens` | `hero-light.png`, `hero-dark.png` | Framed window: session list, the fixed turn, Review with a side-by-side Git diff |
| `timeline` | `timeline.gif` | The collapsed tool summary expanding into seven steps, then folding back |
| `agent` | `agent-turn.gif` | A real worker running the fix turn against the scripted endpoint |
| `composer` | `composer-mention.gif` | Typing `@` pops file candidates; picking one inserts a file chip |
| `review` | `review-stage.gif` | Widening the sidebar, opening Review's Git scope, side-by-side diff, staging a hunk |
| `files` | `files-preview.gif` | Tree, preview of `src/links.mjs`, quoting a line into the composer |
| `terminal` | `terminal.gif` | Terminal drawer: `git log`, `node --test`, a split running `git status` |
| `branches` | `branches.gif` | Status bar branch picker filtering and switching |
| `team` | `team-dispatch.gif` | Opening task T-007 and dispatching it to a role |
| `usage` | `usage.png` | Settings → Usage over 90 days (seeded history) |
| `themes` | `themes.png` | Claude preset in light, and dark over a background image |
| `visuals` | `overview.png`, `architecture-{light,dark}.png`, `theme-switch.gif` | Rendered from `renders/*.html`; needs the `files`, `terminal` and `composer` frames of the same run |
| `social` | `doc/assets/readme/social-preview.png` | 1280×640 card for *Settings → Social preview* (upload manually) |

## How it works

1. **Build** — `electron-vite build` into `<work>/app/out` (the repo's `out/` is untouched). The copy's main window gets `webPreferences.offscreen`, and a small entry sets `userData` to the demo directory and never shows windows. Nothing needs a display or window manager (Linux uses `--ozone-platform=headless`).
2. **Seed** (`seed.mjs`) — an isolated `HOME` with a small git repo (`~/code/lumen`), a work-team board (`seed-board.mjs`), and pi sessions written through the SDK's `SessionManager`. Tool results come from running the SDK's real `read` / `edit` / `bash` tools on that repo. Your own `~/.pi` and app settings are never read or written. `fd` is copied into the demo agent dir so `@` search really works.
3. **Capture** (`capture.mjs`) — Playwright drives the app at 1440×900, device scale 2.
4. **Record** (`record.mjs`, `record-features.mjs`) — frames with timestamps, so GIFs replay at real speed. The agent and team recordings run real workers against `mock-llm.mjs`, a local OpenAI-compatible endpoint that streams the scripted turns from `demo-script.mjs` (it picks the script from the first user message).
5. **Render** (`render.mjs`, `visuals.mjs`, `renders/`) — each template reads `window.__DATA__` (copy, crops of the screenshots, the version from `package.json`) and is captured in one offscreen Electron run. Animated templates expose `window.renderFrame(t)`.
6. **Compose** (`media.mjs`) — ImageMagick frames and crops PNGs, ffmpeg builds GIFs.

The demo story (prompts, thinking, tool calls, answers) lives in `demo-script.mjs` and is shared by the seeded sessions and the mock endpoint, so stills and recordings tell the same story.

## Phone screenshots

Not part of `readme:capture`, and the READMEs no longer ship them: the strip that used to sit at `doc/assets/readme/<lang>/phone.png` came from the upstream pi Desktop capture set. To add one, run the Android app on an emulator against the fake desktop (`node scripts/remote-dev-host.mjs` with `PI_REMOTE_DEMO_LANG=en|zh` and `PI_REMOTE_HOST_NAME=workstation`): inbox, a session, its diff with a line comment, the session panel — crop below the status bar and compose into one strip with ImageMagick.

## Requirements

- `npm install` done; Node.js ≥ 22.19
- `magick` (ImageMagick 7), `ffmpeg` and `git` on `PATH`
- On Windows, point `MAGICK_TEMPORARY_PATH` at a writable directory (`export MAGICK_TEMPORARY_PATH=$TEMP/imtmp`), otherwise large screenshots fail with `Not enough space`
- Fonts: the system UI and CJK fonts end up in the images (on Linux: Noto Sans CJK)

## Options

```bash
npm run readme:capture -- --lang en                     # one language
npm run readme:capture -- --only review,files           # some steps
npm run readme:capture -- --only screens,visuals
npm run readme:capture -- --work ./tmp/capture --keep-work --skip-build
```

| Variable | Purpose |
|---|---|
| `PI_CAPTURE_ELECTRON` | Electron binary to use instead of the project's `electron` package |
| `PI_CAPTURE_MOCK_PORT` | Port of the scripted model endpoint (default `18765`) |
| `PI_CAPTURE_FD` | `fd` binary copied into the demo agent dir for `@` search |

## When the UI changes

- Labels the scripts click are in `config.mjs` (`UI`, `TABS`) and in `record.mjs` / `record-features.mjs` (aria labels and menu copy, both languages); crop rectangles in logical pixels are in `CROPS`, `SPLITTER` and `visuals.mjs`.
- `app.mjs` injects `offscreen` next to the preload line of the main window in the built bundle; if `src/main/window.ts` changes that line, update `OFFSCREEN_ANCHOR` (the run fails loudly when it is missing).
- Screenshot steps that cannot find a target log `step "<name>" failed` and continue; recordings stop with an error. Check the output before committing.
- Rendered copy lives in `visuals.mjs` (`COPY`), next to the README text it has to agree with.
- A left-over `electron.exe` makes `seedDemo` fail with `EPERM ... demo-<lang>`; kill it (`taskkill /F /IM electron.exe /T`) or move the directory aside.
