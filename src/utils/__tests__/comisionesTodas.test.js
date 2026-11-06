import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../services/apiBase', () => ({
  apiUrl: p => `http://api${p}`,
  getAuthHeaders: async () => ({ Authorization: 'Bearer x' }),
}))
vi.mock('../../services/supabase/client', () => ({ default: {} }))
vi.mock('../../store/useAuthStore', () => ({ default: () => null }))
vi.mock('../../components/ui/Toast', () => ({ showToast: () => {} }))
vi.mock('../../services/supabase/realtimeBus', () => ({ broadcastEntidad: () => {} }))

const { fetchComisionesTodas, resumirComisiones } = await import('../../hooks/useComisiones')

// Servidor falso: `total` filas en la base; el servidor quita las de $0 de cada página
// (por eso una página puede traer menos de 1.000 aunque haya más).
function servidorFalso(total, { informaTotal = true, ceroCada = 0 } = {}) {
  const filas = Array.from({ length: total }, (_, i) => ({ id: `c${i}`, despachoid: `d${Math.floor(i / 2)}`, totalcomision: ceroCada && i % ceroCada === 0 ? 0 : 1 }))
  return vi.fn(async url => {
    const q = new URL(url).searchParams
    const page = Number(q.get('page'))
    const size = Number(q.get('pageSize'))
    const lote = filas.slice((page - 1) * size, page * size)
    const visibles = lote.filter(f => f.totalcomision > 0)
    const body = { data: visibles, total: visibles.length, page, pageSize: size }
    if (informaTotal) Object.assign(body, { filasLeidas: lote.length, totalFilas: total })
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  })
}

describe('fetchComisionesTodas', () => {
  const fetchOriginal = globalThis.fetch
  afterEach(() => { globalThis.fetch = fetchOriginal })
  beforeEach(() => { globalThis.fetch = undefined })

  it('trae las 2.300 comisiones en 3 páginas aunque el servidor entregue 1.000 por página', async () => {
    globalThis.fetch = servidorFalso(2300)
    const res = await fetchComisionesTodas({ desde: '2026-08-01', hasta: '2026-10-31' })
    expect(res.data).toHaveLength(2300)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
    const url = new URL(globalThis.fetch.mock.calls[0][0])
    expect(url.searchParams.get('desde')).toBe('2026-08-01')
    expect(url.searchParams.get('pageSize')).toBe('1000')
  })

  it('sigue pidiendo aunque una página llegue "corta" por quitar las de $0', async () => {
    globalThis.fetch = servidorFalso(1500, { ceroCada: 10 })
    const res = await fetchComisionesTodas({})
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(res.data).toHaveLength(1500 - 150)
  })

  it('un período chico es un solo pedido', async () => {
    globalThis.fetch = servidorFalso(416)
    const res = await fetchComisionesTodas({})
    expect(res.data).toHaveLength(416)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('con un servidor viejo (sin total) se comporta como antes: una sola página', async () => {
    globalThis.fetch = servidorFalso(1500, { informaTotal: false })
    const res = await fetchComisionesTodas({})
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(res.data).toHaveLength(1000)
  })

  it('un error del servidor se informa (no se muestran totales incompletos)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'fallo' }))
    await expect(fetchComisionesTodas({})).rejects.toThrow('HTTP 500')
  })
})

describe('resumirComisiones', () => {
  it('suma solo las mayores a $0 y cuenta despachos distintos (misma regla que el servidor)', () => {
    const r = resumirComisiones({ data: [
      { despachoid: 'a', totalcomision: 10.005 },
      { despachoid: 'a', totalcomision: 2 },
      { despachoid: 'b', totalcomision: 0 },
      { despachoid: 'c', totalcomision: 3.1 },
    ] })
    expect(r.totalAcumulado).toBe(15.11)
    expect(r.totalDespachos).toBe(2)
    expect(r.totalRegistros).toBe(2)
    expect(r.totalFilas).toBe(3)
  })
  it('sin datos da ceros', () => {
    expect(resumirComisiones(undefined)).toEqual({ totalAcumulado: 0, totalDespachos: 0, totalRegistros: 0, totalFilas: 0 })
  })
})
