import { defineConfig } from 'vite';
import { rozenitePlugin } from '@rozenite/vite-plugin';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [rozenitePlugin()],
  base: './',
  // The panel kit is another workspace with its own copies of these; the bundle must hold one of each.
  resolve: { dedupe: ['react', 'react-dom', '@rozenite/ui', '@rozenite/plugin-bridge', 'react-grid-layout'] },
  build: {
    outDir: './dist',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2000,
    minify: true,
    sourcemap: false,
  },
});
