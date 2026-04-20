import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  test: {
    // Vitest configuration — co-located alongside the Vite bundler config
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/__tests__/**', 'src/main.jsx'],
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      // Suppressed error codes — these are normal when the backend is offline.
      //   ECONNREFUSED  backend not running (proxy attempts while uvicorn is down)
      //   ECONNRESET    idle WebSocket closed by the OS / backend
      //   EPIPE         write to already-closed socket during reconnect race
      // Any other error code IS logged so real problems surface.

      // WebRTC offer endpoint — plain HTTP POST, must NOT be treated as a WS upgrade
      '/api/offer': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: false,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            if (!['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(err.code)) {
              console.error('[HTTP Proxy Error] /api/offer', err.message);
            }
          });
        },
      },
      // All other /api routes (SSE streaming, clear, etc.)
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: false,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            if (!['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(err.code)) {
              console.error('[HTTP Proxy Error] /api', err.message);
            }
          });
        },
      },
      // Control WebSocket + any future /ws routes
      '/ws': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            // ECONNREFUSED = backend offline (App.jsx reconnects every 2 s)
            // ECONNRESET   = idle socket torn down mid-flight
            // Both are expected during normal dev-only-frontend sessions.
            if (!['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(err.code)) {
              console.error('[WS Proxy Error]', err.message);
            }
          });
        },
      },
    }
  },
  optimizeDeps: {
    exclude: ['@ricky0123/vad-web', 'onnxruntime-web']
  }
})
