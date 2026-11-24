// api/handlers/__tests__/saldoFavorAtomico051.test.js
// OP-2026-051: cargar saldo a favor, devolverlo y cruzarlo contra deuda se guardan en UN SOLO PASO
// (función cxc_saldo_favor_atomico), con huella, aviso de repetido, mensajes claros y todo rechazo
// anotado en la auditoría.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRegistrarSaldoFavor, handleRegistrarDevolucionCredito, handleCruzarSaldoFavor } from '../cxc.js'
import { validateOperator } from '../../lib/auth.js'
import { registrarAuditoria } from '../../lib/audit.js'

vi.mock('../../lib/auth.js', () => ({
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
  validateOperator: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null) }))
vi.mock('../../lib/cxcUtils.js', () => ({ recalcularSaldoPendienteCliente: vi.fn(async () => null) }))

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const CLIENTE = 'cccccccc-3333-4333-8333-cccccccccccc'
const OPERADOR = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const ENV = { SUPABASE_URL: 'https://cxc.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const headers = { apikey: 'service-test', Authorization: 'Bearer service-test', 'Content-Type': 'application/json' }
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const errorBase = (message) => new Response(JSON.stringify({ code: 'P0001', message }), { status: 400 })
const req = (ruta, body) => new Request(`https://worker.test.invalid/api/cxc/${ruta}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
let fetchMock
let llamadas

function base(rpc) {
  return async (url, init = {}) => {
    const u = String(url)
    if (u.includes('/rpc/cxc_saldo_favor_atomico')) {
      const cuerpo = JSON.parse(init.body)
      llamadas.push(cuerpo)
      return rpc ? rpc(cuerpo) : jsonResponse({ id: 'mov-1', nuevo_saldo_favor: 50, nuevo_saldo_pendiente: 0, idempotent: false })
    }
    return jsonResponse([])
  }
}
const rechazos = () => registrarAuditoria.mock.calls.map(c => c[2]).filter(a => /RECHAZAD/.test(a.accion))

beforeEach(() => {
  validateOperator.mockResolvedValue({
    user: { id: ACCOUNT, operator_id: OPERADOR },
    operador: { id: OPERADOR, nombre: 'Test', rol: 'administracion', cuenta_id: ACCOUNT },
    headers, ip: '127.0.0.1',
  })
  llamadas = []
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

const casos = [
  ['saldo-favor', handleRegistrarSaldoFavor, 'credito', 'SALDO_FAVOR_RECHAZADO'],
  ['devolucion-credito', handleRegistrarDevolucionCredito, 'devolucion_credito', 'DEVOLUCION_SALDO_RECHAZADA'],
  ['cruzar-saldo-favor', handleCruzarSaldoFavor, 'cruce', 'CRUCE_SALDO_FAVOR_RECHAZADO'],
]

describe.each(casos)('%s — un solo paso en la base', (ruta, handler, operacion, accionRechazo) => {
  it('manda la operación, el monto, el operador y la huella a la función de la base', async () => {
    fetchMock.mockImplementation(base())
    const r = await handler(req(ruta, { clienteId: CLIENTE, monto: 50, formaPago: 'Zelle', idempotencyKey: 'k-1' }), ENV)
    expect(r.status).toBe(200)
    expect(llamadas[0]).toMatchObject({ p_operacion: operacion, p_cliente_id: CLIENTE, p_monto: 50, p_idempotency_key: 'k-1', p_registrado_por: OPERADOR })
    expect(await r.json()).toMatchObject({ id: 'mov-1', nuevoSaldoFavor: 50 })
  })

  it('no hace inserciones sueltas ni anotaciones desde el servidor cuando todo sale bien', async () => {
    fetchMock.mockImplementation(base())
    await handler(req(ruta, { clienteId: CLIENTE, monto: 50, formaPago: 'Zelle' }), ENV)
    const sueltas = fetchMock.mock.calls.filter(([u, i]) => i?.method === 'POST' && String(u).endsWith('/cuentas_por_cobrar'))
    expect(sueltas).toHaveLength(0)
    expect(registrarAuditoria).not.toHaveBeenCalled()
  })

  it.each([['abc'], [0], [-3], [null]])('monto %p → 400 claro, sin tocar la base, y queda anotado', async (monto) => {
    fetchMock.mockImplementation(base())
    const r = await handler(req(ruta, { clienteId: CLIENTE, monto, formaPago: 'Zelle' }), ENV)
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/^El monto debe ser/)
    expect(llamadas).toHaveLength(0)
    expect(rechazos()[0]).toMatchObject({ accion: accionRechazo, categoria: 'FINANZAS' })
  })

  it('un rol sin permiso queda anotado', async () => {
    validateOperator.mockResolvedValue({
      user: { id: ACCOUNT, operator_id: OPERADOR },
      operador: { id: OPERADOR, nombre: 'Vendedor', rol: 'vendedor', cuenta_id: ACCOUNT },
      headers, ip: '127.0.0.1',
    })
    fetchMock.mockImplementation(base())
    const r = await handler(req(ruta, { clienteId: CLIENTE, monto: 10 }), ENV)
    expect(r.status).toBe(403)
    expect(rechazos()[0]).toMatchObject({ accion: accionRechazo, usuarioRol: 'vendedor' })
  })

  it('un error inesperado de la base queda anotado (500)', async () => {
    fetchMock.mockImplementation(base(() => new Response('boom', { status: 500 })))
    const r = await handler(req(ruta, { clienteId: CLIENTE, monto: 10, formaPago: 'Zelle' }), ENV)
    expect(r.status).toBe(500)
    expect(rechazos()).toHaveLength(1)
  })
})

describe('mensajes claros de saldos', () => {
  it('devolver más que el saldo a favor → 400 con la cifra disponible', async () => {
    fetchMock.mockImplementation(base(() => errorBase('MONTO_SUPERA_SALDO_FAVOR:120.50')))
    const r = await handleRegistrarDevolucionCredito(req('devolucion-credito', { clienteId: CLIENTE, monto: 200, formaPago: 'Zelle' }), ENV)
    const body = await r.json()
    expect(r.status).toBe(400)
    expect(body.code).toBe('MONTO_SUPERA_SALDO_FAVOR')
    expect(body.error).toMatch(/mayor que el saldo a favor del cliente \(\$120\.50\)/)
  })

  it('cruzar más que la deuda → 400 con la deuda', async () => {
    fetchMock.mockImplementation(base(() => errorBase('MONTO_SUPERA_SALDO:30.00')))
    const r = await handleCruzarSaldoFavor(req('cruzar-saldo-favor', { clienteId: CLIENTE, monto: 50 }), ENV)
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/mayor que la deuda del cliente \(\$30\.00\)/)
  })

  it('cruzar sin deuda o sin saldo a favor → mensaje claro', async () => {
    fetchMock.mockImplementation(base(() => errorBase('SIN_DEUDA')))
    let r = await handleCruzarSaldoFavor(req('cruzar-saldo-favor', { clienteId: CLIENTE, monto: 5 }), ENV)
    expect((await r.json()).error).toMatch(/no tiene deuda pendiente/)
    fetchMock.mockImplementation(base(() => errorBase('SIN_SALDO_FAVOR')))
    r = await handleCruzarSaldoFavor(req('cruzar-saldo-favor', { clienteId: CLIENTE, monto: 5 }), ENV)
    expect((await r.json()).error).toMatch(/no tiene saldo a favor disponible/)
  })

  it('carga repetida reciente → 409 POSIBLE_DUPLICADO; con confirmación se lo dice a la base', async () => {
    const previo = { id: 'c-igual', creado_en: new Date(Date.now() - 20_000).toISOString(), referencia: 'ZELLE 991' }
    fetchMock.mockImplementation(base(() => jsonResponse({ posible_duplicado: previo })))
    const r = await handleRegistrarSaldoFavor(req('saldo-favor', { clienteId: CLIENTE, monto: 75, formaPago: 'Zelle' }), ENV)
    const body = await r.json()
    expect(r.status).toBe(409)
    expect(body.code).toBe('POSIBLE_DUPLICADO')
    expect(body.error).toMatch(/Ya se registró una carga de saldo a favor de \$75\.00 .*ZELLE 991/)
    fetchMock.mockImplementation(base())
    await handleRegistrarSaldoFavor(req('saldo-favor', { clienteId: CLIENTE, monto: 75, formaPago: 'Zelle', confirmarDuplicado: true }), ENV)
    expect(llamadas.at(-1).p_confirmar_duplicado).toBe(true)
  })

  it('el cruce no manda forma de pago (la pone la base: "Saldo a favor")', async () => {
    fetchMock.mockImplementation(base())
    await handleCruzarSaldoFavor(req('cruzar-saldo-favor', { clienteId: CLIENTE, monto: 5, formaPago: 'Zelle' }), ENV)
    expect(llamadas[0].p_forma_pago).toBeNull()
  })
})
