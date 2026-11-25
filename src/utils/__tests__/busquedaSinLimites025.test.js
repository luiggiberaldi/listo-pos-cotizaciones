// Pruebas de OP-2026-025: búsquedas de Despachos y Cotizaciones sin recortes,
// con tandas de 1000 filas, máximo 4 consultas simultáneas y búsqueda de
// clientes en tandas de 200 (límite de /api/clientes/lookup).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/supabase/client', () => ({ default: {} }))

const {
  traerTodo,
  mapConLimite,
  lookupClientesPorIds,
  LOOKUP_CLIENTES_MAX,
} = await import('../../services/apiBase.js')

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const leer = rel => fs.readFileSync(path.join(projectRoot, rel), 'utf8')

// Consulta falsa que imita .range(desde, hasta) de Supabase sobre `total` filas.
function consultaFalsa(total, pedidos) {
  return () => ({
    range: async (desde, hasta) => {
      pedidos?.push([desde, hasta])
      const fin = Math.min(hasta, total - 1)
      const data = []
      for (let i = desde; i <= fin; i++) data.push({ id: i })
      return { data, error: null }
    },
  })
}

describe('OP-2026-025 — traerTodo', () => {
  it('trae más de 1000 filas pidiendo tandas hasta que una llega incompleta', async () => {
    const pedidos = []
    const filas = await traerTodo(consultaFalsa(2350, pedidos))
    expect(filas).toHaveLength(2350)
    expect(pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(new Set(filas.map(f => f.id)).size).toBe(2350)
  })

  it('con exactamente 1000 filas hace una tanda extra vacía y termina', async () => {
    const pedidos = []
    const filas = await traerTodo(consultaFalsa(1000, pedidos))
    expect(filas).toHaveLength(1000)
    expect(pedidos).toHaveLength(2)
  })

  it('propaga el error de la base en vez de devolver datos a medias', async () => {
    const crear = () => ({ range: async () => ({ data: null, error: new Error('fallo') }) })
    await expect(traerTodo(crear)).rejects.toThrow('fallo')
  })
})

describe('OP-2026-025 — mapConLimite', () => {
  it('nunca pasa del límite de llamadas simultáneas y conserva el orden', async () => {
    let activas = 0
    let maxActivas = 0
    const res = await mapConLimite([...Array(20).keys()], 4, async n => {
      activas++
      maxActivas = Math.max(maxActivas, activas)
      await new Promise(r => setTimeout(r, 2))
      activas--
      return n * 2
    })
    expect(maxActivas).toBeLessThanOrEqual(4)
    expect(res).toEqual([...Array(20).keys()].map(n => n * 2))
  })

  it('con lista vacía devuelve lista vacía', async () => {
    expect(await mapConLimite([], 4, async x => x)).toEqual([])
  })
})

describe('OP-2026-025 — lookupClientesPorIds', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parte más de 200 ids en tandas de 200 (el servidor rechaza más)', async () => {
    const cuerpos = []
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      const { ids } = JSON.parse(opts.body)
      cuerpos.push(ids.length)
      return { ok: ids.length <= 200, json: async () => ids.map(id => ({ id })) }
    }))
    const ids = Array.from({ length: 450 }, (_, i) => `c-${i}`)
    const clientes = await lookupClientesPorIds(ids, { Authorization: 'Bearer x' })
    expect(LOOKUP_CLIENTES_MAX).toBe(200)
    expect(cuerpos.sort((a, b) => b - a)).toEqual([200, 200, 50])
    expect(clientes).toHaveLength(450)
  })

  it('si una tanda falla, el resto de clientes se muestra igual', async () => {
    let llamada = 0
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      llamada++
      const { ids } = JSON.parse(opts.body)
      if (llamada === 1) return { ok: false, json: async () => ({}) }
      return { ok: true, json: async () => ids.map(id => ({ id })) }
    }))
    const ids = Array.from({ length: 300 }, (_, i) => `c-${i}`)
    const clientes = await lookupClientesPorIds(ids, {})
    expect(clientes.length).toBe(100)
  })

  it('sin ids no llama al servidor', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await lookupClientesPorIds([], {})).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })
})

describe('OP-2026-025 — contrato en los hooks de búsqueda', () => {
  it('Despachos: sin tope de 200 en búsqueda, texto desde 2 caracteres y clientes en tandas', () => {
    const src = leer('src/hooks/useDespachos.js')
    expect(src).not.toContain('ids.slice(0, 200)')
    expect(src).toContain('qBusqueda.length >= 2 || /^\\d+$/.test(qBusqueda)')
    expect(src).toContain('mapConLimite(matchedChunks, 4')
    expect(src).toContain('lookupClientesPorIds(clienteIds')
    expect(src).not.toContain("fetch(apiUrl('/api/clientes/lookup')")
    // La lista normal (sin texto) sigue limitada a 200 para abrir rápido
    expect(src).toContain('if (!esHoy) query = query.limit(200)')
  })

  it('Cotizaciones: sin tope de 60 por cliente y clientes en tandas', () => {
    const archivo = leer('src/hooks/useCotizaciones.js')
    // Solo la búsqueda histórica: la lista normal trae máx. 200 cotizaciones
    // (≤ 200 clientes) y el resto de lookups son de un solo cliente.
    const inicio = archivo.indexOf('export function useBuscarCotizaciones')
    const src = archivo.slice(inicio, archivo.indexOf('\nexport function', inicio + 10))
    expect(inicio).toBeGreaterThan(-1)
    expect(src).not.toContain('.limit(60)')
    // La búsqueda por cliente necesita la sesión de operador (si no, el servidor da 403)
    const busquedaClientes = src.slice(src.indexOf('/api/clientes?busqueda='), src.indexOf('.then(r => r.ok ? r.json() : [])'))
    expect(busquedaClientes).toContain('...getOperatorSessionHeaders()')
    expect(src).toContain("mapConLimite(chunkIds(ids, 50), 4")
    expect(src).toContain('lookupClientesPorIds(clienteIds')
    expect(src).not.toContain("fetch(apiUrl('/api/clientes/lookup')")
  })
})
