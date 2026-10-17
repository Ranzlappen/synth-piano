// Runs the renderer in a normal browser (no Electron) for quick UI work and
// automated UI tests. Native features fall back to browser APIs.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'src/renderer/public'),
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
