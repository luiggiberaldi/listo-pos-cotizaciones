// api/handlers/__tests__/_harness.js
// Utilidades de aislamiento para los tests de handlers.
//
// GARANTÍA DE AISLAMIENTO:
//   · env.SUPABASE_URL apunta a un host inexistente (http://supabase.test.invalid).
//     El TLD .invalid está reservado por la RFC 2606 y nunca resuelve.
//   · Las claves son literales de prueba, no credenciales reales.
//   · installFetchMock() reemplaza globalThis.fetch: ninguna petición sale del proceso.
//   · Si un handler pide una ruta no declarada en el mock, el test FALLA con el
//     detalle de la petición — así una llamada inesperada se detecta, no se ignora.

import { vi, expect } from 'vitest'

export const SUPABASE_URL = 'http://supabase.test.invalid'

/** env falso: ninguna credencial real. */
export const ENV = {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY: 'test-service-key-no-real',
  SUPABASE_ANON_KEY:    'test-anon-key-no-real',
}

/** Operadores de prueba por rol. */
export const OPERADORES = {
  administracion: { id: '11111111-1111-4111-8111-111111111111', nombre: 'Admin Test',      rol: 'administracion', cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  jefe:           { id: '22222222-2222-4222-8222-222222222222', nombre: 'Jefe Test',       rol: 'jefe',           cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  desarrollador:  { id: '33333333-3333-4333-8333-333333333333', nombre: 'Dev Test',        rol: 'desarrollador',  cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  logistica:      { id: '44444444-4444-4444-8444-444444444444', nombre: 'Logistica Test',  rol: 'logistica',      cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  supervisor:     { id: '55555555-5555-4555-8555-555555555555', nombre: 'Supervisor Test', rol: 'supervisor',     cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  vendedor:       { id: '66666666-6666-4666-8666-666666666666', nombre: 'Vendedor Test',   rol: 'vendedor',       cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
}

/** UUIDs fijos reutilizables en los tests. */
export const IDS = {
  empleado:  'e0000000-0000-4000-8000-000000000001',
  empleado2: 'e0000000-0000-4000-8000-000000000002',
  config:    'c0000000-0000-4000-8000-000000000001',
  periodo:   'b0000000-0000-4000-8000-000000000001',
  linea:     '10000000-0000-4000-8000-000000000001',
  linea2:    '10000000-0000-4000-8000-000000000002',
  registro:  'a0000000-0000-4000-8000-000000000001',
  invalido:  'no-es-un-uuid',
}

/** Request falso; el body se sirve tal cual al handler. */
export function makeRequest(body = undefined, { url = 'http://worker.test/api/nomina/x' } = {}) {
  return {
    url,
    method: 'POST',
    headers: { get: () => null },
    json: async () => {
      if (body === '__INVALID_JSON__') throw new Error('Unexpected token')
      return body
    },
  }
}

/** Respuesta estilo fetch. */
function makeResponse(data, { ok = true, status = 200 } = {}) {
  return {
    ok, status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  }
}

/**
 * Instala un fetch mockeado.
 *
 * `routes` es una lista de { match, method?, respond }:
 *   · match: substring o RegExp contra la URL
 *   · method: opcional ('GET' por defecto en las lecturas de PostgREST)
 *   · respond: valor devuelto, o función (url, init) => valor
 *
 * Devuelve un objeto con:
 *   · calls: todas las peticiones interceptadas
 *   · restore(): restaura el fetch original
 */
export function installFetchMock(routes = []) {
  const calls = []

  const impl = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? safeParse(init.body) : undefined
    calls.push({ url: String(url), method, body, headers: init.headers })

    // Blindaje: si alguna vez se colara una URL que no es la de prueba, abortar.
    if (!String(url).startsWith(SUPABASE_URL)) {
      throw new Error(`[harness] Petición fuera del host de prueba: ${url}`)
    }

    for (const r of routes) {
      const okUrl = r.match instanceof RegExp
        ? r.match.test(String(url))
        : String(url).includes(r.match)
      const okMethod = !r.method || r.method.toUpperCase() === method
      if (okUrl && okMethod) {
        const out = typeof r.respond === 'function' ? await r.respond(String(url), init) : r.respond
        if (out && typeof out === 'object' && '__raw' in out) return makeResponse(out.__raw, out)
        return makeResponse(out)
      }
    }

    throw new Error(
      `[harness] Petición no declarada en el mock:\n  ${method} ${url}\n` +
      `  Rutas declaradas: ${routes.map(r => r.match).join(', ') || '(ninguna)'}`
    )
  })

  const original = globalThis.fetch
  globalThis.fetch = impl

  return {
    calls,
    fetchMock: impl,
    restore() { globalThis.fetch = original },
  }
}

function safeParse(b) {
  try { return JSON.parse(b) } catch { return b }
}

/** Extrae { status, body } de una Response del handler. */
export async function readResponse(res) {
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

/**
 * Mockea validateOperator para que devuelva un operador dado sin tocar la red.
 * Se usa con vi.mock a nivel de módulo en cada archivo de test.
 */
export function authOk(operador) {
  return {
    user: { id: operador.id, operator_id: operador.id },
    operador,
    headers: { apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    ip: '127.0.0.1',
  }
}

/** Verifica que ninguna petición interceptada salió del host de prueba. */
export function expectSinRedReal(calls) {
  for (const c of calls) {
    expect(c.url.startsWith(SUPABASE_URL)).toBe(true)
  }
}
