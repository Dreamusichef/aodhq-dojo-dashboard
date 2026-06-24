'use strict';

const BPM_INCLUDE = /interval|ramp|core|routine|endurance|bpm/i;
const BPM_EXCLUDE = /floor|heel\s*down|heel\s*up|\bhip\b|upper\s*leg/i;
const BPM_FAIL_TITLE = /fail/i;
const BPM_NUMBER = /(\d{2,3})\s*bpm/gi;

function extractBpm(msg) {
  if (!msg.embeds || msg.embeds.length === 0) return null;

  const candidates = [];

  for (const e of msg.embeds) {
    const title = e.title || '';
    if (!title) continue;
    if (BPM_FAIL_TITLE.test(title)) continue;

    if (!BPM_NUMBER.test(title)) continue;
    BPM_NUMBER.lastIndex = 0;

    if (!BPM_INCLUDE.test(title)) continue;
    if (BPM_EXCLUDE.test(title)) continue;

    let m;
    while ((m = BPM_NUMBER.exec(title)) !== null) {
      const v = parseInt(m[1], 10);
      if (v >= 40 && v <= 400) candidates.push(v);
    }
  }

  return candidates.length > 0 ? Math.max(...candidates) : null;
}

module.exports = {
  BPM_INCLUDE,
  BPM_EXCLUDE,
  BPM_FAIL_TITLE,
  BPM_NUMBER,
  extractBpm,
};
