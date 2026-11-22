// api/handlers/__tests__/designacionSabados.test.js
// OP-2026-036: contrato y guardarraíles del servidor para el Calendario Mensual de Sábados.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleDesignacion } from '../admin.js'
import { verifyAuth } from '../../lib/auth.js'
import { registrarAuditoria } from '../../lib/audit.js'

vi.mock('../../lib/auth.js', () => ({
  verifyAuth: vi.fn(),
  verifySupervisor: vi.fn(),
  verifyAdminRole: vi.fn(),
  verifyPrivileged: vi.fn(),
  supaServiceHeaders: (env) => ({
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  }),
  validateOperator: vi.fn(),
  invalidateOperatorCache: vi.fn(),
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
}))
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(async () => null),
  logToSystem: vi.fn(async () => null),
}))

const ACCOUNT   = '74dd6821-963d-406e-8621-47352e0df27e'
const JEFE_ID   = '11111111-1111-4111-8111-111111111111'
const JOSUE_ID  = 'd6663eec-1b3b-43c4-a4b9-9cab16bf80a7'
const EDGAR_ID  = 'f56214bb-1f62-42e7-888d-aaf44e177fd6'
const EIKER_ID  = 'a7223bc3-7ae9-4cdc-926f-875ca639d425'
const NIKI_ID   = '5ec8c63b-c96d-46f2-b95e-16420d15d726'
const EXTERNO_ID = '99999999-9999-4999-8999-999999999999'

const ENV = { SUPABASE_URL: 'https://main.test.invalid', SUPABASE_SERVICE_KEY: 'test-key' }

const callDesignacion = (method, body = null, query = '') => {
  const url = new URL(`https://worker.test.invalid/api/comisiones/designacion${query}`)
  const req = new Request(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.1' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return handleDesignacion(req, ENV, url)
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock
let rolOperadorActual
let vendedoresValidos
let designacionesGuardadas
let escriturasBD

beforeEach(() => {
  // Fijamos reloj al domingo 2026-11-22 10:00 Venezuela (14:00 UTC)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-22T14:00:00.000Z'))

  rolOperadorActual = 'jefe'
  vendedoresValidos = [
    { id: JOSUE_ID, nombre: 'Josué Marciales', rol: 'vendedor', color: '#10b981' },
    { id: EDGAR_ID, nombre: 'Edgar Ramírez', rol: 'vendedor', color: '#3b82f6' },
    { id: EIKER_ID, nombre: 'Eiker Montaner', rol: 'vendedor', color: '#f59e0b' },
    { id: NIKI_ID,  nombre: 'Niki Ramírez',  rol: 'supervisor', color: '#8b5cf6' },
  ]
  designacionesGuardadas = new Map([
    ['2026-11-28', { id: 'desig-28', cuenta_id: ACCOUNT, fecha: '2026-11-28', designado_id: JOSUE_ID }],
  ])
  escriturasBD = []

  verifyAuth.mockResolvedValue({
    id: ACCOUNT,
    operator_id: JEFE_ID,
    operator_nombre: 'Enzo Patti',
    operator_rol: 'jefe',
  })
  registrarAuditoria.mockClear()

  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (rawUrl, init = {}) => {
    const u = String(rawUrl)
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : undefined

    // 1. Consulta del rol del operador (getRolOperador)
    if (u.includes('/rest/v1/usuarios?') && u.includes(`id=eq.${JEFE_ID}`)) {
      return jsonResponse([{ rol: rolOperadorActual }])
    }

    // 2. Validación de vendedores elegibles (lote con id=in.(...) o individual con id=eq....)
    if (u.includes('/rest/v1/usuarios?') && u.includes('es_externo=is.false')) {
      const inMatch = /id=in\.\(([^)]+)\)/.exec(u)
      if (inMatch) {
        const ids = inMatch[1].split(',')
        return jsonResponse(vendedoresValidos.filter(v => ids.includes(v.id)))
      }
      const eqMatch = /id=eq\.([0-9a-f-]+)/i.exec(u)
      if (eqMatch) {
        return jsonResponse(vendedoresValidos.filter(v => v.id === eqMatch[1]))
      }
    }

    // 3. GET designaciones
    if (u.includes('/rest/v1/comision_designacion_diaria') && method === 'GET') {
      return jsonResponse(Array.from(designacionesGuardadas.values()))
    }

    // 4. POST upsert designación (bloque atómico o individual)
    if (u.includes('/rest/v1/comision_designacion_diaria') && method === 'POST') {
      const filas = Array.isArray(body) ? body : [body]
      escriturasBD.push({ tipo: 'POST', cantidad: filas.length, fechas: filas.map(f => f.fecha) })
      const out = filas.map(f => {
        const row = {
          id: `desig-${f.fecha}`,
          cuenta_id: f.cuenta_id,
          fecha: f.fecha,
          designado_id: f.designado_id,
          creado_por: f.creado_por,
        }
        designacionesGuardadas.set(f.fecha, row)
        return row
      })
      return jsonResponse(out, 201)
    }

    // 5. DELETE designación (bloque con fecha=in.(...) o individual con fecha=eq....)
    if (u.includes('/rest/v1/comision_designacion_diaria') && method === 'DELETE') {
      const inMatch = /fecha=in\.\(([^)]+)\)/.exec(u)
      const eqMatch = /fecha=eq\.(\d{4}-\d{2}-\d{2})/.exec(u)
      const fechas = inMatch ? inMatch[1].split(',') : (eqMatch ? [eqMatch[1]] : [])
      escriturasBD.push({ tipo: 'DELETE', fechas })
      const eliminadas = []
      for (const f of fechas) {
        const existente = designacionesGuardadas.get(f)
        if (existente) eliminadas.push(existente)
        designacionesGuardadas.delete(f)
      }
      return jsonResponse(eliminadas)
    }

    throw new Error(`Llamada fetch no esperada: ${method} ${u}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
  fetchMock.mockRestore()
})

describe('OP-2026-036 — handleDesignacion (servidor)', () => {
  it('bloquea con 403 a cualquier rol que no sea jefe (vendedor, supervisor, administración)', async () => {
    for (const rolNoJefe of ['vendedor', 'supervisor', 'administracion', 'logistica']) {
      rolOperadorActual = rolNoJefe
      const res = await callDesignacion('POST', {
        cambios: [{ fecha: '2026-12-05', designado_id: EIKER_ID }],
      })
      expect(res.status).toBe(403)
    }
    expect(escriturasBD).toHaveLength(0)
  })

  it('guarda los 4 sábados de diciembre 2026 y limpia el 28-nov en un solo lote, con auditoría completa', async () => {
    const res = await callDesignacion('POST', {
      cambios: [
        { fecha: '2026-11-28', designado_id: null }, // quitar Josué del 28-nov
        { fecha: '2026-12-05', designado_id: JOSUE_ID },
        { fecha: '2026-12-12', designado_id: EDGAR_ID },
        { fecha: '2026-12-19', designado_id: EIKER_ID },
        { fecha: '2026-12-26', designado_id: NIKI_ID },
      ],
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.eliminadas).toEqual(['2026-11-28'])
    expect(data.actualizadas).toHaveLength(4)
    expect(data.actualizadas.map(a => `${a.fecha}:${a.designado?.nombre}`)).toEqual([
      '2026-12-05:Josué Marciales',
      '2026-12-12:Edgar Ramírez',
      '2026-12-19:Eiker Montaner',
      '2026-12-26:Niki Ramírez',
    ])
    // 1 POST en bloque (4 sábados juntos) + 1 DELETE en bloque (1 sábado)
    expect(escriturasBD.filter(e => e.tipo === 'POST')).toHaveLength(1)
    expect(escriturasBD.filter(e => e.tipo === 'POST')[0].cantidad).toBe(4)
    expect(escriturasBD.filter(e => e.tipo === 'DELETE')).toHaveLength(1)
    // 1 DELETE + 4 POST = 5 registros en auditoría
    expect(registrarAuditoria).toHaveBeenCalledTimes(5)
  })

  it('DELETE individual también rechaza borrar una fecha pasada con 400 sin tocar la base', async () => {
    const res = await callDesignacion('DELETE', { fecha: '2026-11-21' })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/fecha pasada/i)
    expect(escriturasBD).toHaveLength(0)
  })

  it('rechaza con 400 si el lote incluye un día que no es sábado, sin tocar la base de datos', async () => {
    const res = await callDesignacion('POST', {
      cambios: [
        { fecha: '2026-12-05', designado_id: JOSUE_ID },
        { fecha: '2026-12-08', designado_id: EDGAR_ID }, // martes
      ],
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/no es un sábado/i)
    expect(escriturasBD).toHaveLength(0)
  })

  it('rechaza con 400 si el lote intenta modificar un sábado pasado, sin tocar la base de datos', async () => {
    const res = await callDesignacion('POST', {
      cambios: [
        { fecha: '2026-11-21', designado_id: EIKER_ID }, // ayer sábado
      ],
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/sábado pasado/i)
    expect(escriturasBD).toHaveLength(0)
  })

  it('rechaza todo el lote si uno de los vendedores es externo o inactivo (pre-validación atómica)', async () => {
    const res = await callDesignacion('POST', {
      cambios: [
        { fecha: '2026-12-05', designado_id: JOSUE_ID },
        { fecha: '2026-12-12', designado_id: EXTERNO_ID }, // externo/no elegible
      ],
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/vendedor o supervisor activo \(no externo\)/i)
    // Ningún sábado del lote se escribió porque la validación ocurre antes de escribir
    expect(escriturasBD).toHaveLength(0)
  })
})
