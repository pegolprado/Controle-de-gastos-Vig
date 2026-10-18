import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.MARX_API ?? 'http://localhost:8000', changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts') || id.includes('d3-')) return 'charts'
            if (id.includes('cytoscape')) return 'graph'
            if (id.includes('leaflet')) return 'map'
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|@tanstack|sonner|lucide-react|clsx)\//.test(id)) return 'vendor'
            // bibliotecas pesadas (DuckDB, Excel, PDF, OCR) ficam em blocos carregados sob demanda
          }
        },
      },
    },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
})
