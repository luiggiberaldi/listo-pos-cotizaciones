// Restricción de reasignación de clientes: solo administración, jefe y
// desarrollador. Supervisor y vendedor deben ser rechazados SIN tocar la base.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleReasignarCliente, handleReasignarClientesBulk, handleActualizarCliente } from '../clientes.js'
import { validateOperator } from '../../lib/auth.js'
import { registrarAuditoria } from '../../lib/audit.js'

vi.mock('../../lib/auth.js', () => ({
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
  validateOperator: vi.fn(),
  verifyAuth: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null) }))

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const CLIENT  = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const DEST    = 'cccccccc-3333-4333-8333-cccccccccccc'
const ORIGIN  = 'dddddddd-4444-4444-8444-dddddddddddd'
const EMPRESA = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const ENV = { SUPABASE_URL: 'https://clientes.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const headers = { apikey: 'service-test', Authorization: 'Bearer service-test', 'Content-Type': 'application/json' }
const privileged = { id: ACCOUNT, nombre: 'Admin test', rol: 'administracion', cuenta_id: ACCOUNT }

const request = (body, path = '/api/clientes/reasignar') => new Request(`https://worker.test.invalid${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
let fetchMock

function setAuth(operator = privileged) {
  validateOperator.mockResolvedValue({
    user: { id: operator.id, operator_id: operator.id },
    operador: operator,
    headers,
    ip: '127.0.0.1',
  })
}

beforeEach(() => {
  setAuth()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** Cola de mocks del camino feliz de una reasignación individual. */
function mockReasignacionFeliz() {
  fetchMock.mockResolvedValueOnce(jsonResponse([{ id: CLIENT, nombre: 'Cliente Uno', vendedor_id: ORIGIN }])) // cliente
  fetchMock.mockResolvedValueOnce(jsonResponse([{ id: DEST }]))                                               // vendedor destino
  fetchMock.mockResolvedValueOnce(jsonResponse({}))                                                           // PATCH cliente
  fetchMock.mockResolvedValueOnce(jsonResponse([]))                                                           // despachos del cliente
  fetchMock.mockResolvedValueOnce(jsonResponse({}))                                                           // registro reasignaciones_clientes
}

describe('handleReasignarCliente — solo administración, jefe y desarrollador', () => {
  it('supervisor: 403 sin tocar la base', async () => {
    setAuth({ ...privileged, rol: 'supervisor' })
    const res = await handleReasignarCliente(request({ clienteId: CLIENT, nuevoVendedorId: DEST }), ENV)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('Solo administración')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('vendedor: 403 sin tocar la base', async () => {
    setAuth({ ...privileged, rol: 'vendedor' })
    const res = await handleReasignarCliente(request({ clienteId: CLIENT, nuevoVendedorId: DEST }), ENV)
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('jefe: reasigna, sin RPC y auditado con su propio rol', async () => {
    setAuth({ ...privileged, rol: 'jefe' })
    mockReasignacionFeliz()
    const res = await handleReasignarCliente(request({ clienteId: CLIENT, nuevoVendedorId: DEST, motivo: 'Traspaso de zona' }), ENV)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(JSON.parse(patch[1].body).vendedor_id).toBe(DEST)
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/rpc/'))).toBe(false)
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.anything(), headers, expect.objectContaining({
      usuarioRol: 'jefe',
      accion: 'REASIGNAR_CLIENTE',
    }))
  })

  it('desarrollador: reasigna y audita con su propio rol', async () => {
    setAuth({ ...privileged, rol: 'desarrollador' })
    mockReasignacionFeliz()
    const res = await handleReasignarCliente(request({ clienteId: CLIENT, nuevoVendedorId: DEST }), ENV)
    expect(res.status).toBe(200)
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.anything(), headers, expect.objectContaining({
      usuarioRol: 'desarrollador',
    }))
  })
})

describe('handleReasignarClientesBulk — misma restricción', () => {
  it('supervisor: 403 sin tocar la base', async () => {
    setAuth({ ...privileged, rol: 'supervisor' })
    const res = await handleReasignarClientesBulk(request({ vendedorOrigenId: ORIGIN, vendedorDestinoId: DEST }, '/api/clientes/reasignar-bulk'), ENV)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('Solo administración')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('administración: conserva la vía (origen sin clientes)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: DEST, nombre: 'Vendedor Destino' }])) // destino
    fetchMock.mockResolvedValueOnce(jsonResponse([]))                                         // clientes del origen
    const res = await handleReasignarClientesBulk(request({ vendedorOrigenId: ORIGIN, vendedorDestinoId: DEST }, '/api/clientes/reasignar-bulk'), ENV)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, reasignados: 0, mensaje: 'Este vendedor no tiene clientes' })
  })
})

describe('handleActualizarCliente — mover a Personal (EMPRESA) restringido', () => {
  it('supervisor: 403 sin tocar la base', async () => {
    setAuth({ ...privileged, rol: 'supervisor' })
    const res = await handleActualizarCliente(request({ id: CLIENT, nombre: 'Cliente Uno', tipo_cliente: 'personal' }, '/api/clientes/actualizar'), ENV)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('Personal')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('administración: conserva la vía y asigna EMPRESA', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: EMPRESA }]))                                                     // usuarios EMPRESA
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: CLIENT, nombre: 'Cliente Uno', tipo_cliente: 'personal' }]))     // PATCH cliente
    const res = await handleActualizarCliente(request({ id: CLIENT, nombre: 'Cliente Uno', tipo_cliente: 'personal' }, '/api/clientes/actualizar'), ENV)
    expect(res.status).toBe(200)
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(JSON.parse(patch[1].body).vendedor_id).toBe(EMPRESA)
  })
})
