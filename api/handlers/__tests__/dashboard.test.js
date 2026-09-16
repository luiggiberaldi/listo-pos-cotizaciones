import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { handleDashboard } from '../dashboard.js'
import { validateOperator } from '../../lib/auth.js'
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn() }))

const account = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const ids = { vendedor: '20000000-0000-4000-8000-000000000001', vendedor_sin_comision: '20000000-0000-4000-8000-000000000002', jefe: '20000000-0000-4000-8000-000000000003', supervisor: '20000000-0000-4000-8000-000000000004', inactivo: '20000000-0000-4000-8000-000000000005' }
const env = { SUPABASE_URL: 'https://dashboard.test.invalid' }
let fixtures, calls
function auth(rol, overrides = {}) {
  const id = ids[rol] || '20000000-0000-4000-8000-000000000009'
  validateOperator.mockResolvedValue({ user: { id: account, operator_session_id: 'test-session' }, operador: { id, cuenta_id: account, rol, nombre: rol, ...overrides }, headers: {} })
}
function commission(id, seller, dispatch, amount) {
  return { id, vendedorid: seller, despachoid: dispatch, cuentaid: account, estado: 'generada', totalcomision: amount }
}
function installTransport({ failTable, injectSale } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const url = new URL(input)
    expect(url.origin).toBe(env.SUPABASE_URL)
    const table = url.pathname.split('/').at(-1)
    const params = url.searchParams
    calls.push({ table, params: Object.fromEntries(params), query: params.toString(), method: init.method || 'GET' })
    expect(init.method || 'GET').toBe('GET')
    expect(params.get(table === 'comisiones' ? 'cuentaid' : 'cuenta_id')).toBe(`eq.${account}`)
    if (failTable === table) return new Response('{}', { status: 503 })
    let rows = [...(fixtures[table] || [])]
    for (const [key, filter] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue
      rows = rows.filter(row => {
        let value = row[key]
        if (key.startsWith('despacho.')) value = fixtures.notas_despacho.find(sale => sale.id === row.despachoid)?.[key.slice(9)]
        if (filter.startsWith('eq.')) return String(value) === filter.slice(3)
        if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').includes(String(value))
        if (filter.startsWith('gt.')) return Number(value) > Number(filter.slice(3))
        if (filter.startsWith('gte.')) return Date.parse(value) >= Date.parse(filter.slice(4))
        if (filter.startsWith('lt.')) return Date.parse(value) < Date.parse(filter.slice(3))
        throw new Error(`Unimplemented filter ${key}:${filter}`)
      })
    }
    if (table === 'notas_despacho' && injectSale) rows.push(injectSale)
    rows.sort((a, b) => a.id.localeCompare(b.id))
    const offset = Number(params.get('offset') || 0)
    const batch = rows.slice(offset, offset + Math.min(Number(params.get('limit') || 500), 83))
    return new Response(JSON.stringify(batch), { headers: { 'content-range': `${offset}-${offset + batch.length - 1}/${rows.length}` } })
  }))
}
const request = (query = '') => new Request(`https://worker.test.invalid/api/dashboard/inicio?${query}`)
beforeEach(() => {
  calls = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-15T14:00:00Z'))
  const sale = (id, seller, amount, tenant = account) => ({ id, numero: Number(id.replace(/\D/g, '')) || 1, vendedor_id: seller, cuenta_id: tenant, total_usd: amount, creado_en: '2026-09-10T15:00:00Z', estado: 'entregada', flete_usd: 10, corte_usd: 5, forma_pago: 'Efectivo', cliente_id: 'client1' })
  fixtures = {
    usuarios: [{ id: ids.vendedor, cuenta_id: account, rol: 'vendedor', nombre: 'Seller A', activo: true }, { id: ids.vendedor_sin_comision, cuenta_id: account, rol: 'vendedor_sin_comision', nombre: 'Seller B', activo: true }, { id: ids.jefe, cuenta_id: account, rol: 'jefe', nombre: 'Boss private', activo: true }, { id: ids.supervisor, cuenta_id: account, rol: 'supervisor', nombre: 'Supervisor private', activo: true }],
    notas_despacho: [sale('sale1', ids.vendedor, 115), sale('sale2', ids.vendedor_sin_comision, 215), sale('sale3', ids.jefe, 1015), sale('sale4', ids.vendedor, 99999, other), { ...sale('sale5', ids.vendedor, 320), id: 'sale5', numero: 5, creado_en: '2026-09-15T13:00:00Z', estado: 'pendiente' }],
    comisiones: [commission('commission1', ids.vendedor, 'sale1', 4), commission('commission2', ids.vendedor_sin_comision, 'sale2', 8), commission('commission3', ids.vendedor, 'sale2', 1)],
    notas_despacho_items: [1, 2, 3].map(i => ({ id: `item${i}`, cuenta_id: account, despacho_id: `sale${i}`, producto_id: 'product1', cantidad: i })),
    productos: [{ id: 'product1', cuenta_id: account, costo_usd: 30, activo: true, stock_actual: 2, stock_minimo: 5 }],
    clientes: [{ id: 'client1', cuenta_id: account, nombre: 'Private client', activo: true, saldo_pendiente: 100, ciudad: 'Valencia' }],
    cuentas_por_cobrar: [{ id: 'cod1', cuenta_id: account, cliente_id: 'client1', despacho_id: 'sale5', tipo: 'cargo', metodo_pago: 'cod', monto_usd: 40, saldo_usd: 40 }, { id: 'due1', cuenta_id: account, cliente_id: 'client1', despacho_id: 'sale1', tipo: 'cargo', metodo_pago: 'cxc', monto_usd: 90, saldo_usd: 90, fecha_vencimiento: '2026-09-20' }],
  }
  auth('vendedor')
  installTransport()
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })

describe('server-selected home data', () => {
  it('returns own sales and own commission beneficiaries, not other sellers or costs', async () => {
    const response = await handleDashboard(request(), env)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.ventas).toEqual({ totalUsd: 115, despachos: 1 })
    // Seller A receives a split commission on B's sale, not ownership of B's sales.
    expect(body.comisiones.totalUsd).toBe(5)
    expect(body.comisiones.despachos).toBe(2)
    expect(body.ultimasVentas.map(row => row.id)).toEqual(['sale1'])
    expect(body.equipo).toBeUndefined()
    expect(body.gananciasEmpresa).toBeUndefined()
    expect(new Set(calls.map(call => call.table))).toEqual(new Set(['notas_despacho', 'comisiones']))
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('preserves own historic commission for seller_sin_comision without widening scope', async () => {
    auth('vendedor_sin_comision')
    const body = await (await handleDashboard(request(), env)).json()
    expect(body.ventas.totalUsd).toBe(215)
    expect(body.comisiones.totalUsd).toBe(8)
    expect(body.comisiones.sinComisionConfigurada).toBe(true)
    expect(body.equipo).toBeUndefined()
  })
  it('supervisor sees active sellers/supervisors and their earnings, never boss operations or company profit', async () => {
    auth('supervisor')
    const body = await (await handleDashboard(request(), env)).json()
    expect(body.scope).toBe('equipo')
    // Seller A (115). Las ventas de EMPRESA (vendedor_sin_comision) quedan fuera del alcance del supervisor.
    expect(body.ventas.totalUsd).toBe(115)
    expect(body.equipo).toHaveLength(2)
    expect(body.equipo.map(row => row.nombre)).not.toContain('Boss private')
    expect(body.equipo.map(row => row.nombre)).not.toContain('Seller B')
    expect(body.comisiones.totalUsd).toBe(5)
    expect(body.gananciasEmpresa).toBeUndefined()
    expect(calls.every(call => !['clientes', 'productos', 'cuentas_por_cobrar'].includes(call.table))).toBe(true)
  })
  it('boss sees company totals without estimated profit data', async () => {
    auth('jefe')
    const body = await (await handleDashboard(request('periodo=historico'), env)).json()
    expect(body.ventas).toEqual({ totalUsd: 1345, despachos: 3 })
    expect(body.gananciasEmpresa).toBeUndefined()
    expect(calls.every(call => !['notas_despacho_items', 'productos'].includes(call.table))).toBe(true)
    expect(body.equipo).toHaveLength(2)
  })
  it('boss totals include company sales; team table lists only active sellers and supervisors', async () => {
    auth('jefe')
    fixtures.usuarios.push({ id: ids.inactivo, cuenta_id: account, rol: 'vendedor', nombre: 'Gone Seller', activo: false })
    const body = await (await handleDashboard(request('periodo=historico'), env)).json()
    expect(body.ventas.totalUsd).toBe(1345)
    const names = body.equipo.map(row => row.nombre)
    expect(names).toContain('Seller A')
    expect(names).toContain('Supervisor private')
    expect(names).not.toContain('Seller B')
    expect(names).not.toContain('Gone Seller')
    expect(names).not.toContain('Boss private')
  })
  it('administration shows only today pending dispatches plus open COD and near-term debts', async () => {
    auth('administracion')
    const body = await (await handleDashboard(request(), env)).json()
    expect(body.operaciones.pendientes).toBe(1)
    expect(body.operaciones.despachos.map(row => row.id)).toEqual(['sale5'])
    expect(body.operaciones.codPendientes).toBeUndefined()
    expect(body.operaciones.deudasPorVencer).toEqual({ cantidad: 1, totalUsd: 90 })
    const pendingCall = calls.find(call => call.table === 'notas_despacho')
    expect(pendingCall.query).toContain('creado_en=gte.2026-09-15T00%3A00%3A00-04%3A00')
    expect(pendingCall.query).toContain('creado_en=lt.2026-09-16T00%3A00%3A00-04%3A00')
  })
  it('logistics shows only today pending deliveries, never historical ones', async () => {
    auth('logistica')
    fixtures.notas_despacho.push({ ...fixtures.notas_despacho[0], id: 'sale6', numero: 6, creado_en: '2026-09-15T12:00:00Z', estado: 'despachada' })
    const body = await (await handleDashboard(request(), env)).json()
    expect(body.operaciones.pendientes).toBe(1)
    expect(body.operaciones.despachos.map(row => row.id)).toEqual(['sale6'])
    const deliveryCall = calls.find(call => call.table === 'notas_despacho')
    expect(deliveryCall.query).toContain('creado_en=gte.2026-09-15T00%3A00%3A00-04%3A00')
    expect(deliveryCall.query).toContain('creado_en=lt.2026-09-16T00%3A00%3A00-04%3A00')
  })
  it.each(['administracion', 'logistica', 'desarrollador'])('%s does not receive financial or team fields', async role => {
    auth(role)
    const body = await (await handleDashboard(request(), env)).json()
    for (const key of ['ventas', 'comisiones', 'gananciasEmpresa', 'equipo']) expect(body[key]).toBeUndefined()
    expect(calls.every(call => call.table !== 'comisiones')).toBe(true)
  })
  it.each(['rol=jefe', 'vendedorId=other', 'cuenta_id=other', 'periodo=invalid'])('rejects scope manipulation %s before data reads', async query => {
    expect((await handleDashboard(request(query), env)).status).toBe(400)
    expect(calls).toHaveLength(0)
  })
  it('denies unknown role and missing operator session', async () => {
    auth('unknown')
    expect((await handleDashboard(request(), env)).status).toBe(403)
    validateOperator.mockResolvedValue({ user: { id: account }, operador: { id: ids.jefe, cuenta_id: account, rol: 'jefe' }, headers: {} })
    expect((await handleDashboard(request(), env)).status).toBe(403)
    expect(calls).toHaveLength(0)
  })
  it('does not compute any data after failed authentication or wrong tenant', async () => {
    validateOperator.mockResolvedValueOnce({ error: new Response('denied', { status: 401 }) })
    expect((await handleDashboard(request(), env)).status).toBe(401)
    auth('jefe', { cuenta_id: other })
    expect((await handleDashboard(request(), env)).status).toBe(403)
    expect(calls).toHaveLength(0)
  })
  it('fails closed when upstream accidentally returns a foreign seller row', async () => {
    installTransport({ injectSale: { ...fixtures.notas_despacho[1] } })
    expect((await handleDashboard(request(), env)).status).toBe(503)
  })
  it('does not report zero on commission service failure', async () => {
    installTransport({ failTable: 'comisiones' })
    const response = await handleDashboard(request(), env)
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.ventas).toBeUndefined()
    expect(body.comisiones).toBeUndefined()
  })
  it('does not compute company profit anymore, even with missing cost records', async () => {
    auth('jefe')
    fixtures.productos = []
    const body = await (await handleDashboard(request(), env)).json()
    expect(body.gananciasEmpresa).toBeUndefined()
  })
  it('uses unique sales, not commission row count, and fully paginates over 1,000 records', async () => {
    fixtures.notas_despacho = Array.from({ length: 1103 }, (_, i) => ({ ...fixtures.notas_despacho[0], id: `sale-${String(i).padStart(5, '0')}`, total_usd: 1 }))
    fixtures.comisiones = []
    const body = await (await handleDashboard(request(), env)).json()
    expect(body.ventas).toEqual({ totalUsd: 1103, despachos: 1103 })
    expect(body.ultimasVentas).toHaveLength(8)
    expect(calls.filter(call => call.table === 'notas_despacho')).toHaveLength(14)
  })
  it('excludes pending, cancelled, donation, and loan documents', async () => {
    const original = fixtures.notas_despacho[0]
    fixtures.notas_despacho.push({ ...original, id: 'pending', estado: 'pendiente' }, { ...original, id: 'cancelled', estado: 'anulada' }, { ...original, id: 'donation', forma_pago: 'Donación' }, { ...original, id: 'loan', forma_pago: 'Préstamo' })
    const body = await (await handleDashboard(request(), env)).json()
    expect(body.ventas.despachos).toBe(1)
  })
})
