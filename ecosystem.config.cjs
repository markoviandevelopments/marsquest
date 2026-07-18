module.exports = {
  apps: [
    {
      name: 'minecraft-clone',
      script: 'server/game-server.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 3010,
        // Public hostname(s) served via Cloudflare Tunnel
        PUBLIC_HOSTS: 'blockworld.immenseaccumulationonline.online',
      },
    },
  ],
};
