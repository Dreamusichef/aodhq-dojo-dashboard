'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readJSON } = require('../lib/data');
const { countClipsInMessage } = require('../lib/clip-detection');

const fixtures = readJSON(path.join(__dirname, '..', 'fixtures', 'messages.json'));
const messages = fixtures['practice-videos'];

describe('clip-detection', () => {
  for (const msg of messages) {
    if (msg.expectedClips == null) continue;
    it(`${msg.id} → ${msg.expectedClips} clips`, () => {
      assert.strictEqual(countClipsInMessage(msg), msg.expectedClips);
    });
  }

  it('counts discord.js-style attachment Map', () => {
    const msg = {
      content: '',
      attachments: new Map([
        ['1', { contentType: 'video/mp4', name: 'clip.mp4', size: 5000000 }],
      ]),
      embeds: [],
    };
    assert.strictEqual(countClipsInMessage(msg), 1);
  });
});
