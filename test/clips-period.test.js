'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getTodayWindow, clipsToday } = require('../lib/clips-period');

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
