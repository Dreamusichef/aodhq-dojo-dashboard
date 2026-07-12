'use strict';

const {
  sgtWeekKey,
  currentSGTWeekKey,
} = require('./sgt');

function weekKeyToMonday(weekKey) {
  const [y, wn] = weekKey.split('-W');
  const year = Number(y);
  const week = Number(wn);
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay() || 7;
  const daysToFirstMonday = (8 - jan1Day) % 7;
  const firstMonday = new Date(jan1);
  firstMonday.setDate(jan1.getDate() + daysToFirstMonday);
  const result = new Date(firstMonday);
  result.setDate(firstMonday.getDate() + (week - 1) * 7);
  return result;
}

function addWeeks(weekKey, n) {
  const [y, wn] = weekKey.split('-W');
  let newWeek = Number(wn) + n;
  let newYear = Number(y);
  const weeksInYear = (yr) => {
    const jan1 = new Date(yr, 0, 1).getDay();
    const isLeap = (yr % 4 === 0 && yr % 100 !== 0) || (yr % 400 === 0);
    return (jan1 === 4 || (isLeap && jan1 === 3)) ? 53 : 52;
  };
  while (newWeek < 1) { newYear--; newWeek += weeksInYear(newYear); }
  while (newWeek > weeksInYear(newYear)) { newWeek -= weeksInYear(newYear); newYear++; }
  return `${newYear}-W${String(newWeek).padStart(2, '0')}`;
}

/**
 * Cycle/Week streak engine (SGT ISO weeks, Monday-start).
 *
 * Design:
 *  - Posting in 8 consecutive weeks completes a cycle (week the 8th post lands = W0).
 *  - Recovery window: 2 full rest weeks (W1, W2) + the whole return week (W3, through
 *    Sunday). recovery_deadline = W0 + 3, inclusive.
 *  - RETURN: a post in any week W1..W3 promotes to the next cycle, Week 1 — this is the
 *    "Cycle N+1 begins on return" promise. Judged by the week the POST landed in, never
 *    by the night it is processed, so a Sunday-evening return processed on Monday still
 *    counts (no day-boundary ambiguity).
 *  - No post by end of W3 → true reset; the next post starts over at Cycle 1, Week 1.
 *  - `carry` = cycles completed before the current run. The nightly recompute derives
 *    cycle/week from raw timestamps, so carry is what makes Cycle 2+ survive recomputes;
 *    `cycle_anchor_week` (= W0) keeps pre-recovery weeks out of the new cycle's count.
 *  - Cycle completion only triggers while the streak is ALIVE (last active week is the
 *    current or previous week) — a stale 8-week run in old history must not re-arm
 *    recovery every night (the bug that kept members in eternal "recovery").
 */
function computeStreaks(students, streaks) {
  const currentWeek = currentSGTWeekKey();
  const prevWeek = addWeeks(currentWeek, -1);

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
        carry: 0,
        cycle_anchor_week: null,
      };
    }

    const s = streaks[u];
    const activeWeeks = new Set(timestamps.map(ts => sgtWeekKey(new Date(ts))));

    if (activeWeeks.size === 0) {
      s.status = 'inactive';
      s.current_cycle = 0;
      s.current_week = 0;
      continue;
    }

    const sortedWeeks = Array.from(activeWeeks).sort();
    const lastActive = sortedWeeks[sortedWeeks.length - 1];

    if (s.status === 'recovery') {
      // Anchor = the week their completed cycle ended (legacy records fall back to
      // last_active_week, which the old code held at the completion week).
      const anchor = s.cycle_anchor_week || s.last_active_week;
      const returned = anchor && lastActive > anchor &&
        (!s.recovery_deadline || lastActive <= s.recovery_deadline);

      if (returned) {
        // The promise, honored: next cycle begins the week they returned.
        s.carry = s.current_cycle || 0;
        s.current_cycle = s.carry + 1;
        s.current_week = 1;
        s.status = 'active';
        s.cycle_start_date = lastActive;
        s.cycle_anchor_week = anchor;
        s.recovery_deadline = null;
        s.last_active_week = lastActive;
        continue;
      }

      if (s.recovery_deadline && currentWeek > s.recovery_deadline) {
        // Window closed with no return — true reset.
        s.current_cycle = 0;
        s.current_week = 0;
        s.status = 'inactive';
        s.cycle_start_date = null;
        s.recovery_deadline = null;
        s.carry = 0;
        s.cycle_anchor_week = null;
        s.last_active_week = lastActive;
      } else {
        s.last_active_week = lastActive;
      }
      continue;
    }

    // Consecutive-week walk, newest backwards. Weeks at/before the anchor belong to an
    // already-completed cycle and never count toward the current one.
    let streak = 0;
    let prev = null;
    let consecutiveStart = null;

    for (const wk of sortedWeeks.reverse()) {
      if (s.cycle_anchor_week && wk <= s.cycle_anchor_week) break;
      if (prev === null) {
        streak = 1;
        prev = wk;
        consecutiveStart = wk;
      } else {
        const prevDate = weekKeyToMonday(prev);
        const wkDate = weekKeyToMonday(wk);
        const diffDays = (prevDate - wkDate) / (1000 * 60 * 60 * 24);
        if (Math.abs(diffDays - 7) < 1) {
          streak++;
          consecutiveStart = wk;
          prev = wk;
        } else {
          break;
        }
      }
    }

    const carry = s.carry || 0;
    const fullCycles = Math.floor(streak / 8);
    const weekInCycle = streak % 8;
    const streakAlive = (lastActive === currentWeek || lastActive === prevWeek);

    if (fullCycles > 0 && weekInCycle === 0 && streak > 0 && streakAlive) {
      // Cycle completed THIS week or last week (alive) → open the recovery window.
      s.current_cycle = carry + fullCycles;
      s.current_week = 8;
      s.status = 'recovery';
      s.cycle_anchor_week = lastActive;                 // W0
      s.recovery_deadline = addWeeks(lastActive, 3);    // W1+W2 rest, return through W3
      s.last_active_week = lastActive;
    } else {
      if (!streakAlive || streak === 0) {
        s.status = 'inactive';
        s.current_cycle = 0;
        s.current_week = 0;
        s.cycle_start_date = null;
        s.carry = 0;
        s.cycle_anchor_week = null;
        s.last_active_week = lastActive;
        continue;
      }

      s.current_cycle = carry + ((fullCycles === 0) ? 1 : fullCycles + 1);
      s.current_week = weekInCycle === 0 ? 8 : weekInCycle;
      s.status = 'active';
      if (!s.cycle_start_date) {
        s.cycle_start_date = consecutiveStart;
      }
      s.last_active_week = lastActive;
    }
  }

  return streaks;
}

module.exports = {
  weekKeyToMonday,
  addWeeks,
  computeStreaks,
};
