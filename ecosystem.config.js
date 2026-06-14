// PM2 launch config for the Dojo Pulse bot.
//   Deploy/start from the repo root:  pm2 start ecosystem.config.js
//   Reload after a pull:              pm2 reload ecosystem.config.js
//
// The `-r ./bot/register-deps.js` preload adds bot/node_modules to NODE_PATH so
// shared code in lib/ can resolve discord.js (it is not installed at the repo root).
// cwd is pinned to this file's directory so the relative preload path resolves
// regardless of where pm2 is invoked.
module.exports = {
  apps: [
    {
      name: 'dojo-pulse',
      script: 'bot/pulse-bot.js',
      cwd: __dirname,
      node_args: '-r ./bot/register-deps.js',
      autorestart: true,
      exp_backoff_restart_delay: 2000,
    },
  ],
};
