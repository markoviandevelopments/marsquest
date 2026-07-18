import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 3000,
    // Cloudflare Tunnel public hostname + local dev
    allowedHosts: [
      'blockworld.immenseaccumulationonline.online',
      '.immenseaccumulationonline.online',
      'localhost',
      '127.0.0.1',
    ],
    // HMR does not work cleanly through the tunnel; game-server disables it too
    hmr: false,
  },
})