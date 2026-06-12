'use strict';

const { countClipsInMessage, isClipMessage } = require('./clip-detection');

/**
 * Simulate pulse-bot fetchLiveClips() from fixture/rest messages (no Discord client).
 */
function simulateLiveClips(messages, students, cutoffStart, cutoffEnd) {
  const nameMap = {};
  for (const s of students) nameMap[s.u] = s.name;

  const inWindow = messages.filter(msg => {
    const ts = new Date(msg.timestamp);
    return ts >= cutoffStart && ts < cutoffEnd && isClipMessage(msg);
  });

  const byAuthor = {};
  const clipTimestamps = [];

  for (const clip of inWindow) {
    const username = clip.author.username;
    const displayName = nameMap[username] || clip.author.global_name || clip.author.username;
    if (!byAuthor[username]) {
      byAuthor[username] = { name: displayName, username, count: 0, timestamps: [] };
    }
    const clipCount = countClipsInMessage(clip);
    byAuthor[username].count += clipCount;
    for (let i = 0; i < clipCount; i++) {
      const ts = new Date(new Date(clip.timestamp).getTime() + i).toISOString();
      byAuthor[username].timestamps.push(ts);
      clipTimestamps.push({ username, timestamp: ts });
    }
  }

  return {
    posters: Object.values(byAuthor).sort((a, b) => b.count - a.count),
    totalClips: clipTimestamps.length,
    ninjaCount: Object.keys(byAuthor).length,
    clipTimestamps,
  };
}

function getTodayWindow() {
  const now = new Date();
  const todayCutoff = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15, 0, 0
  ));
  const cutoffEnd = (now.getTime() >= todayCutoff.getTime())
    ? todayCutoff
    : new Date(todayCutoff.getTime() - 86400000);
  const cutoffStart = new Date(cutoffEnd.getTime() - 86400000);
  return { cutoffStart, cutoffEnd };
}

module.exports = {
  simulateLiveClips,
  getTodayWindow,
};
