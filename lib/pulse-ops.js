'use strict';

const fs = require('fs');
// discord.js is required lazily inside ensureChannel (the only consumer) so that the
// rest of this module — digest builders, milestone logic — can be unit-tested at the
// repo root, where discord.js only resolves via bot/register-deps.js (see ecosystem.config.js).
const { readJSON, writeJSON, loadDojoData, writeBackClipTimestamps } = require('./data');
const { countClipsInMessage, isClipMessage, extractClipLinks } = require('./clip-detection');
const { computeStreaks } = require('./streaks');
const {
  buildDailyMessage,
  buildWeeklyMessage,
  buildMonthlyMessage,
  updatePreviousRanks,
} = require('./digest');
const { clipsThisWeek, getTodayWindow, getReportingDayWindow } = require('./clips-period');
const { milestoneFor, buildCelebrationMessage } = require('./milestone');

function createPulseOps({ paths, discord, dryRun = false }) {
  const { dataFile, pulseStateFile } = paths;
  const { channels, guildId } = discord;
  const practiceChannelId = channels.practiceVideos;
  const pulseChannelName = channels.pulseName;

  function loadState() {
    if (!fs.existsSync(pulseStateFile)) {
      return {
        channelId: null,
        streaks: {},
        previous_ranks: {},
        last_daily: null,
        last_weekly: null,
        last_monthly: null,
      };
    }
    return readJSON(pulseStateFile);
  }

  function saveState(state) {
    writeJSON(pulseStateFile, state);
  }

  async function fetchLiveClips(client, students, cutoffStart, cutoffEnd) {
    console.log(`[Live fetch] Window: ${cutoffStart.toISOString()} → ${cutoffEnd.toISOString()}`);

    const channel = await client.channels.fetch(practiceChannelId);
    const allMessages = [];
    let before = undefined;

    while (true) {
      const options = { limit: 100 };
      if (before) options.before = before;
      const batch = await channel.messages.fetch(options);
      if (batch.size === 0) break;

      let oldestTimestamp = Infinity;
      for (const [, msg] of batch) {
        const ts = msg.createdAt.getTime();
        if (ts < oldestTimestamp) oldestTimestamp = ts;
        if (msg.createdAt >= cutoffStart && msg.createdAt < cutoffEnd) {
          allMessages.push(msg);
        }
      }

      if (oldestTimestamp < cutoffStart.getTime()) break;

      let oldestId = null;
      for (const [id, msg] of batch) {
        if (msg.createdAt.getTime() === oldestTimestamp) { oldestId = id; break; }
      }
      before = oldestId;
      if (batch.size < 100) break;
    }

    const clips = allMessages.filter(isClipMessage);

    const nameMap = {};
    for (const s of students) nameMap[s.u] = s.name;

    const byAuthor = {};
    const clipTimestamps = [];
    for (const clip of clips) {
      const username = clip.author.username;
      const displayName = nameMap[username] || clip.author.globalName || clip.author.username;
      if (!byAuthor[username]) {
        byAuthor[username] = { name: displayName, username, count: 0, timestamps: [] };
      }
      const clipCount = countClipsInMessage(clip);
      byAuthor[username].count += clipCount;
      for (let i = 0; i < clipCount; i++) {
        const ts = new Date(clip.createdAt.getTime() + i).toISOString();
        byAuthor[username].timestamps.push(ts);
        clipTimestamps.push({ username, timestamp: ts });
      }
    }

    const result = {
      posters: Object.values(byAuthor).sort((a, b) => b.count - a.count),
      totalClips: clipTimestamps.length,
      ninjaCount: Object.keys(byAuthor).length,
      clipTimestamps,
    };

    console.log(`[Live fetch] Found ${result.totalClips} clips from ${result.ninjaCount} ninjas`);
    return result;
  }

  // READ-ONLY fetch for /feedback: practice-video messages in [since, until), each as
  // { username, createdAtMs, links }. Reuses the same channel + clip detection as the
  // counter (isClipMessage / extractClipLinks); does not touch fetchLiveClips or counts.
  async function fetchFeedbackClips(client, since, until) {
    const MAX_PAGES = 200; // ~20k messages — safety backstop so a stale marker can't outrun the interaction
    const channel = await client.channels.fetch(practiceChannelId);
    const records = [];
    let before;
    let pages = 0;

    while (true) {
      const options = { limit: 100 };
      if (before) options.before = before;
      const batch = await channel.messages.fetch(options);
      if (batch.size === 0) break;

      let oldestTs = Infinity;
      let oldestId = null;
      for (const [id, msg] of batch) {
        const ts = msg.createdAt.getTime();
        if (ts < oldestTs) { oldestTs = ts; oldestId = id; }
        if (msg.author && msg.author.bot) continue;
        if (msg.createdAt >= since && msg.createdAt < until && isClipMessage(msg)) {
          records.push({
            username: msg.author.username,
            createdAtMs: ts,
            links: extractClipLinks(msg),
          });
        }
      }

      if (oldestTs < since.getTime()) break;
      before = oldestId;
      if (batch.size < 100) break;
      if (++pages >= MAX_PAGES) {
        console.warn(`[feedback] fetchFeedbackClips hit MAX_PAGES (${MAX_PAGES}); returning partial results. Run /feedback done to advance the marker.`);
        break;
      }
    }

    return records;
  }

  async function ensureChannel(client, state) {
    const { PermissionsBitField, ChannelType } = require('discord.js');
    if (state.channelId) {
      try {
        const ch = await client.channels.fetch(state.channelId);
        if (ch) return ch;
      } catch (e) {
        console.log('Stored channel not found, searching/creating...');
      }
    }

    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();

    let channel = guild.channels.cache.find(
      c => c.name === pulseChannelName && c.type === ChannelType.GuildText
    );

    if (!channel) {
      const infoCategory = guild.channels.cache.find(
        c => c.name === 'Information' && c.type === ChannelType.GuildCategory
      );

      channel = await guild.channels.create({
        name: pulseChannelName,
        type: ChannelType.GuildText,
        parent: infoCategory ? infoCategory.id : null,
        topic: 'Automated daily, weekly and monthly activity digests — posted by Dojo Pulse',
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.AddReactions,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
            deny: [PermissionsBitField.Flags.SendMessages],
          },
        ],
      });
      console.log(`Created #${pulseChannelName}: ${channel.id}`);
    }

    state.channelId = channel.id;
    saveState(state);
    return channel;
  }

  async function sendDigest(channel, msg, { mentionEveryone = false } = {}) {
    if (dryRun) {
      console.log('[DRY RUN] Would send digest:', msg.slice(0, 200));
      return;
    }
    if (mentionEveryone) {
      await channel.send({ content: msg, allowedMentions: { parse: ['everyone'] } });
    } else {
      await channel.send(msg);
    }
  }

  async function runDailyWriteback(client) {
    const data = loadDojoData(dataFile);
    const students = data.students;
    try {
      const { cutoffStart, cutoffEnd } = getReportingDayWindow();
      const liveData = await fetchLiveClips(client, students, cutoffStart, cutoffEnd);
      if (liveData) writeBackClipTimestamps(liveData, dataFile);
    } catch (e) {
      console.error('[Daily writeback failed]', e.message);
    }
  }

  async function runDaily(channel, client) {
    const data = loadDojoData(dataFile);
    const state = loadState();
    const students = data.students;

    let liveData = null;
    try {
      const { cutoffStart, cutoffEnd } = getReportingDayWindow();
      liveData = await fetchLiveClips(client, students, cutoffStart, cutoffEnd);
    } catch (e) {
      console.error('[Live fetch failed, falling back to clip_timestamps]', e.message);
    }

    if (liveData) writeBackClipTimestamps(liveData, dataFile);

    state.streaks = computeStreaks(students, state.streaks || {});

    const msg = buildDailyMessage(students, state, liveData);
    await sendDigest(channel, msg);

    updatePreviousRanks(students, state);
    state.last_daily = new Date().toISOString();
    saveState(state);
    console.log(`[Daily] sent at ${state.last_daily}`);
  }

  async function runWeekly(channel) {
    const data = loadDojoData(dataFile);
    const state = loadState();
    const students = data.students;

    state.streaks = computeStreaks(students, state.streaks || {});

    const msg = '@everyone\n' + buildWeeklyMessage(students, state);
    await sendDigest(channel, msg, { mentionEveryone: true });

    const thisWeekClips = students.reduce((sum, s) => sum + clipsThisWeek(s.clip_timestamps), 0);
    state.last_weekly_clips = thisWeekClips;

    updatePreviousRanks(students, state);
    state.last_weekly = new Date().toISOString();
    saveState(state);
    console.log(`[Weekly] sent at ${state.last_weekly}`);
  }

  async function runMonthly(channel) {
    const data = loadDojoData(dataFile);
    const state = loadState();
    const students = data.students;

    state.streaks = computeStreaks(students, state.streaks || {});

    const msg = '@everyone\n' + buildMonthlyMessage(students, state);
    await sendDigest(channel, msg, { mentionEveryone: true });

    updatePreviousRanks(students, state);
    state.last_monthly = new Date().toISOString();
    saveState(state);
    console.log(`[Monthly] sent at ${state.last_monthly}`);
  }

  function buildCelebration(milestone) {
    const data = loadDojoData(dataFile);
    return { content: buildCelebrationMessage(data.students, milestone) };
  }

  // Ping the dojo owner in #clawdbot-notifications with the ready-to-paste celebration so
  // they post it themselves (from their own account) in #announcements with their image.
  // The @everyone inside the code block is inert; only the owner is mentioned.
  async function pingMilestone(client, milestone) {
    const { content } = buildCelebration(milestone);
    let ownerId = null;
    try { const guild = await client.guilds.fetch(guildId); ownerId = guild.ownerId; } catch (e) {}
    const heads = (ownerId ? '<@' + ownerId + '> ' : '') +
      '🏯 The dojo just crossed **' + milestone.toLocaleString() + '** clips! Copy the message below and post it to #announcements with your feast image:';
    if (dryRun) { console.log('[DRY RUN] Would ping owner for milestone', milestone); return; }
    if (!channels.notify) throw new Error('no notify channel configured (channels.notify)');
    const channel = await client.channels.fetch(channels.notify);
    if (!channel || typeof channel.send !== 'function') {
      throw new Error('notify channel ' + channels.notify + ' not found or not sendable');
    }
    await channel.send({
      content: heads + '\n\n```\n@everyone\n\n' + content + '\n```',
      allowedMentions: { parse: [], users: ownerId ? [ownerId] : [] },
    });
  }

  // Auto-detector: fires ONCE when the dojo total crosses a new 1,000 boundary (>= 2,000).
  // The bot never posts publicly — it pings the owner with the ready-to-paste message; the
  // owner posts the celebration manually. The digest itself carries a subtle flourish.
  async function runMilestoneCheck(client) {
    const data = loadDojoData(dataFile);
    const total = data.students.reduce((sum, s) => sum + (s.clips || 0), 0);
    const state = loadState();
    const m = milestoneFor(total);
    if (m < 2000 || m <= (state.last_milestone || 0)) return;

    // Record the milestone as handled even if the owner-ping fails. The ping is a
    // best-effort side effect; the digest's "crossed N today" flourish is gated on
    // last_milestone, so coupling the disarm to a fallible Discord send caused the
    // flourish to repeat every night (the 2,000 bug). /dojo-celebrate can re-surface
    // the paste-ready message on demand if the ping didn't land.
    try {
      await pingMilestone(client, m);
      console.log('[Milestone] ' + m + ' crossed — owner pinged in #clawdbot-notifications.');
    } catch (e) {
      console.error('[Milestone] ' + m + ' crossed but owner ping FAILED:', e && e.message);
      console.error('[Milestone] Run /dojo-celebrate to get the paste-ready celebration message.');
    }
    state.last_milestone = m;
    saveState(state);
  }

  return {
    loadState,
    saveState,
    getTodayWindow,
    fetchLiveClips,
    fetchFeedbackClips,
    ensureChannel,
    sendDigest,
    runDailyWriteback,
    runDaily,
    runWeekly,
    runMonthly,
    buildCelebration,
    pingMilestone,
    runMilestoneCheck,
  };
}

module.exports = { createPulseOps };
