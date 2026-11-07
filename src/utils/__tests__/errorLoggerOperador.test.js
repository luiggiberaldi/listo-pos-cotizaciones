// Los logs (incluidas las mediciones de rendimiento) se envían a nombre del operador del PIN;
// si esa sesión venció, se reenvían sin ella para no perderlos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/supabase/client', () => ({
  default: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) } },
}))
vi.mock('../../services/apiBase', () => ({ apiUrl: p => `https://w.test${p}` }))
const sesion = { headers: {} }
vi.mock('../../services/operatorSession', () => ({ getOperatorSessionHeaders: () => sesion.headers }))

let fetchMock
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function enviar() {
  const { logClientInfo } = await import('../errorLogger.js')
  logClientInfo('Tiempos', 'RENDIMIENTO', {})
  await vi.advanceTimersByTimeAsync(2100)
}

describe('errorLogger', () => {
  it('envía la sesión del operador', async () => {
    sesion.headers = { 'X-Operator-Session': 's1', 'X-Operator-Id': 'op1' }
    await enviar()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const h = fetchMock.mock.calls[0][1].headers
    expect(h['X-Operator-Id']).toBe('op1')
    expect(h.Authorization).toBe('Bearer tok')
  })

  it('si la sesión del PIN venció (401), reenvía sin ella', async () => {
    sesion.headers = { 'X-Operator-Session': 's1', 'X-Operator-Id': 'op1' }
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await enviar()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].headers['X-Operator-Id']).toBeUndefined()
  })

  it('sin sesión de operador envía igual, una sola vez', async () => {
    sesion.headers = {}
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await enviar()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
