import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
});
