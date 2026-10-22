import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
}))

import { validateOperator } from '../../lib/auth.js'
import { registrarAuditoria } from '../../lib/audit.js'
import { handleDevolverPrestamo } from '../clientes.js'

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
}
const cuentaId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const operatorId = '11111111-1111-4111-8111-111111111111'
const loanId = '22222222-2222-4222-8222-222222222222'
const clientId = '33333333-3333-4333-8333-333333333333'
const dispatchId = '44444444-4444-4444-8444-444444444444'
const idempotencyKey = '55555555-5555-4555-8555-555555555555'

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
  return new Request('https://app.test/api/clientes/prestamos/devolver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  })
}

function loanResponse() {
  return new Response(JSON.stringify([{
    id: loanId,
    cliente_id: clientId,
    despacho_id: dispatchId,
    producto: { nombre: 'Producto préstamo', unidad: 'und' },
    despacho: { numero: 17 },
  }]), { status: 200 })
}

function installFetch({ rpcResults = [{ ok: true, nuevo_estado: 'devuelto_parcial', cantidad_devuelta: 3, lote_id: '66666666-6666-4666-8666-666666666666', numero: 81 }] } = {}) {
  const calls = []
  const results = [...rpcResults]
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase()
    const call = { url: String(url), method, body: options.body ? JSON.parse(options.body) : undefined }
    calls.push(call)

    if (String(url).includes('/cliente_prestamos?')) return loanResponse()
    if (String(url).includes('/clientes?')) return new Response(JSON.stringify([{ id: clientId }]), { status: 200 })
    if (String(url).includes('/rpc/devolver_prestamo_inventario_atomico')) {
      return new Response(JSON.stringify(results.shift() || { ok: true, idempotent: true, nuevo_estado: 'devuelto_parcial', cantidad_devuelta: 3 }), { status: 200 })
    }
    if (String(url).includes('/seguimiento_operativo')) return new Response('{}', { status: 201 })

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
  validateOperator.mockResolvedValue(auth())
})

describe('handleDevolverPrestamo', () => {
  it('rechaza roles no autorizados sin consultar ni mutar Supabase', async () => {
    validateOperator.mockResolvedValue(auth('vendedor'))
    const { fetchMock } = installFetch()

    const response = await handleDevolverPrestamo(post({ prestamoId: loanId, cantidad: 1, idempotencyKey }), ENV)
    const result = await readBody(response)

    expect(response.status).toBe(403)
    expect(result.body.error).toContain('permisos')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza una clave inválida antes de cualquier lectura remota', async () => {
    const { fetchMock } = installFetch()

    const response = await handleDevolverPrestamo(post({ prestamoId: loanId, cantidad: 1, idempotencyKey: 'no-es-uuid' }), ENV)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('llama la RPC neutral con cuenta, actor y clave, sin PATCH directo de stock/Kardex', async () => {
    const { calls } = installFetch()

    const response = await handleDevolverPrestamo(post({ prestamoId: loanId, cantidad: 3, idempotencyKey }), ENV)
    const result = await readBody(response)

    expect(response.status).toBe(200)
    expect(result.body).toMatchObject({
      ok: true,
      nuevoEstado: 'devuelto_parcial',
      cantidad_devuelta: 3,
      lote_id: '66666666-6666-4666-8666-666666666666',
      idempotency_key: idempotencyKey,
      idempotent: false,
    })

    const rpcCall = calls.find(call => call.url.includes('/rpc/devolver_prestamo_inventario_atomico'))
    expect(rpcCall).toBeDefined()
    expect(rpcCall.method).toBe('POST')
    expect(rpcCall.body).toEqual({
      p_cuenta_id: cuentaId,
      p_prestamo_id: loanId,
      p_cantidad: 3,
      p_usuario_id: operatorId,
      p_usuario_nombre: 'Admin Test',
      p_usuario_color: '#000000',
      p_idempotency_key: idempotencyKey,
    })
    expect(calls.some(call => call.method === 'PATCH')).toBe(false)
    expect(calls.some(call => call.url.includes('/inventario_movimientos'))).toBe(false)
    expect(calls.find(call => call.url.includes('/seguimiento_operativo')).body.cuenta_id).toBe(cuentaId)
    expect(registrarAuditoria).toHaveBeenCalledTimes(1)
  })

  it('prioriza la clave del header cuando el body no incluye idempotencyKey', async () => {
    const { calls } = installFetch()
    const headerKey = '77777777-7777-4777-8777-777777777777'

    const response = await handleDevolverPrestamo(
      post({ prestamoId: loanId, cantidad: 1 }, { 'Idempotency-Key': headerKey }),
      ENV,
    )

    expect(response.status).toBe(200)
    expect(calls.find(call => call.url.includes('/rpc/')).body.p_idempotency_key).toBe(headerKey)
  })

  it('detiene el flujo cross-tenant antes de invocar la RPC', async () => {
    const { calls, fetchMock } = installFetch()
    fetchMock.mockImplementation(async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase()
      calls.push({ url: String(url), method, body: options.body ? JSON.parse(options.body) : undefined })
      if (String(url).includes('/cliente_prestamos?')) return loanResponse()
      if (String(url).includes('/clientes?')) return new Response('[]', { status: 200 })
      throw new Error(`[test] no debe llegar a: ${method} ${url}`)
    })

    const response = await handleDevolverPrestamo(post({ prestamoId: loanId, cantidad: 1, idempotencyKey }), ENV)

    expect(response.status).toBe(404)
    expect(calls.some(call => call.url.includes('/rpc/'))).toBe(false)
    expect(registrarAuditoria).not.toHaveBeenCalled()
  })

  it('no duplica timeline ni auditoría en un replay idempotente', async () => {
    const { calls } = installFetch({
      rpcResults: [
        { ok: true, nuevo_estado: 'devuelto_parcial', cantidad_devuelta: 3, lote_id: '88888888-8888-4888-8888-888888888888', numero: 82 },
        { ok: true, idempotent: true, nuevo_estado: 'devuelto_parcial', cantidad_devuelta: 3, lote_id: '88888888-8888-4888-8888-888888888888', numero: 82 },
      ],
    })

    const first = await handleDevolverPrestamo(post({ prestamoId: loanId, cantidad: 3, idempotencyKey }), ENV)
    const second = await handleDevolverPrestamo(post({ prestamoId: loanId, cantidad: 3, idempotencyKey }), ENV)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await readBody(second)).body.idempotent).toBe(true)
    expect(calls.filter(call => call.url.includes('/rpc/')).map(call => call.body.p_idempotency_key)).toEqual([idempotencyKey, idempotencyKey])
    expect(calls.filter(call => call.url.includes('/seguimiento_operativo'))).toHaveLength(1)
    expect(registrarAuditoria).toHaveBeenCalledTimes(1)
  })

  it('propaga el error de saldo de la RPC sin intentar efectos auxiliares', async () => {
    const { calls } = installFetch({ rpcResults: [{ message: 'SALDO_PRESTAMO_INVALIDO' }] })
    const rpcCall = calls

    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase()
      rpcCall.push({ url: String(url), method, body: options.body ? JSON.parse(options.body) : undefined })
      if (String(url).includes('/cliente_prestamos?')) return loanResponse()
      if (String(url).includes('/clientes?')) return new Response(JSON.stringify([{ id: clientId }]), { status: 200 })
      if (String(url).includes('/rpc/')) return new Response(JSON.stringify({ message: 'SALDO_PRESTAMO_INVALIDO' }), { status: 400 })
      throw new Error(`[test] no debe llegar a: ${method} ${url}`)
    }))

    const response = await handleDevolverPrestamo(post({ prestamoId: loanId, cantidad: 9, idempotencyKey }), ENV)

    expect(response.status).toBe(400)
    expect((await readBody(response)).body.error).toContain('SALDO_PRESTAMO_INVALIDO')
    expect(calls.some(call => call.url.includes('/seguimiento_operativo'))).toBe(false)
    expect(registrarAuditoria).not.toHaveBeenCalled()
  })
})
