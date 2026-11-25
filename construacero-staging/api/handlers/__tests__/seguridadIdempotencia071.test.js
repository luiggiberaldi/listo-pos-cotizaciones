import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearGeneradorClaveIdempotente } from '../../../src/utils/idempotencyKey.js'

describe('OP-2026-071 Fase 3 (N29 idempotencia en UI/hooks y N30/N16 cierre de RPCs/RLS)', () => {
  it('N29: crearGeneradorClaveIdempotente reutiliza clave con firma igual, cambia si cambia payload y reinicia al limpiar', () => {
    const gen = crearGeneradorClaveIdempotente()
    const k1 = gen.resolver({ despachoId: 'd1', nuevoEstado: 'entregada' })
    const k2 = gen.resolver({ despachoId: 'd1', nuevoEstado: 'entregada' })
    expect(k1).toMatch(/^[0-9a-f-]{36}$/i)
    expect(k2).toBe(k1)

    const kOther = gen.resolver({ despachoId: 'd1', nuevoEstado: 'pendiente' })
    expect(kOther).not.toBe(k1)

    gen.limpiar({ despachoId: 'd1', nuevoEstado: 'pendiente' })
    const kAfterClean = gen.resolver({ despachoId: 'd1', nuevoEstado: 'pendiente' })
    expect(kAfterClean).not.toBe(kOther)
  })

  it('N29: useDespachos, useInventario, DevolucionParcialModal y ModalTransformacion envían claves idempotentes estables', () => {
    const useDespSrc = readFileSync(resolve('src/hooks/useDespachos.js'), 'utf8')
    const devModalSrc = readFileSync(resolve('src/components/despachos/DevolucionParcialModal.jsx'), 'utf8')
    const transModalSrc = readFileSync(resolve('src/components/inventario/ModalTransformacion.jsx'), 'utf8')
    const useInvSrc = readFileSync(resolve('src/hooks/useInventario.js'), 'utf8')

    expect(useDespSrc).toContain('crearGeneradorClaveIdempotente')
    expect(useDespSrc).toContain('Idempotency-Key')
    expect(devModalSrc).toContain('crearGeneradorClaveIdempotente')
    expect(devModalSrc).toContain('idempotencyKey')
    expect(transModalSrc).toContain('crearGeneradorClaveIdempotente')
    expect(transModalSrc).toContain('idempotencyKey')
    expect(useInvSrc).toContain('crearGeneradorClaveIdempotente')
  })

  it('N30/N16: migración 312 revoca RPCs sensibles de anon/authenticated y restringe RLS de escritura', () => {
    const migPath = resolve('supabase/migrations/314_staging_seguridad_inventario_rpcs_y_rls.sql')
    expect(existsSync(migPath)).toBe(true)
    const sql = readFileSync(migPath, 'utf8')
    expect(sql).toContain('REVOKE ALL ON FUNCTION')
    expect(sql).toContain('TO service_role')
    expect(sql).toContain('DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en cliente_prestamos"')
    expect(sql).toContain('DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en despacho_devoluciones"')
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE')
  })
})
