'use strict';

/**
 * Dojo Pulse Bot
 * Automated daily/weekly/monthly activity digests for AODHQ
 * NO AI calls — pure data processing
 */

const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// ─── Paths ──────────────────────────────────────────────────────────────────
const WORKSPACE = path.resolve(__dirname, '..');
const TOKEN_FILE  = path.join(WORKSPACE, '.pulse-bot-token.json');
const DATA_FILE   = path.join(WORKSPACE, 'dojo-data.json');
const STATE_FILE  = path.join(WORKSPACE, 'pulse-state.json');

const GUILD_ID    = '1343785579829137529';
const CHANNEL_NAME = 'dojo-pulse';
const PRACTICE_CHANNEL_ID = '1356110369818411131';

// ─── Rank thresholds ─────────────────────────────────────────────────────────
const RANKS = [
  { name: 'Elite Jōnin', min: 50 },
  { name: 'Chūnin',      min: 20 },
  { name: 'Genin',       min: 1  },
  { name: 'Ghost',       min: 0  },
];

function getRank(clipCount) {
  for (const r of RANKS) {
    if (clipCount >= r.min) return r;
  }
  return RANKS[RANKS.length - 1];
}

// ─── ANSI color helper ────────────────────────────────────────────────────────
const c = (code, text) => `\x1b[${code}m${text}\x1b[0m`;

// ─── Collective milestone ─────────────────────────────────────────────────────
function milestoneBar(total) {
  const next = Math.ceil(total / 1000) * 1000;
  const prev = next - 1000;
  const progress = total - prev;
  const pct = Math.round((progress / 1000) * 20); // 20 blocks = 100%
  const bar = '█'.repeat(pct) + '░'.repeat(20 - pct);
  const remaining = next - total;
  return c(33, '🏯 Mission: ' + next.toLocaleString() + ' clips') +
    '\n[' + c(36, bar) + '] ' + c(36, total.toLocaleString() + '/' + next.toLocaleString()) +
    '\n' + c(36, remaining.toLocaleString() + ' to go');
}

// ─── SGT helpers (UTC+8) ─────────────────────────────────────────────────────
const SGT_OFFSET = 8 * 60; // minutes

function toSGT(date) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + SGT_OFFSET * 60000);
}

// ISO week in SGT: Mon=1 … Sun=7
function sgtWeekKey(date) {
  const d = toSGT(date);
  // Get Monday of the week
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0) ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  // Format YYYY-WNN
  const y = mon.getFullYear();
  // ISO week number
  const startOfYear = new Date(y, 0, 1);
  const weekNo = Math.ceil((((mon - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
  return `${y}-W${String(weekNo).padStart(2, '0')}`;
}

function sgtMonthKey(date) {
  const d = toSGT(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sgtDayKey(date) {
  const d = toSGT(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentSGTMonthKey() { return sgtMonthKey(new Date()); }
function currentSGTWeekKey()  { return sgtWeekKey(new Date()); }
function currentSGTDayKey()   { return sgtDayKey(new Date()); }

function monthName(monthKey) {
  const [y, m] = monthKey.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long' });
}

// ─── File I/O ────────────────────────────────────────────────────────────────
function readJSON(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

// ─── Data reconciliation ─────────────────────────────────────────────────────
// Single source of truth: s.clips = Math.max(s.clips, s.clip_timestamps.length)
// Runs on every data load to prevent drift between the two fields
function reconcileClips(data) {
  let fixed = 0;
  for (const s of data.students) {
    const tsCount = (s.clip_timestamps || []).length;
    const declared = s.clips || 0;
    const correct = Math.max(declared, tsCount);
    if (correct !== declared) {
      s.clips = correct;
      fixed++;
    }
  }
  if (fixed > 0) {
    console.log(`[Reconcile] Fixed ${fixed} students' clip counts`);
    writeJSON(DATA_FILE, data);
  }
  return data;
}

// Always use this to load dojo data — never readJSON(DATA_FILE) directly
function loadDojoData() {
  return reconcileClips(readJSON(DATA_FILE));
}

// ─── State helpers ───────────────────────────────────────────────────────────
function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      channelId: null,
      streaks: {},
      previous_ranks: {},
      last_daily: null,
      last_weekly: null,
      last_monthly: null,
    };
  }
  return readJSON(STATE_FILE);
}

function saveState(state) {
  writeJSON(STATE_FILE, state);
}

// ─── Streak engine ───────────────────────────────────────────────────────────
// Returns updated streaks object (mutates and returns)
function computeStreaks(students, streaks) {
  const now = new Date();
  const currentWeek = currentSGTWeekKey();

  for (const student of students) {
    const u = student.u;
    const timestamps = student.clip_timestamps || [];

    if (!streaks[u]) {
      streaks[u] = {
        current_cycle: 0,
        current_week: 0,
        status: 'inactive',
        cycle_start_date: null,
        last_active_week: null,
        recovery_deadline: null,
      };
    }

    const s = streaks[u];

    // Build set of unique active weeks from timestamps
    const activeWeeks = new Set(timestamps.map(ts => sgtWeekKey(new Date(ts))));

    if (activeWeeks.size === 0) {
      // No clips ever — cold start stays inactive
      s.status = 'inactive';
      s.current_cycle = 0;
      s.current_week = 0;
      continue;
    }

    // Sort weeks
    const sortedWeeks = Array.from(activeWeeks).sort();
    const lastActive = sortedWeeks[sortedWeeks.length - 1];

    // If in recovery, check deadline
    if (s.status === 'recovery') {
      if (s.recovery_deadline && currentWeek > s.recovery_deadline) {
        // Missed recovery deadline — fully reset
        s.current_cycle = 0;
        s.current_week = 0;
        s.status = 'inactive';
        s.cycle_start_date = null;
        s.recovery_deadline = null;
        s.last_active_week = lastActive;
      } else {
        // Still in recovery — update last_active_week
        s.last_active_week = lastActive;
      }
      continue;
    }

    // Rebuild streak from sorted active weeks
    // Walk back from the most recent active week
    let streak = 0;
    let prev = null;
    let consecutiveStart = null;

    for (const wk of sortedWeeks.reverse()) {
      if (prev === null) {
        streak = 1;
        prev = wk;
        consecutiveStart = wk;
      } else {
        // Check if prev and wk are consecutive weeks
        const prevDate = weekKeyToMonday(prev);
        const wkDate = weekKeyToMonday(wk);
        const diffDays = (prevDate - wkDate) / (1000 * 60 * 60 * 24);
        if (Math.abs(diffDays - 7) < 1) {
          streak++;
          consecutiveStart = wk;
          prev = wk;
        } else {
          break; // Gap — streak broken
        }
      }
    }

    // Each 8 weeks = 1 cycle
    const fullCycles = Math.floor(streak / 8);
    const weekInCycle = streak % 8;

    // Check if current week is last_active_week or currentWeek (active this week)
    const postedThisWeek = activeWeeks.has(currentWeek);

    // If we completed a full cycle (streak was exactly divisible by 8 and > 0)
    // We detect cycle completion when last week pushed streak to 8
    // → handled externally in the digest functions

    if (fullCycles > 0 && weekInCycle === 0 && streak > 0) {
      // Completed a cycle
      const completedCycles = fullCycles;
      if (s.status !== 'recovery') {
        s.current_cycle = completedCycles;
        s.current_week = 8; // just completed week 8
        s.status = 'recovery';
        // Recovery deadline: 2 weeks from now
        const deadlineWeek = addWeeks(currentWeek, 2);
        s.recovery_deadline = deadlineWeek;
        s.last_active_week = lastActive;
      }
    } else if (s.status === 'inactive' || s.status === 'active') {
      // Check if streak is broken (last active week is not last week or this week)
      const prevWeek = addWeeks(currentWeek, -1);
      const streakAlive = (lastActive === currentWeek || lastActive === prevWeek);

      if (!streakAlive && streak > 0) {
        // Streak broken mid-cycle — fully reset
        s.current_cycle = 0;
        s.current_week = 0;
        s.status = 'inactive';
        s.cycle_start_date = null;
        s.last_active_week = lastActive;
        continue;
      }

      if (streak === 0 || !streakAlive) {
        s.status = 'inactive';
        s.current_cycle = 0;
        s.current_week = 0;
      } else {
        const cycle = (fullCycles === 0) ? 1 : fullCycles + 1;
        s.current_cycle = cycle;
        s.current_week = weekInCycle === 0 ? 8 : weekInCycle;
        s.status = postedThisWeek ? 'active' : 'active'; // active if streak alive
        if (!s.cycle_start_date) {
          s.cycle_start_date = consecutiveStart;
        }
        s.last_active_week = lastActive;
      }
    }
  }

  return streaks;
}

function weekKeyToMonday(weekKey) {
  // Parse YYYY-WNN back to a Date (Monday)
  const [y, wn] = weekKey.split('-W');
  const year = Number(y);
  const week = Number(wn);
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay() || 7; // Mon=1
  const daysToFirstMonday = (8 - jan1Day) % 7;
  const firstMonday = new Date(jan1);
  firstMonday.setDate(jan1.getDate() + daysToFirstMonday);
  const result = new Date(firstMonday);
  result.setDate(firstMonday.getDate() + (week - 1) * 7);
  return result;
}

function addWeeks(weekKey, n) {
  // Direct arithmetic — avoids sgtWeekKey/weekKeyToMonday off-by-one mismatch
  const [y, wn] = weekKey.split('-W');
  let newWeek = Number(wn) + n;
  let newYear = Number(y);
  // Handle year boundaries (approximate — ISO week 53 exists some years)
  const weeksInYear = (yr) => {
    // Years with 53 weeks: years where Jan 1 is Thursday, or leap years where Jan 1 is Wednesday
    const jan1 = new Date(yr, 0, 1).getDay();
    const isLeap = (yr % 4 === 0 && yr % 100 !== 0) || (yr % 400 === 0);
    return (jan1 === 4 || (isLeap && jan1 === 3)) ? 53 : 52;
  };
  while (newWeek < 1) { newYear--; newWeek += weeksInYear(newYear); }
  while (newWeek > weeksInYear(newYear)) { newWeek -= weeksInYear(newYear); newYear++; }
  return `${newYear}-W${String(newWeek).padStart(2, '0')}`;
}

// ─── Clip counting helpers ────────────────────────────────────────────────────
function clipsForPeriod(timestamps, filterFn) {
  return (timestamps || []).filter(ts => filterFn(new Date(ts))).length;
}

function clipsToday(timestamps) {
  // "Today" = 24h window ending at 23:00 SGT (15:00 UTC)
  // Window: 23:00 SGT yesterday → 23:00 SGT today
  // This ensures clips posted between 22:55 (scan time) and midnight don't slip through
  const now = new Date();
  const todayCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15, 0, 0));
  const cutoffEnd = (now >= todayCutoff) ? todayCutoff : new Date(todayCutoff.getTime() - 24 * 60 * 60 * 1000);
  const cutoffStart = new Date(cutoffEnd.getTime() - 24 * 60 * 60 * 1000);
  return clipsForPeriod(timestamps, d => d >= cutoffStart && d < cutoffEnd);
}

function clipsThisWeek(timestamps) {
  const week = currentSGTWeekKey();
  return clipsForPeriod(timestamps, d => sgtWeekKey(d) === week);
}

function clipsThisMonth(timestamps) {
  const month = currentSGTMonthKey();
  return clipsForPeriod(timestamps, d => sgtMonthKey(d) === month);
}

function clipsInMonth(timestamps, monthKey) {
  return clipsForPeriod(timestamps, d => sgtMonthKey(d) === monthKey);
}

function totalClips(timestamps) {
  return (timestamps || []).length;
}

// ─── Live Discord clip fetching ──────────────────────────────────────────────
// Queries #practice-videos directly so daily digest is independent of scan cron

const CLIP_PATTERN = /youtu\.?be|youtube\.com|vimeo\.com|streamable\.com|clips\.twitch|photos\.app\.goo\.gl|photos\.google\.com|drive\.google\.com[/]file/i;

// GIF/meme sources to exclude — these are NOT practice clips
const GIF_PATTERN = /tenor\.com|giphy\.com|gfycat\.com|imgur\.com\/.*\.gif|media\.discordapp\.net\/.*\.gif/i;

function isClipMessage(msg) {
  return countClipsInMessage(msg) > 0;
}

// Count individual video links/attachments in a single message
function countClipsInMessage(msg) {
  let count = 0;

  // Count video file attachments (skip GIFs disguised as .mp4)
  if (msg.attachments) {
    for (const [, a] of msg.attachments) {
      // Skip GIF content types
      if (a.contentType && a.contentType.startsWith('image/')) continue;
      if ((a.contentType && a.contentType.startsWith('video/')) ||
          /\.(mp4|mov|webm|avi|mkv)$/i.test(a.name || '')) {
        // Skip very small files likely to be GIFs (<2MB)
        if (a.size && a.size < 2 * 1024 * 1024 && a.duration_secs == null) {
          // Small video with no duration metadata — likely a GIF
          // Still count if filename suggests intentional upload
          if (!/practice|clip|drum|bpm/i.test(a.name || '')) continue;
        }
        count++;
      }
    }
  }

  // Count video links in content (each URL = 1 clip, skip GIF sources)
  if (msg.content) {
    const urls = msg.content.match(/https?:\/\/[^\s<>]+/gi) || [];
    for (const url of urls) {
      if (GIF_PATTERN.test(url)) continue; // Skip Tenor/Giphy/etc.
      if (CLIP_PATTERN.test(url)) count++;
    }
  }

  // If no links found in content, check embeds as fallback
  // (only if we didn't already count content links, to avoid double-counting)
  if (count === 0 && msg.embeds) {
    for (const e of msg.embeds) {
      // Skip GIF-type embeds (Tenor, Giphy, gifv)
      if (e.type === 'gifv' || e.type === 'image') continue;
      if (e.provider && GIF_PATTERN.test(e.provider.url || '')) continue;
      if (e.url && GIF_PATTERN.test(e.url)) continue;
      if (e.type === 'video' || (e.video && e.video.url)) count++;
    }
  }

  return count;
}

async function fetchLiveClips(client, students, cutoffStart, cutoffEnd) {
  // Generic live fetch: queries #practice-videos for clips in [cutoffStart, cutoffEnd)
  console.log(`[Live fetch] Window: ${cutoffStart.toISOString()} → ${cutoffEnd.toISOString()}`);

  const channel = await client.channels.fetch(PRACTICE_CHANNEL_ID);
  const allMessages = [];
  let before = undefined;

  // Paginate backwards from newest until we pass the window start
  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;
    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    let oldestTimestamp = Infinity;
    for (const [, msg] of batch) {
      const ts = msg.createdAt.getTime();
      if (ts < oldestTimestamp) oldestTimestamp = ts;
      if (msg.createdAt >= cutoffStart && msg.createdAt < cutoffEnd) {
        allMessages.push(msg);
      }
    }

    // If oldest message in batch is before our window start, we have everything
    if (oldestTimestamp < cutoffStart.getTime()) break;

    // Get oldest message ID for next page
    let oldestId = null;
    for (const [id, msg] of batch) {
      if (msg.createdAt.getTime() === oldestTimestamp) { oldestId = id; break; }
    }
    before = oldestId;
    if (batch.size < 100) break;
  }

  // Filter for actual clips (not text comments)
  const clips = allMessages.filter(isClipMessage);

  // Build name map from dojo-data students
  const nameMap = {};
  for (const s of students) nameMap[s.u] = s.name;

  // Group by author — count individual clips per message, not just messages
  const byAuthor = {};
  const clipTimestamps = []; // raw timestamps for writing back
  for (const clip of clips) {
    const username = clip.author.username;
    const displayName = nameMap[username] || clip.author.globalName || clip.author.username;
    if (!byAuthor[username]) {
      byAuthor[username] = { name: displayName, username, count: 0, timestamps: [] };
    }
    const clipCount = countClipsInMessage(clip);
    byAuthor[username].count += clipCount;
    // Add one timestamp per individual clip (offset by 1ms each for uniqueness)
    for (let i = 0; i < clipCount; i++) {
      const ts = new Date(clip.createdAt.getTime() + i).toISOString();
      byAuthor[username].timestamps.push(ts);
      clipTimestamps.push({ username, timestamp: ts });
    }
  }

  const actualClipCount = clipTimestamps.length;
  const result = {
    posters: Object.values(byAuthor).sort((a, b) => b.count - a.count),
    totalClips: actualClipCount,
    ninjaCount: Object.keys(byAuthor).length,
    clipTimestamps, // for writing back to dojo-data.json
  };

  console.log(`[Live fetch] Found ${result.totalClips} clips from ${result.ninjaCount} ninjas`);
  return result;
}

// Convenience: today's 23:00-to-23:00 SGT window
function getTodayWindow() {
  const now = new Date();
  const todayCutoff = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15, 0, 0
  )); // 15:00 UTC = 23:00 SGT
  const cutoffEnd = (now.getTime() >= todayCutoff.getTime())
    ? todayCutoff
    : new Date(todayCutoff.getTime() - 86400000);
  const cutoffStart = new Date(cutoffEnd.getTime() - 86400000);
  return { cutoffStart, cutoffEnd };
}

// This week's window (Monday 00:00 SGT → now)
function getWeekWindow() {
  const now = new Date();
  const sgt = toSGT(now);
  const day = sgt.getDay() || 7; // Mon=1 ... Sun=7
  const monday = new Date(sgt);
  monday.setDate(sgt.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  // Convert back to UTC: monday in SGT → subtract 8h
  const cutoffStart = new Date(monday.getTime() - SGT_OFFSET * 60000);
  const cutoffEnd = now;
  return { cutoffStart, cutoffEnd };
}

// Previous month's window (1st 00:00 SGT → last day 23:59:59 SGT)
function getMonthWindow() {
  const now = new Date();
  const sgt = toSGT(now);
  // Report on the previous month (monthly fires on the 1st)
  const firstOfPrevMonth = new Date(sgt.getFullYear(), sgt.getMonth() - 1, 1, 0, 0, 0);
  const firstOfThisMonth = new Date(sgt.getFullYear(), sgt.getMonth(), 1, 0, 0, 0);
  // Convert to UTC
  const cutoffStart = new Date(firstOfPrevMonth.getTime() - SGT_OFFSET * 60000);
  const cutoffEnd = new Date(firstOfThisMonth.getTime() - SGT_OFFSET * 60000);
  return { cutoffStart, cutoffEnd };
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildDailyMessage(students, state, liveData) {
  // liveData from fetchLiveClipsToday — if provided, use it instead of clip_timestamps
  const studentMap = {};
  for (const s of students) studentMap[s.u] = s;

  let activeToday;
  if (liveData) {
    activeToday = liveData.posters.map(p => ({
      s: studentMap[p.username] || { name: p.name, u: p.username, clips: 0, clip_timestamps: [] },
      n: p.count,
    }));
  } else {
    // Fallback to clip_timestamps if live fetch failed
    activeToday = students
      .map(s => ({ s, n: clipsToday(s.clip_timestamps) }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n);
  }

  const N = activeToday.reduce((sum, x) => sum + x.n, 0);
  const M = activeToday.length;
  const dojoTotal = students.reduce((sum, s) => sum + (s.clips || 0), 0);

  let lines = [c(33, '✦ Today in the Forge'), ''];

  if (N === 0) {
    lines.push('—');
    lines.push('Quiet day — 0 clips posted');
    lines.push('The Forge is always open.');
    lines.push('—');
    lines.push(milestoneBar(dojoTotal));
    return '```ansi\n' + lines.join('\n') + '\n```';
  }

  lines.push('—');
  const clipsLine = `${c(36, String(N))} clips posted by ${c(36, String(M))} ninja${M !== 1 ? 's' : ''}`;
  lines.push(clipsLine);
  const posterLine = activeToday.map(x => `${x.s.name} (${c(36, String(x.n))})`).join(' · ');
  lines.push(posterLine);
  lines.push('—');

  // Streak watch: posted today AND streak week >= 3, max 3
  const streakWatch = activeToday
    .map(x => {
      const st = state.streaks[x.s.u];
      return { name: x.s.name, st };
    })
    .filter(x => x.st && x.st.current_week >= 3 && x.st.status !== 'inactive')
    .sort((a, b) => {
      const aScore = a.st.current_cycle * 100 + a.st.current_week;
      const bScore = b.st.current_cycle * 100 + b.st.current_week;
      return bScore - aScore;
    })
    .slice(0, 3);

  for (const sw of streakWatch) {
    lines.push(`${c(33, '🔥 Streak watch:')} ${sw.name} — Cycle ${c(36, String(sw.st.current_cycle))}, Week ${c(36, String(sw.st.current_week))}`);
  }

  // Rank promotions today
  for (const { s } of activeToday) {
    const prev = state.previous_ranks[s.u] || 'Ghost'; // default to Ghost if never tracked
    const clipCount = Math.max(s.clips || 0, totalClips(s.clip_timestamps));
    const current = getRank(clipCount);
    if (prev !== current.name) {
      const prevRank = RANKS.find(r => r.name === prev);
      if (prev === 'Ghost' && current.name === 'Genin') {
        // First clip ever — special message
        lines.push(c(32, `🟢 ${s.name} entered the Forge — first clip posted`));
      } else if (current.min > (prevRank ? prevRank.min : -1)) {
        // Promotion to higher rank
        lines.push(c(32, `⬆ ${s.name} just hit ${current.name} (${current.min}+)`));
      }
    }
  }

  // Cycle completion: streak week == 8 this run
  for (const { s } of activeToday) {
    const st = state.streaks[s.u];
    if (st && st.status === 'recovery' && st.current_week === 8) {
      // Just completed
      lines.push(c(32, `🔥 ${s.name} completed Cycle ${st.current_cycle}. Recovery window open — light reps or full rest. The gains are made in recovery.`));
    }
  }

  // Recovery status
  for (const s of students) {
    const st = state.streaks[s.u];
    if (st && st.status === 'recovery') {
      const nextCycle = st.current_cycle + 1;
      lines.push(`🌀 ${s.name} — recovery (clips logged, Cycle ${nextCycle} begins on return)`);
    }
  }

  lines.push('—');
  lines.push(milestoneBar(dojoTotal));

  return '```ansi\n' + lines.join('\n') + '\n```';
}

function buildWeeklyMessage(students, state) {
  const week = currentSGTWeekKey();

  const activeThisWeek = students
    .map(s => ({ s, n: clipsThisWeek(s.clip_timestamps) }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);

  const N = activeThisWeek.reduce((sum, x) => sum + x.n, 0);
  const M = activeThisWeek.length;
  const dojoTotal = students.reduce((sum, s) => sum + (s.clips || 0), 0);

  let lines = [c(33, '✦ This week in the Dojo'), ''];

  lines.push('—');

  if (N === 0) {
    lines.push('Quiet week — 0 clips posted. The Forge is always open.');
    lines.push('—');
  } else {
    // Week-over-week comparison
    const prevWeekClips = state.last_weekly_clips;
    let wowLine = '';
    if (prevWeekClips != null && prevWeekClips > 0) {
      const pctChange = Math.round(((N - prevWeekClips) / prevWeekClips) * 100);
      if (pctChange > 2) wowLine = ` (+${pctChange}% over last week)`;
      else if (pctChange < -2) wowLine = ` (${pctChange}% from last week)`;
      else wowLine = ' (held steady)';
    }
    lines.push(`${c(36, String(M))} ninjas contributed ${c(36, String(N))} clips to the mission${wowLine}`);
    // Names on single line, dot-separated, no clip counts
    const namesList = activeThisWeek.map(x => x.s.name).join(' · ');
    lines.push(namesList);
    lines.push('—');
  }

  // Rank changes this week
  const rankChanges = [];
  for (const s of students) {
    const prev = state.previous_ranks[s.u] || 'Ghost';
    const clipCount = Math.max(s.clips || 0, totalClips(s.clip_timestamps));
    const current = getRank(clipCount);
    if (prev !== current.name) {
      const prevRank = RANKS.find(r => r.name === prev);
      if (current.min > (prevRank ? prevRank.min : -1)) {
        if (prev === 'Ghost' && current.name === 'Genin') {
          rankChanges.push(c(32, `🟢 New Genin: ${s.name} posted first clip`));
        } else {
          rankChanges.push(c(32, `⬆ Rank up: ${s.name} hit ${current.name} (${current.min}+)`));
        }
      }
    }
  }

  if (rankChanges.length > 0) {
    for (const rc of rankChanges) lines.push(rc);
    lines.push('—');
  }

  // Leaderboard milestone entries this week
  const weeklyMilestones = detectMilestoneEntries(students, state);
  if (weeklyMilestones.length > 0) {
    for (const m of weeklyMilestones) {
      lines.push(c(32, `🏆 ${m.name} entered the Top ${m.milestone} (#${m.position})`));
    }
    lines.push('—');
  }

  // Streaks section
  const streakStudents = activeThisWeek
    .map(x => {
      const clipCount = Math.max(x.s.clips || 0, totalClips(x.s.clip_timestamps));
      return { s: x.s, st: state.streaks[x.s.u], rank: getRank(clipCount) };
    })
    .filter(x => x.st && (x.st.current_week >= 1 || x.st.status === 'recovery'));

  // Cold start detection: if ALL streak students are at Cycle 1, Week 1, show single intro line
  const allColdStart = streakStudents.length > 0 &&
    streakStudents.every(x => x.st.current_cycle === 1 && x.st.current_week === 1 && x.st.status === 'active');

  if (allColdStart) {
    lines.push(c(33, '🔥 Streak tracking begins — all ninjas who posted clips start at Cycle 1, Week 1. Watch this space.'));
    lines.push('—');
  } else if (streakStudents.length > 0) {
    // Normal mode: show students with 3+ weeks, plus anyone in recovery
    // If fewer than 3 qualify at 3+ weeks, show top 5 as fallback
    const qualifiedStreaks = streakStudents.filter(x =>
      x.st.current_week >= 3 || x.st.status === 'recovery'
    );
    let toShow;
    if (qualifiedStreaks.length >= 3) {
      toShow = qualifiedStreaks;
    } else {
      // Cold start fallback: top 5 longest streaks
      toShow = streakStudents.slice(0, 5);
    }
    toShow.sort((a, b) => {
      const aScore = a.st.current_cycle * 100 + a.st.current_week;
      const bScore = b.st.current_cycle * 100 + b.st.current_week;
      return bScore - aScore;
    });

    lines.push(c(33, '🔥 Streaks'));
    for (const { s, st } of toShow) {
      if (st.status === 'recovery') {
        lines.push(`${s.name} — recovery (Cycle ${c(36, String(st.current_cycle + 1))} begins on return)`);
      } else {
        lines.push(`${s.name} — Cycle ${c(36, String(st.current_cycle))}, Week ${c(36, String(st.current_week))}`);
      }
    }
    lines.push('—');
  }

  lines.push(milestoneBar(dojoTotal));
  return '```ansi\n' + lines.join('\n') + '\n```';
}

function buildMonthlyMessage(students, state) {
  const now = new Date();
  const sgt = toSGT(now);
  // Current month is the just-completed month (we're on the 1st)
  const reportMonth = sgtMonthKey(new Date(sgt.getFullYear(), sgt.getMonth() - 1, 1));
  const prevMonth = sgtMonthKey(new Date(sgt.getFullYear(), sgt.getMonth() - 2, 1));

  const activeThisMonth = students
    .map(s => ({ s, n: clipsInMonth(s.clip_timestamps, reportMonth) }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);

  const N = activeThisMonth.reduce((sum, x) => sum + x.n, 0);
  const M = activeThisMonth.length;
  const dojoTotal = students.reduce((sum, s) => sum + (s.clips || 0), 0);

  const prevN = students.reduce((sum, s) => sum + clipsInMonth(s.clip_timestamps, prevMonth), 0);
  const pctChange = prevN > 0 ? Math.round(((N - prevN) / prevN) * 100) : null;

  // Check if record month
  const allMonthKeys = new Set();
  for (const s of students) {
    for (const ts of (s.clip_timestamps || [])) {
      allMonthKeys.add(sgtMonthKey(new Date(ts)));
    }
  }
  const monthTotals = Array.from(allMonthKeys).map(mk => ({
    mk,
    n: students.reduce((sum, s) => sum + clipsInMonth(s.clip_timestamps, mk), 0),
  }));
  const maxMonth = monthTotals.reduce((max, m) => m.n > max.n ? m : max, { n: 0 });
  const isRecord = N > 0 && N >= maxMonth.n;

  const mName = monthName(reportMonth);
  const year = reportMonth.split('-')[0];

  let lines = [c(33, `✦ ${mName} ${year} — Dojo Monthly Report`), ''];
  lines.push('—');
  lines.push(`${c(36, String(N))} clips from ${c(36, String(M))} ninja${M !== 1 ? 's' : ''}`);
  if (pctChange !== null) {
    if (pctChange > 2) {
      lines.push(c(32, `+${pctChange}% over ${monthName(prevMonth)}`));
    } else if (pctChange < -2) {
      lines.push(`(quieter month — the Forge is always open)`);
    } else {
      lines.push(`(held steady from ${monthName(prevMonth)})`);
    }
  }
  lines.push('—');
  lines.push(c(33, 'Most active ninjas'));
  const top3 = activeThisMonth.slice(0, 3);
  if (top3.length === 0) {
    lines.push('No clips posted this month.');
  } else {
    for (const x of top3) {
      lines.push(`${x.s.name} — ${c(36, String(x.n))} clips`);
    }
  }
  lines.push('—');

  // Rank promotions this month
  const rankChanges = [];
  for (const s of students) {
    const prev = state.previous_ranks[s.u] || 'Ghost';
    const clipCount = Math.max(s.clips || 0, totalClips(s.clip_timestamps));
    const current = getRank(clipCount);
    if (prev !== current.name) {
      const prevRank = RANKS.find(r => r.name === prev);
      if (current.min > (prevRank ? prevRank.min : -1)) {
        if (prev === 'Ghost' && current.name === 'Genin') {
          rankChanges.push(c(32, `🟢 ${s.name} → Genin`));
        } else {
          rankChanges.push(c(32, `⬆ ${s.name} → ${current.name}`));
        }
      }
    }
  }

  if (rankChanges.length > 0) {
    lines.push(c(33, 'Rank promotions'));
    for (const rc of rankChanges) lines.push(rc);
    lines.push('—');
  }

  // Leaderboard milestone entries this month
  const monthlyMilestones = detectMilestoneEntries(students, state);
  if (monthlyMilestones.length > 0) {
    lines.push(c(33, 'Leaderboard moves'));
    for (const m of monthlyMilestones) {
      lines.push(c(32, `🏆 ${m.name} entered the Top ${m.milestone} (#${m.position})`));
    }
    lines.push('—');
  }

  // Streak leaders — same threshold logic as weekly
  const allStreaks = students
    .map(s => ({ s, st: state.streaks[s.u] }))
    .filter(x => x.st && (x.st.status === 'active' || x.st.status === 'recovery') && x.st.current_week >= 1);

  // Cold start: if all are Cycle 1, Week 1
  const allColdStartMonthly = allStreaks.length > 0 &&
    allStreaks.every(x => x.st.current_cycle === 1 && x.st.current_week === 1 && x.st.status === 'active');

  if (allColdStartMonthly) {
    lines.push(c(33, '🔥 Streak tracking begins — all ninjas who posted clips start at Cycle 1, Week 1. Watch this space.'));
    lines.push('—');
  } else if (allStreaks.length > 0) {
    const qualified = allStreaks.filter(x => x.st.current_week >= 3 || x.st.status === 'recovery');
    let toShow;
    if (qualified.length >= 3) {
      toShow = qualified;
    } else {
      toShow = allStreaks.slice(0, 5);
    }
    toShow.sort((a, b) => {
      const aScore = a.st.current_cycle * 100 + a.st.current_week;
      const bScore = b.st.current_cycle * 100 + b.st.current_week;
      return bScore - aScore;
    });
    toShow = toShow.slice(0, 3); // Cap at 3 for monthly

    lines.push(c(33, '🔥 Streak leaders'));
    for (const { s, st } of toShow) {
      const status = st.status === 'recovery' ? 'recovery' : 'active';
      lines.push(`${s.name} — Cycle ${c(36, String(st.current_cycle))} (${status})`);
    }
    lines.push('—');
  }

  lines.push(milestoneBar(dojoTotal));
  lines.push(c(33, 'Every clip is a rep. Every rep compounds.'));
  if (isRecord) {
    lines.push(c(32, 'New Dojo record — biggest month ever.'));
  }

  return '```ansi\n' + lines.join('\n') + '\n```';
}

// ─── Leaderboard milestone positions ─────────────────────────────────────────
const MILESTONE_POSITIONS = [3, 5, 10, 20];

function getLeaderboardPositions(students) {
  // Sort by total clips descending, return map of username -> position
  const sorted = students.slice().sort((a, b) => (b.clips || 0) - (a.clips || 0));
  const positions = {};
  sorted.forEach((s, i) => { positions[s.u] = i + 1; });
  return positions;
}

function getMilestone(pos) {
  // Returns the milestone threshold this position is inside, or null
  for (const m of MILESTONE_POSITIONS) {
    if (pos <= m) return m;
  }
  return null;
}

function detectMilestoneEntries(students, state) {
  // Returns list of {name, position, milestone} for anyone who newly entered a milestone group
  const currentPositions = getLeaderboardPositions(students);
  const prevPositions = state.previous_positions || {};
  const entries = [];

  for (const s of students) {
    const curPos = currentPositions[s.u];
    const prevPos = prevPositions[s.u] || 9999;
    const curMilestone = getMilestone(curPos);
    const prevMilestone = getMilestone(prevPos);

    // Only fire if they crossed into a new (better) milestone group
    if (curMilestone && curMilestone !== prevMilestone && curPos < prevPos) {
      entries.push({ name: s.name || s.u, position: curPos, milestone: curMilestone });
    }
  }

  // Sort by position ascending (top 3 first)
  entries.sort((a, b) => a.position - b.position);
  return entries;
}

// ─── Update previous_ranks + positions after sending ─────────────────────────
function updatePreviousRanks(students, state) {
  for (const s of students) {
    const clipCount = Math.max(s.clips || 0, totalClips(s.clip_timestamps));
    const current = getRank(clipCount);
    state.previous_ranks[s.u] = current.name;
  }
  // Also update positions
  state.previous_positions = getLeaderboardPositions(students);
}

// ─── Channel setup ────────────────────────────────────────────────────────────
async function ensureChannel(client, state) {
  if (state.channelId) {
    try {
      const ch = await client.channels.fetch(state.channelId);
      if (ch) return ch;
    } catch (e) {
      console.log('Stored channel not found, searching/creating...');
    }
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();

  // Look for existing dojo-pulse channel
  let channel = guild.channels.cache.find(c => c.name === CHANNEL_NAME && c.type === ChannelType.GuildText);

  if (!channel) {
    // Find Information category
    const infoCategory = guild.channels.cache.find(
      c => c.name === 'Information' && c.type === ChannelType.GuildCategory
    );

    channel = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: infoCategory ? infoCategory.id : null,
      topic: 'Automated daily, weekly and monthly activity digests — posted by Dojo Pulse 🥷',
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.ReadMessageHistory],
          deny: [PermissionsBitField.Flags.SendMessages],
        },
      ],
    });
    console.log(`Created #${CHANNEL_NAME}: ${channel.id}`);
  }

  state.channelId = channel.id;
  saveState(state);
  return channel;
}

// ─── Run a digest ─────────────────────────────────────────────────────────────
// Write live clip timestamps back to dojo-data.json so weekly/monthly/rankings stay in sync
function writeBackClipTimestamps(liveData) {
  try {
    const data = loadDojoData();
    const studentMap = {};
    for (const s of data.students) studentMap[s.u] = s;

    for (const clip of (liveData.clipTimestamps || [])) {
      const student = studentMap[clip.username];
      if (!student) continue;
      if (!student.clip_timestamps) student.clip_timestamps = [];
      // Avoid duplicates (same timestamp already exists)
      if (!student.clip_timestamps.includes(clip.timestamp)) {
        student.clip_timestamps.push(clip.timestamp);
        // clips count owned by vps-scan.js — do NOT increment here (two-writer bug fix)
      }
    }

    writeJSON(DATA_FILE, data);
    console.log('[WriteBack] Updated dojo-data.json with live clip timestamps');
  } catch (e) {
    console.error('[WriteBack] Failed:', e.message);
  }
}

// Live fetch + writeback only (no digest post). Called every night before any digest type.
async function runDailyWriteback(client) {
  const data = loadDojoData();
  const students = data.students;
  try {
    const { cutoffStart, cutoffEnd } = getTodayWindow();
    const liveData = await fetchLiveClips(client, students, cutoffStart, cutoffEnd);
    if (liveData) writeBackClipTimestamps(liveData);
  } catch (e) {
    console.error('[Daily writeback failed]', e.message);
  }
}

async function runDaily(channel, client) {
  const data  = loadDojoData();
  const state = loadState();
  const students = data.students;

  // Fetch clips directly from Discord — no dependency on scan cron
  let liveData = null;
  try {
    const { cutoffStart, cutoffEnd } = getTodayWindow();
    liveData = await fetchLiveClips(client, students, cutoffStart, cutoffEnd);
  } catch (e) {
    console.error('[Live fetch failed, falling back to clip_timestamps]', e.message);
  }

  // Write back timestamps to dojo-data.json so weekly/monthly/rankings accumulate
  if (liveData) writeBackClipTimestamps(liveData);

  // Update streaks
  state.streaks = computeStreaks(students, state.streaks || {});

  const msg = buildDailyMessage(students, state, liveData);
  await channel.send(msg);

  // Update ranks after send
  updatePreviousRanks(students, state);
  state.last_daily = new Date().toISOString();
  saveState(state);
  console.log(`[Daily] sent at ${state.last_daily}`);
}

async function runWeekly(channel) {
  // Weekly reads from dojo-data.json — accumulated from 7 verified daily writebacks
  const data  = loadDojoData();
  const state = loadState();
  const students = data.students;

  state.streaks = computeStreaks(students, state.streaks || {});

  const msg = '@everyone\n' + buildWeeklyMessage(students, state);
  await channel.send({ content: msg, allowedMentions: { parse: ['everyone'] } });

  // Store this week's clip count for next week's comparison
  const thisWeekClips = students.reduce((sum, s) => sum + clipsThisWeek(s.clip_timestamps), 0);
  state.last_weekly_clips = thisWeekClips;

  updatePreviousRanks(students, state);
  state.last_weekly = new Date().toISOString();
  saveState(state);
  console.log(`[Weekly] sent at ${state.last_weekly}`);
}

async function runMonthly(channel) {
  // Monthly reads from dojo-data.json — accumulated from ~30 verified daily writebacks
  const data  = loadDojoData();
  const state = loadState();
  const students = data.students;

  state.streaks = computeStreaks(students, state.streaks || {});

  const msg = '@everyone\n' + buildMonthlyMessage(students, state);
  await channel.send({ content: msg, allowedMentions: { parse: ['everyone'] } });

  updatePreviousRanks(students, state);
  state.last_monthly = new Date().toISOString();
  saveState(state);
  console.log(`[Monthly] sent at ${state.last_monthly}`);
}

// ─── /mystats command ─────────────────────────────────────────────────────────
function buildMyStatsResponse(userId, students, state) {
  // Find student by Discord user ID — we store username, not user ID
  // So we need to match by the interaction user
  return null; // placeholder — matched in the handler by username lookup
}

function formatMyStats(student, state, dojoTotal) {
  if (!student) {
    return "I don't have a record for you yet. Post a clip in #practice-videos and you'll show up in the next scan.";
  }

  const clipCount = Math.max(student.clips || 0, totalClips(student.clip_timestamps));
  const rank = getRank(clipCount);
  const st = state.streaks[student.u];

  let lines = ['✦ Your stats', '', '—'];
  lines.push(`Clips: ${clipCount} (${rank.name})`);

  // Streak info
  if (st && st.status === 'recovery') {
    lines.push(`🌀 Recovery (Cycle ${st.current_cycle + 1} begins on return)`);
  } else if (st && st.current_week >= 1) {
    lines.push(`🔥 Cycle ${st.current_cycle}, Week ${st.current_week}`);
  }

  // Last upload
  const timestamps = student.clip_timestamps || [];
  if (timestamps.length > 0) {
    const lastTs = new Date(timestamps[timestamps.length - 1]);
    const daysAgo = Math.floor((Date.now() - lastTs.getTime()) / (1000 * 60 * 60 * 24));
    if (daysAgo === 0) lines.push('Last upload: today');
    else if (daysAgo === 1) lines.push('Last upload: yesterday');
    else lines.push(`Last upload: ${daysAgo} days ago`);
  } else if (clipCount > 0) {
    lines.push('Streak tracking starts from this week.');
  }

  // Next rank
  if (rank.name === 'Ghost') {
    lines.push('Post your first clip to become Genin — 30 seconds, any quality.');
  } else {
    const nextRank = RANKS.find(r => r.min > rank.min) ? null :
      RANKS.slice().reverse().find(r => r.min > clipCount);
    // Find next rank above current
    const sortedRanks = RANKS.slice().sort((a, b) => a.min - b.min);
    const nextUp = sortedRanks.find(r => r.min > clipCount);
    if (nextUp) {
      const away = nextUp.min - clipCount;
      lines.push(`Next rank: ${nextUp.name} at ${nextUp.min} — ${away} away`);
    }
  }

  lines.push('—');
  lines.push(`Dojo milestone: ${dojoTotal.toLocaleString()} / 2,000`);

  return lines.join('\n');
}

async function registerSlashCommands(client) {
  const command = new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('Check your personal Dojo stats — clips, rank, streak, and more')
    .setDefaultMemberPermissions('0'); // '0' = no required permissions = all members

  const rest = new REST({ version: '10' }).setToken(client.token);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: [command.toJSON()] }
    );
    console.log('[Slash] /mystats registered');
  } catch (e) {
    console.error('[Slash] Failed to register:', e.message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const tokenData = readJSON(TOKEN_FILE);
  const token = tokenData.token;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  client.once('ready', async () => {
    console.log(`Dojo Pulse online as ${client.user.tag}`);

    const state = loadState();
    const channel = await ensureChannel(client, state);
    console.log(`Using channel: #${channel.name} (${channel.id})`);

    // Smart digest: monthly > weekly > daily (no redundant posts)
    // Fires at 23:00 SGT (15:00 UTC) every day, picks the right digest type
    cron.schedule('0 15 * * *', async () => {
      try {
        const now = toSGT(new Date());
        const dayOfMonth = now.getDate();
        const dayOfWeek  = now.getDay(); // 0 = Sunday

        // ALWAYS do the daily live fetch + writeback first
        // This ensures today's clips are in dojo-data.json before weekly/monthly reads it
        console.log('[Digest] Running daily live fetch + writeback...');
        await runDailyWriteback(client);

        if (dayOfMonth === 1) {
          // 1st of month → monthly digest (daily writeback already done above)
          console.log('[Digest] Monthly');
          await runMonthly(channel);
        } else if (dayOfWeek === 0) {
          // Sunday → weekly digest (daily writeback already done above)
          console.log('[Digest] Weekly');
          await runWeekly(channel);
        } else {
          // Any other day → daily digest (using the live data already fetched)
          console.log('[Digest] Daily');
          await runDaily(channel, client);
        }
      } catch (e) { console.error('[Digest error]', e); }
    }, { timezone: 'UTC' });

    // 22:55 SGT — run vps-scan.js (updates data, dashboard, ninja-rankings)
    cron.schedule('55 14 * * *', async () => {
      try {
        console.log('[Scan] Starting vps-scan.js...');
        const { execFile } = require('child_process');
        await new Promise((res, rej) => {
          execFile('node', [path.join(WORKSPACE, 'vps-scan.js')], { cwd: WORKSPACE }, (err, stdout, stderr) => {
            if (stdout) console.log(stdout.trim());
            if (stderr) console.error(stderr.trim());
            if (err) rej(err); else res();
          });
        });
      } catch (e) { console.error('[Scan error]', e.message); }
    }, { timezone: 'UTC' });

    // Register /mystats slash command
    await registerSlashCommands(client);

    console.log('Cron schedules active.');
    console.log('  22:55 SGT daily — scan (dashboard + rankings)');
    console.log('  23:00 SGT daily — monthly on 1st, weekly on Sundays, daily otherwise');
  });

  // Handle slash command interactions
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'mystats') return;

    try {
      const data = loadDojoData();
      const state = loadState();
      const students = data.students;
      const dojoTotal = students.reduce((sum, s) => sum + (s.clips || 0), 0);

      // Match by Discord username
      const username = interaction.user.username;
      const student = students.find(s => s.u === username);

      const response = formatMyStats(student, state, dojoTotal);
      await interaction.reply({ content: response, ephemeral: true });
    } catch (e) {
      console.error('[/mystats error]', e.message);
      await interaction.reply({ content: 'Something went wrong. Try again later.', ephemeral: true }).catch(() => {});
    }
  });

  client.login(token);
}

main().catch(console.error);

