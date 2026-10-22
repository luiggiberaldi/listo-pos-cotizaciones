import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
}))

import { validateOperator } from '../../lib/auth.js'
import { handleClearInventory, handleAplicarMovimientoLote, handleTransformacionInventario, handleBatchIngest, handleBatchPriceUpdate } from '../inventario.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-key' }
const cuentaId = '11111111-1111-4111-8111-111111111111'
const productoId = '22222222-2222-4222-8222-222222222222'
const operatorId = '33333333-3333-4333-8333-333333333333'

function operador(rol) {
  return { id: operatorId, nombre: 'Operador Test', rol, color: '#000000', cuenta_id: cuentaId }
}

function auth(rol) {
  const op = operador(rol)
  return {
    user: { id: cuentaId, operator_id: operatorId },
    operador: op,
    headers: { apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    ip: '127.0.0.1',
  }
}

function post(body) {
  return new Request('https://app.test/api/inventario/x', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function jsonBody(response) {
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleClearInventory', () => {
  it('solo el rol desarrollador puede limpiar el inventario', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleClearInventory(post({}), ENV)
    const result = await jsonBody(response)

    expect(response.status).toBe(403)
    expect(result.body.error).toContain('desarrollador')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('envía la confirmación exacta y la clave de idempotencia a la RPC neutral', async () => {
    validateOperator.mockResolvedValue(auth('desarrollador'))
    const idempotencyKey = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ ok: true, productos_eliminados: 2, movimientos_eliminados: 3 }), { status: 200 })
    }))

    const response = await handleClearInventory(post({ idempotencyKey }), ENV)
    const result = await jsonBody(response)

    expect(response.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(calls[0].url).toContain('/rpc/limpiar_inventario_atomico')
    const payload = JSON.parse(calls[0].options.body)
    expect(payload.p_cuenta_id).toBe(cuentaId)
    expect(payload.p_usuario_id).toBe(operatorId)
    expect(payload.p_confirmacion).toBe(`LIMPIAR_INVENTARIO:${cuentaId}`)
    expect(payload.p_idempotency_key).toBe(idempotencyKey)
  })

  it('rechaza una clave de idempotencia inválida antes de llamar a Supabase', async () => {
    validateOperator.mockResolvedValue(auth('desarrollador'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleClearInventory(post({ idempotencyKey: 'no-es-uuid' }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('handleAplicarMovimientoLote', () => {
  const validBody = {
    tipo: 'ingreso',
    motivo: 'Ajuste de prueba',
    motivo_tipo: 'ajuste_inventario',
    items: [{ producto_id: productoId, cantidad: 2 }],
    idempotencyKey: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  }

  it('llama la RPC atómica neutral con el payload completo', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ ok: true, lote_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', numero: 42, movimientos: 1 }), { status: 200 })
    }))

    const response = await handleAplicarMovimientoLote(post(validBody), ENV)
    const result = await jsonBody(response)

    expect(response.status).toBe(200)
    expect(result.body.lote_id).toBe('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb')
    expect(calls[0].url).toContain('/rpc/aplicar_movimiento_inventario_atomico')
    const payload = JSON.parse(calls[0].options.body)
    expect(payload.p_cuenta_id).toBe(cuentaId)
    expect(payload.p_tipo).toBe('ingreso')
    expect(payload.p_motivo_tipo).toBe('ajuste_inventario')
    expect(payload.p_usuario_id).toBe(operatorId)
    expect(payload.p_idempotency_key).toBe(validBody.idempotencyKey)
    expect(payload.p_items).toEqual(validBody.items)
  })

  it('rechaza un motivo_tipo fuera del enum sin llamar a Supabase', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleAplicarMovimientoLote(post({ ...validBody, motivo_tipo: 'ingreso_lote' }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza un producto_id inválido sin llamar a Supabase', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleAplicarMovimientoLote(post({ ...validBody, items: [{ producto_id: 'no-es-uuid', cantidad: 1 }] }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza una cantidad no positiva sin llamar a Supabase', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleAplicarMovimientoLote(post({ ...validBody, items: [{ producto_id: productoId, cantidad: 0 }] }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('genera una clave de idempotencia cuando el body no la incluye', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ ok: true, lote_id: 'cccccccc-3333-4333-8333-cccccccccccc', numero: 7, movimientos: 1 }), { status: 200 })
    }))

    const sinClave = {
      tipo: validBody.tipo,
      motivo: validBody.motivo,
      motivo_tipo: validBody.motivo_tipo,
      items: validBody.items,
    }
    const response = await handleAplicarMovimientoLote(post(sinClave), ENV)
    expect(response.status).toBe(200)
    const payload = JSON.parse(calls[0].options.body)
    expect(payload.p_idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('rechaza una clave de idempotencia inválida', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleAplicarMovimientoLote(post({ ...validBody, idempotencyKey: 'no-es-uuid' }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('handleTransformacionInventario', () => {
  const destinoId = '44444444-4444-4444-8444-444444444444'
  const validBody = {
    origen: { producto_id: productoId, cantidad: 3 },
    destino: { producto_id: destinoId, cantidad: 1.5 },
    motivo: 'Transformación de prueba',
    idempotencyKey: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  }

  it('llama transformar_inventario_atomico con el payload completo', async () => {
    validateOperator.mockResolvedValue(auth('jefe'))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ ok: true, lote_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', numero: 9, origen: {}, destino: {} }), { status: 200 })
    }))

    const response = await handleTransformacionInventario(post(validBody), ENV)
    const result = await jsonBody(response)

    expect(response.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(calls[0].url).toContain('/rpc/transformar_inventario_atomico')
    const payload = JSON.parse(calls[0].options.body)
    expect(payload.p_cuenta_id).toBe(cuentaId)
    expect(payload.p_origen_producto_id).toBe(productoId)
    expect(payload.p_origen_cantidad).toBe(3)
    expect(payload.p_destino_producto_id).toBe(destinoId)
    expect(payload.p_destino_cantidad).toBe(1.5)
    expect(payload.p_usuario_id).toBe(operatorId)
    expect(payload.p_idempotency_key).toBe(validBody.idempotencyKey)
  })

  it('rechaza origen y destino iguales sin llamar a Supabase', async () => {
    validateOperator.mockResolvedValue(auth('jefe'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleTransformacionInventario(post({
      ...validBody,
      destino: { producto_id: productoId, cantidad: 1 },
    }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza una cantidad no positiva sin llamar a Supabase', async () => {
    validateOperator.mockResolvedValue(auth('jefe'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleTransformacionInventario(post({
      ...validBody,
      destino: { producto_id: destinoId, cantidad: 0 },
    }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('handleBatchIngest', () => {
  const validBody = {
    motivo: 'Ingreso masivo de prueba',
    idempotencyKey: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    productos: [
      { id: null, codigo: 'cod-nuevo', nombre: 'Producto Nuevo', cantidad: 5, costo: 10, precio: 20, categoria: 'cat', unidad: 'und', isNuevo: true, modoExistente: 'sumar', actualizarCosto: true },
      { id: productoId, codigo: null, nombre: 'Producto Existente', cantidad: 2, costo: 8, precio: 0, categoria: 'cat', unidad: 'und', isNuevo: false, modoExistente: 'sumar', actualizarCosto: false },
    ],
  }

  it('mapea productos camelCase a snake_case y llama la RPC neutral', async () => {
    validateOperator.mockResolvedValue(auth('supervisor'))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ ok: true, lote_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', procesados: 2, nuevos: 1, movimientos: 2 }), { status: 200 })
    }))

    const response = await handleBatchIngest(post(validBody), ENV)
    const result = await jsonBody(response)

    expect(response.status).toBe(200)
    expect(result.body.procesados).toBe(2)
    expect(result.body.nuevos).toBe(1)
    expect(calls[0].url).toContain('/rpc/ingresar_lote_inventario_atomico')
    const payload = JSON.parse(calls[0].options.body)
    expect(payload.p_cuenta_id).toBe(cuentaId)
    expect(payload.p_motivo).toBe(validBody.motivo)
    expect(payload.p_usuario_id).toBe(operatorId)
    expect(payload.p_idempotency_key).toBe(validBody.idempotencyKey)

    const [nuevo, existente] = payload.p_productos
    expect(nuevo.producto_id).toBe(null)
    expect(nuevo.is_nuevo).toBe(true)
    expect(nuevo.nombre).toBe('PRODUCTO NUEVO')
    expect(nuevo.codigo).toBe('COD-NUEVO')
    expect(nuevo.cantidad).toBe(5)
    expect(nuevo.costo_usd).toBe(10)
    expect(nuevo.precio_usd).toBe(20)
    expect(nuevo.actualizar_costo).toBe(true)

    expect(existente.producto_id).toBe(productoId)
    expect(existente.is_nuevo).toBe(false)
    expect(existente.nombre).toBe('PRODUCTO EXISTENTE')
    expect(existente.modo_existente).toBe('sumar')
    expect(existente.actualizar_costo).toBe(false)
  })

  it('rechaza un producto existente sin id válido', async () => {
    validateOperator.mockResolvedValue(auth('supervisor'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleBatchIngest(post({ ...validBody, productos: [{ id: 'no-es-uuid', nombre: 'X', cantidad: 1, isNuevo: false }] }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza un producto nuevo sin nombre', async () => {
    validateOperator.mockResolvedValue(auth('supervisor'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleBatchIngest(post({ ...validBody, productos: [{ id: null, nombre: '', cantidad: 1, isNuevo: true }] }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza un modoExistente inválido', async () => {
    validateOperator.mockResolvedValue(auth('supervisor'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleBatchIngest(post({ ...validBody, productos: [{ id: productoId, nombre: 'X', cantidad: 1, isNuevo: false, modoExistente: 'reemplazar' }] }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('genera una clave de idempotencia cuando no se envía', async () => {
    validateOperator.mockResolvedValue(auth('supervisor'))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ ok: true, lote_id: 'cccccccc-3333-4333-8333-cccccccccccc', procesados: 1, nuevos: 0, movimientos: 1 }), { status: 200 })
    }))

    const sinClave = { motivo: validBody.motivo, productos: validBody.productos }
    const response = await handleBatchIngest(post(sinClave), ENV)
    expect(response.status).toBe(200)
    const payload = JSON.parse(calls[0].options.body)
    expect(payload.p_idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('rechaza una clave de idempotencia inválida', async () => {
    validateOperator.mockResolvedValue(auth('supervisor'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleBatchIngest(post({ ...validBody, idempotencyKey: 'no-es-uuid' }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('handleBatchPriceUpdate', () => {
  it('ignora el cuenta_id del body y usa el tenant del operador autenticado', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push({ url: String(url) })
      return new Response(JSON.stringify([]), { status: 200 })
    }))

    const response = await handleBatchPriceUpdate(post({
      cuenta_id: '99999999-9999-4999-8999-999999999999',
      modo: 'porcentaje',
      porcentaje: 10,
      valor_fijo: 0,
      categoria: null,
      precio_objetivo: 'precio_usd',
      preview_only: false,
    }), ENV)

    expect(response.status).toBe(200)
    expect(calls[0].url).toContain(`cuenta_id=eq.${cuentaId}`)
    expect(calls[0].url).not.toContain('99999999-9999-4999-8999-999999999999')
  })

  it('rechaza un modo inválido sin llamar a Supabase', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleBatchPriceUpdate(post({
      modo: 'fijo',
      precio_objetivo: 'precio_usd',
    }), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
