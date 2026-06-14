#!/usr/bin/env node
/**
 * ninja-rankings-gen.js
 * Reads dojo-data.json → outputs 3 Discord message texts as JSON
 */
const { readJSON, writeJSON } = require('./lib/data');
const { generateRankings } = require('./lib/rankings-gen');
const { getDataPaths } = require('./lib/discord-config');

const paths = getDataPaths();

const data = readJSON(paths.dataFile);
const state = readJSON(paths.rankingsStateFile);

const output = generateRankings(data, state);

writeJSON(paths.rankingsUpdateFile, output);
console.log('Generated', paths.rankingsUpdateFile);
console.log('Elite:', output.stats.elite, '| Chunin:', output.stats.chunin, '| Genin:', output.stats.genin, '| Ghost:', output.stats.ghost);
console.log('Total vids:', output.stats.totalVids);
