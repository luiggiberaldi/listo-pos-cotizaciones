import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { handleDashboard } from '../dashboard.js'
import { validateOperator } from '../../lib/auth.js'
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn() }))

const account = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const ids = { vendedor: '20000000-0000-4000-8000-000000000001', vendedor_sin_comision: '20000000-0000-4000-8000-000000000002', jefe: '20000000-0000-4000-8000-000000000003', supervisor: '20000000-0000-4000-8000-000000000004' }
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
    calls.push({ table, params: Object.fromEntries(params), method: init.method || 'GET' })
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
    usuarios: [{ id: ids.vendedor, cuenta_id: account, rol: 'vendedor', nombre: 'Seller A', activo: true }, { id: ids.vendedor_sin_comision, cuenta_id: account, rol: 'vendedor_sin_comision', nombre: 'Seller B', activo: true }, { id: ids.jefe, cuenta_id: account, rol: 'jefe', nombre: 'Boss private', activo: true }],
    notas_despacho: [sale('sale1', ids.vendedor, 115), sale('sale2', ids.vendedor_sin_comision, 215), sale('sale3', ids.jefe, 1015), sale('sale4', ids.vendedor, 99999, other)],
    comisiones: [commission('commission1', ids.vendedor, 'sale1', 4), commission('commission2', ids.vendedor_sin_comision, 'sale2', 8), commission('commission3', ids.vendedor, 'sale2', 1)],
    notas_despacho_items: [1, 2, 3].map(i => ({ id: `item${i}`, cuenta_id: account, despacho_id: `sale${i}`, producto_id: 'product1', cantidad: i })),
    productos: [{ id: 'product1', cuenta_id: account, costo_usd: 30, activo: true, stock_actual: 2, stock_minimo: 5 }],
    clientes: [{ id: 'client1', cuenta_id: account, nombre: 'Private client', activo: true, saldo_pendiente: 100, ciudad: 'Valencia' }],
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
    expect(calls.map(call => call.table)).toEqual(['notas_despacho', 'comisiones'])
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
  it('supervisor sees sellers and their earnings, never boss operations or company profit', async () => {
    auth('supervisor')
    const body = await (await handleDashboard(request(), env)).json()
    expect(body.scope).toBe('equipo')
    expect(body.ventas.totalUsd).toBe(330)
    expect(body.equipo).toHaveLength(2)
    expect(body.equipo.map(row => row.nombre)).not.toContain('Boss private')
    expect(body.comisiones.totalUsd).toBe(13)
    expect(body.gananciasEmpresa).toBeUndefined()
    expect(calls.every(call => !['clientes', 'productos', 'cuentas_por_cobrar'].includes(call.table))).toBe(true)
  })
  it('boss sees company totals and explicitly estimated gross profit', async () => {
    auth('jefe')
    const body = await (await handleDashboard(request('periodo=historico'), env)).json()
    expect(body.ventas).toEqual({ totalUsd: 1345, despachos: 3 })
    expect(body.gananciasEmpresa.brutaEstimadaUsd).toBe(1120)
    expect(body.gananciasEmpresa.base).toBe('costos_actuales')
    expect(body.equipo).toHaveLength(2)
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
  it('does not report an invented company profit when cost records are missing', async () => {
    auth('jefe')
    fixtures.productos = []
    const body = await (await handleDashboard(request(), env)).json()
    expect(body.gananciasEmpresa.brutaEstimadaUsd).toBeNull()
    expect(body.gananciasEmpresa.despachosSinCosto).toBe(3)
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
