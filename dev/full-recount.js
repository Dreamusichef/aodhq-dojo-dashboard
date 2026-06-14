#!/usr/bin/env node
'use strict';
/**
 * dev/full-recount.js
 * Fetch all #practice-videos history via the existing Dojo Pulse bot token,
 * recount clips with unified detection, and optionally apply corrected totals.
 *
 * Usage:
 *   node dev/full-recount.js
 *   node dev/full-recount.js --save dev/out/practice-videos-export.json
 *   node dev/full-recount.js --apply --full
 *   DOJO_TEST_MODE=1 node dev/full-recount.js
 *
 * Env:
 *   DOJO_TEST_MODE=1 — test guild + dev/test-data/ (same as vps-scan)
 */
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSON } = require('../lib/data');
const { createDiscordFetch } = require('../lib/discord-fetch');
const { isMessagePayloadEmpty } = require('../lib/clip-detection');
const {
  tallyClipsFromMessages,
  reportRecountDiff,
  applyRecountToStudents,
  updateClipMeta,
} = require('../lib/recount-clips');
const { getDiscordConfig, getDataPaths, isTestMode } = require('../lib/discord-config');

function usage() {
  console.error(`Usage: node dev/full-recount.js [options]

Options:
  --data <path>     dojo-data.json path (default: from DOJO_TEST_MODE / workspace)
  --save <path>     Write fetched messages JSON for audit
  --apply           Write corrected clips to output file
  --out <path>      Output path for --apply (default: same as --data)
  --full            With --apply, set clips=0 for students absent from history
  --help            Show this help

Report-only by default. Always review the diff before --apply.`);
}

function parseArgs(argv) {
  const args = {
    data: null,
    save: null,
    apply: false,
    out: null,
    full: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--full') args.full = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--data') args.data = argv[++i];
    else if (arg === '--save') args.save = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else {
      console.error(`Unknown option: ${arg}`);
      usage();
      process.exit(1);
    }
  }

  return args;
}

function resolvePath(file, workspace) {
  return path.isAbsolute(file) ? file : path.join(workspace, file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const paths = getDataPaths();
  const discord = getDiscordConfig();
  const dataPath = args.data ? resolvePath(args.data, paths.workspace) : paths.dataFile;
  const outPath = args.out ? resolvePath(args.out, paths.workspace) : dataPath;

  if (!fs.existsSync(dataPath)) {
    console.error(`Data file not found: ${dataPath}`);
    process.exit(1);
  }

  const mode = isTestMode() ? 'TEST MODE' : 'PRODUCTION';
  console.log(`[Recount] ${mode} — fetching #practice-videos history`);
  console.log(`[Recount] Channel: ${discord.channels.practiceVideos}`);
  console.log(`[Recount] Data: ${dataPath}`);

  const { fetchMessages } = createDiscordFetch();

  let messages;
  try {
    messages = await fetchMessages(discord.channels.practiceVideos, '0', {
      onPage: (total, batchSize) => {
        process.stdout.write(`\r[Recount] Fetched ${total} messages (+${batchSize})...`);
      },
    });
    process.stdout.write('\n');
  } catch (e) {
    console.error(`[Recount] Fetch failed: ${e.message}`);
    if (e.status === 403) {
      console.error('[Recount] Bot lacks Read Message History on #practice-videos.');
    }
    process.exit(1);
  }

  console.log(`[Recount] Total messages fetched: ${messages.length}`);

  const stripped = messages.filter(isMessagePayloadEmpty);
  if (stripped.length > 0) {
    console.error('');
    console.error(`[Recount] WARNING: ${stripped.length} message(s) have empty content, attachments, and embeds.`);
    console.error('[Recount] Enable Message Content Intent on the bot, then re-run this script.');
    console.error('');
  }

  if (args.save) {
    const savePath = resolvePath(args.save, paths.workspace);
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    writeJSON(savePath, { 'practice-videos': messages });
    console.log(`[Recount] Saved message export to ${savePath}`);
  }

  const data = readJSON(dataPath);
  const students = data.students;
  const recount = tallyClipsFromMessages(messages);
  const { lines, inflated, deflated } = reportRecountDiff(students, recount);

  console.log('\n=== Clip recount report ===');
  console.log(`Messages processed: ${messages.length}`);
  console.log(`Students with clips in history: ${Object.keys(recount).length}\n`);

  if (lines.length === 0) {
    console.log('  All student clip counts match the recount.');
  } else {
    for (const line of lines) console.log(line);
  }

  console.log(`\nTotal inflation: ${inflated} | Total undercount: ${deflated}`);

  if (!args.apply) {
    console.log('\nReview the report above. To apply corrections:');
    console.log(`  node dev/full-recount.js --apply --out ${path.relative(paths.workspace, outPath) || outPath}`);
    if (args.full || inflated > 0) {
      console.log('  Add --full to zero clips for students with no posts in channel history.');
    }
    return;
  }

  applyRecountToStudents(students, recount, { full: args.full });
  updateClipMeta(data);

  if (outPath === dataPath) {
    const backupPath = `${dataPath}.bak-${Date.now()}`;
    fs.copyFileSync(dataPath, backupPath);
    console.log(`\n[Recount] Backup written to ${backupPath}`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeJSON(outPath, data);
  console.log(`[Recount] Applied${args.full ? ' (full)' : ''} recount to ${outPath}`);
  console.log('[Recount] Regenerate dashboard + rankings before relying on updated totals:');
  console.log('  node dojo-dashboard-gen.js');
  console.log('  node vps-scan.js   # or run rankings gen + PATCH on VPS');
}

main().catch(e => {
  console.error('[Recount] Fatal error:', e.message);
  process.exit(1);
});
