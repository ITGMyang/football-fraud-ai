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
      // Two shells: the public app at / and the operations console at /admin.
      // Shared dependencies are hoisted into a chunk both HTML files load.
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url))
      },
      output: {
        entryFileNames: 'build/[name]-[hash].js',
        chunkFileNames: 'build/chunk-[name]-[hash].js',
        assetFileNames: 'build/[name]-[hash].[ext]'
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
