'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { processMessageChannel } = require('../lib/scan-process');
const { tallyMessagesByAuthor, applyMessageTally } = require('../lib/recount-messages');
const { projectStudent, stableId } = require('../lib/public-projection');

function msg(id, username, bot = false) {
  return { id, author: { username, bot } };
}

describe('processMessageChannel (incremental nightly count)', () => {
  it('increments the target field per author, skipping bots and untracked users', () => {
    const students = [
      { u: 'azurek', name: 'Azurek', sentinel: 0 },
      { u: 'wiola17', name: 'Wiola' },
    ];
    const messages = [
      msg('3', 'azurek'), msg('1', 'azurek'), msg('2', 'wiola17'),
      msg('4', 'azurek', true), // bot — ignored
      msg('5', 'stranger'),     // not a tracked ninja — ignored
    ];
    const summary = processMessageChannel(students, messages, 'sentinel');
    assert.strictEqual(students[0].sentinel, 2);
    assert.strictEqual(students[1].sentinel, 1);
    assert.strictEqual(summary.field, 'sentinel');
    assert.strictEqual(summary.adds.length, 3);
  });

  it('adds onto an existing count (only new messages are passed each night)', () => {
    const students = [{ u: 'azurek', name: 'Azurek', lounge: 5 }];
    processMessageChannel(students, [msg('1', 'azurek')], 'lounge');
    assert.strictEqual(students[0].lounge, 6);
  });
});

describe('message recount (full from-scratch rebuild)', () => {
  it('tallies by author and resets every field, zeroing those absent from history', () => {
    const students = [
      { u: 'a', name: 'A', hall: 99 },
      { u: 'b', name: 'B', hall: 3 },
    ];
    const tally = tallyMessagesByAuthor([msg('1', 'a'), msg('2', 'a'), msg('3', 'c')]);
    assert.deepStrictEqual(tally, { a: 2, c: 1 });
    applyMessageTally(students, tally, 'hall');
    assert.strictEqual(students[0].hall, 2); // reset from legacy 99
    assert.strictEqual(students[1].hall, 0); // no history -> 0
  });
});

describe('public projection (stable id + sentinel + privacy)', () => {
  it('attaches a deterministic non-PII id, includes sentinel, normalizes loc, omits the username', () => {
    const rec = projectStudent({ u: 'azurek', name: 'Azurek', loc: 'US', clips: 5, sentinel: 4 }, {});
    assert.strictEqual('u' in rec, false);                 // username never leaks
    assert.strictEqual(rec.id, stableId('azurek'));        // hashed from username
    assert.strictEqual(stableId('azurek'), stableId('azurek')); // deterministic
    assert.notStrictEqual(stableId('azurek'), stableId('wiola17')); // distinct per user
    assert.strictEqual(rec.sentinel, 4);
    assert.strictEqual(rec.loc, 'United States');
  });
});
