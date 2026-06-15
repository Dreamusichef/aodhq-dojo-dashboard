#!/usr/bin/env node
'use strict';
/**
 * dev/preview-digest.js
 * Preview daily/weekly/monthly digest messages offline.
 *
 * Usage:
 *   node dev/preview-digest.js --daily
 *   node dev/preview-digest.js --weekly --plain
 *   node dev/preview-digest.js --monthly --fixtures
 *   node dev/preview-digest.js --daily --writeback
 */
const fs = require('fs');
const path = require('path');
const { readJSON, writeBackClipTimestamps } = require('../lib/data');
const { computeStreaks } = require('../lib/streaks');
const {
  buildDailyMessage,
  buildWeeklyMessage,
  buildMonthlyMessage,
  stripAnsi,
} = require('../lib/digest');
const { simulateLiveClips, getTodayWindow } = require('../lib/live-fetch-sim');

const ROOT = path.join(__dirname, '..');

function resolve(file) {
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(full)) return null;
  return full;
}

function pickDataFile() {
  return resolve('dojo-data.json')
    || resolve('fixtures/dojo-data.sample.json');
}

function pickStateFile() {
  return resolve('pulse-state.json')
    || resolve('fixtures/pulse-state.sample.json');
}

function main() {
  const args = process.argv.slice(2);
  const plain = args.includes('--plain');
  const useFixtures = args.includes('--fixtures');
  const doWriteback = args.includes('--writeback');

  const mode = args.includes('--monthly') ? 'monthly'
    : args.includes('--weekly') ? 'weekly'
    : 'daily';

  const dataPath = pickDataFile();
  const statePath = pickStateFile();
  if (!dataPath) {
    console.error('No dojo-data.json or fixtures/dojo-data.sample.json found.');
    process.exit(1);
  }
  if (!statePath) {
    console.error('No pulse-state.json or fixtures/pulse-state.sample.json found.');
    process.exit(1);
  }

  const data = readJSON(dataPath);
  const state = readJSON(statePath);
  const students = data.students;

  state.streaks = computeStreaks(students, state.streaks || {});

  let liveData = null;
  if (useFixtures || mode === 'daily') {
    const fixturePath = resolve('fixtures/messages.json');
    if (fixturePath) {
      const fixtures = readJSON(fixturePath);
      const messages = fixtures['practice-videos'] || [];
      // Offline preview uses getTodayWindow (current in-progress dojo day). Production
      // cron + test:digest use getReportingDayWindow (dojo day that just ended at 23:00 SGT).
      const { cutoffStart, cutoffEnd } = getTodayWindow();
      liveData = simulateLiveClips(messages, students, cutoffStart, cutoffEnd);
      console.log(`[Simulated live fetch] ${liveData.totalClips} clips from ${liveData.ninjaCount} ninjas`);
      console.log(`  Window: ${cutoffStart.toISOString()} → ${cutoffEnd.toISOString()}\n`);
    }
  }

  if (doWriteback && liveData) {
    const outPath = resolve('dev/out/dojo-data.json') || path.join(ROOT, 'dev', 'out', 'dojo-data.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (!fs.existsSync(outPath)) {
      fs.copyFileSync(dataPath, outPath);
    }
    writeBackClipTimestamps(liveData, outPath);
    console.log(`[Writeback preview] Updated ${outPath}\n`);
  }

  let msg;
  if (mode === 'weekly') {
    msg = buildWeeklyMessage(students, state);
  } else if (mode === 'monthly') {
    msg = buildMonthlyMessage(students, state);
  } else {
    msg = buildDailyMessage(students, state, liveData);
  }

  if (plain) msg = stripAnsi(msg);
  console.log(msg);
}

main();
