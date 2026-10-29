// construacero-staging/api/handlers/__tests__/flotaVehiculos.test.js
// Fase 2 del plan de flota: contratos de los handlers de vehículos, del
// vehículo por viaje en despachos/venta rápida y de la baja protegida de
// transportistas (raíles R1/R2/R13 del plan de flota).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  handleListarVehiculos,
  handleCrearVehiculo,
  handleActualizarVehiculo,
  handleEliminarVehiculo,
  handleReporteFlotaChoferes,
} from '../vehiculos.js'
import { validateOperator } from '../../lib/auth.js'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => null) }))

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const VEHICLE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const OPERATOR = 'cccccccc-3333-4333-8333-cccccccccccc'
const ENV = { SUPABASE_URL: 'https://staging.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const headers = { apikey: 'service-test', Authorization: 'Bearer service-test', 'Content-Type': 'application/json' }

const gestor = { id: OPERATOR, nombre: 'Logística test', rol: 'logistica', cuenta_id: ACCOUNT }
const soloLectura = { id: OPERATOR, nombre: 'Vendedor test', rol: 'vendedor', cuenta_id: ACCOUNT }
const puedeEliminar = { id: OPERATOR, nombre: 'Jefe test', rol: 'jefe', cuenta_id: ACCOUNT }

function setAuth(operator = gestor) {
  validateOperator.mockResolvedValue({ operador: operator, headers, ip: '127.0.0.1' })
}

const request = (path, body) => new Request(`https://worker.test.invalid${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock
let fetchCalls

function installFetch(routes) {
  fetchMock.mockImplementation(async (url, init = {}) => {
    const u = String(url)
    const method = (init.method || 'GET').toUpperCase()
    fetchCalls.push({ method, url: u, body: init.body ? JSON.parse(init.body) : undefined })
    for (const route of routes) {
      if (u.includes(route.match) && (!route.method || route.method === method)) {
        return jsonResponse(route.response, route.status || 200)
      }
    }
    throw new Error(`Ruta inesperada: ${method} ${u}`)
  })
}

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch').mockReset()
  fetchCalls = []
})

describe('GET /api/vehiculos/listar', () => {
  it('devuelve vehículos con sus choferes asignados y filtra inactivos por defecto', async () => {
    setAuth()
    installFetch([
      { match: '/rest/v1/vehiculos', method: 'GET', response: [{ id: VEHICLE, codigo: 'CAM-01', placa: 'TST-001', activo: true }] },
      { match: '/rest/v1/transportistas', method: 'GET', response: [{ id: OPERATOR, nombre: 'Juan', activo: true, vehiculo_habitual_id: VEHICLE }] },
    ])
    const res = await handleListarVehiculos(request('/api/vehiculos/listar'), ENV)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.vehiculos).toHaveLength(1)
    expect(data.vehiculos[0].choferes_asignados).toEqual([{ id: OPERATOR, nombre: 'Juan', activo: true }])
    expect(fetchCalls[0].url).toContain('activo=eq.true')
  })

  it('con incluir_inactivos=true no aplica el filtro de activos', async () => {
    setAuth()
    installFetch([
      { match: '/rest/v1/vehiculos', method: 'GET', response: [] },
      { match: '/rest/v1/transportistas', method: 'GET', response: [] },
    ])
    const res = await handleListarVehiculos(request('/api/vehiculos/listar?incluir_inactivos=true'), ENV)
    expect(res.status).toBe(200)
    expect(fetchCalls[0].url).not.toContain('activo=eq.true')
  })
})

describe('POST /api/vehiculos/crear', () => {
  it('rechaza roles sin permiso de gestión', async () => {
    setAuth(soloLectura)
    installFetch([])
    const res = await handleCrearVehiculo(request('/api/vehiculos/crear', { codigo: 'CAM-05', nombre: 'X', placa: 'TST-005' }), ENV)
    expect(res.status).toBe(403)
  })

  it('exige codigo, nombre y placa', async () => {
    setAuth()
    installFetch([])
    const res = await handleCrearVehiculo(request('/api/vehiculos/crear', { codigo: 'CAM-05' }), ENV)
    expect(res.status).toBe(400)
  })

  it('rechaza con mensaje amable una placa repetida en la cuenta', async () => {
    setAuth()
    installFetch([
      { match: '/rest/v1/vehiculos', method: 'GET', response: [{ id: VEHICLE }] },
    ])
    const res = await handleCrearVehiculo(request('/api/vehiculos/crear', { codigo: 'CAM-05', nombre: 'Otro', placa: 'tst-001' }), ENV)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Ya existe un vehículo con la placa TST-001')
  })

  it('crea el vehículo con la placa normalizada y la cuenta del operador', async () => {
    setAuth()
    installFetch([
      { match: '/rest/v1/vehiculos', method: 'GET', response: [] },
      { match: '/rest/v1/vehiculos', method: 'POST', response: [{ id: VEHICLE, codigo: 'CAM-05', placa: 'TST-005' }] },
    ])
    const res = await handleCrearVehiculo(
      request('/api/vehiculos/crear', { codigo: 'CAM-05', nombre: 'CAM-05 Test', placa: 'tst-005', capacidad_kg: 3500 }),
      ENV
    )
    expect(res.status).toBe(201)
    const insert = fetchCalls.find(c => c.method === 'POST')
    expect(insert.body.cuenta_id).toBe(ACCOUNT)
    expect(insert.body.placa).toBe('TST-005')
    expect(insert.body.capacidad_kg).toBe(3500)
    expect(insert.body.activo).toBe(true)
  })
})

describe('POST /api/vehiculos/actualizar', () => {
  it('no permite dejar la placa de otro vehículo de la cuenta', async () => {
    setAuth()
    installFetch([
      { match: '/rest/v1/vehiculos', method: 'GET', response: [{ id: 'dddddddd-4444-4444-8444-dddddddddddd' }] },
    ])
    const res = await handleActualizarVehiculo(
      request('/api/vehiculos/actualizar', { id: VEHICLE, placa: 'TST-002' }),
      ENV
    )
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Ya existe otro vehículo con la placa')
  })

  it('actualiza campos permitidos y devuelve 404 si no es de la cuenta', async () => {
    setAuth()
    installFetch([
      { match: '/rest/v1/vehiculos', method: 'GET', response: [] },
      { match: '/rest/v1/vehiculos', method: 'PATCH', response: [] },
    ])
    const res = await handleActualizarVehiculo(
      request('/api/vehiculos/actualizar', { id: VEHICLE, activo: true }),
      ENV
    )
    expect(res.status).toBe(404)
    const patch = fetchCalls.find(c => c.method === 'PATCH')
    expect(patch.url).toContain(`cuenta_id=eq.${ACCOUNT}`)
    expect(patch.body).toEqual({ activo: true })
  })
})

describe('POST /api/vehiculos/eliminar', () => {
  it('invoca la RPC atómica y traslada la acción resultante', async () => {
    setAuth(puedeEliminar)
    installFetch([
      {
        match: '/rest/v1/rpc/eliminar_o_desactivar_vehiculo_atomico',
        method: 'POST',
        response: { ok: true, accion: 'desactivado_logico', viajes_historicos: 3, choferes_desvinculados: 1 },
      },
    ])
    const res = await handleEliminarVehiculo(request('/api/vehiculos/eliminar', { id: VEHICLE }), ENV)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.accion).toBe('desactivado_logico')
    expect(data.viajes_historicos).toBe(3)
    const call = fetchCalls[0]
    expect(call.body).toEqual({ p_cuenta_id: ACCOUNT, p_vehiculo_id: VEHICLE })
  })

  it('un logístico no puede dar de baja vehículos', async () => {
    setAuth()
    installFetch([])
    const res = await handleEliminarVehiculo(request('/api/vehiculos/eliminar', { id: VEHICLE }), ENV)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/reportes/flota-choferes', () => {
  it('rechaza fechas inválidas', async () => {
    setAuth()
    installFetch([])
    const res = await handleReporteFlotaChoferes(request('/api/reportes/flota-choferes?desde=2026-13-40'), ENV)
    expect(res.status).toBe(400)
  })

  it('un vendedor no ve comisiones de choferes (raíl R13)', async () => {
    setAuth(soloLectura)
    installFetch([])
    const res = await handleReporteFlotaChoferes(request('/api/reportes/flota-choferes'), ENV)
    expect(res.status).toBe(403)
  })

  it('invoca la RPC con la cuenta del operador y el rango de fechas', async () => {
    setAuth()
    installFetch([
      {
        match: '/rest/v1/rpc/obtener_reporte_flota_y_choferes',
        method: 'POST',
        response: { ok: true, por_vehiculo: [], por_chofer_local: [] },
      },
    ])
    const res = await handleReporteFlotaChoferes(
      request('/api/reportes/flota-choferes?desde=2026-10-01&hasta=2026-10-26'),
      ENV
    )
    expect(res.status).toBe(200)
    const call = fetchCalls[0]
    expect(call.body.p_cuenta_id).toBe(ACCOUNT)
    expect(call.body.p_fecha_inicio).toBe('2026-10-01T00:00:00')
    expect(call.body.p_fecha_fin).toBe('2026-10-26T23:59:59.999')
  })
})

// ── Contratos de fuentes: el resto de la fase 2 debe quedar cableado ─────────
describe('contratos de la fase 2 en el código del servidor', () => {
  const leer = (ruta) => readFileSync(new URL(`../../../${ruta}`, import.meta.url), 'utf8')

  it('worker.js registra las cinco rutas nuevas', () => {
    const worker = leer('worker.js')
    for (const ruta of [
      "/api/vehiculos/listar",
      "/api/vehiculos/crear",
      "/api/vehiculos/actualizar",
      "/api/vehiculos/eliminar",
      "/api/reportes/flota-choferes",
    ]) {
      expect(worker).toContain(ruta)
    }
  })

  it('despachos.js guarda el vehículo del viaje y soporta fijar el habitual', () => {
    const despachos = leer('api/handlers/despachos.js')
    expect(despachos).toContain('vehiculo_id: vehiculoViajeId')
    expect(despachos).toContain('actualizarVehiculoHabitual')
    expect(despachos).toContain('guardarVehiculoHabitual')
  })

  it('al despachar se hereda el camión que el vendedor eligió en la cotización', () => {
    const despachos = leer('api/handlers/despachos.js')
    expect(despachos).toContain('transportistaFinalId === cot.transportista_id ? cot.vehiculo_id : null')
  })

  it('editar un despacho solo toca el camión si se envía o si cambia el chofer (R4)', () => {
    const despachos = leer('api/handlers/despachos.js')
    expect(despachos).toContain("campos.vehiculo_origen = vehiculoId ? 'manual' : null")
    expect(despachos).toMatch(/else if \(cambiaChofer\) \{\s*campos\.vehiculo_id = null;/)
  })

  it('el camión del viaje se valida contra la cuenta en despacho, edición y venta rápida (R8)', () => {
    const despachos = leer('api/handlers/despachos.js')
    const cotizaciones = leer('api/handlers/cotizaciones.js')
    expect(despachos.split('validarVehiculoDeCuenta(').length - 1).toBeGreaterThanOrEqual(2)
    expect(cotizaciones).toContain('validarVehiculoDeCuenta(')
  })

  it('el camión fijo se guarda DESPUÉS de crear la venta/despacho, sin tumbarla si falla', () => {
    for (const rel of ['api/handlers/despachos.js', 'api/handlers/cotizaciones.js']) {
      const fuente = leer(rel)
      expect(fuente).toContain('avisoVehiculo')
      expect(fuente).not.toContain('No se pudo fijar el vehículo habitual')
    }
  })

  it('cotizaciones.js (venta rápida) guarda el vehículo en cotización y despacho', () => {
    const cotizaciones = leer('api/handlers/cotizaciones.js')
    const ocurrencias = cotizaciones.split('vehiculo_id: vehiculoId || null').length - 1
    expect(ocurrencias).toBeGreaterThanOrEqual(2)
    expect(cotizaciones).toContain('actualizarVehiculoHabitual')
  })

  it('admin.js valida el vehículo habitual y usa la baja protegida de choferes', () => {
    const admin = leer('api/handlers/admin.js')
    expect(admin).toContain('validarVehiculoHabitual')
    expect(admin).toContain('vehiculo_habitual_id')
    expect(admin).toContain('eliminar_o_desactivar_transportista_atomico')
    expect(admin).toContain('TIENE_FLETES_PENDIENTES')
    // La escritura directa al PATCH de desactivación quedó reemplazada por la RPC
    expect(admin).not.toContain('body: JSON.stringify({ activo: false })')
  })

  it('vehiculos.js no abre escritura directa a la tabla desde el navegador', () => {
    const vehiculos = leer('api/handlers/vehiculos.js')
    expect(vehiculos).toContain('p_cuenta_id')
    expect(vehiculos).toContain('eliminar_o_desactivar_vehiculo_atomico')
    expect(vehiculos).toContain('obtener_reporte_flota_y_choferes')
  })
})
