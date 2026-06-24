'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readJSON } = require('../lib/data');
const { extractBpm } = require('../lib/bpm-extract');

const fixtures = readJSON(path.join(__dirname, '..', 'fixtures', 'messages.json'));
const messages = fixtures['practice-videos'];

describe('extractBpm', () => {
  it('extracts BPM from qualifying embed title', () => {
    const msg = messages.find(m => m.id === 'fixture-bpm-embed');
    assert.strictEqual(extractBpm(msg), 140);
  });

  it('returns null when exclude keywords present', () => {
    const msg = messages.find(m => m.id === 'fixture-bpm-excluded');
    assert.strictEqual(extractBpm(msg), null);
  });

  it('returns null when title contains fail', () => {
    const msg = messages.find(m => m.id === 'fixture-bpm-fail');
    assert.strictEqual(extractBpm(msg), null);
  });

  it('returns null when no embeds', () => {
    assert.strictEqual(extractBpm({ embeds: [] }), null);
  });
});
