import { describe, it, expect, vi } from 'vitest'
import { leerTodasLasPaginas, ReporteDemasiadoGrandeError } from '../leerPaginas'

// Simula la base de datos: tiene `total` filas y nunca entrega más de `tope` por pedido.
const baseFalsa = (total, tope = 1000) => {
  const filas = Array.from({ length: total }, (_, i) => ({ id: i }))
  return vi.fn(async (desde, hasta) => ({ data: filas.slice(desde, Math.min(hasta + 1, desde + tope)), error: null }))
}

describe('leerTodasLasPaginas', () => {
  it('trae las 2.500 filas completas aunque la base corte en 1.000', async () => {
    const pedir = baseFalsa(2500)
    const filas = await leerTodasLasPaginas(pedir)
    expect(filas).toHaveLength(2500)
    expect(filas[0].id).toBe(0)
    expect(filas[2499].id).toBe(2499)
    expect(new Set(filas.map(f => f.id)).size).toBe(2500)
    expect(pedir).toHaveBeenCalledTimes(3)
    expect(pedir.mock.calls.map(c => c.slice(0, 2))).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('con exactamente 1.000 filas pide una página más para confirmar que no hay otras', async () => {
    const pedir = baseFalsa(1000)
    expect(await leerTodasLasPaginas(pedir)).toHaveLength(1000)
    expect(pedir).toHaveBeenCalledTimes(2)
  })

  it('un período chico se resuelve con un solo pedido', async () => {
    const pedir = baseFalsa(478)
    expect(await leerTodasLasPaginas(pedir)).toHaveLength(478)
    expect(pedir).toHaveBeenCalledTimes(1)
  })

  it('sin filas devuelve lista vacía', async () => {
    expect(await leerTodasLasPaginas(baseFalsa(0))).toEqual([])
  })

  it('acepta respuestas que son listas directas (servidor) y respuestas {data} (navegador)', async () => {
    const filas = await leerTodasLasPaginas(async (d) => (d === 0 ? [{ id: 1 }] : []))
    expect(filas).toEqual([{ id: 1 }])
  })

  it('si la base responde con error, el reporte falla en vez de mostrar números incompletos', async () => {
    const pedir = vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })) })
      .mockResolvedValueOnce({ data: null, error: new Error('se cayó la conexión') })
    await expect(leerTodasLasPaginas(pedir)).rejects.toThrow('se cayó la conexión')
  })

  it('red de seguridad: no se queda pidiendo para siempre', async () => {
    const pedir = baseFalsa(10_000)
    await expect(leerTodasLasPaginas(pedir, { maxPaginas: 3 })).rejects.toBeInstanceOf(ReporteDemasiadoGrandeError)
    expect(pedir).toHaveBeenCalledTimes(3)
  })
})
