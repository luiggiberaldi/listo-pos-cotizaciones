// api/handlers/__tests__/restauracionSeguridad095.test.js — OP-2026-095 Fase 2
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('../../lib/auth.js', () => ({
  verifyAuth: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', operator_id: '22222222-2222-4222-8222-222222222222' })),
  verifySupervisor: vi.fn(async () => true),
  verifyPrivileged: vi.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222', rol: 'jefe', nombre: 'Jefe' })),
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
  validateOperator: vi.fn(),
  invalidateOperatorCache: vi.fn(),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

import { handleBackup, handleRestore } from '../admin.js'

const ENV = { SUPABASE_URL: 'https://staging.supabase.co', SUPABASE_SERVICE_KEY: 'srv-key' }

describe('OP-2026-095 Fase 2 — respaldo completo y restauración segura', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('C3: handleRestore rechaza respaldos antiguos v1.0/v1.1 sin completo: true (no llama a la BD)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const res = await handleRestore(new Request('https://staging.erp.test/api/admin/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '1.1', tablas: { productos: [{ id: 'p1' }] } }),
    }), ENV)
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.error).toMatch(/completo|1000/)
  })

  it('Decisión 1: handleBackup y handleRestore incluyen descuentos, compras, proveedores y flota', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('/rpc/restaurar_respaldo_atomico')) {
        return new Response(JSON.stringify({ ok: true, resumen: { productos: 1, despacho_descuentos: 1, proveedores: 1, ordenes_compra: 1, vehiculos: 1 } }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-range': '*/0' } })
    }))
    const bRes = await handleBackup(new Request('https://staging.erp.test/api/admin/backup'), ENV)
    const backup = await bRes.json()
    expect(backup.version).toBe('1.3')
    expect(backup.completo).toBe(true)
    for (const tabla of [
      'despacho_descuentos', 'cxc_movimientos_borrados', 'comision_liberaciones',
      'comision_designacion_diaria', 'proveedores', 'ordenes_compra', 'orden_compra_items',
      'cuentas_por_pagar', 'vehiculos', 'pagos_transportistas', 'pagos_transportistas_despachos',
    ]) {
      expect(backup.tablas).toHaveProperty(tabla)
    }

    const rRes = await handleRestore(new Request('https://staging.erp.test/api/admin/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    }), ENV)
    expect(rRes.status).toBe(200)
  })

  it('Migración 327 valida tablas hijas ANTES del loop, usa bandera de sesión sin DISABLE TRIGGER y exige service_role en catálogo', () => {
    const sql = readFileSync(resolve('supabase/migrations/327_staging_seguridad_restauracion_y_catalogo.sql'), 'utf8')
    const sqlSinComentarios = sql.replace(/--.*$/gm, '')
    expect(sqlSinComentarios).toContain("set_config('app.restaurando_respaldo', 'on', true)")
    expect(sqlSinComentarios).not.toMatch(/DISABLE\s+TRIGGER\s+USER/i)
    const idxPreCheck = sql.indexOf('préstamos o devoluciones existentes de otra empresa')
    const idxLoop = sql.indexOf('FOREACH v_t IN ARRAY v_orden LOOP')
    expect(idxPreCheck).toBeGreaterThan(0)
    expect(idxPreCheck).toBeLessThan(idxLoop)
    expect(sqlSinComentarios).toContain('LATERAL jsonb_object_keys(elem)')
    expect(sqlSinComentarios).toContain("auth.role() = 'service_role'")
    expect(sqlSinComentarios).not.toContain('auth.uid() IS NULL')
  })
})
