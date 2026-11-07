import { describe, expect, it } from 'vitest'
import { leerServerTiming, resumir } from '../medirRendimiento.js'

describe('leerServerTiming', () => {
  it('lee app, auth y cuenta e ignora otras medidas', () => {
    expect(leerServerTiming('cuenta;dur=0, auth;dur=55.6, app;dur=120, cfL4;desc="x";dur=9')).toEqual({ cuenta: 0, auth: 56, app: 120 })
    expect(leerServerTiming('app;desc="worker";dur=33')).toEqual({ app: 33 })
  })
  it('sin cabecera devuelve vacío', () => {
    expect(leerServerTiming(null)).toEqual({})
    expect(leerServerTiming('')).toEqual({})
  })
})

describe('resumir con desglose del servidor', () => {
  it('agrega srv_p50/auth_p50 solo cuando hay datos', () => {
    const r = resumir([
      { ruta: '/api/config', metodo: 'GET', ms: 900, estado: 200, srv: 300, auth: 250, cuenta: 0 },
      { ruta: '/api/config', metodo: 'GET', ms: 1100, estado: 200, srv: 320, auth: 260, cuenta: 100 },
      { ruta: '/api/x', metodo: 'GET', ms: 50, estado: 200 },
    ])
    const cfg = r.find(x => x.ruta === 'GET /api/config')
    expect(cfg).toMatchObject({ n: 2, srv_p50: 320, auth_p50: 260, cuenta_p50: 100 })
    const x = r.find(x => x.ruta === 'GET /api/x')
    expect(x.srv_p50).toBeUndefined()
  })
})
