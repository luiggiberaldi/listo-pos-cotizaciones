// api/lib/__tests__/audit.test.js
// Endurecimiento de la bitácora (2026-10-23): un registro de auditoría rechazado
// por la base de datos o perdido por la red debe quedar AVISADO en los logs del
// sistema, nunca tragado en silencio. Sin este aviso, el bug del enum
// categoria_auditoria ('FINANZAS' faltante) estuvo meses invisible.
//
// Aislamiento: env apunta a un host inexistente (TLD .invalid, RFC 2606) y toda
// la red está stubbeada; ninguna petición sale del proceso.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registrarAuditoria } from '../audit.js'

const ENV = {
  SUPABASE_URL: 'http://supabase.test.invalid',
  SUPABASE_SERVICE_KEY: 'test-service-key-no-real',
}

const DATOS = {
  usuarioId: '11111111-1111-4111-8111-111111111111',
  usuarioNombre: 'Operador Prueba',
  usuarioRol: 'jefe',
  categoria: 'FINANZAS',
  accion: 'ACCION_PRUEBA',
  descripcion: 'registro de prueba',
  entidadTipo: 'despacho',
  entidadId: '22222222-2222-4222-8222-222222222222',
  meta: {},
  ip: '127.0.0.1',
}

function respuesta(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => body,
  }
}

function stubFetch(impl) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase() })
    return impl(String(url), init)
  }))
  return { calls }
}

let consoleError

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function avisos() {
  return consoleError.mock.calls.map((c) => String(c[0])).join('\n')
}

describe('registrarAuditoria — sin fallos silenciosos', () => {
  it('registro aceptado: devuelve la respuesta y no avisa', async () => {
    stubFetch(() => Promise.resolve(respuesta(201, '[{"id":"x"}]')))

    const res = await registrarAuditoria(ENV, {}, DATOS)

    expect(res.status).toBe(201)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('registro RECHAZADO por la base de datos: avisa con estado y acción, y devuelve la respuesta a los llamadores', async () => {
    const { calls } = stubFetch((url) => {
      if (url.includes('/rest/v1/system_logs')) return Promise.resolve(respuesta(201, ''))
      return Promise.resolve(respuesta(400, 'invalid input value for enum categoria_auditoria: "FINANZAS"'))
    })

    const res = await registrarAuditoria(ENV, {}, DATOS)

    // El contrato con los llamadores no cambia: la respuesta sigue disponible.
    expect(res.status).toBe(400)
    expect(avisos()).toContain('RECHAZADA (400)')
    expect(avisos()).toContain('ACCION_PRUEBA')
    // El aviso también queda persistido en system_logs.
    expect(calls.some((c) => c.url.includes('/rest/v1/system_logs'))).toBe(true)
  })

  it('error de red / timeout: no lanza excepción y deja aviso', async () => {
    const { calls } = stubFetch((url) => {
      if (url.includes('/rest/v1/system_logs')) return Promise.resolve(respuesta(201, ''))
      return Promise.reject(new Error('red caída'))
    })

    const res = await registrarAuditoria(ENV, {}, DATOS)

    expect(res).toBeNull()
    expect(avisos()).toContain('SIN REGISTRAR')
    expect(calls.some((c) => c.url.includes('/rest/v1/system_logs'))).toBe(true)
  })
})
