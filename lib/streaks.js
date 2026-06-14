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

function computeStreaks(students, streaks) {
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
      if (s.recovery_deadline && currentWeek > s.recovery_deadline) {
        s.current_cycle = 0;
        s.current_week = 0;
        s.status = 'inactive';
        s.cycle_start_date = null;
        s.recovery_deadline = null;
        s.last_active_week = lastActive;
      } else {
        s.last_active_week = lastActive;
      }
      continue;
    }

    let streak = 0;
    let prev = null;
    let consecutiveStart = null;

    for (const wk of sortedWeeks.reverse()) {
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

    const fullCycles = Math.floor(streak / 8);
    const weekInCycle = streak % 8;
    const postedThisWeek = activeWeeks.has(currentWeek);

    if (fullCycles > 0 && weekInCycle === 0 && streak > 0) {
      const completedCycles = fullCycles;
      if (s.status !== 'recovery') {
        s.current_cycle = completedCycles;
        s.current_week = 8;
        s.status = 'recovery';
        const deadlineWeek = addWeeks(currentWeek, 2);
        s.recovery_deadline = deadlineWeek;
        s.last_active_week = lastActive;
      }
    } else if (s.status === 'inactive' || s.status === 'active') {
      const prevWeek = addWeeks(currentWeek, -1);
      const streakAlive = (lastActive === currentWeek || lastActive === prevWeek);

      if (!streakAlive && streak > 0) {
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
        s.status = postedThisWeek ? 'active' : 'active';
        if (!s.cycle_start_date) {
          s.cycle_start_date = consecutiveStart;
        }
        s.last_active_week = lastActive;
      }
    }
  }

  return streaks;
}

module.exports = {
  weekKeyToMonday,
  addWeeks,
  computeStreaks,
};
