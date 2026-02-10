import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3120',
      '/ws': { target: 'ws://127.0.0.1:3120', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
