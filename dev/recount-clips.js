#!/usr/bin/env node
'use strict';
/**
 * dev/recount-clips.js
 * Recount clips per student from a message dump using unified clip detection.
 *
 * Usage:
 *   node dev/recount-clips.js --messages fixtures/messages.json
 *   node dev/recount-clips.js --messages export.json --data dojo-data.json
 *   node dev/recount-clips.js --messages fixtures/messages.json --apply dev/out/dojo-data.json
 */
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSON } = require('../lib/data');
const { countClipsInMessage } = require('../lib/clip-detection');

const ROOT = path.join(__dirname, '..');

function resolve(file) {
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    console.error(`File not found: ${full}`);
    process.exit(1);
  }
  return full;
}

function loadMessages(messagesFile) {
  const raw = readJSON(messagesFile);
  if (Array.isArray(raw)) return raw;
  if (raw['practice-videos']) return raw['practice-videos'];
  if (raw.messages) return raw.messages;
  return [];
}

function main() {
  const args = process.argv.slice(2);
  const msgIdx = args.indexOf('--messages');
  const dataIdx = args.indexOf('--data');
  const applyIdx = args.indexOf('--apply');

  if (msgIdx < 0) {
    console.error('Usage: node dev/recount-clips.js --messages <file> [--data dojo-data.json] [--apply out.json]');
    process.exit(1);
  }

  const messagesFile = resolve(args[msgIdx + 1]);
  const dataPath = dataIdx >= 0
    ? resolve(args[dataIdx + 1])
    : resolve('dojo-data.json') || resolve('fixtures/dojo-data.sample.json');

  const messages = loadMessages(messagesFile);
  const data = readJSON(dataPath);
  const students = data.students;

  const recount = {};
  for (const msg of messages) {
    if (msg.author && msg.author.bot) continue;
    const username = msg.author.username;
    const n = countClipsInMessage(msg);
    if (n === 0) continue;
    recount[username] = (recount[username] || 0) + n;
  }

  console.log('=== Clip recount report ===');
  console.log(`Messages processed: ${messages.length}`);
  console.log(`Students with clips in dump: ${Object.keys(recount).length}\n`);

  let inflated = 0;
  let deflated = 0;

  for (const s of students) {
    const correct = recount[s.u] || 0;
    const current = s.clips || 0;
    const delta = current - correct;
    if (delta !== 0) {
      const dir = delta > 0 ? 'inflated' : 'undercounted';
      console.log(`  ${s.name} (@${s.u}): current=${current} recount=${correct} (${dir} by ${Math.abs(delta)})`);
      if (delta > 0) inflated += delta;
      else deflated += Math.abs(delta);
    }
  }

  for (const [u, count] of Object.entries(recount)) {
    if (!students.find(s => s.u === u)) {
      console.log(`  (unknown poster @${u}): ${count} clips in dump, not in dojo-data`);
    }
  }

  console.log(`\nTotal inflation: ${inflated} | Total undercount: ${deflated}`);

  if (applyIdx >= 0) {
    const outPath = resolve(args[applyIdx + 1]);
    for (const s of students) {
      if (recount[s.u] != null) {
        s.clips = recount[s.u];
      } else if (Object.keys(recount).length > 0) {
        // Student not in message dump — leave unchanged unless full recount flag
      }
    }
    data.meta = data.meta || {};
    data.meta.totalClips = students.reduce((sum, x) => sum + (x.clips || 0), 0);
    data.meta.lastUpdated = new Date().toISOString();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    writeJSON(outPath, data);
    console.log(`\nApplied recount to ${outPath}`);
  } else {
    console.log('\nPass --apply <path> to write corrected clips values.');
  }
}

main();
