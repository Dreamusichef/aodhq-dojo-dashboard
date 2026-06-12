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
});
