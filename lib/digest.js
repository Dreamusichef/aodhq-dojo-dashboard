'use strict';

const { getRank, RANKS } = require('./ranks');
const { toSGT, sgtMonthKey, monthName, currentSGTWeekKey } = require('./sgt');
const {
  clipsReportingDay,
  clipsThisWeek,
  clipsInMonth,
  totalClips,
} = require('./clips-period');
const { reachedMilestone } = require('./milestone');

const c = (code, text) => `\x1b[${code}m${text}\x1b[0m`;

function milestoneBar(total, reached) {
  if (reached) {
    return c(33, '🏯 ' + reached.toLocaleString() + ' clips — milestone reached! ✅') +
      '\n[' + c(36, '█'.repeat(20)) + '] ' + c(36, reached.toLocaleString() + '/' + reached.toLocaleString()) +
      '\n' + c(36, 'Next summit: ' + (reached + 1000).toLocaleString());
  }
  const next = Math.ceil(total / 1000) * 1000;
  const prev = next - 1000;
  const progress = total - prev;
  const pct = Math.round((progress / 1000) * 20);
  const bar = '█'.repeat(pct) + '░'.repeat(20 - pct);
  const remaining = next - total;
  return c(33, '🏯 Mission: ' + next.toLocaleString() + ' clips') +
    '\n[' + c(36, bar) + '] ' + c(36, total.toLocaleString() + '/' + next.toLocaleString()) +
    '\n' + c(36, remaining.toLocaleString() + ' to go');
}

const MILESTONE_POSITIONS = [3, 5, 10, 20];

function getLeaderboardPositions(students) {
  const sorted = students.slice().sort((a, b) => (b.clips || 0) - (a.clips || 0));
  const positions = {};
  sorted.forEach((s, i) => { positions[s.u] = i + 1; });
  return positions;
}

function getMilestone(pos) {
  for (const m of MILESTONE_POSITIONS) {
    if (pos <= m) return m;
  }
  return null;
}

function detectMilestoneEntries(students, state) {
  const currentPositions = getLeaderboardPositions(students);
  const prevPositions = state.previous_positions || {};
  const entries = [];

  for (const s of students) {
    const curPos = currentPositions[s.u];
    const prevPos = prevPositions[s.u] || 9999;
    const curMilestone = getMilestone(curPos);
    const prevMilestone = getMilestone(prevPos);

    if (curMilestone && curMilestone !== prevMilestone && curPos < prevPos) {
      entries.push({ name: s.name || s.u, position: curPos, milestone: curMilestone });
    }
  }

  entries.sort((a, b) => a.position - b.position);
  return entries;
}

function updatePreviousRanks(students, state) {
  for (const s of students) {
    const clipCount = Math.max(s.clips || 0, totalClips(s.clip_timestamps));
    const current = getRank(clipCount);
    state.previous_ranks[s.u] = current.name;
  }
  state.previous_positions = getLeaderboardPositions(students);
}

function buildDailyMessage(students, state, liveData) {
  const studentMap = {};
  for (const s of students) studentMap[s.u] = s;

  let activeToday;
  if (liveData) {
    activeToday = liveData.posters.map(p => ({
      s: studentMap[p.username] || { name: p.name, u: p.username, clips: 0, clip_timestamps: [] },
      n: p.count,
    }));
  } else {
    activeToday = students
      .map(s => ({ s, n: clipsReportingDay(s.clip_timestamps) }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n);
  }

  const N = activeToday.reduce((sum, x) => sum + x.n, 0);
  const M = activeToday.length;
  const dojoTotal = students.reduce((sum, s) => sum + (s.clips || 0), 0);
  const reached = reachedMilestone(dojoTotal, state.last_milestone || 0);

  let lines = [c(33, '✦ Today in the Forge'), ''];
  if (reached) { lines.push(c(33, '🏯 Milestone — the dojo just crossed ' + reached.toLocaleString() + ' clips today! 🔥'), ''); }

  if (N === 0) {
    lines.push('—');
    lines.push('Quiet day — 0 clips posted');
    lines.push('The Forge is always open.');
    lines.push('—');
    lines.push(milestoneBar(dojoTotal, reached));
    return '```ansi\n' + lines.join('\n') + '\n```';
  }

  lines.push('—');
  lines.push(`${c(36, String(N))} clips posted by ${c(36, String(M))} ninja${M !== 1 ? 's' : ''}`);
  lines.push(activeToday.map(x => `${x.s.name} (${c(36, String(x.n))})`).join(' · '));
  lines.push('—');

  // Streak watch: today's posters with a streak worth showing. Cycle 2+ members always
  // qualify (any week — a fresh "Cycle 2, Week 1" is the payoff moment, never hide it);
  // Cycle 1 members qualify from Week 3. Sorted high-to-low, so the list naturally mixes
  // veteran cycles on top with rising Cycle 1 streaks below.
  const streakWatch = activeToday
    .map(x => ({ name: x.s.name, st: state.streaks[x.s.u] }))
    .filter(x => x.st && x.st.status === 'active' && (x.st.current_cycle >= 2 || x.st.current_week >= 3))
    .sort((a, b) => {
      const aScore = a.st.current_cycle * 100 + a.st.current_week;
      const bScore = b.st.current_cycle * 100 + b.st.current_week;
      return bScore - aScore;
    })
    .slice(0, 6);

  for (const sw of streakWatch) {
    lines.push(`${c(33, '🔥 Streak watch:')} ${sw.name} — Cycle ${c(36, String(sw.st.current_cycle))}, Week ${c(36, String(sw.st.current_week))}`);
  }

  for (const { s } of activeToday) {
    const prev = state.previous_ranks[s.u] || 'Ghost';
    const clipCount = Math.max(s.clips || 0, totalClips(s.clip_timestamps));
    const current = getRank(clipCount);
    if (prev !== current.name) {
      const prevRank = RANKS.find(r => r.name === prev);
      if (prev === 'Ghost' && current.name === 'Genin') {
        lines.push(c(32, `🟢 ${s.name} entered the Forge — first clip posted`));
      } else if (current.min > (prevRank ? prevRank.min : -1)) {
        lines.push(c(32, `⬆ ${s.name} just hit ${current.name} (${current.min}+)`));
      }
    }
  }

  for (const { s } of activeToday) {
    const st = state.streaks[s.u];
    if (st && st.status === 'recovery' && st.current_week === 8) {
      lines.push(c(32, `🔥 ${s.name} completed Cycle ${st.current_cycle}. Recovery window open — light reps or full rest. The gains are made in recovery.`));
    }
  }

  // The payoff: a member back from recovery starting their next cycle (carry > 0 = they
  // completed cycles before this one; week 1 = the return week).
  for (const { s } of activeToday) {
    const st = state.streaks[s.u];
    if (st && st.status === 'active' && st.current_week === 1 && (st.carry || 0) > 0) {
      lines.push(c(32, `⬆️ ${s.name} is back from recovery — Cycle ${st.current_cycle} begins!`));
    }
  }

  for (const s of students) {
    const st = state.streaks[s.u];
    if (st && st.status === 'recovery') {
      const nextCycle = st.current_cycle + 1;
      lines.push(`🌀 ${s.name} — recovery (Cycle ${nextCycle} begins on return — post any week before the window closes)`);
    }
  }

  lines.push('—');
  lines.push(milestoneBar(dojoTotal, reached));

  return '```ansi\n' + lines.join('\n') + '\n```';
}

function buildWeeklyMessage(students, state) {
  const activeThisWeek = students
    .map(s => ({ s, n: clipsThisWeek(s.clip_timestamps) }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);

  const N = activeThisWeek.reduce((sum, x) => sum + x.n, 0);
  const M = activeThisWeek.length;
  const dojoTotal = students.reduce((sum, s) => sum + (s.clips || 0), 0);
  const reached = reachedMilestone(dojoTotal, state.last_milestone || 0);

  let lines = [c(33, '✦ This week in the Dojo'), ''];
  if (reached) { lines.push(c(33, '🏯 Milestone — the dojo just crossed ' + reached.toLocaleString() + ' clips! 🔥'), ''); }
  lines.push('—');

  if (N === 0) {
    lines.push('Quiet week — 0 clips posted. The Forge is always open.');
    lines.push('—');
  } else {
    const prevWeekClips = state.last_weekly_clips;
    let wowLine = '';
    if (prevWeekClips != null && prevWeekClips > 0) {
      const pctChange = Math.round(((N - prevWeekClips) / prevWeekClips) * 100);
      if (pctChange > 2) wowLine = ` (+${pctChange}% over last week)`;
      else if (pctChange < -2) wowLine = ` (${pctChange}% from last week)`;
      else wowLine = ' (held steady)';
    }
    lines.push(`${c(36, String(M))} ninjas contributed ${c(36, String(N))} clips to the mission${wowLine}`);
    lines.push(activeThisWeek.map(x => x.s.name).join(' · '));
    lines.push('—');
  }

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

  const weeklyMilestones = detectMilestoneEntries(students, state);
  if (weeklyMilestones.length > 0) {
    for (const m of weeklyMilestones) {
      lines.push(c(32, `🏆 ${m.name} entered the Top ${m.milestone} (#${m.position})`));
    }
    lines.push('—');
  }

  const streakStudents = activeThisWeek
    .map(x => {
      const clipCount = Math.max(x.s.clips || 0, totalClips(x.s.clip_timestamps));
      return { s: x.s, st: state.streaks[x.s.u], rank: getRank(clipCount) };
    })
    .filter(x => x.st && (x.st.current_week >= 1 || x.st.status === 'recovery'));

  const allColdStart = streakStudents.length > 0 &&
    streakStudents.every(x => x.st.current_cycle === 1 && x.st.current_week === 1 && x.st.status === 'active');

  if (allColdStart) {
    lines.push(c(33, '🔥 Streak tracking begins — all ninjas who posted clips start at Cycle 1, Week 1. Watch this space.'));
    lines.push('—');
  } else if (streakStudents.length > 0) {
    const qualifiedStreaks = streakStudents.filter(x =>
      x.st.current_week >= 3 || x.st.status === 'recovery' || x.st.current_cycle >= 2
    );
    let toShow = qualifiedStreaks.length >= 3 ? qualifiedStreaks : streakStudents.slice(0, 5);
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

  lines.push(milestoneBar(dojoTotal, reached));
  return '```ansi\n' + lines.join('\n') + '\n```';
}

function buildMonthlyMessage(students, state) {
  const now = new Date();
  const sgt = toSGT(now);
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

  const reached = reachedMilestone(dojoTotal, state.last_milestone || 0);
  const mName = monthName(reportMonth);
  const year = reportMonth.split('-')[0];

  let lines = [c(33, `✦ ${mName} ${year} — Dojo Monthly Report`), ''];
  if (reached) { lines.push(c(33, '🏯 Milestone — the dojo just crossed ' + reached.toLocaleString() + ' clips! 🔥'), ''); }
  lines.push('—');
  lines.push(`${c(36, String(N))} clips from ${c(36, String(M))} ninja${M !== 1 ? 's' : ''}`);
  if (pctChange !== null) {
    if (pctChange > 2) {
      lines.push(c(32, `+${pctChange}% over ${monthName(prevMonth)}`));
    } else if (pctChange < -2) {
      lines.push('(quieter month — the Forge is always open)');
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

  const monthlyMilestones = detectMilestoneEntries(students, state);
  if (monthlyMilestones.length > 0) {
    lines.push(c(33, 'Leaderboard moves'));
    for (const m of monthlyMilestones) {
      lines.push(c(32, `🏆 ${m.name} entered the Top ${m.milestone} (#${m.position})`));
    }
    lines.push('—');
  }

  const allStreaks = students
    .map(s => ({ s, st: state.streaks[s.u] }))
    .filter(x => x.st && (x.st.status === 'active' || x.st.status === 'recovery') && x.st.current_week >= 1);

  const allColdStartMonthly = allStreaks.length > 0 &&
    allStreaks.every(x => x.st.current_cycle === 1 && x.st.current_week === 1 && x.st.status === 'active');

  if (allColdStartMonthly) {
    lines.push(c(33, '🔥 Streak tracking begins — all ninjas who posted clips start at Cycle 1, Week 1. Watch this space.'));
    lines.push('—');
  } else if (allStreaks.length > 0) {
    const qualified = allStreaks.filter(x => x.st.current_week >= 3 || x.st.status === 'recovery' || x.st.current_cycle >= 2);
    let toShow = qualified.length >= 3 ? qualified : allStreaks.slice(0, 5);
    toShow.sort((a, b) => {
      const aScore = a.st.current_cycle * 100 + a.st.current_week;
      const bScore = b.st.current_cycle * 100 + b.st.current_week;
      return bScore - aScore;
    });
    toShow = toShow.slice(0, 3);

    lines.push(c(33, '🔥 Streak leaders'));
    for (const { s, st } of toShow) {
      const status = st.status === 'recovery' ? 'recovery' : 'active';
      lines.push(`${s.name} — Cycle ${c(36, String(st.current_cycle))} (${status})`);
    }
    lines.push('—');
  }

  lines.push(milestoneBar(dojoTotal, reached));
  lines.push(c(33, 'Every clip is a rep. Every rep compounds.'));
  if (isRecord) {
    lines.push(c(32, 'New Dojo record — biggest month ever.'));
  }

  return '```ansi\n' + lines.join('\n') + '\n```';
}

function formatMyStats(student, state, dojoTotal) {
  if (!student) {
    return "I don't have a record for you yet. Post a clip in #practice-videos and you'll show up in the next scan.";
  }

  const clipCount = Math.max(student.clips || 0, totalClips(student.clip_timestamps));
  const rank = getRank(clipCount);
  const st = state.streaks[student.u];

  const lines = ['✦ Your stats', '', '—'];
  lines.push(`Clips: ${clipCount} (${rank.name})`);

  if (st && st.status === 'recovery') {
    lines.push(`🌀 Recovery (Cycle ${st.current_cycle + 1} begins on return)`);
  } else if (st && st.current_week >= 1) {
    lines.push(`🔥 Cycle ${st.current_cycle}, Week ${st.current_week}`);
  }

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

  if (rank.name === 'Ghost') {
    lines.push('Post your first clip to become Genin — 30 seconds, any quality.');
  } else {
    const sortedRanks = RANKS.slice().sort((a, b) => a.min - b.min);
    const nextUp = sortedRanks.find(r => r.min > clipCount);
    if (nextUp) {
      const away = nextUp.min - clipCount;
      lines.push(`Next rank: ${nextUp.name} at ${nextUp.min} — ${away} away`);
    }
  }

  lines.push('—');
  const milestoneGoal = Math.ceil(dojoTotal / 1000) * 1000 || 1000;
  lines.push(`Dojo milestone: ${dojoTotal.toLocaleString()} / ${milestoneGoal.toLocaleString()}`);

  return lines.join('\n');
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

module.exports = {
  c,
  milestoneBar,
  MILESTONE_POSITIONS,
  getLeaderboardPositions,
  getMilestone,
  detectMilestoneEntries,
  updatePreviousRanks,
  buildDailyMessage,
  buildWeeklyMessage,
  buildMonthlyMessage,
  formatMyStats,
  stripAnsi,
};
