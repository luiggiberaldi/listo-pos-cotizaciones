// api/handlers/__tests__/cxcRevertirCargo.test.js
// Reversión del cargo CxC de un despacho (cuadre automático de la corrección de pagos):
// solo administración/jefe/desarrollador, motivo obligatorio, solo reduce el cargo y
// es idempotente por monto objetivo (un reintento no vuelve a aplicar).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRevertirCargoCxc } from '../cxc.js'
import { validateOperator } from '../../lib/auth.js'
import { registrarAuditoria } from '../../lib/audit.js'

vi.mock('../../lib/auth.js', () => ({
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
  validateOperator: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null) }))

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const DESPACHO = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const CLIENTE = 'cccccccc-3333-4333-8333-cccccccccccc'
const CARGO = 'dddddddd-4444-4444-8444-dddddddddddd'
const OPERADOR = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const ENV = { SUPABASE_URL: 'https://cxc.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const headers = { apikey: 'service-test', Authorization: 'Bearer service-test', 'Content-Type': 'application/json' }
const admin = { id: OPERADOR, nombre: 'Admin test', rol: 'administracion', cuenta_id: ACCOUNT }

const request = (body) => new Request('https://worker.test.invalid/api/cxc/revertir-cargo', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
let fetchMock

function setAuth(operator = admin) {
  validateOperator.mockResolvedValue({
    user: { id: ACCOUNT, operator_id: operator.id },
    operador: operator,
    headers,
    ip: '127.0.0.1',
  })
}

// Rutas del handler + del recálculo de saldo (api/lib/cxcUtils.js, que va a la real).
function installFetch({ cargo = [{ id: CARGO, monto_usd: 1232.6, cliente_id: CLIENTE }] } = {}) {
  fetchMock.mockImplementation(async (url, init = {}) => {
    const u = String(url)
    const method = (init.method || 'GET').toUpperCase()
    if (u.includes('/cuentas_por_cobrar') && method === 'GET' && u.includes('tipo=eq.cargo')) return jsonResponse(cargo)
    if (u.includes('/cuentas_por_cobrar') && method === 'PATCH') return jsonResponse([])
    if (u.includes('/cuentas_por_cobrar') && method === 'DELETE') return jsonResponse([])
    if (u.includes('/cuentas_por_cobrar') && method === 'GET') return jsonResponse([{ tipo: 'cargo', monto_usd: 800 }])
    if (u.includes('/clientes') && method === 'PATCH') return jsonResponse([])
    throw new Error(`Ruta inesperada: ${method} ${u}`)
  })
}

const bodyValido = { despachoId: DESPACHO, montoNuevo: 800, motivo: 'El crédito fue error de captura' }

beforeEach(() => {
  setAuth()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('handleRevertirCargoCxc — guardarraíles', () => {
  it('vendedor recibe 403 sin consultar la base', async () => {
    setAuth({ id: OPERADOR, nombre: 'Vendedor test', rol: 'vendedor', cuenta_id: ACCOUNT })
    const response = await handleRevertirCargoCxc(request(bodyValido), ENV)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('Solo administración')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza sin motivo (mínimo 4 caracteres)', async () => {
    const response = await handleRevertirCargoCxc(request({ ...bodyValido, motivo: '  ' }), ENV)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('motivo')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza montoNuevo inválido', async () => {
    const response = await handleRevertirCargoCxc(request({ ...bodyValido, montoNuevo: -1 }), ENV)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('montoNuevo')
  })

  it('responde 404 si el despacho no tiene cargo CxC', async () => {
    installFetch({ cargo: [] })
    const response = await handleRevertirCargoCxc(request(bodyValido), ENV)
    expect(response.status).toBe(404)
    expect((await response.json()).error).toContain('No hay cargo')
  })

  it('no permite aumentar el cargo', async () => {
    const response = await handleRevertirCargoCxc(request({ ...bodyValido, montoNuevo: 1500 }), ENV)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('solo puede reducir')
  })
})

describe('handleRevertirCargoCxc — reversión', () => {
  it('reduce el cargo al monto objetivo, recalcula el saldo y deja auditoría', async () => {
    const response = await handleRevertirCargoCxc(request(bodyValido), ENV)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, montoAnterior: 1232.6, montoNuevo: 800 })

    const patchCargo = fetchMock.mock.calls.find(c => String(c[0]).includes('/cuentas_por_cobrar?') && (c[1]?.method || 'GET') === 'PATCH')
    expect(patchCargo).toBeDefined()
    expect(JSON.parse(patchCargo[1].body)).toEqual({ monto_usd: 800 })

    // Recálculo del saldo del cliente desde los movimientos
    const patchCliente = fetchMock.mock.calls.find(c => String(c[0]).includes('/clientes?') && (c[1]?.method || 'GET') === 'PATCH')
    expect(patchCliente).toBeDefined()

    expect(registrarAuditoria).toHaveBeenCalledWith(
      ENV,
      headers,
      expect.objectContaining({
        accion: 'REVERTIR_CARGO_CXC',
        entidadTipo: 'despacho',
        entidadId: DESPACHO,
        meta: expect.objectContaining({ monto_anterior: 1232.6, monto_nuevo: 800, motivo: 'El crédito fue error de captura' }),
      }),
    )
  })

  it('borra el cargo cuando el monto objetivo es cero', async () => {
    const response = await handleRevertirCargoCxc(request({ ...bodyValido, montoNuevo: 0 }), ENV)
    expect(response.status).toBe(200)
    const del = fetchMock.mock.calls.find(c => (c[1]?.method || 'GET') === 'DELETE')
    expect(del).toBeDefined()
    expect(String(del[0])).toContain(`id=eq.${CARGO}`)
    // No debe quedar un PATCH de un cargo borrado
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/cuentas_por_cobrar?') && (c[1]?.method || 'GET') === 'PATCH')).toBe(false)
  })

  it('el reintento del mismo monto objetivo es idempotente: no vuelve a escribir', async () => {
    const response = await handleRevertirCargoCxc(request({ ...bodyValido, montoNuevo: 1232.6 }), ENV)
    expect(response.status).toBe(200)
    expect((await response.json()).idempotent).toBe(true)
    expect(fetchMock.mock.calls.some(c => ['PATCH', 'DELETE'].includes((c[1]?.method || 'GET').toUpperCase()))).toBe(false)
  })
})
