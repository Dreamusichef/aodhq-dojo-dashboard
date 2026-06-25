#!/usr/bin/env node
'use strict';
/**
 * dev/fix-milestone-digests.js
 * One-off repair for the "milestone repeated" bug: the 2,000-clip digest flourish
 * (🏯 Milestone — the dojo just crossed N clips today! + the N/N "milestone reached"
 * bar) was re-posted in #dojo-pulse on multiple nights because last_milestone never
 * got recorded (see lib/pulse-ops.js runMilestoneCheck — now fixed).
 *
 * This finds the bot's milestone-flourish digests in #dojo-pulse, KEEPS the earliest
 * one (the genuine crossing) and repairs the later duplicates — either by editing out
 * the flourish (default --patch) or deleting them (--delete).
 *
 * Run ONCE on the VPS (token + pulse-state.json live there):
 *   node dev/fix-milestone-digests.js            # REPORT ONLY — lists what it would do
 *   node dev/fix-milestone-digests.js --patch     # edit the duplicates (strip flourish, restore normal bar)
 *   node dev/fix-milestone-digests.js --delete     # delete the duplicates instead
 *   node dev/fix-milestone-digests.js --patch --all  # also repair the earliest (if you want NO flourish at all)
 *   [--channel <id>]   # override the #dojo-pulse channel id (default: pulse-state.json channelId)
 *   [--dry-run]        # do everything except the actual PATCH/DELETE
 */
const { readJSON } = require('../lib/data');
const { createDiscordFetch } = require('../lib/discord-fetch');
const { getDataPaths } = require('../lib/discord-config');
const { c, milestoneBar } = require('../lib/digest');

const MARKER = 'Milestone — the dojo just crossed';

function parseArgs(argv) {
  const a = { patch: false, delete: false, all: false, dryRun: false, channel: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--patch') a.patch = true;
    else if (arg === '--delete') a.delete = true;
    else if (arg === '--all') a.all = true;
    else if (arg === '--dry-run') a.dryRun = true;
    else if (arg === '--channel') a.channel = argv[++i];
    else if (arg === '--help' || arg === '-h') { a.help = true; }
    else { console.error(`Unknown option: ${arg}`); process.exit(1); }
  }
  return a;
}

// Build the corrected content for one flourish digest. Returns the new string, or null
// if the expected milestone markup wasn't found (format/locale drift — skip rather than
// post a no-op or a mangled message).
function repairContent(content, currentTotal) {
  let out = content;
  let changed = false;

  // Pull the milestone number out of the flourish line.
  const m = content.match(/crossed\s+([\d,]+)\s+clips/);
  const milestone = m ? Number(m[1].replace(/,/g, '')) : null;

  if (milestone) {
    // The flourish line is built inline in lib/digest.js; reconstruct it byte-for-byte
    // (daily says "clips today!", weekly/monthly just "clips!") and remove it + its blank line.
    for (const variant of [
      '🏯 Milestone — the dojo just crossed ' + milestone.toLocaleString() + ' clips today! 🔥',
      '🏯 Milestone — the dojo just crossed ' + milestone.toLocaleString() + ' clips! 🔥',
    ]) {
      const line = c(33, variant);
      if (out.includes(line)) { out = out.replace(line + '\n\n', '').replace(line, ''); changed = true; }
    }
    // Swap the "milestone reached!" bar (milestoneBar(M, M)) for the normal progress bar.
    const reachedBlock = milestoneBar(milestone, milestone);
    if (out.includes(reachedBlock)) {
      out = out.replace(reachedBlock, milestoneBar(currentTotal, null));
      changed = true;
    }
  }

  return changed ? out : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.error('node dev/fix-milestone-digests.js [--patch | --delete] [--all] [--channel <id>] [--dry-run]');
    process.exit(0);
  }

  const paths = getDataPaths();
  const channelId = args.channel
    || (require('fs').existsSync(paths.pulseStateFile) ? (readJSON(paths.pulseStateFile).channelId) : null);
  if (!channelId) {
    console.error('No #dojo-pulse channel id. Pass --channel <id> or ensure pulse-state.json has channelId.');
    process.exit(1);
  }

  const currentTotal = (() => {
    try { return readJSON(paths.dataFile).students.reduce((s, x) => s + (x.clips || 0), 0); }
    catch { return 0; }
  })();

  const { discordApi } = createDiscordFetch({ dryRun: args.dryRun });

  // Most-recent 100 messages in #dojo-pulse.
  const r = await discordApi('GET', `/channels/${channelId}/messages?limit=100`);
  if (r.status !== 200) {
    console.error(`Failed to fetch messages: HTTP ${r.status} ${r.body.slice(0, 200)}`);
    process.exit(1);
  }
  const messages = JSON.parse(r.body)
    .filter(m => (m.content || '').includes(MARKER))
    .sort((a, b) => a.id.localeCompare(b.id)); // oldest first

  if (messages.length === 0) {
    console.log(`No milestone-flourish digests found in channel ${channelId} (last 100 messages).`);
    return;
  }

  console.log(`Found ${messages.length} milestone-flourish digest(s) in #dojo-pulse (channel ${channelId}):`);
  messages.forEach((m, i) => {
    const ts = new Date(m.timestamp).toISOString().slice(0, 16).replace('T', ' ');
    const role = i === 0 && !args.all ? 'KEEP (genuine first crossing)' : 'REPAIR';
    console.log(`  [${i}] ${m.id}  ${ts}  -> ${role}`);
  });

  // Targets: everything except the earliest, unless --all.
  const targets = args.all ? messages : messages.slice(1);
  if (targets.length === 0) {
    console.log('\nNothing to repair (only the genuine first crossing is present). Use --all to repair it too.');
    return;
  }

  const mode = args.delete ? 'delete' : (args.patch ? 'patch' : 'report');
  if (mode === 'report') {
    console.log(`\nReport only. Re-run with --patch (edit out the flourish) or --delete (remove them).`);
    console.log(`Would ${args.all ? 'repair all' : 'repair the later'} ${targets.length} message(s). Normal bar would show total ${currentTotal.toLocaleString()}.`);
    return;
  }

  let ok = 0, fail = 0, skipped = 0;
  for (const msg of targets) {
    if (mode === 'delete') {
      const d = await discordApi('DELETE', `/channels/${channelId}/messages/${msg.id}`);
      if (d.status === 204 || d.status === 200) { ok++; console.log(`  deleted ${msg.id}`); }
      else { fail++; console.error(`  delete FAILED ${msg.id}: HTTP ${d.status} ${d.body.slice(0, 120)}`); }
    } else {
      const fixed = repairContent(msg.content, currentTotal);
      if (!fixed) { skipped++; console.warn(`  skip ${msg.id}: expected milestone markup not found (format drift) — left unchanged`); continue; }
      const p = await discordApi('PATCH', `/channels/${channelId}/messages/${msg.id}`, { content: fixed });
      if (p.status === 200) { ok++; console.log(`  patched ${msg.id}`); }
      else { fail++; console.error(`  patch FAILED ${msg.id}: HTTP ${p.status} ${p.body.slice(0, 120)}`); }
    }
    await new Promise(res => setTimeout(res, 600)); // be gentle with the rate limit
  }

  console.log(`\nDone. ${mode}: ${ok} ok, ${fail} failed, ${skipped} skipped.${args.dryRun ? ' (dry run)' : ''}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
