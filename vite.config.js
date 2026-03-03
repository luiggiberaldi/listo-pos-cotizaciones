import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Archivos estáticos que deben estar disponibles offline
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'Precios al Día - Punto de Venta',
        short_name: 'Bodega PV',
        description: 'Punto de venta bimoneda y gestor de inventario para bodegas de Venezuela',
        theme_color: '#10B981', // Emerald 500
        background_color: '#10B981', // Verde esmeralda de la marca
        display: 'standalone', // Modo app nativa (sin barra de navegador)
        orientation: 'portrait', // Bloquear rotación
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        shortcuts: [
          {
            name: "Vender Rápido",
            short_name: "Vender",
            description: "Abrir directamente el Punto de Venta",
            url: "/?view=ventas",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "Revisar Inventario",
            short_name: "Inventario",
            description: "Abrir catálogo de productos",
            url: "/?view=catalogo",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          icons: ['lucide-react'],
        }
      }
    }
  },
})