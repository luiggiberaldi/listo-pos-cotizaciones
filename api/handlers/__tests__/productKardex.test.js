import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
}))

import { validateOperator } from '../../lib/auth.js'
import {
  handleActualizarProductoConKardex,
  handleBorrarProductoConKardex,
  handleCrearProductoConKardex,
} from '../inventario.js'

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
}
const cuentaId = '11111111-1111-4111-8111-111111111111'
const productoId = '22222222-2222-4222-8222-222222222222'
const operatorId = '33333333-3333-4333-8333-333333333333'
const idempotencyKey = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'

function auth(rol = 'administracion') {
  return {
    user: { id: cuentaId, operator_id: operatorId },
    operador: { id: operatorId, nombre: 'Operador Test', rol, color: '#000000', cuenta_id: cuentaId },
    headers: { apikey: 'service-key', Authorization: 'Bearer service-key', 'Content-Type': 'application/json' },
    ip: '127.0.0.1',
  }
}

function request(method, body) {
  return new Request('https://app.test/api/productos/test', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
  })
}

async function responseBody(response) {
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('operaciones de producto con Kardex en Worker', () => {
  it('crea usando la RPC tenant-safe y reenvía todos los campos con idempotencia', async () => {
    validateOperator.mockResolvedValue(auth())
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ ok: true, id: productoId, stock_actual: 10 }), { status: 200 })
    }))

    const response = await handleCrearProductoConKardex(request('POST', {
      codigo: 'TEST-001',
      nombre: 'Producto Test',
      descripcion: 'Descripción',
      categoria: 'TESTER',
      unidad: 'und',
      precio_usd: 25,
      costo_usd: 15,
      stock_actual: 10,
      stock_minimo: 2,
      imagen_url: null,
      precio_2: 24,
      precio_3: 23,
      precio1_porcentaje: 66.67,
      precio2_porcentaje: 60,
      precio3_porcentaje: 53.33,
      idempotencyKey,
    }), ENV)
    const result = await responseBody(response)

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, id: productoId })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/rpc/crear_producto_con_kardex_tenant_safe')
    expect(JSON.parse(calls[0].options.body)).toMatchObject({
      p_cuenta_id: cuentaId,
      p_usuario_id: operatorId,
      p_codigo: 'TEST-001',
      p_nombre: 'Producto Test',
      p_stock_actual: 10,
      p_precio_2: 24,
      p_precio3_porcentaje: 53.33,
      p_idempotency_key: idempotencyKey,
    })
  })

  it('actualiza con tenant-safety y evita enviar el tenant desde el cliente', async () => {
    validateOperator.mockResolvedValue(auth())
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ ok: true, id: productoId, stock_anterior: 10, stock_nuevo: 12 }), { status: 200 })
    }))

    const response = await handleActualizarProductoConKardex(request('PATCH', {
      id: productoId,
      cuenta_id: '99999999-9999-4999-8999-999999999999',
      codigo: 'TEST-001',
      nombre: 'Producto Test Editado',
      unidad: 'und',
      precio_usd: 26,
      costo_usd: 15,
      stock_actual: 12,
      stock_minimo: 2,
      imagen_url: 'https://example.test/producto.webp',
      precio_2: 25,
      precio_3: 24,
      precio1_porcentaje: 73.33,
      precio2_porcentaje: 66.67,
      precio3_porcentaje: 60,
      idempotencyKey,
    }), ENV)
    const result = await responseBody(response)

    expect(result.status).toBe(200)
    expect(calls[0].url).toContain('/rpc/actualizar_producto_con_kardex_tenant_safe')
    const payload = JSON.parse(calls[0].options.body)
    expect(payload.p_cuenta_id).toBe(cuentaId)
    expect(payload.p_producto_id).toBe(productoId)
    expect(payload.p_idempotency_key).toBe(idempotencyKey)
    expect(payload.p_cuenta_id).not.toBe('99999999-9999-4999-8999-999999999999')
  })

  it('borra con confirmación server-side y no permite a supervisor', async () => {
    validateOperator.mockResolvedValue(auth('supervisor'))
    const forbiddenFetch = vi.fn()
    vi.stubGlobal('fetch', forbiddenFetch)

    const forbidden = await handleBorrarProductoConKardex(request('DELETE', { id: productoId, idempotencyKey }), ENV)
    expect(forbidden.status).toBe(403)
    expect(forbiddenFetch).not.toHaveBeenCalled()

    validateOperator.mockResolvedValue(auth('administracion'))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ ok: true, producto_id: productoId }), { status: 200 })
    }))

    const response = await handleBorrarProductoConKardex(request('DELETE', { id: productoId, idempotencyKey }), ENV)
    const result = await responseBody(response)
    expect(result.status).toBe(200)
    expect(calls[0].url).toContain('/rpc/borrar_producto_con_kardex_tenant_safe')
    expect(JSON.parse(calls[0].options.body)).toMatchObject({
      p_cuenta_id: cuentaId,
      p_producto_id: productoId,
      p_confirmacion: 'BORRAR_PRODUCTO',
      p_idempotency_key: idempotencyKey,
    })
  })

  it('rechaza claves inválidas antes de invocar Supabase', async () => {
    validateOperator.mockResolvedValue(auth())
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleCrearProductoConKardex(request('POST', {
      nombre: 'Producto Test',
      idempotencyKey: 'no-es-uuid',
    }), ENV)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
