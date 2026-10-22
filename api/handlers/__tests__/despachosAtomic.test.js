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
import { handleActualizarEstadoDespacho } from '../despachos.js'

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
}
const cuentaId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const operatorId = '11111111-1111-4111-8111-111111111111'
const despachoId = '22222222-2222-4222-8222-222222222222'
const cotizacionId = '33333333-3333-4333-8333-333333333333'
const idempotencyKey = '44444444-4444-4444-8444-444444444444'

function auth(rol = 'administracion') {
  return {
    user: { id: cuentaId, operator_id: operatorId },
    operador: {
      id: operatorId,
      nombre: 'Admin Test',
      rol,
      color: '#000000',
      cuenta_id: cuentaId,
    },
    headers: {
      apikey: 'test',
      Authorization: 'Bearer test',
      'Content-Type': 'application/json',
    },
    ip: '127.0.0.1',
  }
}

function post(body, extraHeaders = {}) {
  return new Request('https://app.test/api/despachos/estado', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  })
}

function despachoResponse(estado) {
  return new Response(JSON.stringify([{
    id: despachoId,
    cuenta_id: cuentaId,
    estado,
    numero: 17,
    vendedor_id: operatorId,
    cliente_id: '55555555-5555-4555-8555-555555555555',
    cliente_factura_id: null,
    cotizacion_id: cotizacionId,
    total_usd: 100,
    forma_pago: '[]',
    forma_pago_cliente: '[]',
    tiene_devoluciones: false,
    flete_pagado: false,
    despachada_en: estado === 'despachada' ? '2026-08-20T10:00:00.000Z' : null,
  }]), { status: 200 })
}

function installFetch({ estado = 'despachada', rpcResults = [] } = {}) {
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

    if (String(url).includes('/notas_despacho?id=')) return despachoResponse(estado)
    if (String(url).includes('/rpc/confirmar_entrega_finanzas_idempotente')) {
      return new Response(JSON.stringify(results.shift() || {
        ok: true,
        nuevo_estado: 'entregada',
        lote_id: '66666666-6666-4666-8666-666666666666',
        movimientos: 1,
        finanzas_atomicas: true,
      }), { status: 200 })
    }
    if (String(url).includes('/rpc/revertir_entrega_finanzas_idempotente')) {
      return new Response(JSON.stringify(results.shift() || {
        ok: true,
        nuevo_estado: 'pendiente',
        lote_id: '77777777-7777-4777-8777-777777777777',
        movimientos: 1,
        finanzas_revertidas: true,
      }), { status: 200 })
    }
    if (String(url).includes('/comisiones?')) return new Response('[]', { status: 200 })
    if (String(url).includes('/cuentas_por_cobrar?')) return new Response('[]', { status: 200 })
    if (String(url).includes('/clientes?')) return new Response(JSON.stringify([{ vendedor_id: operatorId }]), { status: 200 })
    if (String(url).includes('/usuarios?')) return new Response(JSON.stringify([{ rol: 'administracion', markup_pct: 0 }]), { status: 200 })
    if (String(url).includes('/seguimiento_operativo')) return new Response('{}', { status: 201 })
    if (String(url).includes('/cotizaciones?')) return new Response(JSON.stringify([{ cliente_id: '55555555-5555-4555-8555-555555555555', numero: 17 }]), { status: 200 })

    throw new Error(`[test] llamada no declarada: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

async function readBody(response) {
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  validateOperator.mockResolvedValue(auth())
})

describe('handleActualizarEstadoDespacho — P0-B', () => {
  it('rechaza una clave inválida antes de leer el despacho', async () => {
    const { fetchMock } = installFetch()

    const response = await handleActualizarEstadoDespacho(
      post({ despachoId, nuevoEstado: 'entregada', idempotencyKey: 'no-es-uuid' }),
      ENV,
    )

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('confirma entrega con el wrapper financiero y no hace PATCH de stock/Kardex/CxC', async () => {
    const { calls } = installFetch({
      estado: 'despachada',
      rpcResults: [{
        ok: true,
        nuevo_estado: 'entregada',
        lote_id: '66666666-6666-4666-8666-666666666666',
        movimientos: 2,
        finanzas_atomicas: true,
      }],
    })

    const response = await handleActualizarEstadoDespacho(
      post({ despachoId, nuevoEstado: 'entregada', tasaBcv: 36.5, idempotencyKey }),
      ENV,
    )
    const result = await readBody(response)

    expect(response.status).toBe(200)
    expect(result.body).toMatchObject({
      ok: true,
      nuevoEstado: 'entregada',
      idempotency_key: idempotencyKey,
      inventario_atomico: true,
      finanzas_atomicas: true,
      frontera_financiera: 'sql_atomic',
    })

    const rpcCall = calls.find(call => call.url.includes('/rpc/confirmar_entrega_finanzas_idempotente'))
    expect(rpcCall).toBeDefined()
    expect(rpcCall.body).toEqual({
      p_cuenta_id: cuentaId,
      p_despacho_id: despachoId,
      p_idempotency_key: idempotencyKey,
      p_usuario_id: operatorId,
      p_usuario_nombre: 'Admin Test',
      p_usuario_color: '#000000',
      p_tasa_snapshot: 36.5,
      p_permitir_negativo: null,
    })
    expect(calls.some(call => call.method === 'PATCH' && call.url.includes('/productos'))).toBe(false)
    expect(calls.some(call => call.url.includes('/inventario_movimientos'))).toBe(false)
    expect(calls.some(call => call.method === 'POST' && call.url.includes('/cuentas_por_cobrar'))).toBe(false)
    expect(calls.some(call => call.method === 'POST' && call.url.includes('/comisiones'))).toBe(false)
    expect(calls.find(call => call.url.includes('/notas_despacho?id=')).url).toContain(`cuenta_id=eq.${cuentaId}`)
    expect(registrarAuditoria).toHaveBeenCalledTimes(1)
  })

  it('reproduce una entrega sin repetir efectos auxiliares', async () => {
    const { calls } = installFetch({
      estado: 'despachada',
      rpcResults: [
        { ok: true, nuevo_estado: 'entregada', lote_id: '88888888-8888-4888-8888-888888888888', movimientos: 1, finanzas_atomicas: true },
        { ok: true, idempotent: true, nuevo_estado: 'entregada', lote_id: '88888888-8888-4888-8888-888888888888', movimientos: 1, finanzas_atomicas: true },
      ],
    })

    const first = await handleActualizarEstadoDespacho(post({ despachoId, nuevoEstado: 'entregada', idempotencyKey }), ENV)
    const second = await handleActualizarEstadoDespacho(post({ despachoId, nuevoEstado: 'entregada', idempotencyKey }), ENV)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await readBody(second)).body.idempotent).toBe(true)
    expect(calls.filter(call => call.url.includes('/rpc/confirmar_entrega_finanzas')).map(call => call.body.p_idempotency_key)).toEqual([idempotencyKey, idempotencyKey])
    expect(registrarAuditoria).toHaveBeenCalledTimes(1)
  })

  it('revierte entrega mediante el wrapper financiero y no borra CxC/comisión desde REST', async () => {
    const { calls } = installFetch({
      estado: 'entregada',
      rpcResults: [{ ok: true, nuevo_estado: 'pendiente', lote_id: '99999999-9999-4999-8999-999999999999', movimientos: 1, finanzas_revertidas: true }],
    })

    const response = await handleActualizarEstadoDespacho(
      post({ despachoId, nuevoEstado: 'pendiente', motivo_devolucion: 'Revisión de entrega', idempotencyKey }),
      ENV,
    )
    const result = await readBody(response)

    expect(response.status).toBe(200)
    expect(result.body).toMatchObject({
      ok: true,
      nuevoEstado: 'pendiente',
      idempotency_key: idempotencyKey,
      inventario_atomico: true,
      finanzas_atomicas: true,
    })
    const rpcCall = calls.find(call => call.url.includes('/rpc/revertir_entrega_finanzas_idempotente'))
    expect(rpcCall.body).toMatchObject({
      p_cuenta_id: cuentaId,
      p_despacho_id: despachoId,
      p_idempotency_key: idempotencyKey,
      p_nuevo_estado: 'pendiente',
      p_usuario_id: operatorId,
    })
    expect(calls.some(call => call.method === 'PATCH' && call.url.includes('/productos'))).toBe(false)
    expect(calls.some(call => call.method === 'DELETE' && (call.url.includes('/cuentas_por_cobrar') || call.url.includes('/comisiones')))).toBe(false)
    expect(calls.some(call => call.url.includes('/inventario_movimientos'))).toBe(false)
  })

  it('rechaza cross-tenant antes de invocar cualquier wrapper', async () => {
    const { calls, fetchMock } = installFetch({ estado: 'despachada' })
    fetchMock.mockImplementation(async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase()
      calls.push({ url: String(url), method, body: options.body ? JSON.parse(options.body) : undefined })
      if (String(url).includes('/notas_despacho?id=')) return new Response('[]', { status: 200 })
      throw new Error(`[test] no debe llegar a: ${method} ${url}`)
    })

    const response = await handleActualizarEstadoDespacho(post({ despachoId, nuevoEstado: 'entregada', idempotencyKey }), ENV)

    expect(response.status).toBe(404)
    expect(calls.some(call => call.url.includes('/rpc/'))).toBe(false)
  })

  it('conserva el guardarraíl de flete pagado antes de la reversión', async () => {
    const { calls } = installFetch({ estado: 'entregada' })
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase()
      calls.push({ url: String(url), method, body: options.body ? JSON.parse(options.body) : undefined })
      if (String(url).includes('/notas_despacho?id=')) {
        return new Response(JSON.stringify([{ ...JSON.parse((await despachoResponse('entregada').text()))[0], flete_pagado: true }]), { status: 200 })
      }
      return originalFetch(url, options)
    }))

    const response = await handleActualizarEstadoDespacho(post({ despachoId, nuevoEstado: 'pendiente', idempotencyKey }), ENV)

    expect(response.status).toBe(400)
    expect(calls.some(call => call.url.includes('/rpc/'))).toBe(false)
  })
})
