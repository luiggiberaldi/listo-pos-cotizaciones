import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn() }))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(() => Promise.resolve()) }))

import { validateOperator } from '../../lib/auth.js'
import { handleBatchPriceUpdate } from '../inventario.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-key' }
const cuentaId = '11111111-1111-4111-8111-111111111111'
const operatorId = '33333333-3333-4333-8333-333333333333'

function auth(rol) {
  return {
    user: { id: cuentaId, operator_id: operatorId },
    operador: { id: operatorId, nombre: 'Operador Test', rol, color: '#000000', cuenta_id: cuentaId },
    headers: { apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    ip: '127.0.0.1',
  }
}

function post(body) {
  return new Request('https://app.test/api/productos/batch-price', { method: 'PATCH', body: JSON.stringify(body) })
}

async function jsonBody(response) {
  return { status: response.status, body: await response.json() }
}

beforeEach(() => { vi.clearAllMocks() })

describe('handleBatchPriceUpdate — reglas de seguridad de precios', () => {
  const prod = (i, extra = {}) => ({ id: `id-${i}`, nombre: `Prod ${i}`, precio_usd: 10, precio_2: null, precio_3: null, categoria: 'A', ...extra })
  const batchBody = (over = {}) => ({ modo: 'porcentaje', porcentaje: 10, precio_objetivo: 'precio_usd', preview_only: false, ...over })

  // Simula PostgREST: páginas de 1000 por offset y una sola escritura.
  function mockBase(productos) {
    const writes = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const u = String(url)
      if (init?.method === 'POST') { writes.push(JSON.parse(init.body)); return new Response('', { status: 201 }) }
      const offset = Number(/offset=(\d+)/.exec(u)[1])
      const limit = Number(/limit=(\d+)/.exec(u)[1])
      return new Response(JSON.stringify(productos.slice(offset, offset + limit)), { status: 200 })
    }))
    return writes
  }

  it('lee TODOS los productos aunque pasen de 1.000 y guarda todo en una sola escritura', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const writes = mockBase(Array.from({ length: 2500 }, (_, i) => prod(i)))
    const r = await jsonBody(await handleBatchPriceUpdate(post(batchBody()), ENV))
    expect(r.body.updated).toBe(2500)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toHaveLength(2500)
    expect(writes[0][0]).toMatchObject({ id: 'id-0', nombre: 'Prod 0', precio_usd: 11 })
  })

  it('la vista previa cuenta todos los productos y no escribe nada', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const writes = mockBase(Array.from({ length: 1500 }, (_, i) => prod(i)))
    const r = await jsonBody(await handleBatchPriceUpdate(post(batchBody({ preview_only: true })), ENV))
    expect(r.body.count).toBe(1500)
    expect(r.body.ejemplos).toHaveLength(3)
    expect(r.body.ejemplos[0].precio_usd).toEqual({ actual: 10, nuevo: 11 })
    expect(writes).toHaveLength(0)
  })

  it('no toca los precios vacíos (precio 2 / 3 sin definir)', async () => {
    validateOperator.mockResolvedValue(auth('jefe'))
    const writes = mockBase([prod(1, { precio_2: 20 }), prod(2)])
    const r = await jsonBody(await handleBatchPriceUpdate(post(batchBody({ precio_objetivo: 'precio_2' })), ENV))
    expect(r.body.updated).toBe(1)
    expect(r.body.sin_precio).toBe(1)
    expect(writes[0]).toHaveLength(1)
    expect(writes[0][0]).toMatchObject({ id: 'id-1', precio_2: 22 })
    expect(writes[0][0]).not.toHaveProperty('precio_usd')
  })

  it('con "todos" solo cambia los precios que existen en cada producto', async () => {
    validateOperator.mockResolvedValue(auth('jefe'))
    const writes = mockBase([prod(1, { precio_3: 30 }), prod(2)])
    await handleBatchPriceUpdate(post(batchBody({ precio_objetivo: 'todos', modo: 'valor_fijo', valor_fijo: 5 })), ENV)
    const porId = Object.fromEntries(writes[0].map(w => [w.id, w]))
    expect(porId['id-1']).toMatchObject({ precio_usd: 5, precio_3: 5 })
    expect(porId['id-1']).not.toHaveProperty('precio_2')
    expect(porId['id-2']).toMatchObject({ precio_usd: 5 })
    expect(porId['id-2']).not.toHaveProperty('precio_3')
  })

  it.each([
    [{ porcentaje: -100 }],
    [{ porcentaje: -150 }],
    [{ porcentaje: 0 }],
    [{ porcentaje: 5000 }],
    [{ porcentaje: 'abc' }],
    [{ modo: 'valor_fijo', valor_fijo: -3 }],
    [{ modo: 'valor_fijo', valor_fijo: 0 }],
    [{ modo: 'valor_fijo', valor_fijo: 'x' }],
  ])('rechaza valores peligrosos antes de leer o escribir nada: %j', async (over) => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await handleBatchPriceUpdate(post(batchBody(over)), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('si un resultado queda fuera de rango no cambia ningún precio', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const writes = mockBase([prod(1), prod(2, { precio_usd: 99999999 })])
    const response = await handleBatchPriceUpdate(post(batchBody({ porcentaje: 500 })), ENV)
    expect(response.status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  it('si la base falla informa que no se cambió ningún precio', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    vi.stubGlobal('fetch', vi.fn(async (_u, init) =>
      init?.method === 'POST' ? new Response('boom', { status: 500 }) : new Response(JSON.stringify([prod(1)]), { status: 200 })))
    const r = await jsonBody(await handleBatchPriceUpdate(post(batchBody()), ENV))
    expect(r.status).toBe(500)
    expect(r.body.error).toContain('No se cambió ningún precio')
  })

  it('con productos elegidos solo cambia esos y la vista previa los cuenta', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const U = (n) => `00000000-0000-4000-8000-00000000000${n}`
    const base = [1, 2, 3].map(n => prod(n, { id: U(n) }))
    const writes = mockBase(base)
    const pre = await jsonBody(await handleBatchPriceUpdate(post(batchBody({ preview_only: true, producto_ids: [U(1), U(3)] })), ENV))
    expect(pre.body.count).toBe(2)
    const r = await jsonBody(await handleBatchPriceUpdate(post(batchBody({ producto_ids: [U(1), U(3)] })), ENV))
    expect(r.body.updated).toBe(2)
    expect(writes[0].map(w => w.id).sort()).toEqual([U(1), U(3)])
  })

  it('ignora ids de otra cuenta: no aparecen en la lectura del tenant', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const writes = mockBase([prod(1, { id: '00000000-0000-4000-8000-000000000001' })])
    const r = await jsonBody(await handleBatchPriceUpdate(post(batchBody({ producto_ids: ['99999999-9999-4999-8999-999999999999'] })), ENV))
    expect(r.body.count).toBe(0)
    expect(writes).toHaveLength(0)
  })

  it.each([[[]], ['abc'], [['no-es-uuid']], [[123]]])('rechaza una selección inválida: %j', async (producto_ids) => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await handleBatchPriceUpdate(post(batchBody({ producto_ids })), ENV)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('avisa cuántos productos tienen precio 0, que un porcentaje no puede mover', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    mockBase([prod(1), prod(2, { precio_usd: 0 }), prod(3, { precio_usd: 0 })])
    const pre = await jsonBody(await handleBatchPriceUpdate(post(batchBody({ preview_only: true })), ENV))
    expect(pre.body.count).toBe(1)
    expect(pre.body.en_cero).toBe(2)
    const fijo = await jsonBody(await handleBatchPriceUpdate(post(batchBody({ preview_only: true, modo: 'valor_fijo', valor_fijo: 5 })), ENV))
    expect(fijo.body.count).toBe(3)
    expect(fijo.body.en_cero).toBe(0)
  })

  it('vendedor y logística no pueden usar la actualización masiva', async () => {
    for (const rol of ['vendedor', 'logistica']) {
      validateOperator.mockResolvedValue(auth(rol))
      const response = await handleBatchPriceUpdate(post(batchBody()), ENV)
      expect(response.status).toBe(403)
    }
  })
})
