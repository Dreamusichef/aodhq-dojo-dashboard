#!/usr/bin/env node
'use strict';
/**
 * dev/preview-rankings.js
 * Print the 3 ninja-rankings Discord messages to stdout (no Discord PATCH).
 *
 * Usage:
 *   node dev/preview-rankings.js
 *   node dev/preview-rankings.js --data fixtures/dojo-data.sample.json
 */
const fs = require('fs');
const path = require('path');
const { readJSON } = require('../lib/data');
const { generateRankings } = require('../lib/rankings-gen');

const ROOT = path.join(__dirname, '..');

function resolve(file) {
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(full)) return null;
  return full;
}

function main() {
  const args = process.argv.slice(2);
  const dataIdx = args.indexOf('--data');
  const dataPath = dataIdx >= 0
    ? resolve(args[dataIdx + 1])
    : resolve('dojo-data.json') || resolve('fixtures/dojo-data.sample.json');
  const statePath = resolve('ninja-rankings-state.json')
    || resolve('fixtures/ninja-rankings-state.sample.json');

  if (!dataPath) {
    console.error('No dojo-data file found.');
    process.exit(1);
  }
  if (!statePath) {
    console.error('No ninja-rankings-state file found.');
    process.exit(1);
  }

  const data = readJSON(dataPath);
  const state = readJSON(statePath);
  const output = generateRankings(data, state);

  console.log('=== HEADER ===');
  console.log(output.messages.header.content);
  console.log('\n=== GENIN ===');
  console.log(output.messages.genin.content);
  console.log('\n=== FOOTER ===');
  console.log(output.messages.footer.content);
  console.log('\n--- Stats ---');
  console.log(`Elite: ${output.stats.elite} | Chunin: ${output.stats.chunin} | Genin: ${output.stats.genin} | Ghost: ${output.stats.ghost}`);
  console.log(`Total vids: ${output.stats.totalVids}`);
}

main();
