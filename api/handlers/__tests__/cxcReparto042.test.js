// api/handlers/__tests__/cxcReparto042.test.js
// OP-2026-042: vista previa de devolución (mismo reparto que CxC) y validación del
// despacho al registrar un abono desde la ficha del cliente.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handlePreviewDevolucionCxc } from '../despachos.js'
import { handleRegistrarAbono } from '../cxc.js'
import { validateOperator } from '../../lib/auth.js'

vi.mock('../../lib/auth.js', () => ({
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
  validateOperator: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null) }))
vi.mock('../../lib/notificarPush.js', () => ({ avisarDespacho: vi.fn(async () => null) }))

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const DESPACHO = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const OTRO_DESPACHO = 'bbbbbbbb-9999-4999-8999-bbbbbbbbbbbb'
const CLIENTE = 'cccccccc-3333-4333-8333-cccccccccccc'
const OTRO_CLIENTE = 'cccccccc-8888-4888-8888-cccccccccccc'
const OPERADOR = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const ENV = { SUPABASE_URL: 'https://cxc.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const headers = { apikey: 'service-test', Authorization: 'Bearer service-test', 'Content-Type': 'application/json' }
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
let fetchMock

function setAuth(rol = 'administracion') {
  validateOperator.mockResolvedValue({
    user: { id: ACCOUNT, operator_id: OPERADOR },
    operador: { id: OPERADOR, nombre: 'Test', rol, cuenta_id: ACCOUNT },
    headers,
    ip: '127.0.0.1',
  })
}

// Caso Decoraciones Encendo justo antes de la devolución
const MOVS_ENCENDO = [
  { id: 'c1', tipo: 'cargo', monto_usd: 2144, despacho_id: DESPACHO, creado_en: '2026-07-22T19:47:23.134994+00:00', descripcion: 'Orden de despacho #1863 (Crédito)' },
  { id: 'a1', tipo: 'abono', monto_usd: 2144, despacho_id: null, forma_pago_abono: '[{"metodo":"Cruce","monto":2144,"referencia":"NO PROCEDE"}]', referencia: 'NO PROCEDE', descripcion: 'NO PROCEDE', creado_en: '2026-07-27T15:53:48.198193+00:00' },
]

beforeEach(() => {
  setAuth()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('handlePreviewDevolucionCxc', () => {
  const req = (id = DESPACHO) => new Request(`https://worker.test.invalid/api/despachos/devolucion-preview-cxc?despachoId=${id}`)

  it('vendedor recibe 403 sin consultar la base', async () => {
    setAuth('vendedor')
    const r = await handlePreviewDevolucionCxc(req(), ENV, new URL(req().url))
    expect(r.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caso Encendo: el despacho ya estaba cubierto por el Cruce manual', async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/notas_despacho')) {
        expect(u).toContain(`cuenta_id=eq.${ACCOUNT}`)
        return jsonResponse([{ id: DESPACHO, numero: 1863, cliente_id: CLIENTE, cliente_factura_id: null }])
      }
      if (u.includes('/cuentas_por_cobrar')) {
        expect(u).toContain(`cliente_id=eq.${CLIENTE}`)
        return jsonResponse(MOVS_ENCENDO)
      }
      throw new Error(`Ruta inesperada: ${u}`)
    })
    const r = await handlePreviewDevolucionCxc(req(), ENV, new URL(req().url))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.cargoDespacho).toBe(2144)
    expect(body.pendienteSoloEnlazado).toBe(2144) // la regla vieja se equivocaba
    expect(body.pendienteDespacho).toBe(0)        // la regla nueva ve el Cruce
    expect(body.abonosQueCubren).toHaveLength(1)
    expect(body.abonosQueCubren[0]).toMatchObject({ id: 'a1', aplicado: 2144, anulable: true, referencia: 'NO PROCEDE' })
  })

  it('despacho de otra cuenta → 404', async () => {
    fetchMock.mockImplementation(async () => jsonResponse([]))
    const r = await handlePreviewDevolucionCxc(req(), ENV, new URL(req().url))
    expect(r.status).toBe(404)
  })
})

describe('handleRegistrarAbono — despacho elegido en la ficha', () => {
  const req = (body) => new Request('https://worker.test.invalid/api/cxc/abono', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  it('rechaza un despacho que no es del cliente, sin registrar nada', async () => {
    fetchMock.mockImplementation(async (url, init = {}) => {
      const u = String(url)
      if (u.includes('/notas_despacho')) return jsonResponse([{ cliente_id: OTRO_CLIENTE, cliente_factura_id: null }])
      if ((init.method || 'GET') === 'POST') throw new Error('No debe registrar el abono')
      throw new Error(`Ruta inesperada: ${u}`)
    })
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 100, despachoId: OTRO_DESPACHO }), ENV)
    expect(r.status).toBe(400)
    expect((await r.json()).error).toContain('no pertenece a este cliente')
  })

  it('rechaza un despachoId con formato inválido', async () => {
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 100, despachoId: 'xx' }), ENV)
    expect(r.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('con un despacho del cliente, guarda el abono enlazado a ese despacho', async () => {
    let posted = null
    fetchMock.mockImplementation(async (url, init = {}) => {
      const u = String(url)
      const method = (init.method || 'GET').toUpperCase()
      if (u.includes('/notas_despacho')) return jsonResponse([{ cliente_id: CLIENTE, cliente_factura_id: null }])
      if (u.includes('/clientes') && method === 'GET') return jsonResponse([{ saldo_pendiente: 500 }])
      if (u.includes('/cuentas_por_cobrar') && method === 'GET' && u.includes('tipo=eq.cargo')) return jsonResponse([{ id: 'c1' }])
      // OP-2026-050: el abono se guarda con la función de la base (un solo paso)
      if (u.includes('/rpc/cxc_registrar_abono_atomico')) { posted = JSON.parse(init.body); return jsonResponse({ id: 'nuevo', nuevo_saldo: 400 }) }
      if (u.includes('/cuentas_por_cobrar') && method === 'GET') return jsonResponse([])
      throw new Error(`Ruta inesperada: ${method} ${u}`)
    })
    const r = await handleRegistrarAbono(req({ clienteId: CLIENTE, monto: 100, despachoId: DESPACHO, formaPago: 'Efectivo $' }), ENV)
    expect(r.status).toBe(200)
    expect(posted).toMatchObject({ p_cliente_id: CLIENTE, p_despacho_id: DESPACHO, p_monto: 100 })
  })
})
