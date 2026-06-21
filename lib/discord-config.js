'use strict';

const fs = require('fs');
const path = require('path');

const PROD_GUILD_ID = '1343785579829137529';

const PROD_CHANNELS = {
  practiceVideos: '1356110369818411131',
  theHall: '1347383072303091823',
  rankings: '1488189728913096744',
  notify: '1487429631866044568',
  announcements: '1343785602771980340',
  pulseName: 'dojo-pulse',
};

function getWorkspace() {
  return path.resolve(__dirname, '..');
}

function isTestMode() {
  return process.env.DOJO_TEST_MODE === '1';
}

function loadTestConfigFile() {
  const configPath = path.join(getWorkspace(), '.dojo-test-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'DOJO_TEST_MODE=1 requires .dojo-test-config.json. Run: npm run test:setup -- --guild <your-guild-id>'
    );
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
}

function assertTestGuildSafe(guildId) {
  if (guildId === PROD_GUILD_ID) {
    throw new Error(
      `Refusing test mode with production guild ID ${PROD_GUILD_ID}. Use a private test server.`
    );
  }
}

function getDiscordConfig() {
  if (!isTestMode()) {
    return {
      guildId: PROD_GUILD_ID,
      channels: { ...PROD_CHANNELS },
      allowlist: [],
    };
  }

  const test = loadTestConfigFile();
  assertTestGuildSafe(test.guildId);

  return {
    guildId: test.guildId,
    channels: {
      practiceVideos: test.channels.practiceVideos,
      theHall: test.channels.theHall,
      rankings: test.channels.rankings,
      notify: test.channels.notify || null,
      pulseName: test.channels.pulseName || PROD_CHANNELS.pulseName,
    },
    allowlist: Array.isArray(test.allowlist) ? test.allowlist : [],
  };
}

function getDataPaths() {
  const workspace = getWorkspace();

  if (!isTestMode()) {
    return {
      workspace,
      dataDir: workspace,
      dataFile: path.join(workspace, 'dojo-data.json'),
      dojoStateFile: path.join(workspace, 'dojo-state.json'),
      pulseStateFile: path.join(workspace, 'pulse-state.json'),
      rankingsStateFile: path.join(workspace, 'ninja-rankings-state.json'),
      rankingsUpdateFile: path.join(workspace, 'ninja-rankings-update.json'),
      dashboardHtmlFile: path.join(workspace, 'dojo-dashboard.html'),
      tokenFile: path.join(workspace, '.pulse-bot-token.json'),
    };
  }

  const test = loadTestConfigFile();
  const dataDir = path.resolve(workspace, test.dataDir || 'dev/test-data');

  return {
    workspace,
    dataDir,
    dataFile: path.join(dataDir, 'dojo-data.json'),
    dojoStateFile: path.join(dataDir, 'dojo-state.json'),
    pulseStateFile: path.join(dataDir, 'pulse-state.json'),
    rankingsStateFile: path.join(dataDir, 'ninja-rankings-state.json'),
    rankingsUpdateFile: path.join(dataDir, 'ninja-rankings-update.json'),
    dashboardHtmlFile: path.join(dataDir, 'dojo-dashboard.html'),
    tokenFile: path.join(workspace, '.pulse-bot-token.test.json'),
  };
}

function loadBotToken() {
  const { tokenFile } = getDataPaths();
  if (!fs.existsSync(tokenFile)) {
    throw new Error(`Bot token file not found: ${tokenFile}`);
  }
  return JSON.parse(fs.readFileSync(tokenFile, 'utf8').replace(/^\uFEFF/, '')).token;
}

function loadRankingsMessageIds() {
  const { rankingsStateFile } = getDataPaths();
  if (!fs.existsSync(rankingsStateFile)) {
    throw new Error(`Rankings state file not found: ${rankingsStateFile}`);
  }
  const state = JSON.parse(fs.readFileSync(rankingsStateFile, 'utf8').replace(/^\uFEFF/, ''));
  const messages = state.messages || {};
  return {
    channelId: state.channelId,
    header: messages.header,
    genin: messages.genin,
    footer: messages.footer,
  };
}

function canRunTestCommand(userId, memberPermissions, allowlist) {
  if (allowlist.length > 0) {
    return allowlist.includes(userId);
  }
  return memberPermissions && memberPermissions.has('ManageGuild');
}

module.exports = {
  PROD_GUILD_ID,
  PROD_CHANNELS,
  getWorkspace,
  isTestMode,
  getDiscordConfig,
  getDataPaths,
  loadBotToken,
  loadRankingsMessageIds,
  canRunTestCommand,
};
