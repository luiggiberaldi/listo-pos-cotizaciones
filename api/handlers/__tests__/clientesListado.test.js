// Lista de clientes: se piden las dos primeras páginas a la vez (hay >1000 clientes),
// sin perder ni repetir clientes, y con respaldo si la segunda página falla.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleListarClientes } from '../clientes.js'
import { validateOperator } from '../../lib/auth.js'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
  verifyAuth: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null) }))

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const ENV = { SUPABASE_URL: 'https://clientes.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const headers = { apikey: 'service-test', Authorization: 'Bearer service-test' }
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const filas = (desde, n) => Array.from({ length: n }, (_, i) => ({ id: `c${desde + i}`, nombre: `Cliente ${desde + i}` }))
const request = (qs = '') => new Request(`https://worker.test.invalid/api/clientes${qs}`)

let fetchMock
let paginas

beforeEach(() => {
  validateOperator.mockResolvedValue({ user: { id: ACCOUNT }, operador: { id: ACCOUNT, rol: 'jefe' }, headers })
  paginas = {}
  fetchMock = vi.fn(async (url) => {
    const u = new URL(url)
    if (u.pathname.endsWith('/cliente_prestamos')) return jsonResponse([{ cliente_id: 'c5' }])
    const offset = Number(u.searchParams.get('offset'))
    const r = paginas[offset]
    if (r instanceof Error) throw r
    if (r === 500) return new Response('boom', { status: 500 })
    return jsonResponse(r ?? [])
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const offsetsPedidos = () => fetchMock.mock.calls
  .map(([url]) => new URL(url))
  .filter(u => u.pathname.endsWith('/clientes'))
  .map(u => Number(u.searchParams.get('offset')))

describe('handleListarClientes', () => {
  it('pide las dos primeras páginas a la vez y devuelve todos los clientes una sola vez', async () => {
    paginas = { 0: filas(0, 1000), 1000: filas(1000, 206) }
    const res = await handleListarClientes(request(), ENV)
    const data = await res.json()
    expect(data).toHaveLength(1206)
    expect(new Set(data.map(c => c.id)).size).toBe(1206)
    expect(offsetsPedidos()).toEqual([0, 1000])
    expect(data.find(c => c.id === 'c5').tiene_prestamos_activos).toBe(true)
    expect(data.find(c => c.id === 'c6').tiene_prestamos_activos).toBe(false)
  })

  it('ordena por nombre y desempata por id (páginas estables)', async () => {
    paginas = { 0: filas(0, 3) }
    await handleListarClientes(request(), ENV)
    const u = new URL(fetchMock.mock.calls[0][0])
    expect(u.searchParams.get('order')).toBe('nombre.asc,id.asc')
  })

  it('con menos de 1000 clientes ignora la segunda página', async () => {
    paginas = { 0: filas(0, 10), 1000: filas(1000, 5) }
    const data = await (await handleListarClientes(request(), ENV)).json()
    expect(data).toHaveLength(10)
  })

  it('si la segunda página falla, la vuelve a pedir y no pierde clientes', async () => {
    let intentos = 0
    paginas = { 0: filas(0, 1000) }
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(url)
      if (u.pathname.endsWith('/cliente_prestamos')) return jsonResponse([])
      const offset = Number(u.searchParams.get('offset'))
      if (offset === 0) return jsonResponse(paginas[0])
      if (offset === 1000) {
        intentos += 1
        return intentos === 1 ? new Response('boom', { status: 500 }) : jsonResponse(filas(1000, 7))
      }
      return jsonResponse([])
    })
    const data = await (await handleListarClientes(request(), ENV)).json()
    expect(data).toHaveLength(1007)
    expect(intentos).toBe(2)
  })

  it('sigue paginando si hay más de 2000 clientes', async () => {
    paginas = { 0: filas(0, 1000), 1000: filas(1000, 1000), 2000: filas(2000, 3) }
    const data = await (await handleListarClientes(request(), ENV)).json()
    expect(data).toHaveLength(2003)
    expect(offsetsPedidos()).toEqual([0, 1000, 2000])
  })

  it('la búsqueda del servidor sigue funcionando (la usan despachos y cotizaciones)', async () => {
    paginas = { 0: [{ id: 'x', nombre: 'Ferretería Pérez' }, { id: 'y', nombre: 'Aceros Lara' }] }
    const data = await (await handleListarClientes(request('?busqueda=perez'), ENV)).json()
    expect(data.map(c => c.id)).toEqual(['x'])
  })
})
