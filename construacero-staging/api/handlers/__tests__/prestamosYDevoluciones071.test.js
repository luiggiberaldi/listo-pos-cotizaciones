import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
  verifyAuth: vi.fn(),
  getOperatorRole: vi.fn(),
  verifySupervisor: vi.fn(),
  verifyPrivileged: vi.fn(),
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
  logToSystem: vi.fn(() => Promise.resolve()),
}))

vi.mock('../cotizaciones.js', () => ({
  recalcularSaldoPendienteCliente: vi.fn(() => Promise.resolve()),
}))

import { validateOperator } from '../../lib/auth.js'
import {
  handleDevolucionParcialDespacho,
  handleActualizarEstadoDespacho,
} from '../despachos.js'
import { handleFacturarPrestamo } from '../clientes.js'

const ENV = { SUPABASE_URL: 'https://spupqgkdsgohxxfoxydl.supabase.co', SUPABASE_SERVICE_KEY: 'test' }
const CUENTA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACTOR_ID = '44444444-4444-4444-8444-444444444444'
const CLIENTE_ID = '11111111-1111-4111-8111-111111111111'
const DESPACHO_ID = '22222222-2222-4222-8222-222222222222'
const ITEM_VENTA_ID = '33333333-3333-4333-8333-333333333331'
const ITEM_PRESTAMO_ID = '33333333-3333-4333-8333-333333333332'
const PROD_VENTA_ID = '55555555-5555-4555-8555-555555555551'
const PROD_PRESTAMO_ID = '55555555-5555-4555-8555-555555555552'
const PROD_INT_ID = '55555555-5555-4555-8555-555555555553'
const PRESTAMO_ID = '66666666-6666-4666-8666-666666666666'
const IDEM_KEY = '77777777-7777-4777-8777-777777777777'

function makeReq(path, body, method = 'POST') {
  return new Request(`https://staging.erp.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': IDEM_KEY },
    body: JSON.stringify(body),
  })
}

function mockJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('OP-2026-071 Fase 2 (N27 préstamos, N35 bloqueo devolución parcial, N28 reaperturas, N31 intercambios múltiples)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    validateOperator.mockResolvedValue({
      user: { id: CUENTA_ID, operator_id: ACTOR_ID },
      operador: {
        id: ACTOR_ID,
        actor_id: ACTOR_ID,
        cuenta_id: CUENTA_ID,
        nombre: 'Admin Staging',
        rol: 'administracion',
        color: '#0ea5e9',
      },
      headers: { apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      ip: '127.0.0.1',
    })
  })

  it('N35: handleDevolucionParcialDespacho rechaza devolver ítems en préstamo sin llamar a la RPC', async () => {
    const rpcCalls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('/rest/v1/rpc/')) rpcCalls.push(url)
      if (url.includes('/rest/v1/notas_despacho?')) {
        return mockJson([{
          id: DESPACHO_ID, numero: 700, estado: 'entregada',
          cliente_id: CLIENTE_ID, cliente_factura_id: null, cotizacion_id: null,
          cuenta_id: CUENTA_ID, forma_pago: 'Efectivo $', total_usd: 100,
        }])
      }
      if (url.includes('/rest/v1/notas_despacho_items?')) {
        return mockJson([{
          id: ITEM_PRESTAMO_ID, despacho_id: DESPACHO_ID, producto_id: PROD_PRESTAMO_ID,
          nombre_snap: 'Andamio Préstamo', codigo_snap: 'AND-1', unidad_snap: 'und',
          cantidad: 4, precio_unit_usd: 25, descuento_pct: 0, origen: 'inventario', es_prestamo: true,
        }])
      }
      if (url.includes('/rest/v1/despacho_devolucion_intercambios?')) return mockJson([])
      if (url.includes('/rest/v1/cotizacion_items?')) return mockJson([])
      if (url.includes('/rest/v1/despacho_descuentos?')) return mockJson([])
      if (url.includes('/rest/v1/despacho_devoluciones?')) return mockJson([])
      return mockJson({})
    }))

    const res = await handleDevolucionParcialDespacho(makeReq('/api/despachos/devolucion-parcial', {
      despachoId: DESPACHO_ID,
      motivo: 'Intento devolver préstamo en despacho',
      idempotencyKey: IDEM_KEY,
      items: [{
        despacho_item_id: ITEM_PRESTAMO_ID,
        producto_id: PROD_PRESTAMO_ID,
        cantidad_devuelta: 2,
        es_intercambio: false,
      }],
    }), ENV)

    const body = await res.json()
    expect(res.status).toBe(400)
    expect(String(body.error || '').toLowerCase()).toContain('préstamo')
    expect(rpcCalls).toHaveLength(0)
  })

  it('N31: handleDevolucionParcialDespacho suma múltiples filas previas de intercambio del mismo producto', async () => {
    let rpcPayload = null
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (url.includes('/rest/v1/rpc/registrar_devolucion_parcial_cobro_idempotente')) {
        rpcPayload = JSON.parse(opts.body)
        return mockJson({ ok: true, transaccion_atomica: true, idempotent: false })
      }
      if (url.includes('/rest/v1/notas_despacho?')) {
        return mockJson([{
          id: DESPACHO_ID, numero: 701, estado: 'entregada',
          cliente_id: CLIENTE_ID, cliente_factura_id: null, cotizacion_id: null,
          cuenta_id: CUENTA_ID, forma_pago: 'Efectivo $', total_usd: 150,
        }])
      }
      if (url.includes('/rest/v1/notas_despacho_items?')) {
        return mockJson([{
          id: ITEM_VENTA_ID, despacho_id: DESPACHO_ID, producto_id: PROD_VENTA_ID,
          nombre_snap: 'Lámina Zinc', codigo_snap: 'ZIN-1', unidad_snap: 'und',
          cantidad: 10, precio_unit_usd: 15, descuento_pct: 0, origen: 'inventario', es_prestamo: false,
        }])
      }
      if (url.includes('/rest/v1/despacho_devolucion_intercambios?')) {
        // Dos filas previas del MISMO producto (2 + 3 = 5 entregados en intercambio)
        return mockJson([
          { id: '88888888-8888-4888-8888-888888888881', despacho_id: DESPACHO_ID, producto_id: PROD_INT_ID, nombre_snap: 'Pletina 1"', codigo_snap: 'PLE-1', unidad_snap: 'und', cantidad: 2, precio_unit_usd: 10 },
          { id: '88888888-8888-4888-8888-888888888882', despacho_id: DESPACHO_ID, producto_id: PROD_INT_ID, nombre_snap: 'Pletina 1"', codigo_snap: 'PLE-1', unidad_snap: 'und', cantidad: 3, precio_unit_usd: 10 },
        ])
      }
      if (url.includes('/rest/v1/cotizacion_items?')) return mockJson([])
      if (url.includes('/rest/v1/despacho_descuentos?')) return mockJson([])
      if (url.includes('/rest/v1/despacho_devoluciones?')) {
        // Ya se devolvió 1 antes → saldo disponible = (2 + 3) - 1 = 4
        return mockJson([{ despacho_item_id: null, producto_id: PROD_INT_ID, cantidad_devuelta: 1 }])
      }
      return mockJson({})
    }))

    // Solicitar 3 (<= 4) debe proceder aunque ninguna fila individual (2 o 3 minus 1) llegue a 3
    const okRes = await handleDevolucionParcialDespacho(makeReq('/api/despachos/devolucion-parcial', {
      despachoId: DESPACHO_ID,
      motivo: 'Devolución de saldo acumulado de intercambio',
      idempotencyKey: IDEM_KEY,
      items: [{
        despacho_item_id: null,
        producto_id: PROD_INT_ID,
        cantidad_devuelta: 3,
        es_intercambio: true,
        intercambio_id: '88888888-8888-4888-8888-888888888881',
      }],
    }), ENV)
    expect(okRes.status).toBe(200)
    expect(rpcPayload?.p_devoluciones?.[0]?.cantidad_devuelta).toBe(3)

    // Solicitar 5 (> 4) debe fallar con 400
    const badRes = await handleDevolucionParcialDespacho(makeReq('/api/despachos/devolucion-parcial', {
      despachoId: DESPACHO_ID,
      motivo: 'Exceso de intercambio',
      idempotencyKey: IDEM_KEY,
      items: [{
        despacho_item_id: null,
        producto_id: PROD_INT_ID,
        cantidad_devuelta: 5,
        es_intercambio: true,
      }],
    }), ENV)
    expect(badRes.status).toBe(400)
  })

  it('N27: bloquea reabrir despacho a pendiente si tiene préstamos con devoluciones o facturaciones incluso para administracion', async () => {
    const rpcCalls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('/rest/v1/staging_operaciones')) return mockJson([])
      if (url.includes('/rest/v1/notas_despacho?')) {
        return mockJson([{
          id: DESPACHO_ID, numero: 702, estado: 'entregada',
          cliente_id: CLIENTE_ID, tiene_devoluciones: false, tiene_prestamos: true, cuenta_id: CUENTA_ID,
        }])
      }
      if (url.includes('/rest/v1/cliente_prestamos?')) {
        return mockJson([{ cantidad_devuelta: 2, cantidad_facturada: 0 }])
      }
      if (url.includes('/rest/v1/rpc/')) rpcCalls.push(url)
      return mockJson([])
    }))

    const res = await handleActualizarEstadoDespacho(makeReq('/api/despachos/estado', {
      despachoId: DESPACHO_ID,
      nuevoEstado: 'pendiente',
      motivo_devolucion: 'Intento reabrir préstamo ya devuelto parcialmente',
      idempotencyKey: IDEM_KEY,
    }), ENV)

    const body = await res.json()
    expect(res.status).toBe(400)
    expect(String(body.error || '').toLowerCase()).toContain('préstamos')
    expect(rpcCalls).toHaveLength(0)
  })

  it('N27: handleFacturarPrestamo carga deuda en CxC sin modificar stock_actual ni escribir movimientos de inventario', async () => {
    const touchedUrls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      touchedUrls.push({ url, method: opts?.method || 'GET' })
      if (url.includes('/rest/v1/cliente_prestamos?') && (opts?.method || 'GET') === 'GET') {
        return mockJson([{
          id: PRESTAMO_ID,
          cliente_id: CLIENTE_ID,
          despacho_id: DESPACHO_ID,
          producto_id: PROD_PRESTAMO_ID,
          cantidad_prestada: 5,
          cantidad_devuelta: 1,
          cantidad_facturada: 0,
          estado: 'devuelto_parcial',
          producto: { id: PROD_PRESTAMO_ID, precio_usd: 20, nombre: 'Puntal', unidad: 'und' },
          despacho: { numero: 703, cuenta_id: CUENTA_ID },
          cliente: { id: CLIENTE_ID, cuenta_id: CUENTA_ID },
        }])
      }
      if (url.includes('/rest/v1/clientes?')) return mockJson([{ saldo_pendiente: 0 }])
      return mockJson({})
    }))

    const res = await handleFacturarPrestamo(makeReq('/api/clientes/facturar-prestamo', {
      prestamoId: PRESTAMO_ID,
      cantidad: 2,
    }), ENV)

    expect(res.status).toBe(200)
    expect(touchedUrls.some(t => t.url.includes('/rest/v1/productos'))).toBe(false)
    expect(touchedUrls.some(t => t.url.includes('/rest/v1/inventario_movimientos'))).toBe(false)
    expect(touchedUrls.some(t => t.url.includes('/rest/v1/cuentas_por_cobrar') && t.method === 'POST')).toBe(true)
  })

  it('Contrato SQL 311: unifica stock de préstamos en despachos, bloquea préstamo en devolución parcial y agrupa intercambios', () => {
    const migPath = resolve('supabase/migrations/313_staging_prestamos_reapertura_intercambios.sql')
    expect(existsSync(migPath)).toBe(true)
    const sql = readFileSync(migPath, 'utf8')
    expect(sql).toContain('obtener_items_netos_despacho')
    expect(sql).toContain('ITEM_PRESTAMO_NO_DEVOLVIBLE_PARCIAL')
    expect(sql).toContain('PRESTAMO_YA_TIENE_DEVOLUCIONES_O_FACTURAS')
    const [antesDevolucion] = sql.split('CREATE OR REPLACE FUNCTION public.registrar_devolucion_inventario_atomica')
    expect(antesDevolucion).not.toContain('es_prestamo, FALSE) = FALSE')
  })
})
