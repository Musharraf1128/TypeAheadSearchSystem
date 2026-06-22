import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/suggest': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/search': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/cache': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
