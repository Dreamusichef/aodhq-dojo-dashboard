# Dojo Pulse Bot — Technical Summary

## What It Is

A Discord bot for the **Art of Drumming HQ (AODHQ) Dojo** server — a drumming education community with ~111 students. The bot tracks practice video submissions, counts chat engagement, generates daily/weekly/monthly activity digests, maintains a ninja-style ranking system, fires milestone celebrations, and publishes a public dashboard + a privacy-safe public JSON API.

No AI calls — pure data processing and Discord API.

> **Doc map:** this file = infra + internals. `README.md` = dev/test commands. `THE_DOJO_BRIEF.md` = the
> product/vision brief and the canonical feature changelog. When in doubt about current feature state, the brief wins.

---

## Architecture Overview

```
VPS (Hetzner CX23, Helsinki, Ubuntu 24.04) — /opt/dojo-pulse is a git checkout of main
├── /opt/dojo-pulse/
│   ├── bot/pulse-bot.js          — Main bot process (discord.js v14, PM2-managed). Thin: orchestrates lib/.
│   ├── vps-scan.js               — Nightly scan (clips + engagement messages) + data update + dashboard + rankings
│   ├── dojo-dashboard-gen.js     — HTML dashboard generator → GitHub Pages; also publishes dojo-data.public.json
│   ├── ninja-rankings-gen.js     — Thin wrapper → lib/rankings-gen.js (3 #ninja-rankings messages)
│   ├── lib/                      — Shared, mostly-pure logic (clip-detection, scan-process, digest, streaks,
│   │                               milestone, rankings-gen, public-projection, recount-*, data, discord-*, pulse-ops)
│   ├── roles.json                — Hand-curated Dojo Sentinel / specialization overlay (committed; keyed by username)
│   ├── dojo-data.json            — 🔴 SINGLE SOURCE OF TRUTH for all student data (gitignored, VPS-only)
│   ├── dojo-data.public.json     — Privacy-safe public projection (generated; pushed to GitHub Pages)
│   ├── dojo-state.json           — Scan cursor state (lastMessageId per channel)
│   ├── pulse-state.json          — Digest state (streaks, previous_ranks, last_milestone, etc.)
│   ├── ninja-rankings-state.json — Message IDs for the 3 ranking messages
│   ├── ninja-rankings-update.json— Generated output from ninja-rankings-gen.js
│   ├── ecosystem.config.js       — PM2 launch config (sets cwd + the bot/register-deps.js preload)
│   ├── .pulse-bot-token.json     — Discord bot token (gitignored)
│   └── .github-token.json        — GitHub PAT for the Pages push (gitignored)
```

Most logic lives in `lib/` and is pure JSON processing; `bot/pulse-bot.js`, `vps-scan.js`, and
`ninja-rankings-gen.js` are thin entry points that wire it together. This is why their line counts are small.

**Dashboard**: https://dreamusichef.github.io/aodhq-dojo-dashboard/
**Dojo Server ID**: `1343785579829137529`

---

## Nightly Schedule (all times SGT = UTC+8)

### 22:50 SGT → `vps-scan.js` (triggered by pulse-bot.js via node-cron; was 22:55 — shifted Jul 2026 to dodge a GitHub-side Pages-deploy failure window at ~14:55 UTC)

1. Fetches new messages from `#practice-videos` (ID: `1356110369818411131`) incrementally using stored `lastMessageId` cursor
2. For each practice video message: appends `clip_timestamps` (deduped) and increments `student.clips` by the newly-recorded count, sets `lastActivity`, extracts BPM from YouTube embed titles
3. Counts **engagement messages** per author for every channel in the `MESSAGE_CHANNELS` registry (`lib/discord-config.js`), each with its own cursor:
   - `#the-hall` (`1347383072303091823`) → `hall`
   - `#lounge` (`1343785602771980342`) → `lounge`
   - `#sentinel-council` (`1367519122799464490`) → `sentinel`
4. Writes updated `dojo-data.json` (recomputes `meta.totalClips`)
5. Writes updated `dojo-state.json` (advances every cursor)
6. Runs `dojo-dashboard-gen.js` → generates HTML → pushes `index.html` + `dojo-data.public.json` to GitHub Pages as **one atomic commit** (Git Data API — two separate PUTs used to trigger two competing Pages builds; the cancellation race wedged deploys Jul 2–4 2026)
7. Runs `ninja-rankings-gen.js` → generates content → PATCHes 3 Discord messages in `#ninja-rankings` (ID: `1488189728913096744`). Message IDs are read from `ninja-rankings-state.json` (no longer hardcoded).

> The dashboard + rankings refresh runs **even when there are no new messages**, so manual data edits still publish.

### 23:00 SGT → Digest (pulse-bot.js internal cron)

1. Runs `runDailyWriteback()` — live-fetches today's clips from Discord via discord.js client, writes `clip_timestamps` to `dojo-data.json`
2. Then runs one of:
   - **1st of month** → `runMonthly()` (posts `@everyone` monthly summary)
   - **Sunday** → `runWeekly()` (weekly summary)
   - **Any other day** → `runDaily()` (daily summary, also does another live fetch + writeback internally)
3. Digests are posted to `#dojo-pulse` as ANSI-colored code blocks
4. Finally runs `runMilestoneCheck()` — if the dojo total just crossed a new 1,000 boundary (≥2,000), it pings the owner in `#clawdbot-notifications` with a ready-to-paste celebration and records `last_milestone`. The bot never auto-posts the celebration publicly (see [Milestone system](#milestone-system)).

---

## Data Model: `dojo-data.json`

```json
{
  "meta": {
    "totalClips": 2000,
    "lastUpdated": "2026-06-23T..."
  },
  "students": [
    {
      "name": "Display Name",
      "u": "discord_username",
      "join": "2026-03-05",
      "clips": 305,
      "clip_timestamps": ["2026-05-26T02:06:13.919Z", ...],
      "comments": 0,
      "tech": 0,
      "lounge": 7,
      "qwei": 0,
      "hall": 0,
      "sentinel": 0,
      "startBpm": 80,
      "highBpm": 200,
      "currentBpm": 180,
      "loc": "Italy",
      "notes": "OG member",
      "active": true,
      "lastActivity": "2026-06-11T..."
    }
  ]
}
```

~111 students total. `clips` = lifetime practice video count. `clip_timestamps` = individual clip timestamps (added later — partial coverage for older students). `hall`/`lounge`/`sentinel` (and legacy `comments`/`tech`/`qwei`) = per-channel engagement message counts.

### Public projection — `dojo-data.public.json`

A privacy-safe, slimmed view built by `lib/public-projection.js` and published to GitHub Pages for any frontend (the Lovable dashboard) to fetch (CORS `*`, ~10-min cache, refreshes nightly):
`https://dreamusichef.github.io/aodhq-dojo-dashboard/dojo-data.public.json`

- **Drops** the username `u` (PII) and source-only fields (`clip_timestamps`, `notes`, `lastActivity`).
- **Adds** a stable, non-PII `id` — a short SHA-1 hash of the username (computed before `u` is dropped); the safe unique key for frontends.
- **Normalizes** `loc` to full country names.
- **Attaches** a `roles` overlay from `roles.json` (Dojo Sentinels + optional specialization), looked up by `u` before it is stripped. No role → field absent.

---

## Ranking System

4 tiers based on `clips` count:

| Tier | Name | Threshold |
|------|------|-----------|
| 🔥 | Elite Jōnin | 50+ clips |
| ⭐ | Chūnin | 20+ clips |
| 🌱 | Genin | 1+ clips |
| 👻 | Ghost | 0 clips |

Inactive students (2+ months no activity) keep their rank but get marked 💤.

Rankings are displayed in `#ninja-rankings` as 3 Discord messages (header, genin list, footer) that get edited in place nightly.

---

## Clip Detection Logic

**Unified — one detector, `lib/clip-detection.js` `countClipsInMessage()`, used by BOTH the scan and the bot.**
(This resolved the old two-function divergence; see [Resolved history](#resolved-history).)

```js
// 1. Counts video file attachments (.mp4, .mov, .webm, etc.)
//    - Skips image/* content types
//    - Skips small files without duration metadata (likely GIFs) unless filename signals a clip
// 2. Counts video links (YouTube, Vimeo, Streamable, Twitch, Google Photos, Google Drive)
//    - Skips GIF sources (Tenor, Giphy, Gfycat, Imgur .gif)
// 3. Falls back to video embeds
```

`vps-scan.js` (via `lib/scan-process.js`) and `bot/pulse-bot.js` (via `lib/pulse-ops.js`) call the same function, so a YouTube link and a direct `.mp4` upload count identically everywhere. **Limitation:** the detector can't distinguish a member's *own* practice video from a *shared* tutorial — both are video embeds; only a 3rd-party channel name hints at it. Periodic manual sweeps trim obvious over-counts.

**Single counter, no double-write.** `vps-scan.js` owns `clips`: it appends deduped `clip_timestamps` and increments `clips` only by the count of *newly recorded* timestamps. The bot's writeback adds timestamps but never increments `clips`. Re-seeing a message on a later scan therefore cannot double-count. (`lib/data.js reconcileClips()` keeps `clips ≥ clip_timestamps.length` as a safety net.)

---

## Milestone system

Every 1,000 clips (≥2,000), the dojo "feasts." The bot does **not** post publicly. After the nightly digest, `runMilestoneCheck()` (`lib/pulse-ops.js`) detects the crossing, **pings the owner** in `#clawdbot-notifications` with a ready-to-paste celebration (collective stats + top 10 + Wei Lung's note, `@everyone` inside a code block so it's inert), and records `last_milestone` in `pulse-state.json`. The owner posts it manually in `#announcements`. That night's digest also shows a subtle flourish (`🏯 Milestone — crossed N today!` + a completed mission bar). `/dojo-celebrate` (admin-only, ephemeral) prints the same message on demand.

**Design rule (learned the hard way):** the digest flourish is gated on `last_milestone`, and `last_milestone` must be recorded **independently of the owner-ping succeeding**. Coupling them caused the 2,000 flourish to repeat every night when the ping threw. The ping is now best-effort; the milestone is always recorded once the boundary is crossed. Regression test: `test/milestone-check.test.js`.

---

## Known Issues (current)

### 🟡 `#the-hall` / engagement channels may 403

Historically the bot got HTTP 403 fetching `#the-hall`. Engagement counting now covers `#the-hall`, `#lounge`, and `#sentinel-council` (the `MESSAGE_CHANNELS` registry), but each still depends on the bot having **Read Message History** there. A channel that 403s is logged and its field is left unchanged — verify the bot's per-channel permissions if `hall`/`lounge`/`sentinel` stops moving. (Low urgency — engagement counts aren't part of the ranking metric.)

### 🟡 Shared-tutorial over-count

The detector counts any video embed, so a shared 3rd-party tutorial can inflate a count. Mitigated by periodic manual sweeps; no automatic own-vs-shared signal exists.

---

## Resolved history

- **Milestone flourish repeated nightly (Jun 2026).** `last_milestone` was only saved after a successful owner-ping; a failing ping left it re-arming forever. Disarm decoupled from the ping + regression test.
- **Engagement counting was hall-only and broken (Jun 2026).** The old `processHallMessages` wrote to an orphan `hallCount` field nothing read. Replaced by the generic `processMessageChannel(students, messages, field)` + the `MESSAGE_CHANNELS` registry (`#the-hall`/`#lounge`/`#sentinel-council`).
- **Two-writer conflict on `clips` (Jun 2026).** The writeback used to also increment `clips`, double-counting against the scan. Writeback now only adds timestamps; `vps-scan.js` is the sole `clips` counter; `reconcileClips()` is the safety net.
- **Divergent clip detection (Jun 2026).** Scan and bot used different counters. Unified into `lib/clip-detection.js`.
- **Rankings message IDs were stale / hardcoded (Jun 2026).** Now read from `ninja-rankings-state.json` via `loadRankingsMessageIds()` — no constants in `vps-scan.js`.
- **`fetchMessages` had no pagination (Jun 2026).** Now paginates with rate-limit pauses (`lib/discord-fetch.js`).
- **Early return skipped dashboard/rankings refresh (Jun 2026).** Refresh now always runs, even with zero new messages.

---

## File Details

> Line counts are approximate and were correct at the last review (Jun 2026). Most logic now lives in `lib/`; the entry points are thin. Don't treat counts as load-bearing.

### `bot/pulse-bot.js` (~270 lines)
- discord.js v14 client; **thin entry point** — registers crons + slash commands and delegates to `lib/pulse-ops.js`.
- Two internal crons (node-cron): scan at 22:50 SGT, digest at 23:00 SGT (digest then runs `runMilestoneCheck`).
- Must be launched via `ecosystem.config.js` (sets cwd + the `-r ./bot/register-deps.js` preload so shared `lib/` code can resolve `discord.js` from `bot/node_modules`). A bare `node bot/pulse-bot.js` crashes with `MODULE_NOT_FOUND`.
- Slash commands: `/mystats` (public, ephemeral), `/dojo-celebrate` (admin-only). Test-mode-only: `/dojo-scan`, `/dojo-digest`, `/dojo-writeback`.

### `lib/` (the real logic)
- `pulse-ops.js` — the bot's run functions: `fetchLiveClips`, `runDailyWriteback`, `runDaily/Weekly/Monthly`, `runMilestoneCheck`, `pingMilestone`, `ensureChannel` (lazy-requires `discord.js`).
- `digest.js` — `buildDailyMessage` / `buildWeeklyMessage` / `buildMonthlyMessage` (ANSI), `milestoneBar`, `updatePreviousRanks`, leaderboard-position milestones.
- `clip-detection.js` — the unified clip detector. `scan-process.js` — practice-video processing + `processMessageChannel` (engagement counts).
- `rankings-gen.js` — the 3 ranking message bodies + country→flag map. `streaks.js` — Cycle/Week. `milestone.js` — crossing detection + celebration text.
- `public-projection.js` — the public JSON shape (`stableId`, loc normalization, roles overlay). `discord-fetch.js` — raw-REST Discord (paginated, 429-aware). `discord-config.js` — IDs, paths, token, `MESSAGE_CHANNELS`. `data.js` — read/write + `reconcileClips`. `clips-period.js`/`sgt.js` — SGT windows. `recount-clips.js`/`recount-messages.js` — one-time recount logic.

### `vps-scan.js` (~207 lines)
- Raw REST via `lib/discord-fetch.js` (no discord.js dependency)
- Incremental scan using `?after=<lastMessageId>` cursor, for `#practice-videos` and every `MESSAGE_CHANNELS` channel
- BPM extraction from YouTube embed titles (`lib/bpm-extract.js`, include/exclude keyword filters)
- Auto-creates new students when an unknown poster is detected (alerts the notify channel)
- Runs `dojo-dashboard-gen.js` and `ninja-rankings-gen.js` as child processes; PATCHes rankings (IDs from `ninja-rankings-state.json`)

### `dojo-dashboard-gen.js` (~356 lines)
- Reads `dojo-data.json` → generates a self-contained HTML dashboard (the "messages" column sums all engagement fields incl. `sentinel`)
- Pushes `index.html` + `dojo-data.public.json` to the GitHub Pages repo (`Dreamusichef/aodhq-dojo-dashboard`) as **one atomic commit** via the Git Data API (`pushFilesAtomic`) — one Pages build per night, no cancellation race
- Builds the public JSON via `lib/public-projection.js buildPublicStudents()` (+ `roles.json`)
- Uses a GitHub personal access token from `.github-token.json`

### `ninja-rankings-gen.js` (~20 lines)
- Thin wrapper: reads `dojo-data.json` + `ninja-rankings-state.json`, calls `lib/rankings-gen.js generateRankings()`, writes `ninja-rankings-update.json`
- `vps-scan.js` reads that output and PATCHes the 3 Discord messages

---

## State Files

### `dojo-state.json` — Owned by `vps-scan.js`
One cursor per scanned channel (key = the `MESSAGE_CHANNELS` `stateKey`):
```json
{
  "lastChecked": "2026-06-23T...",
  "channels": {
    "practice-videos":  { "lastMessageId": "..." },
    "the-hall":         { "lastMessageId": "..." },
    "lounge":           { "lastMessageId": "..." },
    "sentinel-council": { "lastMessageId": "..." }
  }
}
```

### `pulse-state.json` — Owned by `pulse-bot.js`
```json
{
  "channelId": "<#dojo-pulse id>",
  "streaks": { "<username>": { "current_cycle": 2, "current_week": 4, "status": "active" } },
  "previous_ranks": { "<username>": "Chūnin" },
  "previous_positions": { "<username>": 5 },
  "last_daily": "2026-06-11T15:00:01.598Z",
  "last_weekly": "...",
  "last_monthly": "...",
  "last_milestone": 2000
}
```
`last_milestone` = the highest 1,000 boundary already celebrated; gates both the owner-ping and the digest flourish.

### `ninja-rankings-state.json`
```json
{
  "channelId": "1488189728913096744",
  "messages": {
    "header": "1491470167237197986",
    "genin": "1491470175390666835",
    "footer": "1491470181048778783"
  }
}
```

---

## Infrastructure

- **VPS**: Hetzner CX23, Helsinki, Ubuntu 24.04 (~€4.51/mo)
- **IP**: 204.168.223.58
- **SSH**: Key-based auth (ed25519)
- **Process manager**: PM2 (`pm2 restart dojo-pulse`)
- **Bot path**: `/opt/dojo-pulse/bot/pulse-bot.js`
- **Workspace**: `/opt/dojo-pulse/`
- **Node.js**: Check with `node -v` on VPS
- **Dependencies**: `discord.js` (v14), `node-cron` (installed in `/opt/dojo-pulse/bot/node_modules/`)
- **Dashboard repo**: https://github.com/Dreamusichef/aodhq-dojo-dashboard (GitHub Pages)

---

## What Needs Doing (Priority Order)

The original clip-counting bugs (unify detection, two-writer, inflated data, configurable ranking IDs) are all **done** — see [Resolved history](#resolved-history). Open items:

1. **Verify engagement-channel permissions** — confirm the bot has Read Message History on `#the-hall`, `#lounge`, `#sentinel-council`; run `npm run recount:messages` (report-only) and check for 403s.
2. **Seed the public `id` into Lovable** — once the VPS publishes a `dojo-data.public.json` carrying the new `id` field, switch the frontend's ranking/dedup key from `name|loc` to `id`.
3. **Portal phase hardening** — when login / DB / uploads come online, apply the security rules in `THE_DOJO_BRIEF.md` §8 (RLS default-deny, service_role server-side only, scoped CORS, signed URLs).
4. **Multi-pad game modes / portal migration** — longer-horizon product work (see the brief's dream-build section).

---

## How to Deploy Changes

`/opt/dojo-pulse` is a **git checkout of `main`**. Deploy = pull + reload. Do not hand-edit
files on the server — push to `main`, then pull on the VPS.

```bash
ssh root@204.168.223.58
cd /opt/dojo-pulse
git pull

# only if bot/ dependencies changed:
cd bot && npm install && cd ..

# restart the bot (PM2 launches it via ecosystem.config.js):
pm2 reload ecosystem.config.js
pm2 logs dojo-pulse --lines 50        # verify: "Dojo Pulse online ... (PRODUCTION)"

# manual scan to refresh dashboard + #ninja-rankings when needed:
node vps-scan.js
```

**Local-only files** (gitignored; `git pull` never touches them):
`dojo-data.json`, `dojo-state.json`, `pulse-state.json`, `ninja-rankings-state.json`,
`.pulse-bot-token.json`, `.github-token.json`.

The bot **must** be launched from `ecosystem.config.js` (it sets `cwd` and the
`-r ./bot/register-deps.js` preload so shared `lib/` code can resolve `discord.js` from
`bot/node_modules`). Starting it with a bare `node bot/pulse-bot.js` crashes with
`MODULE_NOT_FOUND`.
