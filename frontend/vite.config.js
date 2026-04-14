import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      // WebRTC offer endpoint — plain HTTP POST, must NOT be treated as a WS upgrade
      '/api/offer': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: false,
      },
      // All other /api routes (SSE streaming, clear, etc.)
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: false,
      },
      // Control WebSocket + any future /ws routes
      '/ws': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
        // Keep the connection alive — prevents ECONNRESET on idle sockets
        configure: (proxy) => {
          proxy.on('error', (err) => {
            // Swallow ECONNRESET from idle WebSocket connections so Vite doesn't crash
            if (err.code !== 'ECONNRESET') {
              console.error('[WS Proxy Error]', err);
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
