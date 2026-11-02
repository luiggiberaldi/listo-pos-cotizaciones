import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn() }))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(() => Promise.resolve()) }))

import { validateOperator } from '../../lib/auth.js'
import { handleBatchPriceUpdate, handleListarLotesPrecios, handleRestaurarLotePrecios } from '../inventario.js'

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
    writes.rpcs = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const u = String(url)
      if (init?.method === 'POST') {
        const b = JSON.parse(init.body)
        writes.push(b.p_cambios)
        writes.rpcs.push(b)
        return new Response(JSON.stringify({ lote_id: 'lote-1', updated: b.p_cambios.length }), { status: 200 })
      }
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
    expect(writes[0][0]).toMatchObject({ id: 'id-0', nombre: 'Prod 0', precio_usd: { antes: 10, despues: 11 } })
    expect(r.body.lote_id).toBe('lote-1')
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
    expect(writes[0][0]).toMatchObject({ id: 'id-1', precio_2: { antes: 20, despues: 22 } })
    expect(writes[0][0]).not.toHaveProperty('precio_usd')
  })

  it('con "todos" solo cambia los precios que existen en cada producto', async () => {
    validateOperator.mockResolvedValue(auth('jefe'))
    const writes = mockBase([prod(1, { precio_3: 30 }), prod(2)])
    await handleBatchPriceUpdate(post(batchBody({ precio_objetivo: 'todos', modo: 'valor_fijo', valor_fijo: 5 })), ENV)
    const porId = Object.fromEntries(writes[0].map(w => [w.id, w]))
    expect(porId['id-1']).toMatchObject({ precio_usd: { antes: 10, despues: 5 }, precio_3: { antes: 30, despues: 5 } })
    expect(porId['id-1']).not.toHaveProperty('precio_2')
    expect(porId['id-2']).toMatchObject({ precio_usd: { antes: 10, despues: 5 } })
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

  it('envía a la función de la base la cuenta del operador, el modo y los precios de antes y después', async () => {
    validateOperator.mockResolvedValue(auth('jefe'))
    const writes = mockBase([prod(1)])
    await handleBatchPriceUpdate(post(batchBody({ cuenta_id: '99999999-9999-4999-8999-999999999999' })), ENV)
    const rpc = writes.rpcs[0]
    expect(rpc.p_cuenta_id).toBe(cuentaId)
    expect(rpc).toMatchObject({ p_modo: 'porcentaje', p_porcentaje: 10, p_precio_objetivo: 'precio_usd', p_seleccion_manual: false, p_operador_rol: 'jefe' })
    expect(rpc.p_cambios[0].precio_usd).toEqual({ antes: 10, despues: 11 })
  })

  it('si un precio cambió mientras el usuario revisaba responde 409 y no cambia nada', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    vi.stubGlobal('fetch', vi.fn(async (_u, init) =>
      init?.method === 'POST' ? new Response('{"message":"PRECIO_CAMBIO_CONCURRENTE"}', { status: 400 }) : new Response(JSON.stringify([prod(1)]), { status: 200 })))
    const r = await jsonBody(await handleBatchPriceUpdate(post(batchBody()), ENV))
    expect(r.status).toBe(409)
    expect(r.body.error).toContain('No se cambió ningún precio')
  })

  it('vendedor y logística no pueden usar la actualización masiva', async () => {
    for (const rol of ['vendedor', 'logistica']) {
      validateOperator.mockResolvedValue(auth(rol))
      const response = await handleBatchPriceUpdate(post(batchBody()), ENV)
      expect(response.status).toBe(403)
    }
  })
})

describe('lotes de precios: historial y restaurar', () => {
  const loteId = '44444444-4444-4444-8444-444444444444'

  it('listar: solo administración, jefe y desarrollador; la cuenta es la del operador', async () => {
    validateOperator.mockResolvedValue(auth('vendedor'))
    expect((await handleListarLotesPrecios(new Request('https://app.test/x'), ENV)).status).toBe(403)

    validateOperator.mockResolvedValue(auth('jefe'))
    const urls = []
    vi.stubGlobal('fetch', vi.fn(async (u) => { urls.push(String(u)); return new Response(JSON.stringify([{ id: loteId }]), { status: 200 }) }))
    const r = await jsonBody(await handleListarLotesPrecios(new Request('https://app.test/x'), ENV))
    expect(r.body.lotes).toHaveLength(1)
    expect(urls[0]).toContain(`cuenta_id=eq.${cuentaId}`)
    expect(urls[0]).toContain('limit=20')
  })

  it('restaurar: rechaza roles sin permiso y ids inválidos sin llamar a la base', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    validateOperator.mockResolvedValue(auth('logistica'))
    expect((await handleRestaurarLotePrecios(post({ lote_id: loteId }), ENV)).status).toBe(403)
    validateOperator.mockResolvedValue(auth('administracion'))
    expect((await handleRestaurarLotePrecios(post({ lote_id: 'no-uuid' }), ENV)).status).toBe(400)
    expect((await handleRestaurarLotePrecios(post({}), ENV)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('restaurar: usa la cuenta del operador (ignora la del cliente) y devuelve el resultado', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const bodies = []
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ restaurados: 3, parciales: 1, omitidos: 2 }), { status: 200 }) }))
    const r = await jsonBody(await handleRestaurarLotePrecios(post({ lote_id: loteId, cuenta_id: '99999999-9999-4999-8999-999999999999' }), ENV))
    expect(r.body).toEqual({ restaurados: 3, parciales: 1, omitidos: 2 })
    expect(bodies[0].p_cuenta_id).toBe(cuentaId)
    expect(bodies[0].p_lote_id).toBe(loteId)
  })

  it.each([
    ['LOTE_NO_ENCONTRADO', 404],
    ['LOTE_YA_RESTAURADO', 409],
    ['algo raro', 500],
  ])('restaurar: el error %s responde %i', async (texto, estado) => {
    validateOperator.mockResolvedValue(auth('administracion'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`{"message":"${texto}"}`, { status: 400 })))
    expect((await handleRestaurarLotePrecios(post({ lote_id: loteId }), ENV)).status).toBe(estado)
  })
})
