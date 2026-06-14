#!/usr/bin/env node
'use strict';
/**
 * dev/setup-test-discord.js
 * Bootstrap a private test Discord server for integration testing.
 *
 * Prerequisites:
 *   1. Create a separate Discord application + bot at https://discord.com/developers/applications
 *   2. Enable Message Content Intent on the bot
 *   3. Save token to .pulse-bot-token.test.json: { "token": "..." }
 *   4. Create a private server and invite the bot (Manage Channels, Send Messages, Read History)
 *
 * Usage:
 *   npm run test:setup -- --guild <your-test-guild-id>
 */
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');
const { readJSON, writeJSON } = require('../lib/data');
const { PROD_GUILD_ID } = require('../lib/discord-config');

const ROOT = path.join(__dirname, '..');
const TEST_TOKEN_FILE = path.join(ROOT, '.pulse-bot-token.test.json');
const TEST_CONFIG_FILE = path.join(ROOT, '.dojo-test-config.json');
const TEST_DATA_DIR = path.join(ROOT, 'dev', 'test-data');

const CHANNEL_SPECS = [
  { key: 'practiceVideos', name: 'practice-videos', topic: 'Post practice clips here for scan testing' },
  { key: 'theHall', name: 'the-hall', topic: 'Hall activity channel for scan testing' },
  { key: 'rankings', name: 'ninja-rankings', topic: 'Pinned ranking messages (edited by scan)' },
  { key: 'notify', name: 'clawdbot-notifications', topic: 'Scan notifications' },
  { key: 'pulse', name: 'dojo-pulse', topic: 'Digest output channel', pulsePermissions: true },
];

function parseGuildId() {
  const idx = process.argv.indexOf('--guild');
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error('Usage: npm run test:setup -- --guild <your-test-guild-id>');
    console.error('');
    console.error('Enable Developer Mode in Discord (Settings → Advanced), then right-click');
    console.error('your test server name → Copy Server ID.');
    process.exit(1);
  }
  return process.argv[idx + 1].trim();
}

function copyFixture(name) {
  return readJSON(path.join(ROOT, 'fixtures', name));
}

async function findOrCreateTextChannel(guild, spec) {
  await guild.channels.fetch();
  let channel = guild.channels.cache.find(
    c => c.name === spec.name && c.type === ChannelType.GuildText
  );

  if (channel) {
    console.log(`  #${spec.name} exists: ${channel.id}`);
    return channel;
  }

  const createOpts = {
    name: spec.name,
    type: ChannelType.GuildText,
    topic: spec.topic,
  };

  if (spec.pulsePermissions) {
    createOpts.permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.AddReactions,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
        deny: [PermissionsBitField.Flags.SendMessages],
      },
    ];
  }

  channel = await guild.channels.create(createOpts);
  console.log(`  Created #${spec.name}: ${channel.id}`);
  return channel;
}

async function main() {
  const guildId = parseGuildId();

  if (guildId === PROD_GUILD_ID) {
    console.error(`Refusing to bootstrap production guild ${PROD_GUILD_ID}. Use a private test server.`);
    process.exit(1);
  }

  if (!fs.existsSync(TEST_TOKEN_FILE)) {
    console.error(`Missing ${TEST_TOKEN_FILE}`);
    console.error('Create it with: { "token": "YOUR_TEST_BOT_TOKEN" }');
    process.exit(1);
  }

  const token = readJSON(TEST_TOKEN_FILE).token;
  if (!token) {
    console.error('No token field in .pulse-bot-token.test.json');
    process.exit(1);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    client.login(token).catch(reject);
  });

  console.log(`Logged in as ${client.user.tag}`);

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error(`Bot is not in guild ${guildId}. Invite the bot to your test server first.`);
    await client.destroy();
    process.exit(1);
  }

  console.log(`Setting up test server: ${guild.name} (${guild.id})`);
  console.log('Channels:');

  const channelIds = {};
  for (const spec of CHANNEL_SPECS) {
    const ch = await findOrCreateTextChannel(guild, spec);
    channelIds[spec.key] = ch.id;
  }

  const rankingsChannel = await client.channels.fetch(channelIds.rankings);
  console.log('Posting placeholder ranking messages…');

  const headerMsg = await rankingsChannel.send('_Rankings header — will be replaced by scan._');
  const geninMsg = await rankingsChannel.send('_Genin list — will be replaced by scan._');
  const footerMsg = await rankingsChannel.send('_Rankings footer — will be replaced by scan._');

  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  writeJSON(path.join(TEST_DATA_DIR, 'dojo-data.json'), copyFixture('dojo-data.sample.json'));
  writeJSON(path.join(TEST_DATA_DIR, 'dojo-state.json'), copyFixture('dojo-state.sample.json'));

  const pulseState = copyFixture('pulse-state.sample.json');
  pulseState.channelId = channelIds.pulse;
  writeJSON(path.join(TEST_DATA_DIR, 'pulse-state.json'), pulseState);

  writeJSON(path.join(TEST_DATA_DIR, 'ninja-rankings-state.json'), {
    channelId: channelIds.rankings,
    messages: {
      header: headerMsg.id,
      genin: geninMsg.id,
      footer: footerMsg.id,
    },
    gist: {
      previewUrl: 'https://example.com/test-dashboard',
    },
  });

  writeJSON(TEST_CONFIG_FILE, {
    guildId,
    dataDir: 'dev/test-data',
    channels: {
      practiceVideos: channelIds.practiceVideos,
      theHall: channelIds.theHall,
      rankings: channelIds.rankings,
      notify: channelIds.notify,
      pulseName: 'dojo-pulse',
    },
    allowlist: [],
  });

  await client.destroy();

  console.log('');
  console.log('Setup complete.');
  console.log('');
  console.log('Files written:');
  console.log(`  ${TEST_CONFIG_FILE}`);
  console.log(`  ${TEST_DATA_DIR}/dojo-data.json`);
  console.log(`  ${TEST_DATA_DIR}/dojo-state.json`);
  console.log(`  ${TEST_DATA_DIR}/pulse-state.json`);
  console.log(`  ${TEST_DATA_DIR}/ninja-rankings-state.json`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Confirm Message Content Intent is ON (Developer Portal → Bot → Privileged Gateway Intents)');
  console.log('  2. Edit dev/test-data/dojo-data.json — set each student "u" to a real Discord username');
  console.log('  3. Post test clips in #practice-videos from those accounts');
  console.log('  4. npm run test:scan');
  console.log('  5. npm run test:bot  (then try /mystats and /dojo-digest in Discord)');
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
