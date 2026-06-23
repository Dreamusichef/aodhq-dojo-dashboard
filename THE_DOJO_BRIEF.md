# THE DOJO — Master Brief

> Drop-in context for any new chat (Claude Code, claude.ai, Lovable). Covers the **Dojo Pulse bot**
> (what it is, how it works, how it runs) and **the dream build** (a premium student/home portal).
> Sibling docs in this repo: `README.md` (dev commands), `TECHNICAL_SUMMARY.md` (infra detail).
> As of June 2026: **~111 ninjas, 77 active across 36 countries**, ~1,982 / 2,000 clips logged. (Counts refresh nightly.)

---

## 0. TL;DR
**Art of Drumming HQ (AODHQ)** runs the world's-best double-bass drumming program. Students ("ninjas")
post practice videos in a Discord; a bot — **Dojo Pulse** — auto-counts them, ranks everyone (ninja
tiers), posts daily/weekly/monthly digests, runs a streak system, and publishes a public leaderboard
dashboard. Everything is vanilla JS, runs on one small VPS, and deploys by `git push`. **Next:** evolve
the look (Lovable) and ultimately build a full **premium student portal** that could one day replace Discord.

---

## 1. Brand & mission (AODHQ)
- **Promise:** help drummers break the **BPM plateau** with a proven, systematic approach. Core formula:
  **P + P = P** = *Deliberate Practice + Reflective Patience = Compounding Progress*.
- **Voice:** direct, empathetic, honest. "A coach with receipts, not a hype merchant." No fluff.
- **Signoff:** *"Don't stop dreaming, and don't stop drumming."* — Wei Lung Wong (founder, sole admin).
- **The Six-Cornered Snowflake** framework (from a flagship lesson): a snowflake is 6-sided because of its
  hexagonal lattice — your technique is the visible result of **6 building blocks**: Full-Leg Control,
  Drum Setup, Laws of Foot Motion, Foot-Pedal Connection, Muscle Alternation, Genetics. Mastery = relentless
  accumulation of good reps ("generating snow" → "building an ice age").
- **Brand system** (`Unified_Brand_Style_Guide.docx`): fonts **Rajdhani Bold** (headers) + **Exo 2** (body);
  palette **Deep Slate `#16202A`**, **Warm Charcoal `#1C1917`**, **Electric Blue `#4DA8DA`** (signature accent),
  **Warm Gold `#E2A84B`** (payoff/reward), Progress Green `#22C55E`, Critical Red `#E8453C`. Dual-mode:
  *Teaching* (slate + blue) vs *Payoff* (gold, reward). A leaderboard is a Payoff-Mode surface → gold-forward.
- **Premium dojo aesthetic** (the new direction): near-black canvas, gold + crimson, engraved `Cinzel` display
  type, kanji tier crests (上忍/中忍/下忍), seigaiha waves, ember glows. Built in Lovable, loved. The brand layer
  is woven in at ~25% (Electric-Blue system accent, Rajdhani for data, brand stamp, the signoff).

---

## 2. System architecture (how it all runs)
```
VPS — Hetzner CX23, Helsinki, Ubuntu 24.04, IP 204.168.223.58, PM2-managed
  /opt/dojo-pulse/   = a clean GIT CHECKOUT of github.com/Dreamusichef/aodhq-dojo-dashboard (branch: main)
    bot/pulse-bot.js        — always-on Discord bot (discord.js v14 + node-cron). Crons + slash commands.
    vps-scan.js             — nightly incremental scan of #practice-videos (+#the-hall) → updates data + dashboard + rankings
    dojo-dashboard-gen.js   — dojo-data.json → HTML dashboard; pushes to GitHub Pages + publishes dojo-data.public.json
    ninja-rankings-gen.js   — dojo-data.json → 3 #ninja-rankings messages
    ecosystem.config.js     — PM2 launch (sets cwd + `-r ./bot/register-deps.js` preload so lib/ resolves discord.js)
    lib/                    — shared, mostly-pure logic (see below)
    dojo-data.json          — 🔴 SINGLE SOURCE OF TRUTH (gitignored; lives only on the VPS)
    dojo-state.json         — scan cursors   pulse-state.json — streaks/ranks/milestone state
    .pulse-bot-token.json / .github-token.json — secrets (gitignored, never committed)
```
- **No build step, no framework.** Pure Node. Deploy = `git pull` + `pm2 reload`.
- **lib/ modules:** `clip-detection` (unified clip counting), `scan-process` (scan pipeline), `digest`
  (daily/weekly/monthly message builders + /mystats), `streaks` (Cycle/Week), `milestone` (celebration message
  + crossing detection), `clips-period`/`sgt` (SGT dojo-day/week/month windows), `rankings-gen` (the 3 ranking
  messages + country→flag map), `public-projection` (shapes the privacy-safe public JSON — drops PII, normalizes
  locations, attaches the `roles` overlay), `recount-clips`/`full-recount` (one-time recount ops), `data`
  (read/write + reconcile), `discord-fetch` (raw-REST Discord, 429-aware), `discord-config` (channel IDs, paths,
  token), `pulse-ops` (the bot's run functions).
- **Timezone:** the dojo "day" boundary is **23:00 SGT = 15:00 UTC**. Week rolls SGT-midnight Monday; month by SGT calendar.

### Nightly schedule (crons, in pulse-bot.js)
- **22:55 SGT** → `vps-scan.js`: incrementally fetch new `#practice-videos` messages (after a stored cursor),
  count clips, extract BPM from YouTube titles, update `dojo-data.json` + `dojo-state.json`, regenerate the
  dashboard (push to Pages + publish public JSON), regenerate + PATCH the 3 `#ninja-rankings` messages.
- **23:00 SGT** → digest: live-fetch today's clips (writeback timestamps), then post **daily** (most nights),
  **weekly** (Sundays), or **monthly** (1st) to `#dojo-pulse`. Then `runMilestoneCheck` (see §4.6).

---

## 3. Data model (`dojo-data.json`)
```jsonc
{ "meta": { "totalClips": 1982, "lastUpdated": "...", "clipsScanPeriod": "...", "hallScanPeriod": "..." },
  "students": [{
    "name": "Display Name", "u": "discord_username", "loc": "Italy", "join": "2025-03-06",
    "clips": 296,                       // lifetime practice-video count = ranking metric
    "clip_timestamps": ["2026-...Z"],   // per-clip timestamps (partial coverage for older clips)
    "comments": 0, "tech": 0, "lounge": 7, "qwei": 0, "hall": 0,   // message counts per channel
    "startBpm": 100, "highBpm": 150, "currentBpm": 140,
    "active": true, "lastActivity": "...", "notes": "OG member"
  }]
}
```
- **Public projection:** `dojo-data.public.json` is a **privacy-safe, slimmed** view built by
  `lib/public-projection.js` and published to GitHub Pages for any frontend to fetch (CORS `*`, ~10-min cache,
  refreshes nightly): `https://dreamusichef.github.io/aodhq-dojo-dashboard/dojo-data.public.json`
  - **Drops** the Discord username `u` (PII) and the source-only fields `clip_timestamps`, `notes`, `lastActivity`.
  - **Normalizes `loc`** to full country names (e.g. `US`/`NY`/`LA`/`S. California` → *United States*;
    `UK`/`London`/`Scotland`/`Wales` → *United Kingdom*; `Perth, AU`/`Melbourne` → *Australia*; etc.).
  - **Roles overlay** (`roles.json`, hand-curated, keyed by username): attaches a `roles` object —
    `{ "sentinel": true }` for **Dojo Sentinels** (trusted senior students / the `#sentinel-council`) plus an
    optional `"specialization"` title (e.g. *Keeper of the Hall*, *Software Specialist*). The lookup reads `u`
    **before** it is stripped, so the join key never leaks. No role → field simply absent.

---

## 4. Features (what the bot does)

### 4.1 Clip detection & counting (`lib/clip-detection.js`)
One unified detector used by both the scan and the bot. Counts: video links (YouTube/Vimeo/Streamable/Twitch/
Google Photos+Drive) **and** direct video attachments (.mp4/.mov/etc.) **and** video embeds. Skips GIFs
(Tenor/Giphy/etc.), images, and tiny non-clip files. **Limitation:** it can't tell a member's *own* practice
video from a *shared* tutorial — both are video embeds (the only signal is the YouTube channel name).

### 4.2 Ranking system → `#ninja-rankings` (3 edited-in-place messages)
🔥 **Elite Jōnin** 50+ · ⭐ **Chūnin** 20+ · 🌱 **Genin** 1+ · 👻 **Ghost** 0. Inactive (2+ months) keep rank,
marked 💤. Each line shows a country flag (`lib/rankings-gen.js` FLAGS map) + name + clip count.

### 4.3 Digests → `#dojo-pulse` (ANSI code-block messages)
- **Daily** "Today in the Forge": today's clips + posters, streak watch, rank-ups, mission bar.
- **Weekly** (Sun) "This week in the Dojo": weekly totals + WoW%, rank-ups, Top-10 milestone entries, streaks.
- **Monthly** (1st): previous-month report, top ninjas, record detection.

### 4.4 Streaks (`lib/streaks.js`)
Weekly Cycle/Week tracking; an 8-week cycle then a recovery window ("Cycle N begins on return").

### 4.5 Mission bar
Dynamic progress toward the next 1,000-clip goal (`ceil(total/1000)*1000`). Shows `X/next` + "to go".

### 4.6 Milestone celebrations (every 1,000 clips, ≥2,000)
The fire/feast "banquet" celebration. When the total crosses a new 1,000 boundary:
- The bot does **NOT** post publicly. `runMilestoneCheck` (after the nightly digest) **privately pings the
  guild owner** in `#clawdbot-notifications` with a **ready-to-paste** celebration (collective stats + top 10 +
  Wei Lung's personal note, with `@everyone` inside a code block so it's inert). Wei Lung posts it **manually**
  in `#announcements` with `@everyone` + a custom Luma "feast" image — so it comes from him, not the bot.
- That night's digest also carries a **subtle flourish**: a `🏯 Milestone — crossed N clips today!` line + the
  mission bar shown as **completed** (`N/N — milestone reached! ✅`), then it rolls to the next goal.
- Re-arms automatically for 3,000, 4,000, … (state in `pulse-state.json: last_milestone`).

### 4.7 Slash commands
- `/mystats` — **public**, ephemeral: a member's clips, rank, streak, BPM, dojo milestone.
- `/dojo-celebrate` — **admin-only, private** (ephemeral): prints the ready-to-paste milestone message on demand.
- (Test-mode only: `/dojo-scan`, `/dojo-digest`, `/dojo-writeback`.)

### 4.8 Public dashboard
`https://dreamusichef.github.io/aodhq-dojo-dashboard/` — sortable/filterable leaderboard generated nightly.
A premium redesign (dark, gold/crimson, kanji crests, BPM journey) is being built in **Lovable**, fed live by
`dojo-data.public.json`.

---

## 5. Channels (guild `1343785579829137529`)
`#practice-videos` (clips, scanned) · `#the-hall` · `#ninja-rankings` (leaderboard, PATCHed) · `#dojo-pulse`
(digests) · `#clawdbot-notifications` (bot→owner alerts) · `#announcements` (milestone posts) · `#lounge`
(chat) · `#welcome` · `#starting-bpms` · `#testimonials` · `#dojo-assets` · `#sentinel-council`.

---

## 6. Deploy & ops
- **Source of truth = `main`.** Edit → push to `main` → on the VPS: `cd /opt/dojo-pulse && git pull && pm2 reload ecosystem.config.js`.
- `dojo-data.json` and the other state/secret files are **gitignored** and live only on the VPS — `git pull`
  never touches them. (Never publish a public artifact under a gitignored source-of-truth filename — it once
  clobbered the live data.) Two GitHub-API content PUTs to the same branch must be **sequential** (else 429/409).
- **Claude does NOT run SQL/DDL.** Database changes (if any) are pasted in chat for the human to run.
- Local dev: `npm test` (regression), `npm run dev:scan|dev:digest|dev:rankings` (offline, no Discord).

---

## 7. Known gotchas
- `#the-hall` returns 403 (low priority; hall counts not displayed).
- Detector counts any video embed → shared tutorials can over-count; sweep only catches ones with a 3rd-party
  channel name. Manual VIPs (1-on-1 students who don't post publicly, e.g. "worm soup") are tracked by hand.
- iOS/iPadOS have no Web MIDI (relevant to the separate metronome app, not the dojo).

---

## 8. Data hygiene, privacy & security

**Data hygiene (the source of truth is curated, not just scraped).**
- **Manual VIPs** — 1-on-1 students who don't post in `#practice-videos` (e.g. "worm soup" at 58) — are added by
  hand and preserved across scans.
- **Dedup discipline:** a member who changes their Discord handle can spawn a duplicate "ghost" record. Merge/remove
  by hand and keep **one record per person** (e.g. the duplicate `@wiola` ghost was removed; `@wiola17`, 3 clips, is
  the real one). The scan reconciles by username.
- The detector can over-count shared tutorials (any video embed counts); a periodic sweep trims obvious
  3rd-party-channel clips and counts are spot-checked against reality.

**Privacy — what's public today.** The only thing exposed to the world is `dojo-data.public.json`, and it is
**deliberately PII-free**: no Discord usernames, no message timestamps, no private notes (see §3) — display name +
country + practice stats only. The current Lovable dashboard is **read-only and static** (it fetches that one JSON),
so its attack surface is small: no database, no auth, no user input, no secrets in the client.

**Security — for the portal phase (the moment login / a database / uploads / payments come online).** The risk model
changes the instant we store real accounts. Bake these in from day one:
- **RLS on every table, default-deny.** Nothing is readable/writable without an explicit, least-privilege policy.
  This is the single most important control — a mis-set RLS policy is the most common Supabase-breach cause.
- **Keys:** the Supabase **anon** key is safe client-side *because RLS protects the data*; the **service_role** key
  must **never** ship to the client or the repo (server-side / Edge Functions only). Same rule for any third-party
  API key (e.g. email/Kit) — Edge Function secrets, never client JS.
- **Auth enforced server-side** (not just hidden in the UI). Validate every Edge Function input. Scope CORS to the
  real frontend origin (drop the `*`) once there's anything private to serve.
- **Storage:** private buckets + signed URLs for any student-uploaded video/asset.
- **Minors & payments:** if the portal ever stores under-18 names, guardian contacts, or payment data, treat it as
  regulated — use a processor (Stripe) so card data never touches our DB; minimize + encrypt PII; run Lovable's
  security scan **and** the Supabase advisor before every launch.
- **Process:** Claude does **not** run SQL/DDL — schema/policy changes are written here and pasted into the Supabase
  SQL editor by the human owner.

---

## 9. THE DREAM BUILD — the premium student / home portal

**Vision:** evolve "The Dojo" into a terrific, premium, thematic, **inviting** home/student portal — the place
that hosts *The Art of Double Bass* and all future courses, and the daily home for the ninjas. Useful, on-brand,
easy to navigate, **less overwhelming than Discord.** Possibly, eventually, **replace Discord** entirely.

### What it should have
1. **Premium welcome / home screen** — thematic, inviting, on-brand (the dojo feel).
2. **Ninja dashboard** — the leaderboard (already in progress in Lovable).
3. **Personal stats page** — per student: videos uploaded, BPM progress (start→peak→current), rank, streaks,
   archive of their own practice videos, and more useful progress stats.
4. **Practice resources** — course materials + a neat **downloadable assets** library.
5. **Course hosting** — *The Art of Double Bass* + future courses.
6. **Practice video posting + auto-tracking** — students upload directly; the portal counts/ranks automatically
   (port the existing `lib/clip-detection` logic). Crucially, **not a buried flood** — today #practice-videos
   gets ~10 clips/day and replies vanish within days. The portal should keep clips organized, browsable, and
   keep feedback threads findable.
7. **Coach feedback** — a clean, dedicated place for Wei Lung to give per-student/per-clip feedback that doesn't
   get buried.
8. **Q&A** — organized, searchable, accessible (much easier than scrolling Discord).
9. **Community** (the ambitious part / Discord parity) — student-to-student chat, gifs/images/messages,
   channels/rooms (mirroring the AODHQ Dojo Discord), a home for **group coaching sessions**.
10. **Simple, uncluttered, fast.** Premium but never convoluted.

### Technical take (for the build)
- **Stack:** Lovable (React frontend) is a strong choice for the UI/portal. Pair it with **Supabase** for the
  backend — Auth (student login), Postgres (the data model above), Storage (video/asset uploads), Realtime
  (chat/notifications). Lovable integrates with Supabase natively.
- **Data continuity:** the portal can read the *current* dojo data immediately via `dojo-data.public.json`
  (read-only) while the deeper backend is built; later, migrate the source-of-truth into Supabase and have the
  portal own uploads + counting directly (the counting logic is pure JS and ports cleanly).
- **Phasing (recommended):**
  - **Phase 1 — Companion portal** (complements Discord): premium home + ninja dashboard + per-student stats +
    practice archive + resources/downloads + courses + a clean feedback/Q&A surface. Reads existing data.
  - **Phase 2 — Native practice tracking:** students upload videos in-portal → auto-counted/ranked (Supabase
    Storage + the ported detector). Portal becomes the source of truth for clips.
  - **Phase 3 — Community/Discord parity:** in-portal chat, rooms/channels, media, coaching-session hosting.
    Evaluate fully replacing Discord once parity + reliability are proven.
- **Open questions to decide:** auth/login method; how courses are gated (membership tiers?); video hosting
  (Supabase Storage vs YouTube-unlisted vs Mux/Bunny for streaming at scale); whether to keep the VPS bot as the
  nightly engine or fold it into Supabase Edge Functions; the path/subdomain (e.g., `dojo.artofdrumminghq.com`).

### Hosting & domain
Custom domain target like `dojo.artofdrumminghq.com` (Lovable custom domain + DNS CNAME, same pattern as
`metronome.artofdrumminghq.com`). The public data API is already CORS-ready for the frontend to fetch live.

---

## 10. Changelog / recent rollouts

A running log of what's shipped, so any new chat can see where the build is.

- **Jun 2026 — Public API hardened for privacy.** `dojo-data.public.json` now drops the Discord username (`u`) and
  other source-only fields, normalizes `loc` to full country names, and carries a curated `roles` overlay (Dojo
  Sentinels + specializations). New: `lib/public-projection.js`, `roles.json`. (§3, §8)
- **Jun 2026 — Data dedup.** Removed the duplicate `@wiola` ghost; one record per ninja. (§8)
- **Jun 2026 — Milestone celebration system.** Owner-ping + paste-ready feast message + subtle digest flourish +
  `/dojo-celebrate`; the bot never auto-posts publicly. (§4.6)
- **Jun 2026 — Daily-digest boundary fix.** A reporting-day window so the 23:00 SGT digest reports the day that just
  ended, not the empty new day.
- **Jun 2026 — `/mystats` made public** to all members; full clip recount + migration to a **git-based deploy**
  (`ecosystem.config.js`, `git pull` + `pm2 reload`).
- **In progress — Lovable re-skin** of the dashboard (premium dark dojo), fed live by the public JSON. (§1, §4.8, §9)

---
*Don't stop dreaming, and don't stop drumming.*
