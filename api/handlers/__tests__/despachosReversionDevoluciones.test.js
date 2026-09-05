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
import { handleActualizarEstadoDespacho } from '../despachos.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'test' }
const cuentaId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const operatorId = '11111111-1111-4111-8111-111111111111'
const despachoId = '22222222-2222-4222-8222-222222222222'
const idempotencyKey = '66666666-6666-4666-8666-666666666666'

function auth() {
  // logistica pasa los roles de devolución (2e) y NO bypasea los guardarraíles
  return {
    user: { id: cuentaId, operator_id: operatorId },
    operador: { id: operatorId, nombre: 'Logistica Test', rol: 'logistica', color: '#000000', cuenta_id: cuentaId },
    headers: { apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    ip: '127.0.0.1',
  }
}

function post(body) {
  return new Request('https://app.test/api/despachos/estado', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function dispatchRow() {
  return {
    id: despachoId,
    cuenta_id: cuentaId,
    estado: 'entregada',
    numero: 954,
    cliente_id: '88888888-8888-4888-8888-888888888888',
    cliente_factura_id: null,
    vendedor_id: operatorId,
    transportista_id: null,
    total_usd: 2,
    tiene_devoluciones: true,
    flete_pagado: false,
  }
}

/**
 * fetchMock con las rutas que consume handleActualizarEstadoDespacho para
 * entregada → pendiente (reversión vía RPC).
 */
function installFetch({ abonos = [], rpcResult = null } = {}) {
  const calls = []
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase()
    const call = { url: String(url), method, body: options.body ? JSON.parse(options.body) : undefined }
    calls.push(call)

    if (String(url).includes('/notas_despacho?id=')) {
      return new Response(JSON.stringify([dispatchRow()]), { status: 200 })
    }
    if (String(url).includes('/comisiones?')) {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (String(url).includes('/cliente_prestamos?')) {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (String(url).includes('/cuentas_por_cobrar')) {
      if (String(url).includes('tipo=eq.credito')) return new Response(JSON.stringify([]), { status: 200 })
      if (String(url).includes('tipo=eq.abono')) return new Response(JSON.stringify(abonos), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (String(url).includes('/rpc/revertir_entrega_finanzas_idempotente')) {
      return new Response(JSON.stringify(rpcResult || {
        ok: true,
        despacho_id: despachoId,
        nuevo_estado: 'pendiente',
        finanzas_revertidas: true,
        cxc_movimientos_eliminados: 3,
        comisiones_eliminadas: 1,
        abonos_devolucion_anulados: 2,
        credito_anulado_usd: 0,
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

describe('handleActualizarEstadoDespacho — reversión consciente de devoluciones (release 06)', () => {
  it('permite revertir un despacho con abonos solo de devolución, delegando en la RPC sin mutaciones REST', async () => {
    const { calls } = installFetch({
      abonos: [{ id: 'cxc-ab-1', monto_usd: 1.9, forma_pago_abono: 'Devolución' }],
    })

    const response = await handleActualizarEstadoDespacho(post({
      despachoId,
      nuevoEstado: 'pendiente',
      motivo_devolucion: 'Cliente ausente',
      idempotencyKey,
    }), ENV)
    const result = await bodyOf(response)

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, nuevoEstado: 'pendiente', finanzas_atomicas: true })

    const rpc = calls.find(c => c.url.includes('/rpc/revertir_entrega_finanzas_idempotente'))
    expect(rpc).toBeTruthy()
    expect(rpc.body).toMatchObject({ p_despacho_id: despachoId, p_nuevo_estado: 'pendiente' })

    // La reversión es 100% RPC: sin DELETE de CxC ni PATCH de estado por REST.
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
  })

  it('bloquea la reversión cuando existe un cobro real (forma de pago distinta de Devolución/Saldo a favor)', async () => {
    const { calls } = installFetch({
      abonos: [
        { id: 'cxc-ab-1', monto_usd: 1.9, forma_pago_abono: 'Devolución' },
        { id: 'cxc-ab-2', monto_usd: 2.0, forma_pago_abono: 'Efectivo $' },
      ],
    })

    const response = await handleActualizarEstadoDespacho(post({
      despachoId,
      nuevoEstado: 'pendiente',
      motivo_devolucion: 'Cliente ausente',
      idempotencyKey,
    }), ENV)
    const result = await bodyOf(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toContain('cobros reales')
    expect(result.body.error).toContain('$2.00')
    expect(calls.some(c => c.url.includes('/rpc/revertir_entrega_finanzas_idempotente'))).toBe(false)
  })

  it('bloquea la reversión cuando el abono no tiene forma de pago (conservador)', async () => {
    const { calls } = installFetch({
      abonos: [{ id: 'cxc-ab-legacy', monto_usd: 5, forma_pago_abono: null }],
    })

    const response = await handleActualizarEstadoDespacho(post({
      despachoId,
      nuevoEstado: 'pendiente',
      motivo_devolucion: 'Cliente ausente',
      idempotencyKey,
    }), ENV)
    const result = await bodyOf(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toContain('cobros reales')
    expect(calls.some(c => c.url.includes('/rpc/revertir_entrega_finanzas_idempotente'))).toBe(false)
  })
})
