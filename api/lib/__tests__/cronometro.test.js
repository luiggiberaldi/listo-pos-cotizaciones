// Cronómetro Server-Timing: mide sin cambiar la respuesta.
import { describe, expect, it } from 'vitest'
import { anotarTiempo, cabeceraServerTiming, conCronometro } from '../cronometro.js'

describe('conCronometro', () => {
  it('agrega Server-Timing a las rutas /api/ sin cambiar estado ni cuerpo', async () => {
    const fetchFn = async (req) => {
      anotarTiempo(req, 'auth', 12)
      anotarTiempo(req, 'auth', 3)
      return new Response('{"ok":true}', { status: 201, headers: { 'Content-Type': 'application/json', 'X-Otro': 'si' } })
    }
    const res = await conCronometro(fetchFn)(new Request('https://w.test/api/config'), {}, {})
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('{"ok":true}')
    expect(res.headers.get('X-Otro')).toBe('si')
    expect(res.headers.get('Server-Timing')).toMatch(/^auth;dur=15, app;dur=\d+$/)
  })

  it('no toca las rutas que no son /api/', async () => {
    const original = new Response('html')
    const res = await conCronometro(async () => original)(new Request('https://w.test/clientes'), {}, {})
    expect(res).toBe(original)
    expect(res.headers.get('Server-Timing')).toBeNull()
  })

  it('si la respuesta no se puede copiar, la devuelve tal cual', async () => {
    const rara = { status: 200, headers: new Headers(), body: null, webSocket: {} }
    const res = await conCronometro(async () => rara)(new Request('https://w.test/api/x'), {}, {})
    expect(res).toBe(rara)
  })

  it('los errores del handler siguen propagándose igual', async () => {
    const f = conCronometro(async () => { throw new Error('boom') })
    await expect(f(new Request('https://w.test/api/x'), {}, {})).rejects.toThrow('boom')
  })

  it('cabecera solo con nombres válidos', () => {
    expect(cabeceraServerTiming(40.4, { auth: 10.6, 'mal nombre': 3, cuenta: NaN })).toBe('auth;dur=11, app;dur=40')
  })
})
