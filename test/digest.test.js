'use strict';

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { buildDailyMessage, stripAnsi } = require('../lib/digest');

const DIGEST_TIME = new Date('2026-06-15T15:00:03.000Z');

function emptyState() {
  return { streaks: {}, previous_ranks: {} };
}

describe('buildDailyMessage at the 23:00 SGT digest boundary', () => {
  it('counts clips from the just-ended dojo day via clip_timestamps fallback', () => {
    mock.timers.enable({ apis: ['Date'], now: DIGEST_TIME });
    try {
      const students = [
        {
          u: 'alice',
          name: 'Alice',
          clips: 100,
          clip_timestamps: [
            '2026-06-15T08:00:00.000Z',
            '2026-06-14T20:00:00.000Z',
            '2026-06-15T15:00:01.000Z',
          ],
        },
        {
          u: 'bob',
          name: 'Bob',
          clips: 50,
          clip_timestamps: ['2026-06-13T10:00:00.000Z'],
        },
      ];

      const msg = stripAnsi(buildDailyMessage(students, emptyState(), null));
      assert.match(msg, /2 clips posted by 1 ninja/);
      assert.match(msg, /Alice \(2\)/);
      assert.doesNotMatch(msg, /Quiet day/);
    } finally {
      mock.timers.reset();
    }
  });

  it('reports live-fetch totals when liveData is provided', () => {
    const students = [
      { u: 'alice', name: 'Alice', clips: 100, clip_timestamps: [] },
      { u: 'bob', name: 'Bob', clips: 50, clip_timestamps: [] },
    ];
    const liveData = {
      posters: [
        { username: 'alice', name: 'Alice', count: 16 },
        { username: 'bob', name: 'Bob', count: 3 },
      ],
      totalClips: 19,
      ninjaCount: 2,
      clipTimestamps: [],
    };

    const msg = stripAnsi(buildDailyMessage(students, emptyState(), liveData));
    assert.match(msg, /19 clips posted by 2 ninjas/);
    assert.match(msg, /Alice \(16\)/);
    assert.match(msg, /Bob \(3\)/);
  });

  it('still shows the dojo milestone from total clips when the day was quiet', () => {
    mock.timers.enable({ apis: ['Date'], now: DIGEST_TIME });
    try {
      const students = [
        { u: 'alice', name: 'Alice', clips: 1931, clip_timestamps: [] },
      ];

      const msg = stripAnsi(buildDailyMessage(students, emptyState(), null));
      assert.match(msg, /Quiet day — 0 clips posted/);
      assert.match(msg, /1,931\/2,000/);
    } finally {
      mock.timers.reset();
    }
  });
});
