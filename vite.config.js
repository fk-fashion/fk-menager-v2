import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    // In local dev, proxy /api calls so you don't need CORS workarounds
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },

  build: {
    rollupOptions: {
      // Capacitor packages are only available in native app builds.
      // Mark them external so Vite doesn't try to bundle them for web.
      // Your App.jsx already uses dynamic import() with .catch() for these,
      // so they will silently be skipped on web — this is correct behaviour.
      external: [
        "@capacitor/core",
        "@capacitor/status-bar",
        "@capacitor/splash-screen"
      ]
    }
  },

  // Prevent Vite from trying to process Node.js-only modules
  // that may be accidentally imported
  optimizeDeps: {
    exclude: [
      'firebase-admin',
      'imagekit',
      '@imagekit/nodejs'
    ]
  },

  define: {
    // Fix "process is not defined" errors from some Firebase internals
    'process.env': {}
  }
})