'use strict';

const { countClipsInMessage } = require('./clip-detection');

function tallyClipsFromMessages(messages) {
  const recount = {};
  for (const msg of messages) {
    if (msg.author && msg.author.bot) continue;
    const username = msg.author?.username;
    if (!username) continue;
    const n = countClipsInMessage(msg);
    if (n === 0) continue;
    recount[username] = (recount[username] || 0) + n;
  }
  return recount;
}

function reportRecountDiff(students, recount) {
  const lines = [];
  let inflated = 0;
  let deflated = 0;

  for (const s of students) {
    const correct = recount[s.u] || 0;
    const current = s.clips || 0;
    const delta = current - correct;
    if (delta !== 0) {
      const dir = delta > 0 ? 'inflated' : 'undercounted';
      lines.push(`  ${s.name} (@${s.u}): current=${current} recount=${correct} (${dir} by ${Math.abs(delta)})`);
      if (delta > 0) inflated += delta;
      else deflated += Math.abs(delta);
    }
  }

  for (const [u, count] of Object.entries(recount)) {
    if (!students.find(s => s.u === u)) {
      lines.push(`  (unknown poster @${u}): ${count} clips in history, not in dojo-data`);
    }
  }

  return { lines, inflated, deflated };
}

function applyRecountToStudents(students, recount, { full = false } = {}) {
  for (const s of students) {
    if (full) {
      s.clips = recount[s.u] || 0;
    } else if (recount[s.u] != null) {
      s.clips = recount[s.u];
    }
  }
}

function updateClipMeta(data) {
  data.meta = data.meta || {};
  data.meta.totalClips = data.students.reduce((sum, x) => sum + (x.clips || 0), 0);
  data.meta.lastUpdated = new Date().toISOString();
}

module.exports = {
  tallyClipsFromMessages,
  reportRecountDiff,
  applyRecountToStudents,
  updateClipMeta,
};
