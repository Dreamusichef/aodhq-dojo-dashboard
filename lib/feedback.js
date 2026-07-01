'use strict';

/**
 * lib/feedback.js — pure logic for the /feedback review command.
 *
 * /feedback list  → the weekly review list (read-only): every practice-video link
 *                   posted since the stored marker, grouped by student, keeping ONLY
 *                   each student's own most recent posting DAY (SGT calendar day).
 * /feedback done  → advances the marker to now (the only mutating action).
 *
 * This module does NO Discord I/O and NO clip detection — it takes already-fetched,
 * already-detected records and shapes them. Detection is reused from clip-detection.js;
 * fetching is reused from pulse-ops (same channel access as the counter).
 */

const fs = require('fs');
const { sgtDayKey, toSGT } = require('./sgt');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function loadFeedbackState(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return {};
  }
}

function saveFeedbackState(file, state) {
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}

// Window start: the stored marker, or 7 days ago on the first ever run.
function effectiveSince(state, now = new Date()) {
  const stored = state && state.lastReviewedAt;
  const t = stored ? Date.parse(stored) : NaN;
  return Number.isFinite(t) ? new Date(t) : new Date(now.getTime() - WEEK_MS);
}

// Weekday name for a UTC instant, in SGT (matches the SGT calendar day used for grouping).
function weekdayName(date) {
  return WEEKDAYS[toSGT(date).getDay()];
}

/**
 * Collapse per-message records to one entry per student, keeping ONLY that student's
 * most recent SGT calendar day. Each student's latest day is independent.
 * records: [{ username, createdAtMs, links: [string] }]
 * → [{ username, dayKey, weekday, links: [string], count }] sorted alphabetically.
 */
function groupByStudentLatestDay(records) {
  const byUser = new Map();
  for (const r of records) {
    if (!r || !r.username) continue;
    const day = sgtDayKey(new Date(r.createdAtMs));
    let u = byUser.get(r.username);
    if (!u) {
      u = { username: r.username, latestDay: day, days: new Map() };
      byUser.set(r.username, u);
    }
    if (day > u.latestDay) u.latestDay = day; // YYYY-MM-DD sorts lexicographically = chronologically
    if (!u.days.has(day)) u.days.set(day, []);
    u.days.get(day).push(r);
  }

  const linksForDay = (recs) => {
    const out = [];
    for (const r of recs.slice().sort((a, b) => a.createdAtMs - b.createdAtMs)) {
      for (const l of (r.links || [])) out.push(l);
    }
    return out;
  };

  const groups = [];
  for (const u of byUser.values()) {
    // Prefer the student's most recent day. If that day resolves to zero links (a clip
    // the bot counted but couldn't turn into a URL), fall back to their most recent day
    // that DOES resolve — so an actively-posting student is never silently dropped.
    const daysDesc = Array.from(u.days.keys()).sort().reverse();
    let dayKey = null;
    let links = [];
    for (const dk of daysDesc) {
      const dl = linksForDay(u.days.get(dk));
      if (dl.length) { dayKey = dk; links = dl; break; }
    }
    if (!dayKey) continue; // no day resolved any link — nothing to review

    const dayRecords = u.days.get(dayKey).slice().sort((a, b) => a.createdAtMs - b.createdAtMs);
    groups.push({
      username: u.username,
      dayKey,
      weekday: weekdayName(new Date(dayRecords[dayRecords.length - 1].createdAtMs)),
      links,
      count: links.length,
    });
  }

  // Alphabetical by username → a stable "did I get everyone" checklist.
  groups.sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
  return groups;
}

function formatBlock(g) {
  const noun = g.count === 1 ? 'video' : 'videos';
  const head = `@${g.username} — ${g.count} ${noun} (last posted ${g.weekday})`;
  return head + '\n' + g.links.join('\n');
}

function formatFeedbackList(groups, { since } = {}) {
  const sinceStr = since ? new Date(since).toISOString() : '';
  if (!groups || groups.length === 0) {
    return `No new practice videos since ${sinceStr}. You're all caught up. ✅`;
  }
  const totalVideos = groups.reduce((s, g) => s + g.count, 0);
  const sN = groups.length === 1 ? 'student' : 'students';
  const vN = totalVideos === 1 ? 'video' : 'videos';
  const header = `🎬 Feedback list — ${groups.length} ${sN}, ${totalVideos} ${vN} to review (since ${sinceStr})`;
  return header + '\n\n' + groups.map(formatBlock).join('\n\n');
}

/**
 * Split into <2000-char chunks WITHOUT ever splitting a student's block. Blocks are
 * separated by a blank line; an oversized single block is split on its own lines as
 * a last resort. Default max leaves headroom under Discord's 2000-char limit.
 */
function chunkMessage(text, max = 1900) {
  const out = [];
  let cur = '';
  const push = () => { if (cur) { out.push(cur); cur = ''; } };
  const hardSlice = (s) => { for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)); };

  for (const b of String(text).split('\n\n')) {
    if (b.length > max) {
      push();
      let sub = '';
      const flushSub = () => { if (sub) { out.push(sub); sub = ''; } };
      for (const ln of b.split('\n')) {
        if (ln.length > max) { flushSub(); hardSlice(ln); continue; } // unsplittable single line
        const add = sub ? '\n' + ln : ln;
        if (sub && sub.length + add.length > max) { flushSub(); sub = ln; }
        else sub += add;
      }
      flushSub();
      continue;
    }
    const add = cur ? '\n\n' + b : b;
    if (cur && cur.length + add.length > max) { push(); cur = b; }
    else cur += add;
  }
  push();
  return out.length ? out : [String(text)];
}

function formatDoneConfirmation(ts) {
  return `Feedback window advanced. Next /feedback shows posts after ${new Date(ts).toISOString()}.`;
}

module.exports = {
  WEEK_MS,
  loadFeedbackState,
  saveFeedbackState,
  effectiveSince,
  weekdayName,
  groupByStudentLatestDay,
  formatBlock,
  formatFeedbackList,
  chunkMessage,
  formatDoneConfirmation,
};
