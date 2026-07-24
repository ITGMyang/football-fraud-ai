import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../public', import.meta.url)),
    emptyOutDir: false,
    assetsDir: 'build',
    rollupOptions: {
      output: {
        entryFileNames: 'build/app-[hash].js',
        chunkFileNames: 'build/chunk-[name]-[hash].js',
        assetFileNames: 'build/app-[hash].[ext]'
      }
    }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3888',
      '/auth': 'http://localhost:3888'
    }
  }
});
