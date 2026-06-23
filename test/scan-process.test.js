'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { processPracticeVideoMessages } = require('../lib/scan-process');

describe('processPracticeVideoMessages', () => {
  it('appends clip_timestamps for each detected clip', async () => {
    const students = [];
    const messages = [{
      id: '1',
      timestamp: '2026-06-12T22:42:55.961Z',
      author: { username: 'azurek', global_name: 'Azurek', bot: false },
      content: 'https://www.youtube.com/watch?v=test123',
      attachments: [],
      embeds: [],
    }];

    await processPracticeVideoMessages(students, messages);

    assert.strictEqual(students.length, 1);
    assert.strictEqual(students[0].clips, 1);
    assert.deepStrictEqual(students[0].clip_timestamps, ['2026-06-12T22:42:55.961Z']);
  });

  it('increments clips but skips BPM when embed title contains fail', async () => {
    const students = [{
      u: 'alice_test',
      name: 'Alice Test',
      clips: 0,
      clip_timestamps: [],
      active: true,
      startBpm: 80,
      currentBpm: 100,
      highBpm: 120,
    }];
    const messages = [{
      id: '2',
      timestamp: '2026-06-12T10:45:00.000Z',
      author: { username: 'alice_test', global_name: 'Alice Test', bot: false },
      content: 'https://www.youtube.com/watch?v=failtest',
      attachments: [],
      embeds: [{ type: 'video', title: '150 BPM core routine fail attempt', video: { url: 'https://www.youtube.com/embed/failtest' } }],
    }];

    const summary = await processPracticeVideoMessages(students, messages);

    assert.strictEqual(students[0].clips, 1);
    assert.strictEqual(students[0].currentBpm, 100);
    assert.strictEqual(students[0].highBpm, 120);
    assert.strictEqual(summary.bpmUpdates.length, 0);
  });
});
