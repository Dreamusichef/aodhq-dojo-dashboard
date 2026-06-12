'use strict';

const SGT_OFFSET = 8 * 60;

function toSGT(date) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + SGT_OFFSET * 60000);
}

function sgtWeekKey(date) {
  const d = toSGT(date);
  const day = d.getDay();
  const diff = (day === 0) ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  const y = mon.getFullYear();
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
function currentSGTWeekKey() { return sgtWeekKey(new Date()); }
function currentSGTDayKey() { return sgtDayKey(new Date()); }

function monthName(monthKey) {
  const [y, m] = monthKey.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long' });
}

module.exports = {
  SGT_OFFSET,
  toSGT,
  sgtWeekKey,
  sgtMonthKey,
  sgtDayKey,
  currentSGTMonthKey,
  currentSGTWeekKey,
  currentSGTDayKey,
  monthName,
};
