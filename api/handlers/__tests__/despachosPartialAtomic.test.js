import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
  verifyAuth: vi.fn(),
  getOperatorRole: vi.fn(),
  verifySupervisor: vi.fn(),
  verifyPrivileged: vi.fn(),
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../lib/cxcUtils.js', () => ({
  recalcularSaldoPendienteCliente: vi.fn(() => Promise.resolve()),
}))

import { validateOperator } from '../../lib/auth.js'
import { registrarAuditoria } from '../../lib/audit.js'
import { handleDevolucionParcialDespacho } from '../despachos.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'test' }
const cuentaId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const operatorId = '11111111-1111-4111-8111-111111111111'
const despachoId = '22222222-2222-4222-8222-222222222222'
const itemId = '33333333-3333-4333-8333-333333333333'
const productId = '44444444-4444-4444-8444-444444444444'
const exchangeProductId = '55555555-5555-4555-8555-555555555555'
const idempotencyKey = '66666666-6666-4666-8666-666666666666'
const replacementId = '77777777-7777-4777-8777-777777777777'

function auth() {
  return {
    user: { id: cuentaId, operator_id: operatorId },
    operador: { id: operatorId, nombre: 'Admin Test', rol: 'administracion', color: '#000000', cuenta_id: cuentaId },
    headers: { apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    ip: '127.0.0.1',
  }
}

function post(body) {
  return new Request('https://app.test/api/despachos/devolucion-parcial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function dispatchRows() {
  return [{
    id: despachoId,
    cuenta_id: cuentaId,
    estado: 'entregada',
    numero: 44,
    cliente_id: '88888888-8888-4888-8888-888888888888',
    cliente_factura_id: null,
    vendedor_id: operatorId,
    transportista_id: null,
    total_usd: 100,
    tiene_devoluciones: false,
  }]
}

function installFetch(rpcResults = []) {
  const calls = []
  const results = [...rpcResults]
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase()
    const call = {
      url: String(url),
      method,
      body: options.body ? JSON.parse(options.body) : undefined,
    }
    calls.push(call)

    if (String(url).includes('/productos?id=')) {
      return new Response(JSON.stringify([{
        id: String(url).includes(exchangeProductId) ? exchangeProductId : productId,
        nombre: String(url).includes(exchangeProductId) ? 'Producto intercambio' : 'Producto devuelto',
        codigo: 'P-001',
        unidad: 'und',
        stock_actual: 10,
        activo: true,
        cuenta_id: cuentaId,
      }]), { status: 200 })
    }
    if (String(url).includes('/notas_despacho?id=')) return new Response(JSON.stringify(dispatchRows()), { status: 200 })
    if (String(url).includes('/notas_despacho_items?')) {
      return new Response(JSON.stringify([{
        id: itemId,
        despacho_id: despachoId,
        producto_id: productId,
        nombre_snap: 'Producto devuelto',
        codigo_snap: 'P-001',
        unidad_snap: 'und',
        cantidad: 2,
        precio_unit_usd: 10,
        descuento_pct: 0,
        origen: 'inventario',
      }]), { status: 200 })
    }
    if (String(url).includes('/despacho_devolucion_intercambios?')) return new Response('[]', { status: 200 })
    if (String(url).includes('/despacho_devoluciones')) return new Response('[]', { status: 200 })
    if (String(url).includes('/cuentas_por_cobrar')) return new Response(JSON.stringify([{ id: 'cxc-1' }]), { status: 200 })
    if (String(url).includes('/rpc/registrar_devolucion_parcial_idempotente') || String(url).includes('/rpc/registrar_devolucion_parcial_cobro_idempotente')) {
      return new Response(JSON.stringify(results.shift() || {
        ok: true,
        transaccion_atomica: true,
        cotizacion_reemplazo_id: replacementId,
        idempotency_key: idempotencyKey,
      }), { status: 200 })
    }

    throw new Error(`[test] llamada no declarada: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

async function bodyOf(response) {
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  validateOperator.mockResolvedValue(auth())
})

describe('handleDevolucionParcialDespacho — P0-C', () => {
  it('rechaza la clave antes de leer o mutar el flujo', async () => {
    const { fetchMock } = installFetch()
    const response = await handleDevolucionParcialDespacho(post({
      despachoId,
      items: [{ despacho_item_id: itemId, cantidad_devuelta: 1 }],
      motivo: 'Prueba',
      idempotencyKey: 'no-es-uuid',
    }), ENV)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('envía devolución, intercambio y cotización de reemplazo a una sola RPC', async () => {
    const { calls } = installFetch([{
      ok: true,
      transaccion_atomica: true,
      cotizacion_reemplazo_id: replacementId,
      idempotency_key: idempotencyKey,
    }])

    const response = await handleDevolucionParcialDespacho(post({
      despachoId,
      items: [{ despacho_item_id: itemId, producto_id: productId, cantidad_devuelta: 1 }],
      exchangeItems: [{ producto_id: exchangeProductId, cantidad: 1, precio_unit_usd: 12 }],
      motivo: 'Producto con daño',
      generarReemplazo: true,
      idempotencyKey,
    }), ENV)
    const result = await bodyOf(response)
    const rpc = calls.find(call => (call.url.includes('/rpc/registrar_devolucion_parcial_idempotente') || call.url.includes('/rpc/registrar_devolucion_parcial_cobro_idempotente')))

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, cotizacionReemplazoId: replacementId, idempotency_key: idempotencyKey })
    expect(rpc.body).toMatchObject({
      p_cuenta_id: cuentaId,
      p_despacho_id: despachoId,
      p_idempotency_key: idempotencyKey,
      p_motivo: 'Producto con daño',
      p_total_devuelto_usd: 10,
      p_total_intercambio_usd: 12,
    })
    expect(rpc.body.p_reemplazo).toMatchObject({
      cliente_id: dispatchRows()[0].cliente_id,
      vendedor_id: operatorId,
      total_usd: 10,
    })
    expect(rpc.body.p_reemplazo.items).toHaveLength(1)
    expect(rpc.body.p_reemplazo.items[0]).toMatchObject({ producto_id: productId, cantidad: 1, total_linea_usd: 10 })
    expect(calls.some(call => call.method === 'PATCH')).toBe(false)
    expect(calls.some(call => call.method === 'POST' && !call.url.includes('/rpc/'))).toBe(false)
    expect(registrarAuditoria).toHaveBeenCalledTimes(1)
  })

  it('replay devuelve la misma cotización sin auditoría ni mutaciones REST duplicadas', async () => {
    const { calls } = installFetch([
      { ok: true, transaccion_atomica: true, cotizacion_reemplazo_id: replacementId, idempotency_key: idempotencyKey },
      { ok: true, idempotent: true, transaccion_atomica: true, cotizacion_reemplazo_id: replacementId, idempotency_key: idempotencyKey },
    ])
    const requestBody = {
      despachoId,
      items: [{ despacho_item_id: itemId, producto_id: productId, cantidad_devuelta: 1 }],
      motivo: 'Reintento',
      generarReemplazo: true,
      idempotencyKey,
    }

    const first = await handleDevolucionParcialDespacho(post(requestBody), ENV)
    const second = await handleDevolucionParcialDespacho(post(requestBody), ENV)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await bodyOf(second)).body).toMatchObject({ idempotent: true, cotizacionReemplazoId: replacementId })
    expect(calls.filter(call => (call.url.includes('/rpc/registrar_devolucion_parcial_idempotente') || call.url.includes('/rpc/registrar_devolucion_parcial_cobro_idempotente')))).toHaveLength(2)
    expect(registrarAuditoria).toHaveBeenCalledTimes(1)
    expect(calls.some(call => call.method === 'PATCH')).toBe(false)
    expect(calls.some(call => call.method === 'POST' && !call.url.includes('/rpc/'))).toBe(false)
  })

  it('rechaza cross-tenant antes de invocar la RPC', async () => {
    const { calls, fetchMock } = installFetch()
    fetchMock.mockImplementation(async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase()
      calls.push({ url: String(url), method, body: options.body ? JSON.parse(options.body) : undefined })
      if (String(url).includes('/productos?id=')) return new Response('[]', { status: 200 })
      if (String(url).includes('/notas_despacho?id=')) return new Response('[]', { status: 200 })
      throw new Error(`[test] no debe llegar a: ${method} ${url}`)
    })

    const response = await handleDevolucionParcialDespacho(post({
      despachoId,
      items: [{ despacho_item_id: itemId, producto_id: productId, cantidad_devuelta: 1 }],
      motivo: 'Cross tenant',
      idempotencyKey,
    }), ENV)

    expect(response.status).toBe(404)
    expect(calls.some(call => call.url.includes('/rpc/'))).toBe(false)
  })

  it('procesa reembolso multi-método delegando los egresos a la RPC atómica (sin INSERT REST post-transacción)', async () => {
    const { calls } = installFetch([{
      ok: true,
      transaccion_atomica: true,
      cotizacion_reemplazo_id: null,
      idempotency_key: idempotencyKey,
      credito_monto: 10,
      destino_saldo: 'reembolso',
      reembolso_total: 10,
    }])

    const response = await handleDevolucionParcialDespacho(post({
      despachoId,
      items: [{ despacho_item_id: itemId, producto_id: productId, cantidad_devuelta: 1 }],
      motivo: 'Devolución de material',
      destinoSaldo: 'reembolso',
      pagosReembolso: [
        { metodo: 'Efectivo $', monto: 6.00, referencia: '' },
        { metodo: 'Transf. / Pago Móvil', monto: 4.00, referencia: 'PM-9988' }
      ],
      idempotencyKey,
    }), ENV)

    const result = await bodyOf(response)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      ok: true,
      totalDevueltoUsd: 10,
      balanceNetoUsd: -10,
      destinoSaldo: 'reembolso',
      reembolsoTotalUsd: 10,
    })

    // La RPC atómica recibe destino y pagos de reembolso (Fase 3)
    const rpcCall = calls.find(call => call.url.includes('/rpc/registrar_devolucion_parcial_cobro_idempotente'))
    expect(rpcCall).toBeTruthy()
    expect(rpcCall.body).toMatchObject({
      p_destino_saldo: 'reembolso',
      p_pagos_reembolso: [
        { metodo: 'Efectivo $', monto: 6 },
        { metodo: 'Transf. / Pago Móvil', monto: 4, referencia: 'PM-9988' },
      ],
    })

    // Ya NO se insertan egresos ni metadatos vía REST post-transacción:
    // la RPC los persiste dentro de su propia transacción.
    expect(calls.some(call => call.method === 'POST' && call.url.includes('/cuentas_por_cobrar'))).toBe(false)
    expect(calls.some(call => call.method === 'PATCH' && call.url.includes('/despacho_devoluciones'))).toBe(false)
  })

  it('rechaza reembolso multi-método si la suma supera el saldo a favor disponible', async () => {
    const { calls } = installFetch()

    const response = await handleDevolucionParcialDespacho(post({
      despachoId,
      items: [{ despacho_item_id: itemId, producto_id: productId, cantidad_devuelta: 1 }],
      motivo: 'Exceso de reembolso',
      destinoSaldo: 'reembolso',
      pagosReembolso: [
        { metodo: 'Efectivo $', monto: 8.00, referencia: '' },
        { metodo: 'Zelle', monto: 5.00, referencia: 'ZEL-123' } // 8 + 5 = 13 > 10
      ],
      idempotencyKey,
    }), ENV)

    const result = await bodyOf(response)
    expect(result.status).toBe(400)
    expect(result.body.error).toContain('supera el saldo a favor disponible')
    expect(calls.some(call => call.url.includes('/rpc/'))).toBe(false)
  })

  it('rechaza reembolso multi-método si método digital no incluye referencia', async () => {
    const { calls } = installFetch()

    const response = await handleDevolucionParcialDespacho(post({
      despachoId,
      items: [{ despacho_item_id: itemId, producto_id: productId, cantidad_devuelta: 1 }],
      motivo: 'Sin referencia',
      destinoSaldo: 'reembolso',
      pagosReembolso: [
        { metodo: 'Transf. / Pago Móvil', monto: 10.00, referencia: '   ' }
      ],
      idempotencyKey,
    }), ENV)

    const result = await bodyOf(response)
    expect(result.status).toBe(400)
    expect(result.body.error).toContain('referencia es obligatoria')
    expect(calls.some(call => call.url.includes('/rpc/'))).toBe(false)
  })

  it('rechaza reembolso multi-método si un método se repite (Opción A)', async () => {
    const { calls } = installFetch()

    const response = await handleDevolucionParcialDespacho(post({
      despachoId,
      items: [{ despacho_item_id: itemId, producto_id: productId, cantidad_devuelta: 1 }],
      motivo: 'Métodos duplicados',
      destinoSaldo: 'reembolso',
      pagosReembolso: [
        { metodo: 'Efectivo $', monto: 6.00, referencia: '' },
        { metodo: 'Efectivo $', monto: 4.00, referencia: '' }
      ],
      idempotencyKey,
    }), ENV)

    const result = await bodyOf(response)
    expect(result.status).toBe(400)
    expect(result.body.error).toContain('no puede repetirse')
    expect(calls.some(call => call.url.includes('/rpc/'))).toBe(false)
  })
})
