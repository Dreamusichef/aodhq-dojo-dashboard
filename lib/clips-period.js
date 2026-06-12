'use strict';

const {
  sgtWeekKey,
  sgtMonthKey,
  currentSGTWeekKey,
  currentSGTMonthKey,
} = require('./sgt');

function clipsForPeriod(timestamps, filterFn) {
  return (timestamps || []).filter(ts => filterFn(new Date(ts))).length;
}

function clipsToday(timestamps) {
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

module.exports = {
  clipsForPeriod,
  clipsToday,
  clipsThisWeek,
  clipsThisMonth,
  clipsInMonth,
  totalClips,
};
