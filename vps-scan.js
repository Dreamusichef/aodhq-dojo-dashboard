'use strict';
/**
 * vps-scan.js — Dojo Daily Scan (VPS edition, no AI)
 * Runs at 22:55 SGT via node-cron on the VPS.
 * - Reads new messages from #practice-videos and #the-hall
 * - Updates dojo-data.json (clip counts, hall counts, lastActivity)
 * - Runs dojo-dashboard-gen.js (pushes GitHub Pages)
 * - Runs ninja-rankings-gen.js + edits #ninja-rankings messages via Discord API
 * - Saves updated dojo-state.json
 * Does NOT touch clip_timestamps — Pulse bot owns those.
 *
 * Env: DOJO_DRY_RUN=1 or --dry-run skips Discord POST/PATCH (local dev).
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { readJSON, writeJSON } = require('./lib/data');
const { processPracticeVideoMessages, processHallMessages } = require('./lib/scan-process');

const WORKSPACE = __dirname;
const DATA_FILE = path.join(WORKSPACE, 'dojo-data.json');
const STATE_FILE = path.join(WORKSPACE, 'dojo-state.json');
const TOKEN_FILE = path.join(WORKSPACE, '.pulse-bot-token.json');
const NOTIFY_CHANNEL = '1487429631866044568'; // #clawdbot

const GUILD_ID = '1343785579829137529';
const PRACTICE_VIDEOS_ID = '1356110369818411131';
const THE_HALL_ID = '1347383072303091823';

const RANKINGS_CHANNEL = '1488189728913096744';
const RANKINGS_HEADER = '1491470167237197986';
const RANKINGS_GENIN = '1491470175390666835';
const RANKINGS_FOOTER = '1491470181048778783';

const DRY_RUN = process.env.DOJO_DRY_RUN === '1' || process.argv.includes('--dry-run');

function getToken() {
  return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token;
}

function discordApi(method, endpoint, body) {
  if (DRY_RUN && method !== 'GET') {
    console.log(`[DRY RUN] ${method} ${endpoint}`);
    return Promise.resolve({ status: 200, body: '{}' });
  }

  return new Promise((res, rej) => {
    const token = getToken();
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'discord.com',
      path: '/api/v10' + endpoint,
      method,
      headers: {
        'Authorization': 'Bot ' + token,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res({ status: r.status || r.statusCode, body: d }));
    });
    req.on('error', rej);
    if (data) req.write(data);
    req.end();
  });
}

async function fetchMessages(channelId, afterId) {
  const all = [];
  let cursor = afterId;
  while (true) {
    const r = await discordApi('GET', `/channels/${channelId}/messages?limit=100&after=${cursor}`);
    if (r.status !== 200) { console.error('fetchMessages failed', r.status); break; }
    const batch = JSON.parse(r.body);
    if (batch.length === 0) break;
    batch.sort((a, b) => a.id.localeCompare(b.id));
    all.push(...batch);
    if (batch.length < 100) break;
    cursor = batch[batch.length - 1].id;
    await new Promise(r => setTimeout(r, 500));
  }
  return all;
}

async function sendNotification(content) {
  if (DRY_RUN) {
    console.log('[DRY RUN] Notification:', content.slice(0, 120));
    return;
  }
  await discordApi('POST', `/channels/${NOTIFY_CHANNEL}/messages`, { content });
}

async function editRankingsMessage(messageId, content) {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would PATCH rankings message ${messageId} (${content.length} chars)`);
    return true;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await discordApi('PATCH', `/channels/${RANKINGS_CHANNEL}/messages/${messageId}`, { content });
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
  console.log('[Scan] Starting at', new Date().toISOString(), DRY_RUN ? '(DRY RUN)' : '');

  const state = readJSON(STATE_FILE);
  const storedPV = state.channels['practice-videos'].lastMessageId;
  const storedHall = state.channels['the-hall'].lastMessageId;

  const pvMessages = await fetchMessages(PRACTICE_VIDEOS_ID, storedPV);
  const hallMessages = await fetchMessages(THE_HALL_ID, storedHall);

  console.log(`[Scan] #practice-videos: ${pvMessages.length} new messages`);
  console.log(`[Scan] #the-hall: ${hallMessages.length} new messages`);

  if (pvMessages.length === 0 && hallMessages.length === 0) {
    console.log('[Scan] No new messages. Running dashboard + rankings refresh anyway.');
  }

  const data = readJSON(DATA_FILE);
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
    state.channels['practice-videos'].lastMessageId = lastMsg.id;
  }

  if (hallMessages.length > 0) {
    const hallSummary = processHallMessages(students, hallMessages);
    if (hallSummary.hallAdds.length > 0) changed = true;

    const lastMsg = hallMessages.sort((a, b) => a.id.localeCompare(b.id))[hallMessages.length - 1];
    state.channels['the-hall'].lastMessageId = lastMsg.id;
  }

  if (changed) {
    data.meta = data.meta || {};
    data.meta.totalClips = students.reduce((s, x) => s + (x.clips || 0), 0);
    data.meta.lastUpdated = new Date().toISOString();
    writeJSON(DATA_FILE, data);
    console.log('[Scan] dojo-data.json updated');
  }

  state.lastChecked = new Date().toISOString();
  writeJSON(STATE_FILE, state);

  try {
    execSync(`node ${path.join(WORKSPACE, 'dojo-dashboard-gen.js')}`, { cwd: WORKSPACE, stdio: 'inherit' });
    console.log('[Scan] Dashboard generated');
  } catch (e) {
    console.error('[Scan] Dashboard gen failed:', e.message);
  }

  try {
    execSync(`node ${path.join(WORKSPACE, 'ninja-rankings-gen.js')}`, { cwd: WORKSPACE, stdio: 'inherit' });
    const update = readJSON(path.join(WORKSPACE, 'ninja-rankings-update.json'));
    const { header, genin, footer } = update.messages;

    const r1 = await editRankingsMessage(RANKINGS_HEADER, header.content);
    const r2 = await editRankingsMessage(RANKINGS_GENIN, genin.content);
    const r3 = await editRankingsMessage(RANKINGS_FOOTER, footer.content);
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
