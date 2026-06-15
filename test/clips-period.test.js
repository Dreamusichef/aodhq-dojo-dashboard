'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getTodayWindow, clipsToday, getReportingDayWindow, clipsReportingDay } = require('../lib/clips-period');

describe('getTodayWindow', () => {
  it('before 15:00 UTC uses the dojo day ending at today 15:00 UTC', () => {
    const now = new Date('2026-06-12T10:00:00.000Z');
    const { cutoffStart, cutoffEnd } = getTodayWindow(now);
    assert.strictEqual(cutoffStart.toISOString(), '2026-06-11T15:00:00.000Z');
    assert.strictEqual(cutoffEnd.toISOString(), '2026-06-12T15:00:00.000Z');
  });

  it('after 15:00 UTC uses the dojo day ending at tomorrow 15:00 UTC', () => {
    const now = new Date('2026-06-12T22:43:00.000Z');
    const { cutoffStart, cutoffEnd } = getTodayWindow(now);
    assert.strictEqual(cutoffStart.toISOString(), '2026-06-12T15:00:00.000Z');
    assert.strictEqual(cutoffEnd.toISOString(), '2026-06-13T15:00:00.000Z');
  });

  it('counts clips posted after 15:00 UTC in the current dojo day', () => {
    const now = new Date('2026-06-12T22:43:00.000Z');
    const n = clipsToday(['2026-06-12T22:42:55.961Z'], now);
    assert.strictEqual(n, 1);
  });
});

describe('getReportingDayWindow (daily digest at the 23:00 boundary)', () => {
  it('reports the day that just ENDED when fired at the 15:00 UTC boundary', () => {
    const now = new Date('2026-06-15T15:00:03.000Z'); // 23:00:03 SGT — actual digest fire time
    const { cutoffStart, cutoffEnd } = getReportingDayWindow(now);
    assert.strictEqual(cutoffStart.toISOString(), '2026-06-14T15:00:00.000Z');
    assert.strictEqual(cutoffEnd.toISOString(), '2026-06-15T15:00:00.000Z');
  });

  it('counts a clip posted earlier in the just-ended day', () => {
    const now = new Date('2026-06-15T15:00:03.000Z');
    const n = clipsReportingDay(['2026-06-15T08:00:00.000Z'], now);
    assert.strictEqual(n, 1);
  });
});

describe('dojo day windows at digest boundary', () => {
  const digestTime = new Date('2026-06-15T15:00:03.000Z');

  it('getTodayWindow starts where getReportingDayWindow ends', () => {
    const today = getTodayWindow(digestTime);
    const reporting = getReportingDayWindow(digestTime);
    assert.strictEqual(today.cutoffStart.toISOString(), reporting.cutoffEnd.toISOString());
    assert.strictEqual(reporting.cutoffStart.toISOString(), '2026-06-14T15:00:00.000Z');
    assert.strictEqual(today.cutoffEnd.toISOString(), '2026-06-16T15:00:00.000Z');
  });

  it('clipsReportingDay excludes clips in the new dojo day; clipsToday includes them', () => {
    const clipInNewDay = '2026-06-15T15:00:01.000Z';
    assert.strictEqual(clipsReportingDay([clipInNewDay], digestTime), 0);
    assert.strictEqual(clipsToday([clipInNewDay], digestTime), 1);
  });
});
