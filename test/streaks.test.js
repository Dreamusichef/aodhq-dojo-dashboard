'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { computeStreaks, addWeeks } = require('../lib/streaks');
const { currentSGTWeekKey, sgtWeekKey } = require('../lib/sgt');

const WEEK = 7 * 24 * 3600 * 1000;
// Timestamp exactly n weeks before now — same weekday, so its SGT week key is
// currentWeek - n regardless of when the tests run.
const ts = (nWeeksAgo) => new Date(Date.now() - nWeeksAgo * WEEK).toISOString();
const weekKeyAgo = (n) => sgtWeekKey(new Date(Date.now() - n * WEEK));

// An 8-consecutive-week cycle whose final (8th) posting week was `endWeeksAgo` weeks ago.
function cycleRun(endWeeksAgo) {
  const out = [];
  for (let i = 0; i < 8; i++) out.push(ts(endWeeksAgo + 7 - i));
  return out;
}

function student(u, timestamps) {
  return { u, name: u, clip_timestamps: timestamps };
}

// A recovery record as production holds it after completing cycle 1 in week W0
// (`anchorWeeksAgo` weeks ago). Deadline = W0 + 3 (2 rest weeks + the return week).
function recoveryState(anchorWeeksAgo) {
  const anchor = weekKeyAgo(anchorWeeksAgo);
  return {
    current_cycle: 1,
    current_week: 8,
    status: 'recovery',
    cycle_start_date: null,
    last_active_week: anchor,
    recovery_deadline: addWeeks(anchor, 3),
    carry: 0,
    cycle_anchor_week: anchor,
  };
}

describe('recovery → return promotes to the next cycle (the promise)', () => {
  it('post during the window → Cycle 2, Week 1 (mandubien scenario, fixed)', () => {
    // Cycle 1 ended 3 weeks ago → rest W1,W2 → return week = THIS week.
    const clips = cycleRun(3).concat([ts(0)]); // returns this week
    const streaks = { mandubien: recoveryState(3) };
    computeStreaks([student('mandubien', clips)], streaks);
    const s = streaks.mandubien;
    assert.strictEqual(s.status, 'active');
    assert.strictEqual(s.current_cycle, 2);
    assert.strictEqual(s.current_week, 1);
    assert.strictEqual(s.carry, 1);
  });

  it('post during a REST week also promotes (light reps count as return)', () => {
    const clips = cycleRun(2).concat([ts(0)]); // W0 two weeks ago; posts in rest week W2
    const streaks = { early: recoveryState(2) };
    computeStreaks([student('early', clips)], streaks);
    assert.strictEqual(streaks.early.status, 'active');
    assert.strictEqual(streaks.early.current_cycle, 2);
  });

  it('Sunday-edge: return posted inside the window but PROCESSED after the deadline still promotes', () => {
    // W0 four weeks ago → deadline = one week ago. The return post landed LAST week
    // (== deadline week) but tonight's run is already past the deadline. The post's
    // week decides — not the processing night.
    const clips = cycleRun(4).concat([ts(1)]);
    const streaks = { sunday: recoveryState(4) };
    computeStreaks([student('sunday', clips)], streaks);
    assert.strictEqual(streaks.sunday.status, 'active');
    assert.strictEqual(streaks.sunday.current_cycle, 2);
    assert.strictEqual(streaks.sunday.current_week, 1);
  });

  it('promotion survives the nightly recompute (carry protects Cycle 2)', () => {
    const clips = cycleRun(3).concat([ts(0)]);
    const streaks = { keeper: recoveryState(3) };
    computeStreaks([student('keeper', clips)], streaks);  // promotes
    computeStreaks([student('keeper', clips)], streaks);  // next nightly recompute
    computeStreaks([student('keeper', clips)], streaks);  // and another
    assert.strictEqual(streaks.keeper.status, 'active');
    assert.strictEqual(streaks.keeper.current_cycle, 2);  // NOT clobbered back to 1
    assert.strictEqual(streaks.keeper.current_week, 1);
  });

  it('legacy recovery record (no anchor field) still promotes via last_active_week', () => {
    const st = recoveryState(3);
    delete st.cycle_anchor_week;
    delete st.carry;
    const clips = cycleRun(3).concat([ts(0)]);
    const streaks = { legacy: st };
    computeStreaks([student('legacy', clips)], streaks);
    assert.strictEqual(streaks.legacy.status, 'active');
    assert.strictEqual(streaks.legacy.current_cycle, 2);
  });
});

describe('recovery expiry (no return by end of the return week)', () => {
  it('window closed with no post → full reset; next post starts Cycle 1 Week 1', () => {
    // W0 five weeks ago → deadline two weeks ago; never returned.
    const clips = cycleRun(5);
    const streaks = { gone: recoveryState(5) };
    computeStreaks([student('gone', clips)], streaks);
    assert.strictEqual(streaks.gone.status, 'inactive');
    assert.strictEqual(streaks.gone.current_cycle, 0);
    assert.strictEqual(streaks.gone.carry, 0);

    // They come back much later → a genuine fresh start.
    clips.push(ts(0));
    computeStreaks([student('gone', clips)], streaks);
    assert.strictEqual(streaks.gone.status, 'active');
    assert.strictEqual(streaks.gone.current_cycle, 1);
    assert.strictEqual(streaks.gone.current_week, 1);
  });
});

describe('cycle completion detection (eternal re-arm fixed)', () => {
  it('a STALE 8-week run in old history does NOT enter recovery', () => {
    const streaks = {};
    computeStreaks([student('stale', cycleRun(4))], streaks);
    assert.strictEqual(streaks.stale.status, 'inactive');   // pre-fix: recovery, re-armed nightly
    assert.strictEqual(streaks.stale.current_cycle, 0);
  });

  it('a LIVE 8th consecutive week enters recovery with deadline = W0 + 3', () => {
    const streaks = {};
    computeStreaks([student('live', cycleRun(0))], streaks);
    const s = streaks.live;
    assert.strictEqual(s.status, 'recovery');
    assert.strictEqual(s.current_cycle, 1);
    assert.strictEqual(s.current_week, 8);
    assert.strictEqual(s.cycle_anchor_week, currentSGTWeekKey());
    assert.strictEqual(s.recovery_deadline, addWeeks(currentSGTWeekKey(), 3));
  });

  it('continuous poster: completes, returns adjacent week — old weeks never double-count', () => {
    // Cycle 1 ended LAST week; they post again THIS week (no gap at all).
    const clips = cycleRun(1).concat([ts(0)]);
    const streaks = { nonstop: recoveryState(1) };
    computeStreaks([student('nonstop', clips)], streaks);   // promote
    assert.strictEqual(streaks.nonstop.current_cycle, 2);
    assert.strictEqual(streaks.nonstop.current_week, 1);    // anchored walk: only the new week counts
    computeStreaks([student('nonstop', clips)], streaks);   // recompute — still Cycle 2 Week 1
    assert.strictEqual(streaks.nonstop.current_cycle, 2);
    assert.strictEqual(streaks.nonstop.current_week, 1);    // NOT week 9 / cycle 3
  });
});

describe('regular progression (unchanged behavior)', () => {
  it('3 consecutive weeks ending now → Cycle 1, Week 3, active', () => {
    const streaks = {};
    computeStreaks([student('reg', [ts(2), ts(1), ts(0)])], streaks);
    assert.strictEqual(streaks.reg.status, 'active');
    assert.strictEqual(streaks.reg.current_cycle, 1);
    assert.strictEqual(streaks.reg.current_week, 3);
  });

  it('no posts at all → inactive', () => {
    const streaks = {};
    computeStreaks([student('ghost', [])], streaks);
    assert.strictEqual(streaks.ghost.status, 'inactive');
  });

  it('broken streak (last post 3 weeks ago) → inactive until they post again', () => {
    const streaks = {};
    computeStreaks([student('broke', [ts(4), ts(3)])], streaks);
    assert.strictEqual(streaks.broke.status, 'inactive');
    assert.strictEqual(streaks.broke.current_cycle, 0);
  });
});
