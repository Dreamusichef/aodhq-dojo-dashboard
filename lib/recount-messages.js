'use strict';

// Per-author message counting for the engagement channels (#the-hall, #lounge,
// #sentinel-council). Mirrors lib/recount-clips.js, but counts messages, not clips.
// Used by dev/recount-messages.js to rebuild counts from full channel history.

function tallyMessagesByAuthor(messages) {
  const tally = {};
  for (const msg of messages) {
    if (msg.author && msg.author.bot) continue;
    const u = msg.author && msg.author.username;
    if (!u) continue;
    tally[u] = (tally[u] || 0) + 1;
  }
  return tally;
}

function reportMessageDiff(students, tally, field) {
  const lines = [];
  let higher = 0;
  let lower = 0;

  for (const s of students) {
    const recount = tally[s.u] || 0;
    const current = s[field] || 0;
    const delta = current - recount;
    if (delta !== 0) {
      const dir = delta > 0 ? 'was higher' : 'was lower';
      lines.push(`  ${s.name} (@${s.u}): current=${current} recount=${recount} (${dir} by ${Math.abs(delta)})`);
      if (delta > 0) higher += delta;
      else lower += Math.abs(delta);
    }
  }

  for (const [u, count] of Object.entries(tally)) {
    if (!students.find(s => s.u === u)) {
      lines.push(`  (untracked poster @${u}): ${count} messages in history, not in dojo-data`);
    }
  }

  return { lines, higher, lower };
}

// Full reset: every student's field becomes the recounted total (0 if they have no
// messages in this channel's history). This is what "count fresh from the beginning"
// means — the unreliable legacy numbers are replaced outright.
function applyMessageTally(students, tally, field) {
  for (const s of students) s[field] = tally[s.u] || 0;
}

module.exports = { tallyMessagesByAuthor, reportMessageDiff, applyMessageTally };
