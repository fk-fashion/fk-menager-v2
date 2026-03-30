import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  // 🔥 ADD THIS PART
  build: {
    rollupOptions: {
      external: [
        "@capacitor/core",
        "@capacitor/status-bar",
        "@capacitor/splash-screen"
      ]
    }
  }
})