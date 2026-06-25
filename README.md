# aodhq-dojo-dashboard

AODHQ Dojo BPM Ninja Rankings — Discord bot, nightly scan pipeline, and static dashboard for the Art of Drumming HQ Dojo.

**Live dashboard:** https://dreamusichef.github.io/aodhq-dojo-dashboard/

For architecture, schedules, and known bugs, see [TECHNICAL_SUMMARY.md](TECHNICAL_SUMMARY.md).

---

## What’s in this repo

| Path | Purpose |
|------|---------|
| [`bot/pulse-bot.js`](bot/pulse-bot.js) | Discord bot — digests, live clip writeback, `/mystats` |
| [`vps-scan.js`](vps-scan.js) | Nightly scan — message fetch, clip counts, dashboard + rankings refresh |
| [`dojo-dashboard-gen.js`](dojo-dashboard-gen.js) | `dojo-data.json` → HTML dashboard |
| [`ninja-rankings-gen.js`](ninja-rankings-gen.js) | `dojo-data.json` → 3 Discord ranking messages |
| [`lib/`](lib/) | Shared logic (clip detection, digests, streaks, Discord fetch, recount, etc.) |
| [`fixtures/`](fixtures/) | Sample data and hand-editable Discord message fixtures |
| [`dev/`](dev/) | Offline dev scripts + test Discord setup (`setup-test-discord.js`, `trigger-digest.js`) |
| [`test/`](test/) | Regression tests (`node:test`, no extra dependencies) |

Most business logic is pure JSON processing. Discord is only needed for fetching messages and posting digests — everything else runs offline.

**Two local dev modes:**

| Mode | When to use | Needs Discord? |
|------|-------------|----------------|
| **Offline** (`dev/*`, `npm test`) | Logic, clip rules, digest text, dashboard HTML | No |
| **Test Discord** (`npm run test:*`) | End-to-end scan, rankings PATCH, digests, slash commands | Yes — private server + separate test bot |

---

## Local setup (one-time)

1. **Install bot dependencies** (only needed if you run the bot itself):

   ```bash
   cd bot && npm install
   ```

2. **Optional — copy production data from the VPS** (`/opt/dojo-pulse/`) into the repo root for realistic local runs:

   | File | Purpose |
   |------|---------|
   | `dojo-data.json` | Student data (single source of truth) |
   | `dojo-state.json` | Scan cursors |
   | `pulse-state.json` | Digest / streak state |
   | `ninja-rankings-state.json` | Rankings message IDs |
   | `.pulse-bot-token.json` | Bot token (not needed for offline dev) |
   | `.github-token.json` | GitHub PAT (only for pushing dashboard to Pages) |

   These paths are listed in [`.gitignore`](.gitignore) — do not commit them.

3. **Or use the bundled sample data** in `fixtures/` — enough to run the full offline loop without the VPS.

---

## Local workflow

### Quick start (sample fixtures, no VPS copy)

```bash
npm test                  # regression tests (clip counting, BPM, writeback)
npm run dev:scan          # Simulate scan against fixtures/messages.json
npm run dev:rankings      # Print the 3 ninja-rankings Discord messages
npm run dev:digest        # Preview today's daily digest (plain text)
```

For **live Discord integration** (practice video uploads, rankings, digests), see [Test Discord (integration testing)](#test-discord-integration-testing) below.

### Dev scripts

| Command | What it does |
|---------|--------------|
| `node dev/run-scan-fixtures.js` | Process `fixtures/messages.json` through the scan pipeline; writes `dev/out/dojo-data.json` |
| `node dev/run-scan-fixtures.js --write` | Same, but also overwrites the source data file |
| `node dev/preview-digest.js --daily` | Preview daily digest (uses `dojo-data.json` or sample data) |
| `node dev/preview-digest.js --weekly --plain` | Weekly digest, ANSI stripped |
| `node dev/preview-digest.js --monthly --fixtures` | Monthly digest with simulated live fetch from fixtures |
| `node dev/preview-digest.js --daily --writeback` | Preview timestamp writeback into `dev/out/dojo-data.json` |
| `node dev/preview-rankings.js` | Print header / genin / footer ranking messages |
| `node dev/recount-clips.js --messages fixtures/messages.json --data fixtures/dojo-data.sample.json` | Report clip inflation vs a saved message dump |
| `node dev/recount-clips.js --messages export.json --data dojo-data.json --apply dev/out/dojo-data.json --full` | Apply corrected clip counts from a dump file |
| `node dev/full-recount.js` | Fetch all `#practice-videos` history via bot token and report clip inflation |
| `npm run recount -- --apply --full` | Apply a full recount on production data (see [Full clip recount](#full-clip-recount) below) |
| `node dojo-dashboard-gen.js` | Generate `dojo-dashboard.html` locally (skips GitHub push without token) |

### Editing test inputs

Add or change cases in [`fixtures/messages.json`](fixtures/messages.json). Each fixture is a Discord REST-shaped message with optional `expectedClips` and `expectedBpm` fields used by the test suite:

| Fixture | Scenario |
|---------|----------|
| `fixture-youtube-single` | One YouTube URL |
| `fixture-mp4-upload` | Direct `.mp4` attachment (no URL) |
| `fixture-small-gif-mp4` | Small video attachment that should be skipped |
| `fixture-practice-named-mp4` | Small file with `practice` in filename — should count |
| `fixture-multi-clip` | Multiple URLs in one message |
| `fixture-tenor-gif` | Tenor URL — should not count |
| `fixture-bpm-embed` | BPM extraction (include rules) |
| `fixture-bpm-excluded` | BPM extraction (exclude rules) |

After editing fixtures, run `npm test` and `npm run dev:scan` to verify.

### Typical bug-fixing loop

1. Copy latest `dojo-data.json` from the VPS when you want real data.
2. Add or adjust a case in `fixtures/messages.json`.
3. `npm run dev:scan` — confirm clip counts and BPM updates.
4. `node dev/preview-digest.js --daily --plain` — inspect digest output.
5. `node dojo-dashboard-gen.js` — open `dojo-dashboard.html` in a browser.
6. `npm test` — confirm no regressions.

For **inflated clip counts** (see TECHNICAL_SUMMARY Bug 1), use [Full clip recount](#full-clip-recount) below — no third-party export tool required.

---

## Full clip recount

Use this when clip detection was fixed, Message Content Intent was enabled late, or counts were double-incremented. It fetches **all** `#practice-videos` history through the **existing Dojo Pulse bot** (same token as `vps-scan.js`) and recomputes `clips` per student using unified detection in `lib/clip-detection.js`.

**What it changes:** `clips` and `meta.totalClips` only. It does **not** rebuild `clip_timestamps`, BPM fields, or the engagement-message fields (`hall`/`lounge`/`sentinel` — those have their own recount, see [Message-count recount](#message-count-recount)). The nightly scan continues incrementally after you apply.

**What it does not do:** Resetting `dojo-state.json` cursors and re-running `vps-scan.js` is **not** a recount — the scan **adds** to existing counts. Use `dev/full-recount.js` instead.

### Prerequisites

- Bot token at `.pulse-bot-token.json` (production) or `.pulse-bot-token.test.json` (test mode)
- **Message Content Intent** enabled on the bot application
- Bot has **Read Message History** on `#practice-videos`

### Step 1 — Report only (always do this first)

On the **VPS** (recommended — token and data already live there):

```bash
cd /opt/dojo-pulse
node dev/full-recount.js
```

Locally against test data:

```bash
npm run test:recount
```

Review the diff printed for each student (`inflated` / `undercounted`). Optionally save the fetched messages for audit:

```bash
node dev/full-recount.js --save dev/out/practice-videos-export.json
```

For a few thousand messages, expect a few minutes of Discord pagination — normal for a one-time ops run.

### Step 2 — Apply corrected counts

When the report looks right:

```bash
# Production (writes dojo-data.json, creates dojo-data.json.bak-<timestamp> first)
node dev/full-recount.js --apply --full

# Or write to a staging file first
node dev/full-recount.js --apply --full --out dev/out/dojo-data-recounted.json
```

| Flag | Meaning |
|------|---------|
| `--apply` | Write corrected `clips` values |
| `--full` | Set `clips = 0` for students with no posts in channel history (recommended for a true from-scratch recount) |
| `--out <path>` | Output file (default: same as data file) |
| `--save <path>` | Save raw Discord message export |
| `--data <path>` | Override data file path |

Without `--full`, only students who appear in the fetched history are updated; everyone else keeps their current count.

### Step 3 — Refresh dashboard and rankings

After applying on the VPS:

```bash
node dojo-dashboard-gen.js    # pushes GitHub Pages dashboard
node vps-scan.js              # regenerates rankings + PATCHes #ninja-rankings
```

Or trigger the normal nightly scan window — it always refreshes dashboard and rankings even when there are no new messages.

### Offline recount from a saved dump

If you already have a message export JSON (from `--save` or `dev/recount-clips.js` format):

```bash
node dev/recount-clips.js --messages dev/out/practice-videos-export.json --data dojo-data.json --apply dojo-data.json --full
```

---

## Message-count recount

The engagement-message counts (`hall`, `lounge`, `sentinel`) are scanned incrementally each night from
`#the-hall`, `#lounge`, and `#sentinel-council` (the `MESSAGE_CHANNELS` registry in [`lib/discord-config.js`](lib/discord-config.js)).
To rebuild them **from scratch** out of full channel history — e.g. after adding a new channel to the registry,
or to replace unreliable legacy counts — use the dedicated recount, which mirrors the clip recount:

```bash
# Report only — fetches full history per channel, prints the diff, writes nothing
npm run recount:messages
# or: node dev/recount-messages.js

# Apply — resets hall/lounge/sentinel from history AND advances the dojo-state cursors
# so the nightly scan continues incrementally (no double counting). Backs up first.
node dev/recount-messages.js --apply
```

| Flag | Meaning |
|------|---------|
| *(none)* | Report only — no writes |
| `--apply` | Full reset of each field from history + advance cursors (backs up `dojo-data.json` + `dojo-state.json`) |
| `--save <dir>` | Also dump the fetched messages per channel for audit |

Run it **once on the VPS** (where the bot token and live data live), then regenerate the dashboard:
`node dojo-dashboard-gen.js`. A channel the bot can't read (HTTP 403) is reported and left unchanged.

For practice-video clip counts, use [Full clip recount](#full-clip-recount) instead.

---

## Dry-run mode (optional live Discord)

If you run the production scripts locally with a real token but want to avoid posting:

```bash
# vps-scan.js — skips Discord POST/PATCH, still updates local JSON
DOJO_DRY_RUN=1 node vps-scan.js
node vps-scan.js --dry-run

# pulse-bot.js — skips channel.send and cron registration
DOJO_DRY_RUN=1 node bot/pulse-bot.js
```

For day-to-day development, prefer the `dev/*` scripts instead — they need no token at all.

---

## Test Discord (integration testing)

Run the **full live pipeline** against a **private test server** using a **separate Discord bot application** — not the production Dojo bot. Production channels and GitHub Pages are never touched when `DOJO_TEST_MODE=1` is set.

Use this when you need to verify:

- Practice video / link detection from real Discord API payloads
- Scan → `dojo-data.json` → dashboard HTML → `#ninja-rankings` PATCH
- Digests in `#dojo-pulse` and slash commands (`/mystats`, etc.)

### Prerequisites

- Node.js installed
- A Discord account
- Repo cloned locally

### Step 1 — Create a test bot application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. **New Application** → name it something like `Dojo Pulse Test` (keep it separate from production).
3. Open **Bot** in the sidebar → **Reset Token** → copy the token (you will not see it again).
4. Under **Privileged Gateway Intents**, enable **Message Content Intent** → **Save Changes**.

   **This intent is required.** Without it, Discord returns messages with empty `content`, `attachments`, and `embeds`. The scan will log `1 new messages` but count zero clips. If you see `message shell(s) with empty content` in the terminal, enable this intent, reset scan cursors (Step 6), and re-scan.

5. Save the token to **`.pulse-bot-token.test.json`** in the repo root (gitignored):

   ```json
   { "token": "YOUR_TEST_BOT_TOKEN" }
   ```

   Do not use the production `.pulse-bot-token.json` for local testing.

### Step 2 — Create a private test server and invite the bot

1. In Discord, **Add a Server** → create a private server for testing.
2. In the Developer Portal, open your test app → **OAuth2** → **URL Generator**.
3. Select scopes: **`bot`**, **`applications.commands`**
4. Select bot permissions:
   - Manage Channels
   - Send Messages
   - Read Message History
   - Manage Messages (needed to PATCH ranking messages)
5. Copy the generated URL, open it in a browser, and add the bot to your test server.

### Step 3 — Install dependencies

```bash
cd bot && npm install && cd ..
npm install
```

Root `npm install` pulls in `cross-env` (for Windows-friendly test scripts). Bot dependencies include `discord.js`.

### Step 4 — Bootstrap channels and config

1. Enable **Developer Mode** in Discord: Settings → Advanced → Developer Mode.
2. Right-click your test server name → **Copy Server ID**.
3. Run bootstrap from the repo root:

   ```bash
   npm run test:setup -- --guild YOUR_TEST_GUILD_ID
   ```

   The `--` passes `--guild` to the setup script, not to npm.

This script:

- Creates `#practice-videos`, `#the-hall`, `#ninja-rankings`, `#dojo-pulse`, `#clawdbot-notifications` (if missing)
- Posts 3 placeholder ranking messages in `#ninja-rankings`
- Seeds isolated data under `dev/test-data/`
- Writes `.dojo-test-config.json` (channel IDs — do not edit by hand)

**Generated files (all gitignored):**

| File | Purpose |
|------|---------|
| `.dojo-test-config.json` | Test guild + channel IDs |
| `.pulse-bot-token.test.json` | Test bot token (you create this in Step 1) |
| `dev/test-data/dojo-data.json` | Student stats |
| `dev/test-data/dojo-state.json` | Scan cursors (`lastMessageId` per channel) |
| `dev/test-data/pulse-state.json` | Digest / streak state |
| `dev/test-data/ninja-rankings-state.json` | Ranking message IDs for PATCH |

### Step 5 — Align student usernames (optional)

Sample data in `dev/test-data/dojo-data.json` includes placeholder students (`alice_test`, etc.). Either:

- **Edit `"u"` fields** to match the Discord **username** (not display name) of accounts that will post clips, or
- **Skip this** — the scan auto-adds a new student on first detected clip using `author.username` from Discord.

To check your username: Discord → Settings → My Account, or run `/mystats` after starting the test bot (Step 7).

### Step 6 — Test practice video uploads

This is the main integration loop for clip detection and the scan pipeline.

1. **Post a clip** in `#practice-videos` from your Discord account. Any of these should count:

   | Post type | Example |
   |-----------|---------|
   | YouTube link | `Day 1 — 120 BPM https://www.youtube.com/watch?v=...` |
   | YouTube link only | Paste the URL (Discord may embed it) |
   | Video upload | Attach an `.mp4` directly |

   Posts that do **not** count: Tenor/Giphy GIFs, image-only uploads, plain text with no clip.

2. **Run the scan:**

   ```bash
   npm run test:scan
   ```

3. **Check the terminal** for success signals:

   ```
   [Scan] #practice-videos: 1 new messages
   [Scan] dojo-data.json updated
   [Scan] Auto-added new student: your_username    ← if you weren't in dojo-data yet
   [Scan] #ninja-rankings updated: header=true ...
   ```

   If you see `message shell(s) with empty content`, Message Content Intent is still off (Step 1).

4. **Verify outputs:**

   - `dev/test-data/dojo-data.json` — clip count incremented (or new student added)
   - `#ninja-rankings` in Discord — 3 messages updated
   - `dev/test-data/dojo-dashboard.html` — open in a browser

5. **Post another clip** and run `npm run test:scan` again — only messages **after** the last cursor are fetched (incremental scan, same as production).

**Re-scanning old messages:** If you fixed Message Content Intent or clip detection and need to re-process earlier posts, reset the cursor in `dev/test-data/dojo-state.json`:

```json
"practice-videos": { "lastMessageId": "0" }
```

Then run `npm run test:scan` again.

### Step 7 — Test digests and slash commands (optional)

Keep the test bot online:

```bash
npm run test:bot
```

| Command | What it does |
|---------|--------------|
| `/mystats` | Ephemeral stats for your Discord username |
| `/dojo-scan` | Run scan pipeline (Manage Server required) |
| `/dojo-digest` | Post daily / weekly / monthly digest |
| `/dojo-writeback` | Live-fetch today's clips → timestamps |

Or run a one-shot digest from the terminal:

```bash
npm run test:digest -- --daily
npm run test:digest -- --weekly
npm run test:digest -- --monthly
```

### Test commands reference

| Command | What it does |
|---------|--------------|
| `npm run test:setup -- --guild <id>` | One-time bootstrap (Step 4) |
| `npm run test:scan` | Scan `#practice-videos` + `#the-hall`, update data, dashboard, rankings |
| `npm run test:digest -- --daily` | Post digest to `#dojo-pulse` without keeping bot online |
| `npm run test:bot` | Run bot for slash commands (no production cron) |

All test runs set `DOJO_TEST_MODE=1` automatically. Data stays in `dev/test-data/`; GitHub Pages push is skipped.

See [`fixtures/dojo-test-config.sample.json`](fixtures/dojo-test-config.sample.json) for the config file shape.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `#practice-videos: N new messages` but no `dojo-data.json updated` | Message Content Intent off | Enable intent (Step 1), reset cursor, re-scan |
| `message shell(s) with empty content` warning | Same as above | Same as above |
| `/mystats` says you're not in the dojo | `"u"` mismatch | Edit `dojo-data.json` or let scan auto-add on first clip |
| Clip posted but never scanned again | Cursor already passed it | Reset `lastMessageId` to `"0"` or post a new message |
| Rankings PATCH fails | Bot missing Manage Messages | Re-invite with correct permissions |

---

## Tests

```bash
npm test
```

Covers unified clip detection (`lib/clip-detection.js`), BPM extraction, and writeback behavior (timestamps added without incrementing `clips`).

---

## Production deploy

See the **How to Deploy Changes** section in [TECHNICAL_SUMMARY.md](TECHNICAL_SUMMARY.md).
