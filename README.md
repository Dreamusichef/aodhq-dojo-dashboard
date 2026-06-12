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
| [`lib/`](lib/) | Shared logic (clip detection, digests, streaks, etc.) |
| [`fixtures/`](fixtures/) | Sample data and hand-editable Discord message fixtures |
| [`dev/`](dev/) | Offline dev scripts (no live Discord required) |
| [`test/`](test/) | Regression tests (`node:test`, no extra dependencies) |

Most business logic is pure JSON processing. Discord is only needed for fetching messages and posting digests — everything else runs offline.

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
npm test                  # 14 regression tests (clip counting, BPM, writeback)
npm run dev:scan          # Simulate scan against fixtures/messages.json
npm run dev:rankings      # Print the 3 ninja-rankings Discord messages
npm run dev:digest        # Preview today's daily digest (plain text)
```

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
| `node dev/recount-clips.js --messages fixtures/messages.json --data fixtures/dojo-data.sample.json` | Report clip inflation vs a message dump |
| `node dev/recount-clips.js --messages export.json --data dojo-data.json --apply dev/out/dojo-data.json` | Apply corrected clip counts to an output file |
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

For **inflated clip counts** (see TECHNICAL_SUMMARY Bug 1): export messages from Discord, then use `dev/recount-clips.js --apply` to produce corrected values before applying on the VPS.

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

## Tests

```bash
npm test
```

Covers unified clip detection (`lib/clip-detection.js`), BPM extraction, and writeback behavior (timestamps added without incrementing `clips`).

---

## Production deploy

See the **How to Deploy Changes** section in [TECHNICAL_SUMMARY.md](TECHNICAL_SUMMARY.md).
