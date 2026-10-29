/**
 * Novamail - renderer-only preview server.
 *
 * Used for design review and for viewing the interface without the Electron
 * shell. The renderer detects that window.novamail is missing and installs the
 * demo bridge, so every screen is reachable with sample data. This config is
 * never part of a packaged build.
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5199,
    strictPort: true,
    allowedHosts: true
  }
})
