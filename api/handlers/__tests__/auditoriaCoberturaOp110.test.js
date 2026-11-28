// api/handlers/__tests__/auditoriaCoberturaOp110.test.js
// Pruebas de Auditoría 2.0 (OP-2026-110 — Fases 1, 2, 3, 4 y 5):
//  1. Portero: decide qué rutas registrar y clasifica ok/denegado/error.
//  2. Separación real de roles: supervisor NO ve dinero/precios ni peticiones ni sellos;
//     administracion y jefe sí.
//  3. Crecer sola (guardia estática): todas las acciones de registrarAuditoria() están
//     en el catálogo (321) y las 17 tablas clave tienen cámara (320).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../../lib/auth.js', () => ({
  verifyAuth: vi.fn(),
  getOperatorRole: vi.fn(),
}))

import { verifyAuth, getOperatorRole } from '../../lib/auth.js'
import { debeRegistrarPortero, clasificarResultadoPortero } from '../../lib/portero.js'
import {
  handleGetAudit,
  handleGetAuditCambios,
  handleGetAuditPeticiones,
  handleVerificarCadenaAuditoria,
} from '../audit.js'

const ENV = {
  SUPABASE_URL: 'http://supabase.test.invalid',
  SUPABASE_SERVICE_KEY: 'test-service-key',
}

describe('OP-2026-110 — Auditoría 2.0 (Portero, Roles y Cobertura)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('Portero registra mutaciones y alertas 401/403/500, pero ignora GET 200 y /api/logs', () => {
    expect(debeRegistrarPortero('POST', '/api/despachos/crear', 200)).toBe(true)
    expect(debeRegistrarPortero('GET', '/api/clientes', 200)).toBe(false)
    expect(debeRegistrarPortero('GET', '/api/admin/audit', 403)).toBe(true)
    expect(debeRegistrarPortero('GET', '/api/clientes', 500)).toBe(true)
    expect(debeRegistrarPortero('POST', '/api/logs', 200)).toBe(false)

    expect(clasificarResultadoPortero(200)).toBe('ok')
    expect(clasificarResultadoPortero(401)).toBe('denegado')
    expect(clasificarResultadoPortero(403)).toBe('denegado')
    expect(clasificarResultadoPortero(500)).toBe('error')
  })

  it('supervisor NO ve finanzas/precios en /audit ni en /cambios, y recibe 403 en /peticiones y /verificar-cadena', async () => {
    verifyAuth.mockResolvedValue({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', operator_id: '11111111-1111-4111-8111-111111111111' })
    getOperatorRole.mockResolvedValue('supervisor')

    const urlsConsultadas = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      urlsConsultadas.push(String(url))
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-range': '0-1/2' }),
        json: async () => [
          { id: '1', categoria: 'FINANZAS', accion: 'REGISTRAR_ABONO', meta: { monto_usd: 500 } },
          { id: '2', categoria: 'DESPACHO', accion: 'CREAR_DESPACHO', meta: { despacho: 'DES-1', total_usd: 100 } },
        ],
      }
    }))

    // 1. Si pide FINANZAS explícitamente, devuelve vacío
    const reqFin = new Request('https://app.test/api/admin/audit?categoria=FINANZAS')
    const resFin = await handleGetAudit(reqFin, ENV, new URL(reqFin.url))
    expect(resFin.status).toBe(200)
    expect((await resFin.json()).registros).toEqual([])

    // 2. Sin categoría: filtra FINANZAS y limpia claves de dinero en meta
    const reqAll = new Request('https://app.test/api/admin/audit')
    const resAll = await handleGetAudit(reqAll, ENV, new URL(reqAll.url))
    const bodyAll = await resAll.json()
    expect(bodyAll.registros).toHaveLength(1)
    expect(bodyAll.registros[0].accion).toBe('CREAR_DESPACHO')
    expect(bodyAll.registros[0].meta).toEqual({ despacho: 'DES-1' })

    // 3. En /cambios agrega es_sensible_dinero=eq.false en la consulta a Supabase
    const reqCambios = new Request('https://app.test/api/admin/audit/cambios')
    const resCambios = await handleGetAuditCambios(reqCambios, ENV, new URL(reqCambios.url))
    expect(resCambios.status).toBe(200)
    expect(urlsConsultadas.some((u) => u.includes('es_sensible_dinero=eq.false'))).toBe(true)

    // 4. En /peticiones y /verificar-cadena devuelve 403
    const reqPet = new Request('https://app.test/api/admin/audit/peticiones')
    expect((await handleGetAuditPeticiones(reqPet, ENV, new URL(reqPet.url))).status).toBe(403)
    expect((await handleVerificarCadenaAuditoria(new Request('https://app.test/api/admin/audit/verificar-cadena'), ENV)).status).toBe(403)
  })

  it('administracion SÍ accede a /cambios sin filtro de dinero, /peticiones y /verificar-cadena', async () => {
    verifyAuth.mockResolvedValue({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', operator_id: '22222222-2222-4222-8222-222222222222' })
    getOperatorRole.mockResolvedValue('administracion')

    const urls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      urls.push(String(url))
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-range': '0-0/1' }),
        json: async () => (String(url).includes('verificar_cadena') ? { ok: true, revisadas: 10, primer_id_roto: null } : []),
      }
    }))

    const reqC = new Request('https://app.test/api/admin/audit/cambios')
    expect((await handleGetAuditCambios(reqC, ENV, new URL(reqC.url))).status).toBe(200)
    expect(urls.some((u) => u.includes('es_sensible_dinero=eq.false'))).toBe(false)

    const reqP = new Request('https://app.test/api/admin/audit/peticiones')
    expect((await handleGetAuditPeticiones(reqP, ENV, new URL(reqP.url))).status).toBe(200)

    const resV = await handleVerificarCadenaAuditoria(new Request('https://app.test/api/admin/audit/verificar-cadena'), ENV)
    expect(resV.status).toBe(200)
    expect((await resV.json()).ok).toBe(true)
  })

  it('guardia estática: todas las acciones de registrarAuditoria() están en el catálogo 321 y las 17 tablas en 320', () => {
    const mig320 = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/320_auditoria_camaras_fase1.sql'), 'utf8')
    const mig321 = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/321_auditoria_portero_catalogo_fase2.sql'), 'utf8')

    const tablasClave = [
      'notas_despacho', 'notas_despacho_items', 'cotizaciones', 'cuentas_por_cobrar',
      'clientes', 'productos', 'inventario_movimientos', 'comisiones', 'usuarios',
      'transportistas', 'pagos_transportistas', 'vehiculos', 'cuentas_por_pagar',
      'proveedores', 'configuracion_negocio', 'despacho_devoluciones', 'despacho_descuentos',
    ]
    for (const t of tablasClave) {
      expect(mig320, `Falta cámara en tabla ${t}`).toContain(`'${t}'`)
    }

    const handlersDir = path.resolve(process.cwd(), 'api/handlers')
    const faltantes = []
    for (const f of fs.readdirSync(handlersDir).filter((n) => n.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(handlersDir, f), 'utf8')
      for (const m of src.matchAll(/accion:\s*'([A-Z0-9_]+)'/g)) {
        const acc = m[1]
        if (!mig321.includes(`'${acc}'`)) faltantes.push(`${f}: ${acc}`)
      }
    }
    expect(faltantes).toEqual([])
  })
})
