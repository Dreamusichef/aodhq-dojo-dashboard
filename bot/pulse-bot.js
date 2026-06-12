'use strict';

/**
 * Dojo Pulse Bot
 * Automated daily/weekly/monthly activity digests for AODHQ
 * NO AI calls — pure data processing
 *
 * Env: DOJO_DRY_RUN=1 skips channel.send and cron registration (local dev).
 */

const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const { readJSON, writeJSON, loadDojoData, writeBackClipTimestamps } = require('../lib/data');
const { countClipsInMessage, isClipMessage } = require('../lib/clip-detection');
const { toSGT } = require('../lib/sgt');
const { computeStreaks } = require('../lib/streaks');
const {
  buildDailyMessage,
  buildWeeklyMessage,
  buildMonthlyMessage,
  formatMyStats,
  updatePreviousRanks,
} = require('../lib/digest');
const { clipsThisWeek } = require('../lib/clips-period');

const WORKSPACE = path.resolve(__dirname, '..');
const TOKEN_FILE = path.join(WORKSPACE, '.pulse-bot-token.json');
const DATA_FILE = path.join(WORKSPACE, 'dojo-data.json');
const STATE_FILE = path.join(WORKSPACE, 'pulse-state.json');

const GUILD_ID = '1343785579829137529';
const CHANNEL_NAME = 'dojo-pulse';
const PRACTICE_CHANNEL_ID = '1356110369818411131';
const DRY_RUN = process.env.DOJO_DRY_RUN === '1';

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      channelId: null,
      streaks: {},
      previous_ranks: {},
      last_daily: null,
      last_weekly: null,
      last_monthly: null,
    };
  }
  return readJSON(STATE_FILE);
}

function saveState(state) {
  writeJSON(STATE_FILE, state);
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

async function fetchLiveClips(client, students, cutoffStart, cutoffEnd) {
  console.log(`[Live fetch] Window: ${cutoffStart.toISOString()} → ${cutoffEnd.toISOString()}`);

  const channel = await client.channels.fetch(PRACTICE_CHANNEL_ID);
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

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();

  let channel = guild.channels.cache.find(c => c.name === CHANNEL_NAME && c.type === ChannelType.GuildText);

  if (!channel) {
    const infoCategory = guild.channels.cache.find(
      c => c.name === 'Information' && c.type === ChannelType.GuildCategory
    );

    channel = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: infoCategory ? infoCategory.id : null,
      topic: 'Automated daily, weekly and monthly activity digests — posted by Dojo Pulse 🥷',
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.ReadMessageHistory],
          deny: [PermissionsBitField.Flags.SendMessages],
        },
      ],
    });
    console.log(`Created #${CHANNEL_NAME}: ${channel.id}`);
  }

  state.channelId = channel.id;
  saveState(state);
  return channel;
}

async function sendDigest(channel, msg, { mentionEveryone = false } = {}) {
  if (DRY_RUN) {
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
  const data = loadDojoData(DATA_FILE);
  const students = data.students;
  try {
    const { cutoffStart, cutoffEnd } = getTodayWindow();
    const liveData = await fetchLiveClips(client, students, cutoffStart, cutoffEnd);
    if (liveData) writeBackClipTimestamps(liveData, DATA_FILE);
  } catch (e) {
    console.error('[Daily writeback failed]', e.message);
  }
}

async function runDaily(channel, client) {
  const data = loadDojoData(DATA_FILE);
  const state = loadState();
  const students = data.students;

  let liveData = null;
  try {
    const { cutoffStart, cutoffEnd } = getTodayWindow();
    liveData = await fetchLiveClips(client, students, cutoffStart, cutoffEnd);
  } catch (e) {
    console.error('[Live fetch failed, falling back to clip_timestamps]', e.message);
  }

  if (liveData) writeBackClipTimestamps(liveData, DATA_FILE);

  state.streaks = computeStreaks(students, state.streaks || {});

  const msg = buildDailyMessage(students, state, liveData);
  await sendDigest(channel, msg);

  updatePreviousRanks(students, state);
  state.last_daily = new Date().toISOString();
  saveState(state);
  console.log(`[Daily] sent at ${state.last_daily}`);
}

async function runWeekly(channel) {
  const data = loadDojoData(DATA_FILE);
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
  const data = loadDojoData(DATA_FILE);
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

async function registerSlashCommands(client) {
  const command = new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('Check your personal Dojo stats — clips, rank, streak, and more')
    .setDefaultMemberPermissions('0');

  const rest = new REST({ version: '10' }).setToken(client.token);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: [command.toJSON()] }
    );
    console.log('[Slash] /mystats registered');
  } catch (e) {
    console.error('[Slash] Failed to register:', e.message);
  }
}

async function main() {
  const tokenData = readJSON(TOKEN_FILE);
  const token = tokenData.token;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  client.once('ready', async () => {
    console.log(`Dojo Pulse online as ${client.user.tag}${DRY_RUN ? ' (DRY RUN)' : ''}`);

    const state = loadState();
    const channel = await ensureChannel(client, state);
    console.log(`Using channel: #${channel.name} (${channel.id})`);

    if (!DRY_RUN) {
      cron.schedule('0 15 * * *', async () => {
        try {
          const now = toSGT(new Date());
          const dayOfMonth = now.getDate();
          const dayOfWeek = now.getDay();

          console.log('[Digest] Running daily live fetch + writeback...');
          await runDailyWriteback(client);

          if (dayOfMonth === 1) {
            console.log('[Digest] Monthly');
            await runMonthly(channel);
          } else if (dayOfWeek === 0) {
            console.log('[Digest] Weekly');
            await runWeekly(channel);
          } else {
            console.log('[Digest] Daily');
            await runDaily(channel, client);
          }
        } catch (e) { console.error('[Digest error]', e); }
      }, { timezone: 'UTC' });

      cron.schedule('55 14 * * *', async () => {
        try {
          console.log('[Scan] Starting vps-scan.js...');
          const { execFile } = require('child_process');
          await new Promise((res, rej) => {
            execFile('node', [path.join(WORKSPACE, 'vps-scan.js')], { cwd: WORKSPACE }, (err, stdout, stderr) => {
              if (stdout) console.log(stdout.trim());
              if (stderr) console.error(stderr.trim());
              if (err) rej(err); else res();
            });
          });
        } catch (e) { console.error('[Scan error]', e.message); }
      }, { timezone: 'UTC' });

      await registerSlashCommands(client);

      console.log('Cron schedules active.');
      console.log('  22:55 SGT daily — scan (dashboard + rankings)');
      console.log('  23:00 SGT daily — monthly on 1st, weekly on Sundays, daily otherwise');
    } else {
      console.log('[DRY RUN] Cron schedules and slash command registration skipped.');
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'mystats') return;

    try {
      const data = loadDojoData(DATA_FILE);
      const state = loadState();
      const students = data.students;
      const dojoTotal = students.reduce((sum, s) => sum + (s.clips || 0), 0);

      const username = interaction.user.username;
      const student = students.find(s => s.u === username);

      const response = formatMyStats(student, state, dojoTotal);
      await interaction.reply({ content: response, ephemeral: true });
    } catch (e) {
      console.error('[/mystats error]', e.message);
      await interaction.reply({ content: 'Something went wrong. Try again later.', ephemeral: true }).catch(() => {});
    }
  });

  client.login(token);
}

main().catch(console.error);
