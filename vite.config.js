import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(Date.now().toString()),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: false,

      includeAssets: [
        'favicon.png',
        'logo.png',
        'logo-dark.png',
        'pwa-icon.png',
      ],

      injectManifest: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },

      manifest: {
        name: 'Construacero Carabobo',
        short_name: 'Construacero',
        description: 'Sistema de cotizaciones y despachos',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#0ea5e9',
        orientation: 'portrait-primary',
        icons: [
          { src: 'pwa-icon.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'pwa-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },

      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    include: ['src/utils/__tests__/**/*.test.js'],
  },
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
