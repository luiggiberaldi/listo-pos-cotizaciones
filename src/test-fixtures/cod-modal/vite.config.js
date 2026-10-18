import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const fixtureDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(fixtureDir, '../../..')

export default defineConfig({
  root: projectRoot,
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('cod-modal-fixture') },
  resolve: {
    alias: [
      { find: '../../hooks/useTasaCambio', replacement: path.join(fixtureDir, 'rateHookMock.js') },
      { find: '../../services/authFetch', replacement: path.join(fixtureDir, 'authFetchMock.js') },
    ],
  },
  server: { host: '127.0.0.1', port: Number(process.env.COD_MODAL_PORT) || 5199, strictPort: true },
})
