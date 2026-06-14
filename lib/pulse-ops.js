'use strict';

const fs = require('fs');
const { PermissionsBitField, ChannelType } = require('discord.js');
const { readJSON, writeJSON, loadDojoData, writeBackClipTimestamps } = require('./data');
const { countClipsInMessage, isClipMessage } = require('./clip-detection');
const { computeStreaks } = require('./streaks');
const {
  buildDailyMessage,
  buildWeeklyMessage,
  buildMonthlyMessage,
  updatePreviousRanks,
} = require('./digest');
const { clipsThisWeek, getTodayWindow } = require('./clips-period');

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

  async function ensureChannel(client, state) {
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
      const { cutoffStart, cutoffEnd } = getTodayWindow();
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
      const { cutoffStart, cutoffEnd } = getTodayWindow();
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

  return {
    loadState,
    saveState,
    getTodayWindow,
    fetchLiveClips,
    ensureChannel,
    sendDigest,
    runDailyWriteback,
    runDaily,
    runWeekly,
    runMonthly,
  };
}

module.exports = { createPulseOps };
