import { describe, it, expect } from 'vitest'
import { handleConciliarPagoCod } from '../cod.js'
import { handleCrearDespacho, handleEditarPagoDespacho } from '../despachos.js'

const ajeno = () => new Request('https://api.ejemplo.test/api/despachos/crear', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
  body: '{}',
})
// Sin fetch ni sesión: si el chequeo de origen fallara, el handler intentaría
// validar sesión contra Supabase. El 403 prueba que se corta antes.
const env = { SUPABASE_URL: 'https://unreachable.invalid', SUPABASE_SERVICE_KEY: 'x' }

describe('mutaciones rechazan origen cross-site', () => {
  it('handleConciliarPagoCod responde 403', async () => {
    const res = await handleConciliarPagoCod(ajeno(), env)
    expect(res.status).toBe(403)
  })
  it('handleCrearDespacho responde 403', async () => {
    expect((await handleCrearDespacho(ajeno(), env)).status).toBe(403)
  })
  it('handleEditarPagoDespacho responde 403', async () => {
    expect((await handleEditarPagoDespacho(ajeno(), env)).status).toBe(403)
  })
})
