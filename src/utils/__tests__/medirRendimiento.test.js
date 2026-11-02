import { describe, it, expect, vi } from 'vitest'
vi.mock('../errorLogger', () => ({ logClientError: vi.fn() }))
import { normalizarRuta, resumir } from '../medirRendimiento'

describe('medirRendimiento', () => {
  it('quita parámetros y ids de la ruta', () => {
    expect(normalizarRuta('/api/despachos/123e4567-e89b-12d3-a456-426614174000?cliente=Juan')).toBe('/api/despachos/:id')
    expect(normalizarRuta('/api/x/42/items')).toBe('/api/x/:id/items')
  })
  it('resume por ruta con percentiles y errores, la más lenta primero', () => {
    const l = [
      ...[100, 200, 300, 400, 1000].map(ms => ({ ruta: '/a', metodo: 'GET', ms, estado: 200 })),
      { ruta: '/b', metodo: 'POST', ms: 50, estado: 500 },
    ]
    const r = resumir(l)
    expect(r[0]).toMatchObject({ ruta: 'GET /a', n: 5, p50: 300, max: 1000, errores: 0 })
    expect(r[1]).toMatchObject({ ruta: 'POST /b', errores: 1 })
  })
})
