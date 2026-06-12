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
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

const WORKSPACE  = __dirname;
const DATA_FILE  = path.join(WORKSPACE, 'dojo-data.json');
const STATE_FILE = path.join(WORKSPACE, 'dojo-state.json');
const TOKEN_FILE = path.join(WORKSPACE, '.pulse-bot-token.json');
const NOTIFY_CHANNEL = '1487429631866044568'; // #clawdbot
const NOTIFY_GUILD   = '1487429532775350501';

const GUILD_ID = '1343785579829137529';
const PRACTICE_VIDEOS_ID = '1356110369818411131';
const THE_HALL_ID        = '1347383072303091823';

// #ninja-rankings message IDs
const RANKINGS_CHANNEL = '1488189728913096744';
const RANKINGS_HEADER  = '1491470167237197986';
const RANKINGS_GENIN   = '1491470175390666835';
const RANKINGS_FOOTER  = '1491470181048778783';

const CLIP_PATTERN = /youtu\.?be|youtube\.com|vimeo\.com|streamable\.com|clips\.twitch/i;

function getToken() {
  return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token;
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function discordApi(method, endpoint, body) {
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
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, r => {
      let d = ''; r.on('data', c => d += c);
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
    // Discord returns newest-first for ?after=, sort ascending by ID
    batch.sort((a, b) => a.id.localeCompare(b.id));
    all.push(...batch);
    if (batch.length < 100) break; // no more pages
    cursor = batch[batch.length - 1].id; // advance cursor to newest in batch
    // Rate limit safety — 500ms pause between pages
    await new Promise(r => setTimeout(r, 500));
  }
  return all;
}

function countClips(msg) {
  let count = 0;
  if (msg.content) {
    const urls = msg.content.match(/https?:\/\/[^\s<>]+/gi) || [];
    for (const url of urls) if (CLIP_PATTERN.test(url)) count++;
  }
  if (count === 0 && msg.embeds) {
    for (const e of msg.embeds) if (e.type === 'video' || (e.video && e.video.url)) count++;
  }
  return count;
}

// Extract BPM from a practice video embed title only.
// Rules (Wei Lung, June 2026):
//   INCLUDE: title must contain BPM + at least one of: interval, ramp, core, routine, endurance
//   EXCLUDE: title must NOT contain: floor, heel down, heel up, hip, upper leg
// Never reads message text — embed title only.
const BPM_INCLUDE = /interval|ramp|core|routine|endurance|bpm/i;
const BPM_EXCLUDE = /floor|heel\s*down|heel\s*up|\bhip\b|upper\s*leg/i;
const BPM_NUMBER  = /(\d{2,3})\s*bpm/gi;

function extractBpm(msg) {
  if (!msg.embeds || msg.embeds.length === 0) return null;

  const candidates = [];

  for (const e of msg.embeds) {
    const title = e.title || '';
    if (!title) continue;

    // Must have BPM number in the title
    if (!BPM_NUMBER.test(title)) continue;
    BPM_NUMBER.lastIndex = 0;

    // Must pass include filter (title has a qualifying keyword)
    if (!BPM_INCLUDE.test(title)) continue;

    // Must pass exclude filter (no anatomy/floor exercise keywords)
    if (BPM_EXCLUDE.test(title)) continue;

    // Extract all BPM values from the title
    let m;
    while ((m = BPM_NUMBER.exec(title)) !== null) {
      const v = parseInt(m[1], 10);
      if (v >= 40 && v <= 400) candidates.push(v);
    }
  }

  return candidates.length > 0 ? Math.max(...candidates) : null;
}

async function sendNotification(content) {
  await discordApi('POST', `/channels/${NOTIFY_CHANNEL}/messages`, { content });
}

async function editRankingsMessage(messageId, content) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await discordApi('PATCH', `/channels/${RANKINGS_CHANNEL}/messages/${messageId}`, { content });
    if (r.status === 200) return true;
    if (r.status === 429) {
      // Rate limited — parse retry_after and wait
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
  console.log('[Scan] Starting at', new Date().toISOString());

  const state = readJSON(STATE_FILE);
  const storedPV   = state.channels['practice-videos'].lastMessageId;
  const storedHall = state.channels['the-hall'].lastMessageId;

  // Fetch new messages
  const pvMessages   = await fetchMessages(PRACTICE_VIDEOS_ID, storedPV);
  const hallMessages = await fetchMessages(THE_HALL_ID, storedHall);

  console.log(`[Scan] #practice-videos: ${pvMessages.length} new messages`);
  console.log(`[Scan] #the-hall: ${hallMessages.length} new messages`);

  if (pvMessages.length === 0 && hallMessages.length === 0) {
    console.log('[Scan] No new messages. Running dashboard + rankings refresh anyway.');
  }

  const data = readJSON(DATA_FILE);
  const students = data.students;
  let changed = false;

  // Process #practice-videos
  if (pvMessages.length > 0) {
    // Sort oldest first
    pvMessages.sort((a, b) => a.id.localeCompare(b.id));

    for (const msg of pvMessages) {
      const username = msg.author.username;
      if (msg.author.bot) continue;
      const n = countClips(msg);
      if (n === 0) continue;

      let student = students.find(s => s.u === username);
      if (!student) {
        // Auto-create new student
        const displayName = msg.author.global_name || msg.author.username;
        student = { u: username, name: displayName, clips: 0, clip_timestamps: [], active: true, lastActivity: null, startBpm: 80 };
        students.push(student);
        await sendNotification(`🆕 New poster detected in #practice-videos: **${displayName}** (@${username}). Auto-added to dojo-data.json. Review needed.`);
        console.log(`[Scan] Auto-added new student: ${username}`);
        changed = true;
      }

      student.clips = (student.clips || 0) + n;
      student.active = true;
      student.lastActivity = msg.timestamp;

      // Extract BPM from the message and update current/peak if found
      const bpm = extractBpm(msg);
      if (bpm !== null) {
        const prevCurrent = student.currentBpm || student.startBpm || 0;
        const prevHigh    = student.highBpm    || student.startBpm || 0;
        student.currentBpm = bpm;
        if (bpm > prevHigh) {
          student.highBpm = bpm;
          console.log(`[BPM] ${student.name}: new peak ${prevHigh} → ${bpm}`);
        } else {
          console.log(`[BPM] ${student.name}: current ${prevCurrent} → ${bpm} (peak stays ${prevHigh})`);
        }
      }

      changed = true;
    }

    // Update lastMessageId
    const lastMsg = pvMessages[pvMessages.length - 1];
    state.channels['practice-videos'].lastMessageId = lastMsg.id;
  }

  // Process #the-hall
  if (hallMessages.length > 0) {
    hallMessages.sort((a, b) => a.id.localeCompare(b.id));

    for (const msg of hallMessages) {
      const username = msg.author.username;
      if (msg.author.bot) continue;
      const student = students.find(s => s.u === username);
      if (!student) continue;
      student.hallCount = (student.hallCount || 0) + 1;
      changed = true;
    }

    const lastMsg = hallMessages[hallMessages.length - 1];
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

  // Run dashboard generator
  try {
    execSync(`node ${path.join(WORKSPACE, 'dojo-dashboard-gen.js')}`, { cwd: WORKSPACE, stdio: 'inherit' });
    console.log('[Scan] Dashboard generated');
  } catch (e) {
    console.error('[Scan] Dashboard gen failed:', e.message);
  }

  // Run ninja rankings generator + edit Discord messages
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
