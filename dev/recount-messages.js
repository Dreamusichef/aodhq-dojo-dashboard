#!/usr/bin/env node
'use strict';
/**
 * dev/recount-messages.js
 * Rebuild engagement message counts (#the-hall, #lounge, #sentinel-council) from
 * FULL channel history via the Dojo Pulse bot token. Replaces the unreliable static
 * legacy counts with a fresh, accurate tally, and advances the dojo-state.json cursors
 * so the nightly vps-scan continues incrementally from there (no double counting).
 *
 * Run this ONCE on the VPS (where the token + live dojo-data.json live). After that,
 * vps-scan keeps the counts current every night, exactly like #practice-videos.
 *
 * Usage:
 *   node dev/recount-messages.js               # REPORT ONLY — no writes
 *   node dev/recount-messages.js --apply       # reset counts + advance cursors (backs up first)
 *   node dev/recount-messages.js --save dev/out # also dump fetched messages per channel
 *
 * Env: DOJO_TEST_MODE=1 — test guild + dev/test-data/ (same as vps-scan)
 */
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSON } = require('../lib/data');
const { createDiscordFetch } = require('../lib/discord-fetch');
const { tallyMessagesByAuthor, reportMessageDiff, applyMessageTally } = require('../lib/recount-messages');
const { getDiscordConfig, getDataPaths, MESSAGE_CHANNELS, isTestMode } = require('../lib/discord-config');

function parseArgs(argv) {
  const a = { apply: false, save: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') a.apply = true;
    else if (arg === '--save') a.save = argv[++i];
    else if (arg === '--help' || arg === '-h') { a.help = true; }
    else { console.error(`Unknown option: ${arg}`); process.exit(1); }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.error('node dev/recount-messages.js [--apply] [--save <dir>]   (report-only without --apply)');
    process.exit(0);
  }

  const paths = getDataPaths();
  const discord = getDiscordConfig();
  const { fetchMessages } = createDiscordFetch();

  if (!fs.existsSync(paths.dataFile)) {
    console.error(`Data file not found: ${paths.dataFile}`);
    process.exit(1);
  }
  const data = readJSON(paths.dataFile);
  const students = data.students;
  const state = fs.existsSync(paths.dojoStateFile) ? readJSON(paths.dojoStateFile) : { channels: {} };
  state.channels = state.channels || {};

  console.log(`[MsgRecount] ${isTestMode() ? 'TEST MODE' : 'PRODUCTION'} — rebuilding message counts from full history\n`);

  const results = [];
  for (const mc of MESSAGE_CHANNELS) {
    const channelId = discord.channels[mc.channelKey];
    if (!channelId) {
      console.log(`[MsgRecount] #${mc.stateKey}: no channel id configured — skipped\n`);
      continue;
    }
    console.log(`[MsgRecount] #${mc.stateKey} -> field "${mc.field}" (channel ${channelId})`);

    let messages;
    try {
      messages = await fetchMessages(channelId, '0', {
        onPage: (total, batch) => process.stdout.write(`\r  fetched ${total} (+${batch})...`),
      });
      process.stdout.write('\n');
    } catch (e) {
      console.error(`  fetch failed: HTTP ${e.status || ''} ${e.message}`);
      if (e.status === 403) console.error('  -> bot lacks Read Message History on this channel; field left unchanged.');
      console.log('');
      continue;
    }

    if (args.save) {
      const dir = path.isAbsolute(args.save) ? args.save : path.join(paths.workspace, args.save);
      fs.mkdirSync(dir, { recursive: true });
      writeJSON(path.join(dir, `messages-${mc.stateKey}.json`), { [mc.stateKey]: messages });
    }

    const tally = tallyMessagesByAuthor(messages);
    const { lines, higher, lower } = reportMessageDiff(students, tally, mc.field);
    const tracked = students.filter(s => tally[s.u]).length;
    const lastId = messages.length
      ? messages[messages.length - 1].id
      : (state.channels[mc.stateKey] || {}).lastMessageId || '0';

    console.log(`  messages: ${messages.length} | tracked posters: ${tracked}`);
    if (lines.length === 0) console.log('  counts already match — no change.');
    else for (const l of lines) console.log(l);
    console.log(`  net vs current: -${higher} / +${lower}\n`);

    results.push({ mc, tally, lastId });
  }

  if (!args.apply) {
    console.log('Report only — nothing written.');
    console.log('Re-run with --apply to reset counts + advance cursors (a backup of dojo-data.json + dojo-state.json is written first).');
    return;
  }

  if (results.length === 0) {
    console.error('[MsgRecount] No channels fetched successfully — nothing to apply.');
    process.exit(1);
  }

  // Backup before mutating the source of truth.
  fs.copyFileSync(paths.dataFile, `${paths.dataFile}.bak-${Date.now()}`);
  if (fs.existsSync(paths.dojoStateFile)) {
    fs.copyFileSync(paths.dojoStateFile, `${paths.dojoStateFile}.bak-${Date.now()}`);
  }

  for (const { mc, tally, lastId } of results) {
    applyMessageTally(students, tally, mc.field);   // full reset of this field
    state.channels[mc.stateKey] = { lastMessageId: lastId };
  }
  data.meta = data.meta || {};
  data.meta.lastUpdated = new Date().toISOString();

  writeJSON(paths.dataFile, data);
  writeJSON(paths.dojoStateFile, state);
  console.log(`[MsgRecount] Applied to ${results.length} channel(s). Counts reset + cursors advanced (backups written).`);
  console.log('[MsgRecount] Now regenerate the dashboard + public JSON:');
  console.log('  node dojo-dashboard-gen.js');
}

main().catch(e => {
  console.error('[MsgRecount] Fatal error:', e.message);
  process.exit(1);
});
