import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist/client',
    chunkSizeWarningLimit: 1500,
    sourcemap: process.env.VITE_BUILD_SOURCEMAP === 'true',
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
