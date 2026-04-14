import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          icons: ['lucide-react'],
          pdf: ['jspdf', 'html2canvas'],
          cloud: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
        }
      }
    }
  },
})
