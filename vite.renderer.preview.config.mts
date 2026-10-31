/**
 * Novamail - renderer-only preview server.
 *
 * Used for design review and for viewing the interface without the Electron
 * shell. The renderer detects that window.novamail is missing and installs the
 * demo bridge, so every screen is reachable with sample data. This config is
 * never part of a packaged build.
 */
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The app ships a strict CSP (`script-src 'self'`). That is correct for the
 * packaged window, but in dev Vite injects an inline react-refresh preamble and
 * an HMR websocket, both of which that policy blocks - so fast refresh breaks
 * and the console fills with CSP errors.
 *
 * This rewrites the meta tag for the local preview only. Production output is
 * untouched: the plugin applies to `serve` and the packaged build does not use
 * this config at all.
 */
function devCsp(): Plugin {
  return {
    name: 'novamail-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?content=")([^"]*)(")/,
        (_match, start: string, policy: string, end: string) => {
          const relaxed = policy
            .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            .replace('connect-src \'self\' ws:', "connect-src 'self' ws: wss:")
          return `${start}${relaxed}${end}`
        }
      )
    }
  }
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  plugins: [react(), devCsp()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5199,
    strictPort: true,
    allowedHosts: true
  }
})
