// construacero-staging/api/handlers/__tests__/crearUsuario.test.js
// OP-2026-030: contrato de la creación (y renombre) de usuarios.
// - nombre repetido en la empresa → 409, sin insertar nada
// - reintento tras conexión lenta → el segundo intento no duplica
// - si no se puede comprobar el nombre → 503, sin insertar
// - PIN con largo incorrecto → 400
// - el nombre se guarda limpio (sin espacios dobles)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAdmin } from '../admin.js'
import { verifyAuth, verifySupervisor } from '../../lib/auth.js'

vi.mock('../../lib/auth.js', () => ({
  verifyAuth: vi.fn(),
  verifySupervisor: vi.fn(),
  verifyPrivileged: vi.fn(),
  validateOperator: vi.fn(),
  invalidateOperatorCache: vi.fn(),
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null) }))
vi.mock('../../lib/crypto.js', () => ({
  generateSalt: () => 'sal-test',
  hashPinPBKDF2: vi.fn(async () => 'hash-test'),
}))

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OPERATOR = 'cccccccc-3333-4333-8333-cccccccccccc'
const OTRO = 'dddddddd-4444-4444-8444-dddddddddddd'
const ENV = { SUPABASE_URL: 'https://staging.test.invalid', SUPABASE_SERVICE_KEY: 'test' }

let ipSeq = 0
const request = (path, method, body) => new Request(`https://worker.test.invalid${path}`, {
  method,
  // IP distinta por prueba: el límite de pedidos por minuto no debe interferir
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.0.0.${++ipSeq}` },
  body: JSON.stringify(body),
})
const call = (path, method, body) => {
  const req = request(path, method, body)
  return handleAdmin(req, ENV, new URL(req.url))
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock
let calls
let usuariosEnBD

function installFetch({ lookupFalla = false } = {}) {
  fetchMock.mockImplementation(async (url, init = {}) => {
    const u = String(url)
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, url: u, body })
    if (u.includes('/rest/v1/usuarios') && method === 'GET') {
      if (lookupFalla) return jsonResponse({ message: 'caído' }, 500)
      return jsonResponse(usuariosEnBD)
    }
    if (u.includes('/rest/v1/usuarios') && method === 'POST') {
      usuariosEnBD.push({ id: body.id, nombre: body.nombre, activo: true })
      return new Response(null, { status: 201 })
    }
    if (u.includes('/rest/v1/usuarios') && method === 'PATCH') {
      return new Response(null, { status: 204 })
    }
    throw new Error(`Ruta inesperada: ${method} ${u}`)
  })
}

const inserts = () => calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/usuarios'))
const nuevo = (extra = {}) => ({ nombre: 'Ana Gómez', rol: 'vendedor', pin: '1234', ...extra })

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch').mockReset()
  calls = []
  usuariosEnBD = [{ id: OTRO, nombre: 'José Pérez', activo: true }]
  verifyAuth.mockResolvedValue({ id: ACCOUNT, operator_id: OPERATOR, operator_nombre: 'Jefe test', operator_rol: 'jefe' })
  verifySupervisor.mockResolvedValue(true)
  installFetch()
})

describe('POST /api/admin/users — crear usuario', () => {
  it('crea un usuario con nombre nuevo y lo guarda limpio', async () => {
    const res = await call('/api/admin/users', 'POST', nuevo({ nombre: '  Ana   Gómez ' }))
    expect(res.status).toBe(201)
    expect(inserts()).toHaveLength(1)
    expect(inserts()[0].body).toMatchObject({ nombre: 'Ana Gómez', rol: 'vendedor', cuenta_id: ACCOUNT, pin_hash: 'hash-test' })
    // la búsqueda de repetidos se limita a la empresa de quien crea
    const lookup = calls.find(c => c.method === 'GET')
    expect(lookup.url).toContain(`cuenta_id=eq.${ACCOUNT}`)
  })

  it.each([
    ['igual', 'José Pérez'],
    ['sin acentos ni mayúsculas', 'jose perez'],
    ['con espacios de más', '  JOSÉ   PÉREZ  '],
  ])('rechaza un nombre repetido (%s) con 409 y no inserta', async (_caso, nombre) => {
    const res = await call('/api/admin/users', 'POST', nuevo({ nombre }))
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toContain('Ya existe un usuario llamado "José Pérez"')
    expect(inserts()).toHaveLength(0)
  })

  it('si el repetido está desactivado, sugiere reactivarlo', async () => {
    usuariosEnBD = [{ id: OTRO, nombre: 'José Pérez', activo: false }]
    const res = await call('/api/admin/users', 'POST', nuevo({ nombre: 'José Pérez' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('reactivarlo')
  })

  it('un reintento con los mismos datos (doble clic / conexión lenta) no duplica', async () => {
    const primero = await call('/api/admin/users', 'POST', nuevo())
    const segundo = await call('/api/admin/users', 'POST', nuevo())
    expect(primero.status).toBe(201)
    expect(segundo.status).toBe(409)
    expect(inserts()).toHaveLength(1)
  })

  it('si no se puede comprobar el nombre, responde 503 y no inserta', async () => {
    installFetch({ lookupFalla: true })
    const res = await call('/api/admin/users', 'POST', nuevo())
    expect(res.status).toBe(503)
    expect(inserts()).toHaveLength(0)
  })

  it.each([
    ['vendedor con 6 dígitos', { rol: 'vendedor', pin: '123456' }, 4],
    ['jefe con 4 dígitos', { rol: 'jefe', pin: '1234' }, 6],
    ['PIN con letras', { rol: 'vendedor', pin: '12a4' }, 4],
  ])('rechaza PIN inválido: %s', async (_caso, extra, largo) => {
    const res = await call('/api/admin/users', 'POST', nuevo(extra))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain(`${largo} dígitos`)
    expect(inserts()).toHaveLength(0)
  })

  it('rechaza un nombre hecho solo de espacios', async () => {
    const res = await call('/api/admin/users', 'POST', nuevo({ nombre: '    ' }))
    expect(res.status).toBe(400)
    expect(inserts()).toHaveLength(0)
  })

  it('sin permiso de administrar usuarios → 403', async () => {
    verifySupervisor.mockResolvedValue(false)
    const res = await call('/api/admin/users', 'POST', nuevo())
    expect(res.status).toBe(403)
    expect(inserts()).toHaveLength(0)
  })
})

describe('PUT /api/admin/users/:id — renombrar', () => {
  const MIO = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'

  it('no deja renombrar a un nombre que ya usa otro usuario', async () => {
    usuariosEnBD.push({ id: MIO, nombre: 'Ana Gómez', activo: true })
    const res = await call(`/api/admin/users/${MIO}`, 'PUT', { nombre: 'jose perez', rol: 'vendedor' })
    expect(res.status).toBe(409)
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
  })

  it('guardar sin cambiar el propio nombre sí funciona', async () => {
    usuariosEnBD.push({ id: MIO, nombre: 'Ana Gómez', activo: true })
    const res = await call(`/api/admin/users/${MIO}`, 'PUT', { nombre: 'Ana Gómez', rol: 'vendedor' })
    expect(res.status).toBe(200)
    expect(calls.find(c => c.method === 'PATCH').body.nombre).toBe('Ana Gómez')
  })

  it('activar/desactivar (sin nombre) no consulta nombres', async () => {
    const res = await call(`/api/admin/users/${MIO}`, 'PUT', { activo: false })
    expect(res.status).toBe(200)
    expect(calls.filter(c => c.method === 'GET')).toHaveLength(0)
  })
})
