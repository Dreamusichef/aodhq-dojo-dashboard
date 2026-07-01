'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { countClipsInMessage, extractClipLinks } = require('../lib/clip-detection');
const {
  effectiveSince,
  groupByStudentLatestDay,
  formatFeedbackList,
  formatBlock,
  chunkMessage,
  formatDoneConfirmation,
  WEEK_MS,
} = require('../lib/feedback');

// A known-Monday reference so weekday assertions are deterministic.
// 2024-01-01 12:00 SGT = 2024-01-01 04:00 UTC → Monday.
const MON = Date.UTC(2024, 0, 1, 4, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const rec = (username, ms, ...links) => ({ username, createdAtMs: ms, links });

describe('effectiveSince', () => {
  it('defaults to 7 days ago on first run (no marker)', () => {
    const now = new Date('2026-06-27T00:00:00Z');
    assert.strictEqual(effectiveSince({}, now).getTime(), now.getTime() - WEEK_MS);
    assert.strictEqual(effectiveSince(null, now).getTime(), now.getTime() - WEEK_MS);
  });
  it('uses the stored marker when present', () => {
    const iso = '2026-06-20T15:00:00.000Z';
    assert.strictEqual(effectiveSince({ lastReviewedAt: iso }).toISOString(), iso);
  });
  it('falls back to 7 days when the stored marker is garbage', () => {
    const now = new Date('2026-06-27T00:00:00Z');
    assert.strictEqual(effectiveSince({ lastReviewedAt: 'not-a-date' }, now).getTime(), now.getTime() - WEEK_MS);
  });
});

describe('groupByStudentLatestDay', () => {
  it("keeps only each student's OWN most recent day, independently", () => {
    const records = [
      rec('alice', MON, 'a-mon'),                 // Monday (older)
      rec('alice', MON + 2 * DAY, 'a-wed1', 'a-wed2'), // Wednesday (alice's latest)
      rec('bob', MON + 1 * DAY, 'b-tue'),         // Tuesday (bob's latest, different day than alice)
    ];
    const groups = groupByStudentLatestDay(records);
    assert.strictEqual(groups.length, 2);

    const alice = groups.find(g => g.username === 'alice');
    assert.deepStrictEqual(alice.links, ['a-wed1', 'a-wed2']); // Monday link dropped
    assert.strictEqual(alice.count, 2);
    assert.strictEqual(alice.weekday, 'Wednesday');

    const bob = groups.find(g => g.username === 'bob');
    assert.deepStrictEqual(bob.links, ['b-tue']);
    assert.strictEqual(bob.weekday, 'Tuesday');
  });

  it('collapses many posts across a week to just the latest active day', () => {
    const records = [
      rec('cara', MON, 'x1'),
      rec('cara', MON + DAY, 'x2'),
      rec('cara', MON + 2 * DAY, 'x3'),
      rec('cara', MON + 3 * DAY, 'y1', 'y2'), // Thursday — latest
    ];
    const [g] = groupByStudentLatestDay(records);
    assert.deepStrictEqual(g.links, ['y1', 'y2']);
    assert.strictEqual(g.weekday, 'Thursday');
  });

  it('orders a student\'s links chronologically within the latest day', () => {
    const records = [
      rec('dan', MON + 2 * DAY + 5000, 'later'),
      rec('dan', MON + 2 * DAY + 1000, 'earlier'),
    ];
    const [g] = groupByStudentLatestDay(records);
    assert.deepStrictEqual(g.links, ['earlier', 'later']);
  });

  it('respects the SGT calendar-day boundary (midnight SGT = 16:00 UTC)', () => {
    // 2024-01-01 15:30 UTC = 23:30 SGT Jan 1; 2024-01-01 16:30 UTC = 00:30 SGT Jan 2.
    const beforeMidnight = Date.UTC(2024, 0, 1, 15, 30, 0);
    const afterMidnight = Date.UTC(2024, 0, 1, 16, 30, 0);
    const [g] = groupByStudentLatestDay([
      rec('eve', beforeMidnight, 'jan1'),
      rec('eve', afterMidnight, 'jan2'),
    ]);
    assert.deepStrictEqual(g.links, ['jan2']); // only the SGT-Jan-2 post
  });

  it('sorts students alphabetically (case-insensitive)', () => {
    const groups = groupByStudentLatestDay([
      rec('Zed', MON, 'z'),
      rec('alice', MON, 'a'),
      rec('Bob', MON, 'b'),
    ]);
    assert.deepStrictEqual(groups.map(g => g.username), ['alice', 'Bob', 'Zed']);
  });

  it('drops a student only when NONE of their days resolve to a link', () => {
    const groups = groupByStudentLatestDay([rec('ghost', MON)]); // no links, only day
    assert.strictEqual(groups.length, 0);
  });

  it('falls back to the most recent day WITH links when the latest day resolves to none', () => {
    const records = [
      rec('carol', MON, 'c-mon'),   // Monday — has a link
      rec('carol', MON + 3 * DAY),  // Thursday (latest) — counted clip, but no resolvable link
    ];
    const [g] = groupByStudentLatestDay(records);
    assert.strictEqual(g.username, 'carol');
    assert.deepStrictEqual(g.links, ['c-mon']); // not dropped — falls back to Monday
    assert.strictEqual(g.weekday, 'Monday');
  });
});

describe('extractClipLinks — parity with countClipsInMessage', () => {
  const cases = [
    { name: 'youtube link', msg: { content: 'Day 1 https://youtube.com/watch?v=abc 120bpm' }, links: ['https://youtube.com/watch?v=abc'] },
    { name: 'two clip links', msg: { content: 'https://youtu.be/a and https://vimeo.com/123' }, links: ['https://youtu.be/a', 'https://vimeo.com/123'] },
    { name: 'tenor gif (skip)', msg: { content: 'lol https://tenor.com/view/x.gif' }, links: [] },
    { name: 'plain text', msg: { content: 'nice work everyone' }, links: [] },
    {
      name: 'mp4 upload (REST array)',
      msg: { content: '', attachments: [{ url: 'https://cdn.discordapp.com/a/clip.mp4', filename: 'clip.mp4', content_type: 'video/mp4', size: 5 * 1024 * 1024 }] },
      links: ['https://cdn.discordapp.com/a/clip.mp4'],
    },
    {
      name: 'mp4 upload (discord.js Map)',
      msg: { content: '', attachments: new Map([['1', { url: 'https://cdn/x.mov', name: 'x.mov', contentType: 'video/quicktime', size: 9e6 }]]) },
      links: ['https://cdn/x.mov'],
    },
    {
      name: 'upload + youtube link (2 clips)',
      msg: { content: 'plus https://youtube.com/watch?v=z', attachments: [{ url: 'https://cdn/v.mp4', filename: 'v.mp4', content_type: 'video/mp4', size: 8e6 }] },
      links: ['https://cdn/v.mp4', 'https://youtube.com/watch?v=z'],
    },
    {
      name: 'embed-only video (fallback)',
      msg: { content: '', embeds: [{ type: 'video', url: 'https://youtube.com/watch?v=e', video: { url: 'https://youtube.com/embed/e' } }] },
      links: ['https://youtube.com/embed/e'],
    },
    {
      name: 'small gif mp4 (skipped)',
      msg: { content: '', attachments: [{ url: 'https://cdn/tiny.mp4', filename: 'tiny.mp4', content_type: 'video/mp4', size: 100 * 1024 }] },
      links: [],
    },
  ];

  for (const c of cases) {
    it(`${c.name}: links match and count === links.length`, () => {
      const got = extractClipLinks(c.msg);
      assert.deepStrictEqual(got, c.links);
      assert.strictEqual(got.length, countClipsInMessage(c.msg));
    });
  }

  it('resolves an attachment via proxy_url when url is absent', () => {
    const msg = { content: '', attachments: [{ proxy_url: 'https://media.discordapp.net/a/clip.mp4', filename: 'clip.mp4', content_type: 'video/mp4', size: 5e6 }] };
    assert.deepStrictEqual(extractClipLinks(msg), ['https://media.discordapp.net/a/clip.mp4']);
    assert.strictEqual(extractClipLinks(msg).length, countClipsInMessage(msg));
  });

  it('does NOT substitute an embed link when an attachment was detected but had no url', () => {
    // Video attachment with no url/proxy_url is still COUNTED; the extractor must mirror the
    // counter's gate (matched > 0 → no embed fallback), not surface the unrelated embed link.
    const msg = {
      content: '',
      attachments: [{ filename: 'clip.mp4', content_type: 'video/mp4', size: 5e6 }],
      embeds: [{ type: 'video', url: 'https://youtube.com/embed/WRONG', video: { url: 'https://youtube.com/embed/WRONG' } }],
    };
    assert.strictEqual(countClipsInMessage(msg), 1);
    assert.deepStrictEqual(extractClipLinks(msg), []);              // no wrong embed link
    assert.ok(extractClipLinks(msg).length <= countClipsInMessage(msg)); // softened invariant holds
  });
});

describe('formatFeedbackList / formatBlock', () => {
  it('renders one block per student with @handle, count, weekday, and links', () => {
    const groups = groupByStudentLatestDay([
      rec('alice', MON + 2 * DAY, 'https://youtu.be/a1', 'https://youtu.be/a2'),
      rec('bob', MON + 1 * DAY, 'https://youtu.be/b1'),
    ]);
    const out = formatFeedbackList(groups, { since: new Date(MON) });
    assert.match(out, /@alice — 2 videos \(last posted Wednesday\)/);
    assert.match(out, /@bob — 1 video \(last posted Tuesday\)/);
    assert.match(out, /https:\/\/youtu\.be\/a1/);
    assert.match(out, /2 students, 3 videos to review/);
  });

  it('shows a friendly caught-up message when empty', () => {
    const out = formatFeedbackList([], { since: new Date(MON) });
    assert.match(out, /all caught up/i);
    assert.doesNotMatch(out, /@/);
  });

  it('formatBlock singular/plural', () => {
    assert.match(formatBlock({ username: 'x', count: 1, weekday: 'Friday', links: ['u'] }), /1 video \(/);
    assert.match(formatBlock({ username: 'x', count: 3, weekday: 'Friday', links: ['a', 'b', 'c'] }), /3 videos \(/);
  });
});

describe('chunkMessage', () => {
  it('keeps everything in one chunk when small', () => {
    assert.deepStrictEqual(chunkMessage('short text'), ['short text']);
  });

  it('splits on block boundaries, never mid-block, staying under the limit', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => `@user${i} — 1 video (last posted Monday)\nhttps://youtu.be/${'x'.repeat(60)}${i}`);
    const text = blocks.join('\n\n');
    const chunks = chunkMessage(text, 500);
    for (const ch of chunks) assert.ok(ch.length <= 500, `chunk too long: ${ch.length}`);
    // Every original block survives intact in exactly one chunk.
    for (const b of blocks) assert.ok(chunks.some(ch => ch.includes(b)), 'a block was split');
    assert.strictEqual(chunks.join('\n\n'), text);
  });

  it('hard-slices an unsplittable single line so no chunk exceeds the limit', () => {
    const line = 'https://x/' + 'c'.repeat(2100); // one 2110-char line, no spaces/newlines
    const chunks = chunkMessage(line, 1900);
    for (const ch of chunks) assert.ok(ch.length <= 1900, `chunk too long: ${ch.length}`);
    assert.strictEqual(chunks.join(''), line); // pieces reconstruct the original line
  });
});

describe('formatDoneConfirmation', () => {
  it('matches the spec wording and echoes the timestamp', () => {
    const ts = new Date('2026-06-27T15:14:00.000Z');
    assert.strictEqual(
      formatDoneConfirmation(ts),
      'Feedback window advanced. Next /feedback shows posts after 2026-06-27T15:14:00.000Z.'
    );
  });
});
