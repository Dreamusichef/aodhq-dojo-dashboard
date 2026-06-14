'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJSON, writeBackClipTimestamps } = require('../lib/data');

describe('writeBackClipTimestamps', () => {
  it('adds timestamps without incrementing clips (Bug 1 regression)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-writeback-'));
    const dataFile = path.join(tmpDir, 'dojo-data.json');

    const data = {
      meta: { totalClips: 5 },
      students: [{
        u: 'alice_test',
        name: 'Alice',
        clips: 5,
        clip_timestamps: ['2026-06-11T10:00:00.000Z'],
      }],
    };
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

    const liveData = {
      clipTimestamps: [
        { username: 'alice_test', timestamp: '2026-06-12T10:00:00.000Z' },
        { username: 'alice_test', timestamp: '2026-06-12T10:00:01.000Z' },
      ],
    };

    writeBackClipTimestamps(liveData, dataFile, { log: () => {} });

    const updated = readJSON(dataFile);
    const alice = updated.students[0];
    assert.strictEqual(alice.clips, 5, 'clips must not be incremented by writeback');
    assert.strictEqual(alice.clip_timestamps.length, 3);
    assert.ok(alice.clip_timestamps.includes('2026-06-12T10:00:00.000Z'));
  });

  it('skips duplicate timestamps', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-writeback-'));
    const dataFile = path.join(tmpDir, 'dojo-data.json');

    const data = {
      students: [{
        u: 'bob',
        name: 'Bob',
        clips: 1,
        clip_timestamps: ['2026-06-12T10:00:00.000Z'],
      }],
    };
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

    writeBackClipTimestamps({
      clipTimestamps: [{ username: 'bob', timestamp: '2026-06-12T10:00:00.000Z' }],
    }, dataFile, { log: () => {} });

    const updated = readJSON(dataFile);
    assert.strictEqual(updated.students[0].clip_timestamps.length, 1);
    assert.strictEqual(updated.students[0].clips, 1);
  });
});
