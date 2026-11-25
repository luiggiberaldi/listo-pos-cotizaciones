// OP-2026-065 (N28): cotizaciones pendientes en el equipo — la cola no pierde
// intentos cuando falta el PIN, y el reenvío lleva la sesión del vendedor.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const almacen = new Map()
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k) => almacen.get(k)),
  set: vi.fn(async (k, v) => { almacen.set(k, v) }),
  del: vi.fn(async (k) => { almacen.delete(k) }),
  keys: vi.fn(async () => [...almacen.keys()]),
}))

import { enqueue, processQueue, dequeuePending, dequeueFailed, rescatarCotizacionesFallidas } from '../../lib/mutationQueue.js'

const leer = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

beforeEach(() => almacen.clear())

describe('cola de pendientes', () => {
  it('"posponer" (falta el PIN o la conexión) no gasta intentos ni la marca como fallida', async () => {
    await enqueue('GUARDAR_COTIZACION', { cotizacionId: 'local_1' })
    const posponer = async () => { const e = new Error('Esperando PIN'); e.posponer = true; throw e }
    for (let i = 0; i < 5; i++) await processQueue(posponer)
    const [item] = await dequeuePending()
    expect(item.attempts).toBe(0)
    expect(item.error).toBe('Esperando PIN')
    expect(await dequeueFailed()).toHaveLength(0)
  })

  it('un error real sí cuenta y a los 3 intentos queda como fallida (visible, no borrada)', async () => {
    await enqueue('GUARDAR_COTIZACION', { cotizacionId: 'local_1' })
    const falla = async () => { throw new Error('Cliente inválido') }
    for (let i = 0; i < 3; i++) await processQueue(falla)
    expect(await dequeueFailed()).toHaveLength(1)
  })

  it('rescata las cotizaciones que quedaron fallidas por el defecto del PIN (y no las de otros errores)', async () => {
    await enqueue('GUARDAR_COTIZACION', { cotizacionId: 'local_1' })
    await enqueue('GUARDAR_COTIZACION', { cotizacionId: 'local_2' })
    await enqueue('VENTA_RAPIDA', {})
    const items = [...almacen.values()]
    const errores = ['No hay operador seleccionado', 'Cliente inválido', 'No hay operador seleccionado']
    items.forEach((it, i) => almacen.set(it.id, { ...it, status: 'failed', attempts: 3, error: errores[i] }))
    const n = await rescatarCotizacionesFallidas()
    expect(n).toBe(1)
    const pendientes = await dequeuePending()
    expect(pendientes).toHaveLength(1)
    expect(pendientes[0].attempts).toBe(0)
    expect(await dequeueFailed()).toHaveLength(2) // la del cliente inválido y la venta rápida siguen visibles
  })

  it('si se sube bien, sale de la cola', async () => {
    await enqueue('GUARDAR_COTIZACION', { cotizacionId: 'local_1' })
    const r = await processQueue(async () => ({ id: 'x' }))
    expect(r.done).toBe(1)
    expect(await dequeuePending()).toHaveLength(0)
  })
})

describe('contrato del código (para que no vuelva el defecto)', () => {
  const cola = leer('../../hooks/useMutationQueue.js')
  const guardar = leer('../../hooks/useCotizaciones.js')
  const sw = leer('../../sw.js')

  it('el reenvío de cotizaciones usa la sesión del vendedor (getAuthHeaders) y verifica que sea el dueño', () => {
    const bloque = cola.slice(cola.indexOf('async function dispatchCotizacion'), cola.indexOf('async function dispatchItem'))
    expect(bloque).toContain('getAuthHeaders()')
    expect(bloque).toContain('duenoDeCotizacionEncolada(item)')
    expect(bloque).toContain('nuevoId')
  })

  it('la cola se intenta subir al entrar con el PIN', () => {
    expect(cola).toContain('subscribeOperatorSession(')
  })

  it('el reenvío en segundo plano del navegador no procesa cotizaciones (no tiene el PIN)', () => {
    expect(sw).toMatch(/if \(item\.type === 'GUARDAR_COTIZACION'\) continue/)
    expect(sw).not.toContain("fetch('/api/cotizaciones/guardar'")
  })

  it('con internet, un fallo al guardar se avisa: no se guarda a escondidas en el equipo', () => {
    expect(guardar).toContain('export const TIEMPO_ESPERA_GUARDAR_MS = 20000')
    const iCatch = guardar.indexOf('if (navigator.onLine) {\n          throw new Error(\'No se pudo guardar la cotización')
    const iEnqueue = guardar.indexOf("await enqueue('GUARDAR_COTIZACION'")
    expect(iCatch).toBeGreaterThan(0)
    expect(iCatch).toBeLessThan(iEnqueue)
    expect(guardar).toContain('_operadorId:')
  })
})
