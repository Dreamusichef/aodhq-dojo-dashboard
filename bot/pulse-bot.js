'use strict';

/**
 * Dojo Pulse Bot
 * Automated daily/weekly/monthly activity digests for AODHQ
 * NO AI calls — pure data processing
 *
 * Env:
 *   DOJO_DRY_RUN=1 — skips channel.send and cron registration
 *   DOJO_TEST_MODE=1 — uses .dojo-test-config.json + test token/data (see README)
 */

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const cron = require('node-cron');
const path = require('path');
const { execFile } = require('child_process');

const { readJSON, loadDojoData } = require('../lib/data');
const { toSGT } = require('../lib/sgt');
const { formatMyStats } = require('../lib/digest');
const { createPulseOps } = require('../lib/pulse-ops');
const {
  getDiscordConfig,
  getDataPaths,
  isTestMode,
  loadBotToken,
  canRunTestCommand,
} = require('../lib/discord-config');

const paths = getDataPaths();
const discord = getDiscordConfig();
const DRY_RUN = process.env.DOJO_DRY_RUN === '1';
const ops = createPulseOps({ paths, discord, dryRun: DRY_RUN });

async function registerSlashCommands(client) {
  const commands = [
    // Public command — every member can check their own stats.
    // (Do NOT set default member permissions here; '0' would hide it from non-admins.)
    new SlashCommandBuilder()
      .setName('mystats')
      .setDescription('Check your personal Dojo stats — clips, rank, streak, and more'),
    // Admin-only: preview (private) or fire the milestone celebration.
    new SlashCommandBuilder()
      .setName('dojo-celebrate')
      .setDescription('Preview or fire the milestone celebration (admin only)')
      .addBooleanOption(o => o.setName('confirm').setDescription('Actually post to #announcements with @everyone'))
      .addIntegerOption(o => o.setName('milestone').setDescription('Milestone to celebrate (default: current 1,000 mark)'))
      .setDefaultMemberPermissions('0'),
  ];

  if (isTestMode()) {
    commands.push(
      new SlashCommandBuilder()
        .setName('dojo-scan')
        .setDescription('[Test] Run vps-scan.js against the test server')
        .setDefaultMemberPermissions('0'),
      new SlashCommandBuilder()
        .setName('dojo-digest')
        .setDescription('[Test] Post a digest to #dojo-pulse')
        .addStringOption(opt =>
          opt.setName('type')
            .setDescription('Digest type')
            .setRequired(true)
            .addChoices(
              { name: 'daily', value: 'daily' },
              { name: 'weekly', value: 'weekly' },
              { name: 'monthly', value: 'monthly' },
            ))
        .setDefaultMemberPermissions('0'),
      new SlashCommandBuilder()
        .setName('dojo-writeback')
        .setDescription('[Test] Live-fetch today\'s clips and write timestamps')
        .setDefaultMemberPermissions('0'),
    );
  }

  const rest = new REST({ version: '10' }).setToken(client.token);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, discord.guildId),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log(`[Slash] Registered ${commands.length} command(s) for guild ${discord.guildId}`);
  } catch (e) {
    console.error('[Slash] Failed to register:', e.message);
  }
}

function runScanScript() {
  return new Promise((resolve, reject) => {
    execFile(
      'node',
      [path.join(paths.workspace, 'vps-scan.js')],
      { cwd: paths.workspace, env: { ...process.env } },
      (err, stdout, stderr) => {
        if (stdout) console.log(stdout.trim());
        if (stderr) console.error(stderr.trim());
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

async function main() {
  const token = loadBotToken();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once('ready', async () => {
    const modeLabel = isTestMode() ? 'TEST MODE' : (DRY_RUN ? 'DRY RUN' : 'PRODUCTION');
    console.log(`Dojo Pulse online as ${client.user.tag} (${modeLabel})`);
    if (isTestMode()) {
      console.log(`Data dir: ${paths.dataDir}`);
    }

    const state = ops.loadState();
    const channel = await ops.ensureChannel(client, state);
    console.log(`Using channel: #${channel.name} (${channel.id})`);

    const enableCron = !DRY_RUN && !isTestMode();

    if (enableCron) {
      cron.schedule('0 15 * * *', async () => {
        try {
          const now = toSGT(new Date());
          const dayOfMonth = now.getDate();
          const dayOfWeek = now.getDay();

          console.log('[Digest] Running daily live fetch + writeback...');
          await ops.runDailyWriteback(client);

          if (dayOfMonth === 1) {
            console.log('[Digest] Monthly');
            await ops.runMonthly(channel);
          } else if (dayOfWeek === 0) {
            console.log('[Digest] Weekly');
            await ops.runWeekly(channel);
          } else {
            console.log('[Digest] Daily');
            await ops.runDaily(channel, client);
          }

          await ops.runMilestoneCheck(client);
        } catch (e) { console.error('[Digest error]', e); }
      }, { timezone: 'UTC' });

      cron.schedule('55 14 * * *', async () => {
        try {
          console.log('[Scan] Starting vps-scan.js...');
          await runScanScript();
        } catch (e) { console.error('[Scan error]', e.message); }
      }, { timezone: 'UTC' });

      console.log('Cron schedules active.');
      console.log('  22:55 SGT daily — scan (dashboard + rankings)');
      console.log('  23:00 SGT daily — monthly on 1st, weekly on Sundays, daily otherwise');
    } else if (isTestMode()) {
      console.log('[Test mode] Cron disabled. Use /dojo-scan, /dojo-digest, or npm run test:scan / test:digest.');
    } else {
      console.log('[DRY RUN] Cron schedules skipped.');
    }

    await registerSlashCommands(client);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'mystats') {
      try {
        const data = loadDojoData(paths.dataFile);
        const state = ops.loadState();
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
      return;
    }

    if (interaction.commandName === 'dojo-celebrate') {
      if (!interaction.memberPermissions || !interaction.memberPermissions.has('Administrator')) {
        await interaction.reply({ content: 'Admins only.', ephemeral: true });
        return;
      }
      try {
        const data = loadDojoData(paths.dataFile);
        const total = data.students.reduce((sum, s) => sum + (s.clips || 0), 0);
        const milestone = interaction.options.getInteger('milestone') || (Math.floor(total / 1000) * 1000) || 2000;
        const confirm = interaction.options.getBoolean('confirm');
        if (confirm) {
          await interaction.deferReply({ ephemeral: true });
          await ops.postCelebration(client, milestone, { ping: true });
          const st = ops.loadState();
          if ((st.last_milestone || 0) < milestone) { st.last_milestone = milestone; ops.saveState(st); }
          await interaction.editReply('🔥 Celebration for ' + milestone.toLocaleString() + ' posted to #announcements (with @everyone).');
        } else {
          const { content, imgPath, hasImage } = ops.buildCelebration(milestone);
          await interaction.reply({
            content: '**PREVIEW — only you can see this, no @everyone ping**\n\n@everyone\n\n' + content,
            files: hasImage ? [imgPath] : [],
            allowedMentions: { parse: [] },
            ephemeral: true,
          });
        }
      } catch (e) {
        console.error('[/dojo-celebrate error]', e.message);
        const m = 'Failed: ' + e.message;
        if (interaction.deferred || interaction.replied) await interaction.editReply(m).catch(() => {});
        else await interaction.reply({ content: m, ephemeral: true }).catch(() => {});
      }
      return;
    }

    if (!isTestMode()) return;

    if (!canRunTestCommand(interaction.user.id, interaction.memberPermissions, discord.allowlist)) {
      await interaction.reply({ content: 'You need Manage Server permission to run test commands.', ephemeral: true });
      return;
    }

    try {
      if (interaction.commandName === 'dojo-scan') {
        await interaction.reply({ content: 'Starting scan…', ephemeral: true });
        await runScanScript();
        await interaction.followUp({ content: 'Scan complete.', ephemeral: true }).catch(() => {});
        return;
      }

      if (interaction.commandName === 'dojo-writeback') {
        await interaction.deferReply({ ephemeral: true });
        await ops.runDailyWriteback(client);
        await interaction.editReply('Writeback complete.');
        return;
      }

      if (interaction.commandName === 'dojo-digest') {
        const type = interaction.options.getString('type');
        await interaction.deferReply({ ephemeral: true });
        const state = ops.loadState();
        const channel = await ops.ensureChannel(client, state);

        await ops.runDailyWriteback(client);

        if (type === 'weekly') {
          await ops.runWeekly(channel);
        } else if (type === 'monthly') {
          await ops.runMonthly(channel);
        } else {
          await ops.runDaily(channel, client);
        }

        await interaction.editReply(`${type} digest posted to #${channel.name}.`);
      }
    } catch (e) {
      console.error(`[/${interaction.commandName} error]`, e.message);
      const msg = `Failed: ${e.message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  });

  client.login(token);
}

main().catch(console.error);
