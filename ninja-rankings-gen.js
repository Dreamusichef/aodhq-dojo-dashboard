#!/usr/bin/env node
/**
 * ninja-rankings-gen.js
 * Reads dojo-data.json → outputs 3 Discord message texts as JSON
 */
const path = require('path');
const { readJSON, writeJSON } = require('./lib/data');
const { generateRankings } = require('./lib/rankings-gen');

const data = readJSON(path.join(__dirname, 'dojo-data.json'));
const state = readJSON(path.join(__dirname, 'ninja-rankings-state.json'));

const output = generateRankings(data, state);

writeJSON(path.join(__dirname, 'ninja-rankings-update.json'), output);
console.log('Generated ninja-rankings-update.json');
console.log('Elite:', output.stats.elite, '| Chunin:', output.stats.chunin, '| Genin:', output.stats.genin, '| Ghost:', output.stats.ghost);
console.log('Total vids:', output.stats.totalVids);
