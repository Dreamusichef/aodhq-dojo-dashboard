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

/** SGT dojo day: 23:00 SGT → 23:00 SGT next day (15:00 UTC boundaries). */
function getTodayWindow(now = new Date()) {
  const todayCutoff = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15, 0, 0
  ));
  const cutoffEnd = (now.getTime() >= todayCutoff.getTime())
    ? new Date(todayCutoff.getTime() + 86400000)
    : todayCutoff;
  const cutoffStart = new Date(cutoffEnd.getTime() - 86400000);
  return { cutoffStart, cutoffEnd };
}

function clipsToday(timestamps, now = new Date()) {
  const { cutoffStart, cutoffEnd } = getTodayWindow(now);
  return clipsForPeriod(timestamps, d => d >= cutoffStart && d < cutoffEnd);
}

/**
 * The dojo day that has just ENDED at the most recent 23:00 SGT (15:00 UTC) boundary.
 * The daily digest fires exactly on that boundary, where getTodayWindow() returns the
 * day just *starting* (empty). The digest must report the day that just ended.
 */
function getReportingDayWindow(now = new Date()) {
  const todayCutoff = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15, 0, 0
  );
  const cutoffEnd = (now.getTime() >= todayCutoff)
    ? new Date(todayCutoff)
    : new Date(todayCutoff - 86400000);
  const cutoffStart = new Date(cutoffEnd.getTime() - 86400000);
  return { cutoffStart, cutoffEnd };
}

function clipsReportingDay(timestamps, now = new Date()) {
  const { cutoffStart, cutoffEnd } = getReportingDayWindow(now);
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
  getTodayWindow,
  clipsToday,
  getReportingDayWindow,
  clipsReportingDay,
  clipsThisWeek,
  clipsThisMonth,
  clipsInMonth,
  totalClips,
};
