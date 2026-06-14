'use strict';

const { countClipsInMessage } = require('./clip-detection');
const { extractBpm } = require('./bpm-extract');

/**
 * Process practice-video messages against a student list (shared by vps-scan and dev fixtures).
 * Mutates students in place. Returns summary of changes.
 */
async function processPracticeVideoMessages(students, messages, { onNewStudent = null } = {}) {
  const summary = {
    clipAdds: [],
    bpmUpdates: [],
    newStudents: [],
  };

  const sorted = messages.slice().sort((a, b) => a.id.localeCompare(b.id));

  for (const msg of sorted) {
    const username = msg.author.username;
    if (msg.author.bot) continue;

    const n = countClipsInMessage(msg);
    if (n === 0) continue;

    let student = students.find(s => s.u === username);
    if (!student) {
      const displayName = msg.author.global_name || msg.author.username;
      student = {
        u: username,
        name: displayName,
        clips: 0,
        clip_timestamps: [],
        active: true,
        lastActivity: null,
        startBpm: 80,
      };
      students.push(student);
      summary.newStudents.push({ username, displayName });
      if (onNewStudent) await onNewStudent(displayName, username);
    }

    student.active = true;
    student.lastActivity = msg.timestamp;

    if (!student.clip_timestamps) student.clip_timestamps = [];
    const baseTs = new Date(msg.timestamp).getTime();
    let added = 0;
    for (let i = 0; i < n; i++) {
      const ts = new Date(baseTs + i).toISOString();
      if (!student.clip_timestamps.includes(ts)) {
        student.clip_timestamps.push(ts);
        added++;
      }
    }
    // Count only newly-recorded clips. If the pulse writeback already logged this
    // clip's timestamp (and reconcileClips bumped clips to match), re-seeing the
    // same message on a later scan must not increment clips again.
    student.clips = (student.clips || 0) + added;

    if (added > 0) {
      summary.clipAdds.push({ username, name: student.name, added, total: student.clips });
    }

    const bpm = extractBpm(msg);
    if (bpm !== null) {
      const prevHigh = student.highBpm || student.startBpm || 0;
      student.currentBpm = bpm;
      if (bpm > prevHigh) student.highBpm = bpm;
      summary.bpmUpdates.push({ username, name: student.name, bpm, peak: student.highBpm });
    }
  }

  return summary;
}

function processHallMessages(students, messages) {
  const summary = { hallAdds: [] };
  const sorted = messages.slice().sort((a, b) => a.id.localeCompare(b.id));

  for (const msg of sorted) {
    const username = msg.author.username;
    if (msg.author.bot) continue;
    const student = students.find(s => s.u === username);
    if (!student) continue;
    student.hallCount = (student.hallCount || 0) + 1;
    summary.hallAdds.push({ username, name: student.name, total: student.hallCount });
  }

  return summary;
}

module.exports = {
  processPracticeVideoMessages,
  processHallMessages,
};
