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
  define: { __APP_VERSION__: JSON.stringify('editar-pago-fixture') },
  resolve: {
    alias: [
      // El hook real useEditarDespacho llama a authFetch: aquí se intercepta para
      // registrar el body exacto que llegaría al servidor (sin red real).
      { find: '../services/authFetch', replacement: path.join(fixtureDir, 'authFetchMock.js') },
      { find: '../../services/authFetch', replacement: path.join(fixtureDir, 'authFetchMock.js') },
      // Supabase no se usa en esta prueba: se sustituye por un stub hermético.
      { find: '../services/supabase/client', replacement: path.join(fixtureDir, 'supabaseClientMock.js') },
      { find: '../../services/supabase/client', replacement: path.join(fixtureDir, 'supabaseClientMock.js') },
    ],
  },
  server: { host: '127.0.0.1', port: Number(process.env.EDITAR_PAGO_PORT) || 5198, strictPort: true },
})
