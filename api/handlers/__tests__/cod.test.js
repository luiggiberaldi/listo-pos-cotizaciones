import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleConciliarPagoCod, handleResumenFinancieroDespacho } from '../cod.js'
import { handleEditarPagoDespacho } from '../despachos.js'
import { validateOperator } from '../../lib/auth.js'

vi.mock('../../lib/auth.js', () => ({
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
  validateOperator: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null) }))

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const DISPATCH = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const OPERATOR = 'cccccccc-3333-4333-8333-cccccccccccc'
const KEY = 'dddddddd-4444-4444-8444-dddddddddddd'
const ENV = { SUPABASE_URL: 'https://cod.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const privileged = { id: OPERATOR, nombre: 'Admin test', rol: 'administracion', cuenta_id: ACCOUNT }
const headers = { apikey: 'service-test', Authorization: 'Bearer service-test', 'Content-Type': 'application/json' }
const request = (body, path = '/api/despachos/conciliar-cod', extraHeaders = {}) => new Request(`https://worker.test.invalid${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body),
})
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
let fetchMock

function setAuth(operator = privileged) {
  validateOperator.mockResolvedValue({
    user: { id: ACCOUNT, operator_id: operator.id },
    operador: operator,
    headers,
    ip: '127.0.0.1',
  })
}

function dispatchRow({ forms = [{ metodo: 'Cobro a destino', monto: 270 }], estado = 'despachada' } = {}) {
  const payment = JSON.stringify(forms)
  return {
    id: DISPATCH,
    estado,
    vendedor_id: OPERATOR,
    total_usd: 270,
    cliente_id: OPERATOR,
    forma_pago: payment,
    forma_pago_cliente: payment,
  }
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

describe('handleResumenFinancieroDespacho (R1)', () => {
  it('llama a la RPC tenant-scoped y devuelve resumen', async () => {
    const summary = { cuenta_id: ACCOUNT, despacho_id: DISPATCH, cod: { estado: 'pendiente' }, fuente: 'cuentas_por_cobrar' }
    fetchMock.mockResolvedValueOnce(jsonResponse(summary))
    const response = await handleResumenFinancieroDespacho(request({ despachoId: DISPATCH }), ENV)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ resumen: summary })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${ENV.SUPABASE_URL}/rest/v1/rpc/resumen_financiero_despacho`)
    expect(JSON.parse(init.body)).toEqual({ p_cuenta_id: ACCOUNT, p_despacho_id: DISPATCH })
  })

  it('rechaza despacho inválido y vendedor antes de consultar la base', async () => {
    expect((await handleResumenFinancieroDespacho(request({ despachoId: 'not-uuid' }), ENV)).status).toBe(400)
    setAuth({ ...privileged, rol: 'vendedor' })
    expect((await handleResumenFinancieroDespacho(request({ despachoId: DISPATCH }), ENV)).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('handleConciliarPagoCod (R2/R3)', () => {
  const validBody = {
    despachoId: DISPATCH,
    idempotencyKey: KEY,
    pagos: [{ metodo: 'Zelle', monto: 174, referencia: 'TX-99382' }],
    evidencia: 'Comprobante bancario recibido 24/09/2026',
  }

  it('registra todo en una RPC atómica con tenant, idempotencia y evidencia', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, transaccion_atomica: true, estado_cod: 'cobrado', pago_usd: 174 }))
    const response = await handleConciliarPagoCod(request(validBody), ENV)
    expect(response.status).toBe(200)
    expect((await response.json()).transaccion_atomica).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${ENV.SUPABASE_URL}/rest/v1/rpc/registrar_pago_externo_cobro_idempotente`)
    expect(JSON.parse(init.body)).toEqual({
      p_cuenta_id: ACCOUNT,
      p_despacho_id: DISPATCH,
      p_idempotency_key: KEY,
      p_usuario_id: OPERATOR,
      p_usuario_nombre: 'Admin test',
      p_pagos: [{ metodo: 'Zelle', monto: 174, referencia: 'TX-99382' }],
      p_evidencia: validBody.evidencia,
      p_ip_origen: null,
    })
  })

  it('envía efectivo Bs con equivalente USD y snapshot de la tasa seleccionada', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, estado_cod: 'parcial', pago_usd: 100 }))
    const response = await handleConciliarPagoCod(request({
      ...validBody,
      pagos: [{ metodo: 'Efectivo Bs', monto: 100, monto_bs: 20000, tasa_snapshot: 200,
        tasa_fuente: 'USDT', tasa_actualizada_en: '2026-10-02T12:00:00.000Z' }],
    }), ENV)
    expect(response.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_pagos[0]).toEqual({
      metodo: 'Efectivo Bs', monto: 100, monto_bs: 20000, tasa_snapshot: 200,
      tasa_fuente: 'USDT', tasa_actualizada_en: '2026-10-02T12:00:00.000Z', referencia: null,
    })
  })

  it('acepta conversiones de medio centavo con redondeo SQL half-up y rechaza precision extra en Bs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, pago_usd: 10_000.01 }))
    const response = await handleConciliarPagoCod(request({
      ...validBody,
      pagos: [{ metodo: 'Efectivo Bs', monto: 10_000.01, monto_bs: 20000.01, tasa_snapshot: 2, tasa_fuente: 'Manual' }],
    }), ENV)
    expect(response.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_pagos[0].monto).toBe(10_000.01)

    const invalidPrecision = await handleConciliarPagoCod(request({
      ...validBody, pagos: [{ metodo: 'Efectivo Bs', monto: 0.01, monto_bs: 1.001, tasa_snapshot: 200, tasa_fuente: 'Manual' }],
    }), ENV)
    expect(invalidPrecision.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rechaza efectivo Bs sin tasa válida o con equivalente USD inconsistente', async () => {
    const responseSinTasa = await handleConciliarPagoCod(request({
      ...validBody, pagos: [{ metodo: 'Efectivo Bs', monto: 100, monto_bs: 20000 }],
    }), ENV)
    const responseInconsistente = await handleConciliarPagoCod(request({
      ...validBody, pagos: [{ metodo: 'Efectivo Bs', monto: 101, monto_bs: 20000, tasa_snapshot: 200, tasa_fuente: 'USDT' }],
    }), ENV)
    const responsePrecisionInvalida = await handleConciliarPagoCod(request({
      ...validBody, pagos: [{ metodo: 'Efectivo Bs', monto: 100, monto_bs: 20000, tasa_snapshot: 200.000000001, tasa_fuente: 'USDT' }],
    }), ENV)
    expect(responseSinTasa.status).toBe(400)
    expect(responseInconsistente.status).toBe(400)
    expect(responsePrecisionInvalida.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('permite enviar un abono COD parcial menor al saldo ledger', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, estado_cod: 'parcial', saldo_restante_usd: 74 }))
    const response = await handleConciliarPagoCod(request({
      ...validBody, pagos: [{ metodo: 'Zelle', monto: 100, referencia: 'TX-PARCIAL' }],
    }), ENV)
    expect(response.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_pagos[0].monto).toBe(100)
  })

  it('deniega vendedor sin llamar a la RPC', async () => {
    setAuth({ ...privileged, rol: 'vendedor' })
    const response = await handleConciliarPagoCod(request(validBody), ENV)
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bloquea al desarrollador virtual porque no existe como actor contable', async () => {
    setAuth({
      ...privileged,
      id: '00000000-0000-0000-0000-000000000000',
      rol: 'desarrollador',
    })
    validateOperator.mockResolvedValueOnce({
      user: { id: ACCOUNT, operator_virtual_developer: true },
      operador: { id: '00000000-0000-0000-0000-000000000000', rol: 'desarrollador', cuenta_id: ACCOUNT },
      headers,
    })
    const response = await handleConciliarPagoCod(request(validBody), ENV)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('usuario contable válido')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'COD_CONCILIACION_MONTO_NOMINAL_INVALIDO',
    'COD_CONCILIACION_DESPACHO_CAMBIO',
  ])('devuelve error de negocio %s como 400, no como fallo de servicio', async errorCode => {
    fetchMock.mockResolvedValueOnce(new Response(errorCode, { status: 400 }))
    const response = await handleConciliarPagoCod(request(validBody), ENV)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain(errorCode)
  })

  it('requiere evidencia y referencias para medios no efectivo', async () => {
    expect((await handleConciliarPagoCod(request({ ...validBody, evidencia: ' x ' }), ENV)).status).toBe(400)
    expect((await handleConciliarPagoCod(request({ ...validBody, pagos: [{ metodo: 'Zelle', monto: 174 }] }), ENV)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza métodos contables y montos inválidos', async () => {
    expect((await handleConciliarPagoCod(request({ ...validBody, pagos: [{ metodo: 'Cruce', monto: 174 }] }), ENV)).status).toBe(400)
    expect((await handleConciliarPagoCod(request({ ...validBody, pagos: [{ metodo: 'Zelle', monto: '174.001', referencia: 'TX' }] }), ENV)).status).toBe(400)
    expect((await handleConciliarPagoCod(request({ ...validBody, pagos: [{ metodo: 'Zelle', monto: '1e2', referencia: 'TX' }] }), ENV)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza efectivo Bs con más de dos decimales aunque el valor numérico se redondee', async () => {
    const response = await handleConciliarPagoCod(request({
      ...validBody,
      pagos: [{ metodo: 'Efectivo Bs', monto: 0.01, monto_bs: '1.001', tasa_snapshot: 200, tasa_fuente: 'Manual' }],
    }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('acepta pago hasta un centavo sobre el saldo y lo registra como excedente en resultado', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, estado_cod: 'cobrado', saldo_restante_usd: 0, excedente_usd: 0.01, pago_usd: 174.01 }))
    const response = await handleConciliarPagoCod(request({
      ...validBody, pagos: [{ metodo: 'Zelle', monto: '174.01', referencia: 'TX-OVER-CENT' }],
    }), ENV)
    expect(response.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_pagos[0].monto).toBe(174.01)
    expect((await response.json()).excedente_usd).toBe(0.01)
  })

  it('acepta importes positivos de un centavo', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, estado_cod: 'parcial', pago_usd: 0.01 }))
    const response = await handleConciliarPagoCod(request({
      ...validBody, pagos: [{ metodo: 'Efectivo $', monto: '0.01' }],
    }), ENV)
    expect(response.status).toBe(200)
  })

  it('rechaza un monto en Bs con formato numérico exponencial', async () => {
    const response = await handleConciliarPagoCod(request({
      ...validBody,
      pagos: [{ metodo: 'Efectivo Bs', monto: '0.01', monto_bs: '2e2', tasa_snapshot: 2, tasa_fuente: 'Manual' }],
    }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza error de saldo neto y no usa una segunda ruta de escritura', async () => {
    fetchMock.mockResolvedValueOnce(new Response('COD_CONCILIACION_MONTO_NO_COINCIDE', { status: 400 }))
    const response = await handleConciliarPagoCod(request(validBody), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('acepta llave estable desde cabecera', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const response = await handleConciliarPagoCod(request({ ...validBody, idempotencyKey: undefined }, '/api/despachos/conciliar-cod', { 'Idempotency-Key': KEY }), ENV)
    expect(response.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_idempotency_key).toBe(KEY)
  })
})

describe('handleEditarPagoDespacho (guardarraíles R3)', () => {
  it('rechaza la conciliación sin abono antes de consultar el despacho', async () => {
    const response = await handleEditarPagoDespacho(request({ despachoId: DISPATCH, codSinAbono: true }, '/api/despachos/editar-pago'), ENV)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('sin asiento contable está deshabilitada')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no permite cambiar flag COD a pagado en JSON legado', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([dispatchRow()]))
    const paid = JSON.stringify([{ metodo: 'Cobro a destino', monto: 270, cobro_destino_pagado: true }])
    const response = await handleEditarPagoDespacho(request({ despachoId: DISPATCH, formaPago: paid, formaPagoCliente: paid }, '/api/despachos/editar-pago'), ENV)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('registro atómico')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('no permite borrar obligación COD reemplazándola por efectivo', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([dispatchRow()]))
    const replacement = JSON.stringify([{ metodo: 'Efectivo $', monto: 270 }])
    const response = await handleEditarPagoDespacho(request({ despachoId: DISPATCH, formaPago: replacement, formaPagoCliente: replacement }, '/api/despachos/editar-pago'), ENV)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('No se puede quitar')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('handleEditarPagoDespacho — métodos de pago en entregada (solo administración)', () => {
  const formas = JSON.stringify([{ metodo: 'Efectivo $', monto: 270 }])
  const soloPagoBody = { despachoId: DISPATCH, soloPagoEntregado: true, formaPago: formas, formaPagoCliente: formas }
  const filaEntregada = () => dispatchRow({ forms: [{ metodo: 'Efectivo $', monto: 270 }], estado: 'entregada' })

  it('vendedor con flag: rechazo 403 sin consultar la base', async () => {
    setAuth({ ...privileged, rol: 'vendedor' })
    const response = await handleEditarPagoDespacho(request(soloPagoBody, '/api/despachos/editar-pago'), ENV)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('Solo administración')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('administración con campos mixtos (pago + flete): rechazo 400 sin consultar la base', async () => {
    const response = await handleEditarPagoDespacho(request({ ...soloPagoBody, fleteUsd: 5 }, '/api/despachos/editar-pago'), ENV)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('solo acepta')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rol sin flag explícito no abre la vía nueva (guard de entregada)', async () => {
    setAuth({ ...privileged, rol: 'vendedor' })
    fetchMock.mockResolvedValueOnce(jsonResponse([filaEntregada()]))
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    const response = await handleEditarPagoDespacho(request({ despachoId: DISPATCH, formaPago: formas, formaPagoCliente: formas }, '/api/despachos/editar-pago'), ENV)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('estado entregado')
  })

  it('administración con flag incompleto (falta formaPagoCliente): rechazo 400', async () => {
    const response = await handleEditarPagoDespacho(request({ ...soloPagoBody, formaPagoCliente: undefined }, '/api/despachos/editar-pago'), ENV)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('solo acepta')
  })

  it('administración puede editar solo métodos de pago en entregada, sin recalcular comisión', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([filaEntregada()]))
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    const response = await handleEditarPagoDespacho(request(soloPagoBody, '/api/despachos/editar-pago'), ENV)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')
    expect(patch).toBeDefined()
    const campos = JSON.parse(patch[1].body)
    expect(Object.keys(campos).sort()).toEqual(['forma_pago', 'forma_pago_cliente'])
    const llamadoRpc = fetchMock.mock.calls.some(c => String(c[0]).includes('/rpc/'))
    expect(llamadoRpc).toBe(false)
  })

  it('el aviso de comisión se emite cuando el despacho ya tiene comisión', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(jsonResponse([filaEntregada()]))
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'com-1', estado: 'generada' }]))
    const response = await handleEditarPagoDespacho(request(soloPagoBody, '/api/despachos/editar-pago'), ENV)
    expect(response.status).toBe(200)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('revisar manualmente'))
    warnSpy.mockRestore()
  })
})
