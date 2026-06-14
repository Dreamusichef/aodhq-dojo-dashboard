'use strict';

/**
 * Preload via `node -r ./bot/register-deps.js` so shared lib/ code can resolve
 * discord.js from bot/node_modules (not installed at repo root).
 */
const path = require('path');
const Module = require('module');

const botNodeModules = path.resolve(__dirname, 'node_modules');
const sep = path.delimiter;
const existing = process.env.NODE_PATH || '';
const paths = existing.split(sep).filter(Boolean);

if (!paths.includes(botNodeModules)) {
  process.env.NODE_PATH = [botNodeModules, ...paths].join(sep);
  Module._initPaths();
}
