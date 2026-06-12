#!/usr/bin/env node
'use strict';
/**
 * dev/run-scan-fixtures.js
 * Run vps-scan message processing against fixture messages (no Discord).
 *
 * Usage:
 *   node dev/run-scan-fixtures.js
 *   node dev/run-scan-fixtures.js --write          # overwrite dev/out/dojo-data.json
 *   node dev/run-scan-fixtures.js --data path.json # custom input data file
 */
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSON } = require('../lib/data');
const { processPracticeVideoMessages } = require('../lib/scan-process');
const { countClipsInMessage } = require('../lib/clip-detection');
const { extractBpm } = require('../lib/bpm-extract');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures', 'messages.json');
const DEFAULT_DATA = path.join(ROOT, 'fixtures', 'dojo-data.sample.json');
const OUT_DIR = path.join(ROOT, 'dev', 'out');
const OUT_DATA = path.join(OUT_DIR, 'dojo-data.json');

const args = process.argv.slice(2);
const writeOut = args.includes('--write');
const dataArgIdx = args.indexOf('--data');
const dataFile = dataArgIdx >= 0 ? args[dataArgIdx + 1] : DEFAULT_DATA;

function resolveDataPath(file) {
  return path.isAbsolute(file) ? file : path.join(ROOT, file);
}

async function main() {
  const fixtures = readJSON(FIXTURES);
  const messages = fixtures['practice-videos'] || [];

  console.log('=== Fixture clip counts ===');
  for (const msg of messages) {
    const n = countClipsInMessage(msg);
    const bpm = extractBpm(msg);
    const expect = msg.expectedClips != null ? ` (expected ${msg.expectedClips})` : '';
    const bpmStr = bpm != null ? ` bpm=${bpm}` : '';
    const ok = msg.expectedClips == null || n === msg.expectedClips ? '✓' : '✗ MISMATCH';
    console.log(`  ${ok} ${msg.id}: ${n} clips${expect}${bpmStr}`);
  }

  const data = readJSON(resolveDataPath(dataFile));
  const students = data.students;

  console.log('\n=== Processing fixtures against student data ===');
  const summary = await processPracticeVideoMessages(students, messages, {
    onNewStudent: (displayName, username) => {
      console.log(`  🆕 New student: ${displayName} (@${username})`);
    },
  });

  if (summary.clipAdds.length === 0 && summary.newStudents.length === 0) {
    console.log('  No clip changes from fixtures.');
  } else {
    for (const c of summary.clipAdds) {
      console.log(`  +${c.added} clips → ${c.name} (@${c.username}) now ${c.total}`);
    }
    for (const b of summary.bpmUpdates) {
      console.log(`  BPM ${b.name}: ${b.bpm} (peak ${b.peak})`);
    }
  }

  data.meta = data.meta || {};
  data.meta.totalClips = students.reduce((s, x) => s + (x.clips || 0), 0);
  data.meta.lastUpdated = new Date().toISOString();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeJSON(OUT_DATA, data);
  console.log(`\nWrote ${OUT_DATA}`);

  if (writeOut) {
    const target = resolveDataPath(dataFile);
    writeJSON(target, data);
    console.log(`Also wrote ${target} (--write)`);
  } else {
    console.log('Pass --write to overwrite the source data file.');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
