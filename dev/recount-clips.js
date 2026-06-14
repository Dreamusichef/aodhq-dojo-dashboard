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
 *   node dev/recount-clips.js --messages export.json --apply dojo-data.json --full
 */
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSON } = require('../lib/data');
const {
  tallyClipsFromMessages,
  reportRecountDiff,
  applyRecountToStudents,
  updateClipMeta,
} = require('../lib/recount-clips');

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
  const full = args.includes('--full');

  if (msgIdx < 0) {
    console.error('Usage: node dev/recount-clips.js --messages <file> [--data dojo-data.json] [--apply out.json] [--full]');
    process.exit(1);
  }

  const messagesFile = resolve(args[msgIdx + 1]);
  const dataPath = dataIdx >= 0
    ? resolve(args[dataIdx + 1])
    : resolve('dojo-data.json');

  const messages = loadMessages(messagesFile);
  const data = readJSON(dataPath);
  const students = data.students;
  const recount = tallyClipsFromMessages(messages);
  const { lines, inflated, deflated } = reportRecountDiff(students, recount);

  console.log('=== Clip recount report ===');
  console.log(`Messages processed: ${messages.length}`);
  console.log(`Students with clips in dump: ${Object.keys(recount).length}\n`);

  if (lines.length === 0) {
    console.log('  All student clip counts match the recount.');
  } else {
    for (const line of lines) console.log(line);
  }

  console.log(`\nTotal inflation: ${inflated} | Total undercount: ${deflated}`);

  if (applyIdx >= 0) {
    const outPath = resolve(args[applyIdx + 1]);
    applyRecountToStudents(students, recount, { full });
    updateClipMeta(data);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    writeJSON(outPath, data);
    console.log(`\nApplied${full ? ' (full)' : ''} recount to ${outPath}`);
  } else {
    console.log('\nPass --apply <path> to write corrected clips values.');
    console.log('Add --full to zero clips for students absent from the message dump.');
  }
}

main();
