'use strict';
/**
 * vps-scan.js — Dojo Daily Scan (VPS edition, no AI)
 * Runs at 22:55 SGT via node-cron on the VPS.
 * - Reads new messages from #practice-videos and #the-hall
 * - Updates dojo-data.json (clip counts, hall counts, lastActivity)
 * - Runs dojo-dashboard-gen.js (pushes GitHub Pages)
 * - Runs ninja-rankings-gen.js + edits #ninja-rankings messages via Discord API
 * - Saves updated dojo-state.json
 * Appends clip_timestamps per detected clip (deduped). Pulse writeback may add the same
 * window again at digest time — writeBackClipTimestamps skips duplicates.
 *
 * Env:
 *   DOJO_DRY_RUN=1 or --dry-run — skips Discord POST/PATCH
 *   DOJO_TEST_MODE=1 — uses test config + isolated data dir
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { readJSON, writeJSON } = require('./lib/data');
const { processPracticeVideoMessages, processMessageChannel } = require('./lib/scan-process');
const { isMessagePayloadEmpty } = require('./lib/clip-detection');
const { createDiscordFetch } = require('./lib/discord-fetch');
const {
  getDiscordConfig,
  getDataPaths,
  loadRankingsMessageIds,
  isTestMode,
  MESSAGE_CHANNELS,
} = require('./lib/discord-config');

const paths = getDataPaths();
const discord = getDiscordConfig();
const rankings = loadRankingsMessageIds();

const DRY_RUN = process.env.DOJO_DRY_RUN === '1' || process.argv.includes('--dry-run');
const { discordApi, fetchMessages: fetchChannelMessages } = createDiscordFetch({ dryRun: DRY_RUN });

async function fetchMessages(channelId, afterId) {
  try {
    return await fetchChannelMessages(channelId, afterId);
  } catch (e) {
    console.error('fetchMessages failed', e.status || e.message);
    return [];
  }
}

async function sendNotification(content) {
  const notifyChannel = discord.channels.notify;
  if (!notifyChannel) {
    console.log('[Notify skipped — no notify channel configured]', content.slice(0, 120));
    return;
  }
  if (DRY_RUN) {
    console.log('[DRY RUN] Notification:', content.slice(0, 120));
    return;
  }
  await discordApi('POST', `/channels/${notifyChannel}/messages`, { content });
}

async function editRankingsMessage(messageId, content) {
  const rankingsChannel = discord.channels.rankings;
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would PATCH rankings message ${messageId} (${content.length} chars)`);
    return true;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await discordApi('PATCH', `/channels/${rankingsChannel}/messages/${messageId}`, { content });
    if (r.status === 200) return true;
    if (r.status === 429) {
      try {
        const body = JSON.parse(r.body);
        const waitMs = Math.ceil((body.retry_after || 2) * 1000);
        console.warn(`[Rankings] Rate limited on msg ${messageId}, waiting ${waitMs}ms (attempt ${attempt}/3)`);
        await new Promise(res => setTimeout(res, waitMs));
      } catch { await new Promise(res => setTimeout(res, 2000)); }
      continue;
    }
    console.error(`[Rankings] PATCH failed for msg ${messageId}: status=${r.status} body=${r.body} (attempt ${attempt}/3)`);
    if (attempt < 3) await new Promise(res => setTimeout(res, 1000));
  }
  return false;
}

async function runScan() {
  const mode = isTestMode() ? 'TEST MODE' : (DRY_RUN ? 'DRY RUN' : '');
  console.log('[Scan] Starting at', new Date().toISOString(), mode);
  if (isTestMode()) {
    console.log('[Scan] Data dir:', paths.dataDir);
  }

  const state = readJSON(paths.dojoStateFile);
  state.channels = state.channels || {};
  const storedPV = (state.channels['practice-videos'] || {}).lastMessageId || '0';

  const pvMessages = await fetchMessages(discord.channels.practiceVideos, storedPV);

  console.log(`[Scan] #practice-videos: ${pvMessages.length} new messages`);

  const strippedMessages = pvMessages.filter(isMessagePayloadEmpty);
  if (strippedMessages.length > 0) {
    console.error('');
    console.error('[Scan] WARNING: Discord returned message shell(s) with empty content, attachments, and embeds.');
    console.error(`[Scan] ${strippedMessages.length} message(s) affected (ids: ${strippedMessages.map(m => m.id).join(', ')}).`);
    console.error('[Scan] Enable **Message Content Intent** for your bot in the Discord Developer Portal:');
    console.error('[Scan]   https://discord.com/developers/applications → your app → Bot → Privileged Gateway Intents');
    console.error('[Scan] Without it, clips and links cannot be detected. Reset dojo-state cursors and re-scan after enabling.');
    console.error('');
  }

  const data = readJSON(paths.dataFile);
  const students = data.students;
  let changed = false;

  if (pvMessages.length > 0) {
    const summary = await processPracticeVideoMessages(students, pvMessages, {
      onNewStudent: async (displayName, username) => {
        await sendNotification(`🆕 New poster detected in #practice-videos: **${displayName}** (@${username}). Auto-added to dojo-data.json. Review needed.`);
        console.log(`[Scan] Auto-added new student: ${username}`);
      },
    });

    if (summary.newStudents.length > 0 || summary.clipAdds.length > 0 || summary.bpmUpdates.length > 0) {
      changed = true;
    }

    for (const b of summary.bpmUpdates) {
      console.log(`[BPM] ${b.name}: bpm=${b.bpm} peak=${b.peak}`);
    }

    const lastMsg = pvMessages.sort((a, b) => a.id.localeCompare(b.id))[pvMessages.length - 1];
    state.channels['practice-videos'] = state.channels['practice-videos'] || {};
    state.channels['practice-videos'].lastMessageId = lastMsg.id;
  }

  // Engagement message channels (#the-hall, #lounge, #sentinel-council): count new
  // messages per author into each ninja's field, exactly like clips. One cursor per
  // channel in dojo-state.json, initialized on first run.
  let newMsgTotal = 0;
  for (const mc of MESSAGE_CHANNELS) {
    const channelId = discord.channels[mc.channelKey];
    if (!channelId) continue; // not configured (e.g. test mode) — skip
    if (!state.channels[mc.stateKey]) state.channels[mc.stateKey] = { lastMessageId: '0' };
    const stored = state.channels[mc.stateKey].lastMessageId || '0';

    const msgs = await fetchMessages(channelId, stored);
    console.log(`[Scan] #${mc.stateKey}: ${msgs.length} new messages`);
    newMsgTotal += msgs.length;
    if (msgs.length === 0) continue;

    const sum = processMessageChannel(students, msgs, mc.field);
    if (sum.adds.length > 0) changed = true;
    const lastMsg = msgs.sort((a, b) => a.id.localeCompare(b.id))[msgs.length - 1];
    state.channels[mc.stateKey].lastMessageId = lastMsg.id;
  }

  if (pvMessages.length === 0 && newMsgTotal === 0) {
    console.log('[Scan] No new messages. Running dashboard + rankings refresh anyway.');
  }

  if (changed) {
    data.meta = data.meta || {};
    data.meta.totalClips = students.reduce((s, x) => s + (x.clips || 0), 0);
    data.meta.lastUpdated = new Date().toISOString();
    writeJSON(paths.dataFile, data);
    console.log('[Scan] dojo-data.json updated');
  }

  state.lastChecked = new Date().toISOString();
  writeJSON(paths.dojoStateFile, state);

  try {
    execSync(`node ${path.join(paths.workspace, 'dojo-dashboard-gen.js')}`, {
      cwd: paths.workspace,
      env: { ...process.env },
      stdio: 'inherit',
    });
    console.log('[Scan] Dashboard generated');
  } catch (e) {
    console.error('[Scan] Dashboard gen failed:', e.message);
  }

  try {
    execSync(`node ${path.join(paths.workspace, 'ninja-rankings-gen.js')}`, {
      cwd: paths.workspace,
      env: { ...process.env },
      stdio: 'inherit',
    });
    const update = readJSON(paths.rankingsUpdateFile);
    const { header, genin, footer } = update.messages;

    const r1 = await editRankingsMessage(rankings.header, header.content);
    const r2 = await editRankingsMessage(rankings.genin, genin.content);
    const r3 = await editRankingsMessage(rankings.footer, footer.content);
    console.log(`[Scan] #ninja-rankings updated: header=${r1} genin=${r2} footer=${r3}`);
  } catch (e) {
    console.error('[Scan] Rankings update failed:', e.message);
  }

  console.log('[Scan] Complete at', new Date().toISOString());
}

runScan().catch(e => {
  console.error('[Scan] Fatal error:', e.message);
  process.exit(1);
});
