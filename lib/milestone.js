'use strict';

// Personal note from Wei Lung, included in every milestone celebration message.
const PERSONAL_LINE =
  "I'm so appreciative that all of you from so many parts of the world have gathered here in " +
  "pursuit of the passion of double bass drumming. It's my honour to keep providing for everyone " +
  "here in the best way possible. Thank you for making this Dojo so vibrant and inspiring for " +
  "everyone. Don't stop dreaming, and don't stop drumming!\n— Wei Lung";

// The 1,000-clip milestone a total currently sits at (0, 1000, 2000, ...).
function milestoneFor(total) {
  return Math.floor((total || 0) / 1000) * 1000;
}

// The just-crossed milestone (>= 2000) if total has passed a new 1,000 boundary beyond `last`, else null.
function reachedMilestone(total, last) {
  const m = milestoneFor(total);
  return (m >= 2000 && m > (last || 0)) ? m : null;
}

// The ready-to-paste celebration message (markdown). @everyone is added by the caller.
function buildCelebrationMessage(students, milestone, personalLine = PERSONAL_LINE) {
  const active = students.filter(s => (s.clips || 0) > 0);
  const countries = new Set(active.map(s => String(s.loc || '').trim()).filter(Boolean)).size;
  const top = active.slice().sort((a, b) => (b.clips || 0) - (a.clips || 0)).slice(0, 10);

  const lines = [
    '🔥 **The Dojo Hits ' + milestone.toLocaleString() + ' — Mission Accomplished** 🔥',
    '',
    '**' + active.length + ' ninjas across ' + countries + ' countries**, built one good rep at a time. Tonight, the Forge feasts. 🍖🥁',
    '',
    '🏆 **Led by the top 10**',
  ];
  top.forEach((s, i) => lines.push((i + 1) + '. ' + s.name + ' — ' + s.clips));
  lines.push('');
  lines.push('🏯 **Next summit: ' + (milestone + 1000).toLocaleString() + '.**');
  if (personalLine) { lines.push(''); lines.push(personalLine); }
  return lines.join('\n');
}

module.exports = { PERSONAL_LINE, milestoneFor, reachedMilestone, buildCelebrationMessage };
