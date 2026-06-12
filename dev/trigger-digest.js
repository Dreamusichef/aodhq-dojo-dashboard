#!/usr/bin/env node
'use strict';
/**
 * dev/trigger-digest.js
 * One-shot digest post against the test Discord server.
 *
 * Usage:
 *   npm run test:digest -- --daily
 *   npm run test:digest -- --weekly
 *   npm run test:digest -- --monthly
 *
 * Requires DOJO_TEST_MODE=1 (set by npm script) and .dojo-test-config.json from test:setup.
 */
const path = require('path');
module.paths.unshift(path.join(__dirname, '..', 'bot', 'node_modules'));
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const { createPulseOps } = require('../lib/pulse-ops');
const {
  getDiscordConfig,
  getDataPaths,
  loadBotToken,
} = require('../lib/discord-config');

if (process.env.DOJO_TEST_MODE !== '1') {
  console.error('Set DOJO_TEST_MODE=1 (use npm run test:digest).');
  process.exit(1);
}

const mode = process.argv.includes('--monthly') ? 'monthly'
  : process.argv.includes('--weekly') ? 'weekly'
  : 'daily';

const paths = getDataPaths();
const discord = getDiscordConfig();
const ops = createPulseOps({ paths, discord, dryRun: false });

async function main() {
  const token = loadBotToken();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    client.login(token).catch(reject);
  });

  console.log(`Triggering ${mode} digest (test mode)`);

  const state = ops.loadState();
  const channel = await ops.ensureChannel(client, state);

  await ops.runDailyWriteback(client);

  if (mode === 'weekly') {
    await ops.runWeekly(channel);
  } else if (mode === 'monthly') {
    await ops.runMonthly(channel);
  } else {
    await ops.runDaily(channel, client);
  }

  console.log(`Posted ${mode} digest to #${channel.name}`);
  await client.destroy();
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
