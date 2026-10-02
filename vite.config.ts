import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  plugins: [svelte()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks: { leaflet: ['leaflet'] },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8080', '/status': 'http://127.0.0.1:8080' },
  },
});
