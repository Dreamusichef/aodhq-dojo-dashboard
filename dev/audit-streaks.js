#!/usr/bin/env node
'use strict';
/**
 * dev/audit-streaks.js
 * Replays the CORRECTED streak rules over every member's full clip_timestamps history
 * and diffs the outcome against the stored streak state (pulse-state.json).
 *
 * Purpose: find anyone the old engine robbed — members who completed an 8-week cycle,
 * returned within their recovery window (2 rest weeks + the return week), and were
 * reset to Cycle 1 instead of promoted (no promotion path existed before Jul 2026).
 *
 * Rules replayed (see lib/streaks.js):
 *   - post ≥1×/week keeps the streak; 8 consecutive weeks completes a cycle (W0)
 *   - recovery: rest W1+W2, return through W3 (post's week decides, inclusive)
 *   - return in W1..W3 → next cycle, Week 1 (carry preserved)
 *   - no post by end of W3 → true reset (next post = Cycle 1 Week 1)
 *
 * Usage (VPS, from /opt/dojo-pulse):
 *   node dev/audit-streaks.js                 # report only
 *   node dev/audit-streaks.js --months 3      # limit the events report window (default 3)
 *   node dev/audit-streaks.js --apply         # write corrected records into pulse-state.json (backs up first)
 *   node dev/audit-streaks.js --data <f> --state <f>   # override file paths (local prototyping)
 * With no pulse-state.json (local), prints expected states without comparison.
 */
const fs = require('fs');
const { addWeeks, weekKeyToMonday } = require('../lib/streaks');
const { sgtWeekKey, currentSGTWeekKey } = require('../lib/sgt');
const { getDataPaths } = require('../lib/discord-config');

function parseArgs(argv) {
  const a = { apply: false, months: 3, data: null, state: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') a.apply = true;
    else if (arg === '--months') a.months = Number(argv[++i]) || 3;
    else if (arg === '--data') a.data = argv[++i];
    else if (arg === '--state') a.state = argv[++i];
    else { console.error('Unknown option: ' + arg); process.exit(1); }
  }
  return a;
}

const consecutive = (a, b) => (weekKeyToMonday(b) - weekKeyToMonday(a)) === 7 * 86400000;

/** Replay the corrected rules over one member's posting weeks. */
function replay(weeks, currentWeek) {
  const events = [];
  let carry = 0, mode = 'none', runLen = 0, prev = null;
  let completed = 0, anchor = null, deadline = null;

  for (const w of weeks) {
    if (mode === 'recovery') {
      if (w <= deadline) {
        carry = completed;
        events.push({ type: 'promoted', week: w, toCycle: carry + 1 });
        mode = 'active'; runLen = 1;
      } else {
        events.push({ type: 'window-missed', week: w, deadline });
        carry = 0; mode = 'active'; runLen = 1;
      }
    } else if (mode === 'active') {
      if (consecutive(prev, w)) runLen++;
      else { events.push({ type: 'broke', after: prev }); carry = 0; runLen = 1; }
    } else {
      mode = 'active'; runLen = 1;
    }
    prev = w;

    if (mode === 'active' && runLen === 8) {
      completed = carry + 1;
      events.push({ type: 'completed', week: w, cycle: completed });
      mode = 'recovery'; anchor = w; deadline = addWeeks(w, 3);
    }
  }

  // Expected state as of currentWeek
  let expected;
  if (mode === 'recovery') {
    if (currentWeek > deadline) {
      expected = { status: 'inactive', current_cycle: 0, current_week: 0, carry: 0, cycle_anchor_week: null, recovery_deadline: null };
      events.push({ type: 'window-expired', deadline });
    } else {
      expected = { status: 'recovery', current_cycle: completed, current_week: 8, carry: completed - 1, cycle_anchor_week: anchor, recovery_deadline: deadline };
    }
  } else if (mode === 'active') {
    const alive = prev === currentWeek || prev === addWeeks(currentWeek, -1);
    expected = alive
      ? { status: 'active', current_cycle: carry + 1, current_week: runLen, carry, cycle_anchor_week: carry > 0 ? anchor : null, recovery_deadline: null }
      : { status: 'inactive', current_cycle: 0, current_week: 0, carry: 0, cycle_anchor_week: null, recovery_deadline: null };
  } else {
    expected = { status: 'inactive', current_cycle: 0, current_week: 0, carry: 0, cycle_anchor_week: null, recovery_deadline: null };
  }
  return { expected, events };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = getDataPaths();
  const dataFile = args.data || paths.dataFile;
  const stateFile = args.state || paths.pulseStateFile;

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8').replace(/^﻿/, ''));
  const hasState = fs.existsSync(stateFile);
  const state = hasState ? JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^﻿/, '')) : { streaks: {} };
  state.streaks = state.streaks || {};

  const currentWeek = currentSGTWeekKey();
  const sinceMs = Date.now() - args.months * 30.5 * 86400000;
  const inWindow = wk => weekKeyToMonday(wk).getTime() >= sinceMs;

  console.log(`[Audit] Replaying corrected streak rules | current week ${currentWeek} | events window: last ~${args.months} months`);
  console.log(hasState ? `[Audit] Comparing against ${stateFile}` : '[Audit] No pulse-state found — printing expected states only');
  console.log('');

  const corrections = [];
  let robbed = 0, mismatches = 0, storiesShown = 0;

  for (const s of data.students) {
    const weeks = Array.from(new Set((s.clip_timestamps || []).map(t => sgtWeekKey(new Date(t))))).sort();
    if (weeks.length === 0) continue;

    const { expected, events } = replay(weeks, currentWeek);
    const notable = events.filter(e => ['completed', 'promoted', 'window-missed', 'window-expired'].includes(e.type))
      .filter(e => !e.week || inWindow(e.week));

    const st = state.streaks[s.u];
    const diff = hasState && st && (
      st.status !== expected.status ||
      (st.current_cycle || 0) !== expected.current_cycle ||
      (st.current_week || 0) !== expected.current_week ||
      // a recovery member with a wrong (re-armed) window must be normalized too
      (expected.status === 'recovery' && st.recovery_deadline !== expected.recovery_deadline)
    );
    const wasRobbed = events.some(e => e.type === 'promoted' && inWindow(e.week));

    if (notable.length === 0 && !diff) continue;

    storiesShown++;
    console.log(`— ${s.name} (@${s.u})`);
    for (const e of notable) {
      if (e.type === 'completed') console.log(`   ✅ completed Cycle ${e.cycle} in ${e.week} (window through end of ${addWeeks(e.week, 3)})`);
      if (e.type === 'promoted') console.log(`   ⬆️  RETURNED IN-WINDOW ${e.week} → should be Cycle ${e.toCycle} (old engine reset them to Cycle 1)`);
      if (e.type === 'window-missed') console.log(`   ⏳ returned ${e.week}, after window ${e.deadline} → legit reset to Cycle 1`);
      if (e.type === 'window-expired') console.log(`   💤 recovery window ${e.deadline} passed with no return → reset`);
    }
    if (wasRobbed) robbed++;
    console.log(`   expected NOW: ${expected.status} · Cycle ${expected.current_cycle}, Week ${expected.current_week}${expected.recovery_deadline ? ' · window through ' + expected.recovery_deadline : ''}`);
    if (hasState) {
      if (st) console.log(`   stored   NOW: ${st.status} · Cycle ${st.current_cycle || 0}, Week ${st.current_week || 0}${diff ? '   ← MISMATCH' : '   (matches)'}`);
      else console.log('   stored   NOW: (no record)');
      if (diff) { mismatches++; corrections.push({ u: s.u, name: s.name, expected }); }
    }
    console.log('');
  }

  console.log(`[Audit] ${storiesShown} member(s) with notable streak events; ${robbed} robbed of a promotion in the window; ${hasState ? mismatches + ' current mismatch(es).' : '(no comparison)'}`);

  if (corrections.length && !args.apply) {
    console.log('[Audit] Re-run with --apply to write the expected records into pulse-state.json (backup written first).');
  }
  if (corrections.length && args.apply) {
    fs.copyFileSync(stateFile, `${stateFile}.bak-${Date.now()}`);
    for (const c of corrections) {
      state.streaks[c.u] = { ...(state.streaks[c.u] || {}), ...c.expected, last_active_week: (state.streaks[c.u] || {}).last_active_week || null, cycle_start_date: null };
      console.log(`[Audit] corrected ${c.name} → ${c.expected.status} · Cycle ${c.expected.current_cycle}, Week ${c.expected.current_week}`);
    }
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    console.log('[Audit] pulse-state.json updated (backup saved).');
  }
}

main();
