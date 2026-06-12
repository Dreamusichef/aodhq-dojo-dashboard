# Dojo Pulse Bot — Technical Summary

## What It Is

A Discord bot for the **Art of Drumming HQ (AODHQ) Dojo** server — a drumming education community with ~112 students. The bot tracks practice video submissions, generates daily/weekly/monthly activity digests, maintains a ninja-style ranking system, and hosts a public dashboard.

No AI calls — pure data processing and Discord API.

---

## Architecture Overview

```
VPS (Hetzner CX23, Helsinki, Ubuntu 24.04)
├── /opt/dojo-pulse/
│   ├── bot/pulse-bot.js          — Main bot process (discord.js, PM2-managed)
│   ├── vps-scan.js               — Nightly scan + data update + rankings
│   ├── dojo-dashboard-gen.js     — HTML dashboard generator → GitHub Pages
│   ├── ninja-rankings-gen.js     — Generates 3 Discord messages for #ninja-rankings
│   ├── dojo-data.json            — 🔴 SINGLE SOURCE OF TRUTH for all student data
│   ├── dojo-state.json           — Scan cursor state (lastMessageId per channel)
│   ├── pulse-state.json          — Digest state (streaks, previous_ranks, etc.)
│   ├── ninja-rankings-state.json — Message IDs for the 3 ranking messages
│   ├── ninja-rankings-update.json— Generated output from ninja-rankings-gen.js
│   └── .pulse-bot-token.json     — Discord bot token
```

**Dashboard**: https://dreamusichef.github.io/aodhq-dojo-dashboard/
**Dojo Server ID**: `1343785579829137529`

---

## Nightly Schedule (all times SGT = UTC+8)

### 22:55 SGT → `vps-scan.js` (triggered by pulse-bot.js via node-cron)

1. Fetches new messages from `#practice-videos` (ID: `1356110369818411131`) incrementally using stored `lastMessageId` cursor
2. Fetches new messages from `#the-hall` (ID: `1347383072303091823`)
3. For each practice video message: increments `student.clips`, sets `lastActivity`, extracts BPM from YouTube embed titles
4. Writes updated `dojo-data.json`
5. Writes updated `dojo-state.json` (advances cursor)
6. Runs `dojo-dashboard-gen.js` → generates HTML → pushes to GitHub Pages via API
7. Runs `ninja-rankings-gen.js` → generates content → PATCHes 3 Discord messages in `#ninja-rankings` (ID: `1488189728913096744`)

### 23:00 SGT → Digest (pulse-bot.js internal cron)

1. Runs `runDailyWriteback()` — live-fetches today's clips from Discord via discord.js client, writes `clip_timestamps` to `dojo-data.json`
2. Then runs one of:
   - **1st of month** → `runMonthly()` (posts `@everyone` monthly summary)
   - **Sunday** → `runWeekly()` (weekly summary)
   - **Any other day** → `runDaily()` (daily summary, also does another live fetch + writeback internally)
3. Digests are posted to `#dojo-pulse` (ID: `1488891205747081267`) as ANSI-colored code blocks

---

## Data Model: `dojo-data.json`

```json
{
  "meta": {
    "totalClips": 1871,
    "lastUpdated": "2026-06-12T02:47:25.924Z"
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

112 students total. `clips` = lifetime practice video count. `clip_timestamps` = individual clip timestamps (added later — partial coverage for older students).

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

### vps-scan.js `countClips()` — SIMPLIFIED, used for incremental scan:
```js
// Counts YouTube/Vimeo/Streamable/Twitch links in message content
// Falls back to video embeds if no links found
// ⚠️ Does NOT count direct file attachments (.mp4, .mov uploads)
```

### pulse-bot.js `countClipsInMessage()` — COMPREHENSIVE, used for live fetch:
```js
// 1. Counts video file attachments (.mp4, .mov, .webm, etc.)
//    - Skips image/* content types
//    - Skips small files (<2MB) without duration metadata (likely GIFs)
// 2. Counts video links (YouTube, Vimeo, Streamable, Google Photos, Google Drive)
//    - Skips GIF sources (Tenor, Giphy, Gfycat, Imgur .gif)
// 3. Falls back to video embeds
```

**⚠️ KEY BUG: These two functions count differently.** `vps-scan.js` misses direct video uploads that students post as Discord attachments. The pulse bot counts them correctly. This means `vps-scan.js` undercounts for students who upload videos directly instead of posting YouTube links.

---

## Known Bugs & Issues (as of June 12, 2026)

### 🔴 Bug 1: Two-Writer Conflict on `clips` Field

**Both** `vps-scan.js` (22:55) and `pulse-bot.js` `writeBackClipTimestamps()` (23:00) increment `student.clips` for the same clips. The pulse bot's writeback checks for duplicate timestamps before adding, but since `vps-scan.js` never adds timestamps, the dedup check doesn't prevent the double-increment.

**Location**: `pulse-bot.js` line ~1000, inside `writeBackClipTimestamps()`:
```js
if (!student.clip_timestamps.includes(clip.timestamp)) {
    student.clip_timestamps.push(clip.timestamp);
    student.clips = (student.clips || 0) + 1;  // ← THIS LINE double-counts
}
```

**Intended ownership**: `vps-scan.js` owns `clips`, pulse bot owns `clip_timestamps`. The `student.clips` increment in the writeback function should be removed (or the entire clips counting should be unified into one system).

**Status**: I (CVD) removed the offending line on June 12 and restarted PM2, but the existing data is already inflated to varying degrees.

### 🔴 Bug 2: Inconsistent Clip Counting Between Systems

`vps-scan.js` and `pulse-bot.js` use different clip detection functions:
- `vps-scan.js`: Only counts YouTube/Vimeo/Streamable URLs + video embeds
- `pulse-bot.js`: Also counts direct video file attachments (.mp4, .mov uploads)

Students who upload videos directly to Discord (not via YouTube) get counted by the pulse bot but NOT by vps-scan.js. This means:
- `clips` field (owned by vps-scan) undercounts these students
- `clip_timestamps` (owned by pulse bot) has correct counts for them
- The dashboard/rankings use `clips`, so these students show lower than reality

**Fix needed**: Unify the counting logic. Either:
- Make `vps-scan.js` use the same comprehensive detection as pulse-bot
- Or make one system the single counter

### 🟡 Bug 3: `#the-hall` Returns 403

The bot gets HTTP 403 when fetching `#the-hall` messages. Either permissions changed or the channel was recreated. `hallCount` hasn't been incrementing. Low priority since hall counts aren't displayed in rankings.

### 🟢 Fixed: Rankings Message IDs Were Stale (June 12)

The 3 message IDs in `#ninja-rankings` that `vps-scan.js` tries to PATCH were returning 404 (messages deleted/channel recreated). Fixed by updating to current IDs:
- Header: `1491470167237197986`
- Genin: `1491470175390666835`
- Footer: `1491470181048778783`

These are hardcoded in `vps-scan.js` (constants at top) AND stored in `ninja-rankings-state.json`.

### 🟢 Fixed: fetchMessages Had No Pagination (June 12)

`vps-scan.js` `fetchMessages()` only fetched 100 messages per call with no pagination. If >100 new messages arrived between scans, the oldest were permanently skipped. Now loops with 500ms rate-limit pauses until all pages are fetched.

### 🟢 Fixed: Early Return Skipped Dashboard/Rankings Refresh (June 12)

When no new messages were found, `vps-scan.js` returned early without regenerating dashboard or rankings. Now always runs dashboard + rankings even on zero new messages (catches manual data corrections).

---

## File Details

### `pulse-bot.js` (1,264 lines)
- discord.js v14 client
- Two internal crons (node-cron): scan at 22:55 SGT, digest at 23:00 SGT
- `fetchLiveClips()` — queries `#practice-videos` via discord.js for a time window, returns clip data with timestamps
- `writeBackClipTimestamps()` — merges live clip timestamps into `dojo-data.json`
- `buildDailyMessage()` / `buildWeeklyMessage()` / `buildMonthlyMessage()` — ANSI-formatted digest messages
- `computeStreaks()` — weekly streak tracking (Cycle N, Week N system)
- `/mystats` slash command — ephemeral response with personal stats
- `updatePreviousRanks()` — tracks rank changes for promotion announcements
- PM2-managed: `pm2 restart dojo-pulse`

### `vps-scan.js` (291 lines)
- Raw `https` module (no discord.js dependency)
- Incremental scan using `?after=<lastMessageId>` cursor
- BPM extraction from YouTube embed titles (with include/exclude keyword filters)
- Auto-creates new students when unknown poster detected (alerts `#clawdbot`)
- Runs `dojo-dashboard-gen.js` and `ninja-rankings-gen.js` as child processes

### `dojo-dashboard-gen.js` (345 lines)
- Reads `dojo-data.json` → generates self-contained HTML dashboard
- Pushes to GitHub Pages repo (`Dreamusichef/aodhq-dojo-dashboard`) via GitHub API
- Also updates a GitHub Gist (legacy URL support)
- Uses a GitHub personal access token from `.github-token.json`

### `ninja-rankings-gen.js` (144 lines)
- Reads `dojo-data.json` + `ninja-rankings-state.json`
- Generates 3 Discord message contents (header+elite+chunin, genin list, ghost+rules)
- Writes output to `ninja-rankings-update.json`
- `vps-scan.js` reads this output and PATCHes the Discord messages

---

## State Files

### `dojo-state.json` — Owned by `vps-scan.js`
```json
{
  "lastChecked": "2026-06-12T...",
  "channels": {
    "practice-videos": { "lastMessageId": "1514825966197805096" },
    "the-hall": { "lastMessageId": "1490688396983533578" }
  }
}
```

### `pulse-state.json` — Owned by `pulse-bot.js`
```json
{
  "channelId": "1488891205747081267",
  "streaks": { "<username>": { "current_cycle": 2, "current_week": 4, "status": "active" } },
  "previous_ranks": { "<username>": "Chūnin" },
  "previous_positions": { "<username>": 5 },
  "last_daily": "2026-06-11T15:00:01.598Z",
  "last_weekly": "...",
  "last_monthly": "..."
}
```

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

## What Needs Fixing (Priority Order)

1. **Unify clip counting** — `vps-scan.js` needs to count video file attachments the same way `pulse-bot.js` does, or consolidate into one counter
2. **Fix the inflated data** — Run a proper full recount that uses the comprehensive clip detection (including attachments), then set correct `clips` values
3. **Remove the two-writer pattern** — Only ONE system should increment `clips`. Either vps-scan.js does it on scan, or pulse-bot does it on writeback. Not both.
4. **Fix `#the-hall` 403** — Check bot permissions for that channel
5. **Consider making rankings message IDs configurable** — Currently hardcoded in `vps-scan.js` constants; if messages get deleted again, same problem recurs

---

## How to Deploy Changes

```bash
# SSH into VPS
ssh root@204.168.223.58

# Edit files directly or SCP from local
scp localfile.js root@204.168.223.58:/opt/dojo-pulse/filename.js

# For pulse-bot.js changes (needs restart):
pm2 restart dojo-pulse

# For vps-scan.js changes (no restart needed — runs as child process each time)
# Just replace the file

# Check logs
pm2 logs dojo-pulse --lines 100

# Manual scan trigger
cd /opt/dojo-pulse && node vps-scan.js
```
