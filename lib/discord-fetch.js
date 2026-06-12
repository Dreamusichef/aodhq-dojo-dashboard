'use strict';

const https = require('https');
const { loadBotToken } = require('./discord-config');

/**
 * Discord REST helpers (no discord.js). Shared by vps-scan and dev ops scripts.
 */
function createDiscordFetch({ getToken = loadBotToken, dryRun = false } = {}) {
  function discordApi(method, endpoint, body) {
    if (dryRun && method !== 'GET') {
      console.log(`[DRY RUN] ${method} ${endpoint}`);
      return Promise.resolve({ status: 200, body: '{}' });
    }

    return new Promise((res, rej) => {
      const token = getToken();
      const data = body ? JSON.stringify(body) : null;
      const req = https.request({
        hostname: 'discord.com',
        path: '/api/v10' + endpoint,
        method,
        headers: {
          'Authorization': 'Bot ' + token,
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => res({ status: r.status || r.statusCode, body: d }));
      });
      req.on('error', rej);
      if (data) req.write(data);
      req.end();
    });
  }

  async function fetchMessages(channelId, afterId = '0', { pageDelayMs = 500, onPage = null } = {}) {
    const all = [];
    let cursor = afterId;

    while (true) {
      const r = await discordApi('GET', `/channels/${channelId}/messages?limit=100&after=${cursor}`);
      if (r.status !== 200) {
        const err = new Error(`fetchMessages failed: HTTP ${r.status} ${r.body.slice(0, 200)}`);
        err.status = r.status;
        throw err;
      }

      const batch = JSON.parse(r.body);
      if (batch.length === 0) break;

      batch.sort((a, b) => a.id.localeCompare(b.id));
      all.push(...batch);

      if (onPage) onPage(all.length, batch.length);

      if (batch.length < 100) break;
      cursor = batch[batch.length - 1].id;
      await new Promise(resolve => setTimeout(resolve, pageDelayMs));
    }

    return all;
  }

  return { discordApi, fetchMessages };
}

module.exports = { createDiscordFetch };
