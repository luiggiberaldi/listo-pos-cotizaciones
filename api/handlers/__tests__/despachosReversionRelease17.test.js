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
import { recalcularSaldoPendienteCliente } from '../../lib/cxcUtils.js'
import { handleActualizarEstadoDespacho } from '../despachos.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'test' }
const cuentaId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const operatorId = '11111111-1111-4111-8111-111111111111'
const despachoId = '22222222-2222-4222-8222-222222222222'
const idempotencyKey = '66666666-6666-4666-8666-666666666666'

function auth(rol = 'logistica') {
  return {
    user: { id: cuentaId, operator_id: operatorId },
    operador: { id: operatorId, nombre: 'Operador Test', rol, color: '#000000', cuenta_id: cuentaId },
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

function dispatchRow(estado = 'despachada') {
  return {
    id: despachoId,
    cuenta_id: cuentaId,
    estado,
    numero: 4127,
    cliente_id: '88888888-8888-4888-8888-888888888888',
    cliente_factura_id: null,
    vendedor_id: operatorId,
    transportista_id: null,
    total_usd: 4,
    tiene_devoluciones: false,
    flete_pagado: false,
    forma_pago: JSON.stringify([{
      metodo: 'Cobro a destino',
      monto: '4',
      cobro_destino_pagado: true,
      metodos_pagados: [{ metodo: 'Efectivo $', monto: '4', referencia: '' }],
    }]),
    forma_pago_cliente: null,
  }
}

const ERROR_FUNCION_AUSENTE = {
  code: 'PGRST202',
  message: 'Could not find the function public.revertir_despacho_inventario_atomica(p_despacho_id, p_nuevo_estado, p_usuario_color, p_usuario_id, p_usuario_nombre) in the schema cache',
}

/**
 * fetchMock para despachada → pendiente/anulada.
 * `t4Response` define la respuesta del RPC del release 17
 * (status + cuerpo) para simular base con o sin release 17.
 */
function installFetch({ abonos = [], t4Response, reversaResponse, estado = 'despachada' } = {}) {
  const calls = []
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase()
    const call = { url: String(url), method, body: options.body ? JSON.parse(options.body) : undefined }
    calls.push(call)

    if (String(url).includes('/notas_despacho?id=')) {
      return new Response(JSON.stringify([dispatchRow(estado)]), { status: 200 })
    }
    if (String(url).includes('/rpc/revertir_entrega_finanzas_idempotente')) {
      return new Response(JSON.stringify(reversaResponse.body), { status: reversaResponse.status })
    }
    if (String(url).includes('/comisiones?')) {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (String(url).includes('/cliente_prestamos?')) {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (String(url).includes('/cuentas_por_cobrar')) {
      if (String(url).includes('tipo=eq.abono')) return new Response(JSON.stringify(abonos), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (String(url).includes('/rpc/revertir_despacho_inventario_atomica')) {
      return new Response(JSON.stringify(t4Response.body), { status: t4Response.status })
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

describe('handleActualizarEstadoDespacho — compatibilidad de rollout release 17', () => {
  it('devuelve a pendiente aunque la base aún no tenga el release 17 (ruta desplegada)', async () => {
    const { calls } = installFetch({ t4Response: { status: 404, body: ERROR_FUNCION_AUSENTE } })

    const response = await handleActualizarEstadoDespacho(post({
      despachoId,
      nuevoEstado: 'pendiente',
      motivo_devolucion: 'Cliente ausente',
      idempotencyKey,
    }), ENV)
    const result = await bodyOf(response)

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, nuevoEstado: 'pendiente' })

    // El RPC del release 17 se intentó primero (queda para cuando se suba).
    const t4 = calls.find(c => c.url.includes('/rpc/revertir_despacho_inventario_atomica'))
    expect(t4).toBeTruthy()

    // Se continúa con la ruta desplegada: PATCH de estado con motivo y reset de
    // flete + marcas COD (cobro_destino_pagado → false, metodos_pagados → propuesto).
    const patch = calls.find(c => c.method === 'PATCH' && c.url.includes('/notas_despacho?id='))
    expect(patch).toBeTruthy()
    expect(patch.body).toMatchObject({
      estado: 'pendiente',
      motivo_devolucion: 'Cliente ausente',
      entregada_en: null,
      flete_pagado: false,
    })
    const fp = JSON.parse(patch.body.forma_pago)
    expect(fp[0].cobro_destino_pagado).toBe(false)
    expect(fp[0].metodos_pagados).toBeUndefined()
    expect(fp[0].metodo_propuesto).toEqual([{ metodo: 'Efectivo $', monto: '4', referencia: '' }])

    // Baja de movimientos CxC del despacho + recálculo de saldo del cliente.
    expect(calls.some(c => c.method === 'DELETE' && c.url.includes('/cuentas_por_cobrar?despacho_id=eq.'))).toBe(true)
    expect(recalcularSaldoPendienteCliente).toHaveBeenCalledWith('88888888-8888-4888-8888-888888888888', ENV, expect.anything())
  })

  it('anula desde despachada con la misma ruta cuando falta el release 17', async () => {
    // Anular exige rol administración/supervisor/jefe/desarrollador (guarda 2d).
    validateOperator.mockResolvedValue(auth('administracion'))
    const { calls } = installFetch({ t4Response: { status: 404, body: ERROR_FUNCION_AUSENTE } })

    const response = await handleActualizarEstadoDespacho(post({
      despachoId,
      nuevoEstado: 'anulada',
      motivo_anulacion: 'Prueba de rollout',
      idempotencyKey,
    }), ENV)
    const result = await bodyOf(response)

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, nuevoEstado: 'anulada' })
    const patch = calls.find(c => c.method === 'PATCH' && c.url.includes('/notas_despacho?id='))
    expect(patch.body).toMatchObject({ estado: 'anulada', motivo_anulacion: 'Prueba de rollout', flete_pagado: false })
  })

  it('persiste el motivo cuando la reversión la resuelve la RPC atómica (entregada→pendiente)', async () => {
    // entregada→pendiente pasa por revertir_entrega_finanzas_idempotente: esa
    // ruta salta el PATCH de estado, así que el motivo exige su propio PATCH.
    const { calls } = installFetch({
      estado: 'entregada',
      reversaResponse: { status: 200, body: { ok: true, nuevo_estado: 'pendiente' } },
    })

    const response = await handleActualizarEstadoDespacho(post({
      despachoId,
      nuevoEstado: 'pendiente',
      motivo_devolucion: 'Cliente ausente',
      idempotencyKey,
    }), ENV)
    const result = await bodyOf(response)

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, nuevoEstado: 'pendiente' })

    const rpc = calls.find(c => c.url.includes('/rpc/revertir_entrega_finanzas_idempotente'))
    expect(rpc).toBeTruthy()
    expect(rpc.body).toMatchObject({ p_despacho_id: despachoId, p_nuevo_estado: 'pendiente' })

    // El motivo elegido en la interfaz se persiste pese al salto del PATCH de estado.
    const patch = calls.find(c => c.method === 'PATCH' && c.url.includes('/notas_despacho?id='))
    expect(patch).toBeTruthy()
    expect(patch.body).toEqual({ motivo_devolucion: 'Cliente ausente' })

    // La RPC atómica es la autoridad de finanzas: sin DELETE de CxC por REST.
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  })

  it('no permite anular directamente desde entregada (hay que reabrir primero)', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const { calls } = installFetch({ estado: 'entregada' })

    const response = await handleActualizarEstadoDespacho(post({
      despachoId,
      nuevoEstado: 'anulada',
      motivo_anulacion: 'Error de captura',
      idempotencyKey,
    }), ENV)
    const result = await bodyOf(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toContain('No se puede pasar de')
    expect(result.body.error).toContain('anulada')
    // Nada avanzó: sin RPC de reversión ni PATCH de motivo.
    expect(calls.some(c => c.url.includes('/rpc/revertir_entrega_finanzas_idempotente'))).toBe(false)
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
  })

  it('un error distinto de "función no encontrada" sigue bloqueando la operación', async () => {
    const { calls } = installFetch({
      t4Response: { status: 400, body: { message: 'ESTADO_INVALIDO: Solo se puede revertir un despacho aprobado' } },
    })

    const response = await handleActualizarEstadoDespacho(post({
      despachoId,
      nuevoEstado: 'pendiente',
      motivo_devolucion: 'Cliente ausente',
      idempotencyKey,
    }), ENV)
    const result = await bodyOf(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toContain('No se pudo revertir el despacho con reingreso atómico')
    // Nada avanzó: sin PATCH de estado ni bajas de CxC.
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  })
})
