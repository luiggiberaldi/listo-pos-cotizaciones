import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { FACTURACION_PRESTAMOS_HABILITADA, handleFacturarPrestamo } from '../clientes.js'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const MIG = path.join(ROOT, 'supabase', 'migrations')

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '')
}

describe('OP-2026-097 — Seguridad, respaldo y migraciones de producción (313–318)', () => {
  it('mantiene facturación de préstamos apagada por defecto en el servidor (HTTP 403)', async () => {
    expect(FACTURACION_PRESTAMOS_HABILITADA).toBe(false)
    const req = new Request('https://app.example.com/api/clientes/prestamos/facturar', {
      method: 'POST',
      headers: { Origin: 'https://app.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prestamoId: '00000000-0000-4000-8000-000000000001', cantidad: 1 }),
    })
    const res = await handleFacturarPrestamo(req, {})
    expect(res.status).toBe(403)
  })

  it('todas las migraciones 313–318 y sus 6 rollbacks existen sin fugas de staging', () => {
    const names = [
      '313_prod_inventario_ficha_conteo_kardex_y_lote',
      '314_prod_decimales_4_digitos',
      '315_prod_prestamos_devoluciones_y_reapertura',
      '316_prod_stock_por_aprobar',
      '317_prod_seguridad_rpcs_rls_y_catalogo',
      '318_prod_respaldo_restauracion_atomica_26_tablas',
    ]
    for (const base of names) {
      for (const suffix of ['.sql', '_rollback.sql']) {
        const p = path.join(MIG, base + suffix)
        expect(fs.existsSync(p), `falta ${base + suffix}`).toBe(true)
        const sql = fs.readFileSync(p, 'utf8')
        expect(sql).not.toMatch(/inventario_operaciones_staging|staging_reservar|staging_guardar|staging_etiquetar|comision_prestamo_facturado_staging/)
      }
    }
  })

  it('317 cierra RPCs/RLS, usa service_role (A4) y preserva precio2_habilitado / precio3_habilitado', () => {
    const sql = stripSqlComments(fs.readFileSync(path.join(MIG, '317_prod_seguridad_rpcs_rls_y_catalogo.sql'), 'utf8'))
    expect(sql).toMatch(/auth\.role\(\)\s*=\s*'service_role'/)
    expect(sql).toMatch(/precio2_habilitado/)
    expect(sql).toMatch(/precio3_habilitado/)
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE[\s\S]*cliente_prestamos/)
    expect(sql).toMatch(/CREATE POLICY "aislamiento_cuenta" ON public\.despacho_devoluciones AS RESTRICTIVE/)
    expect(sql).toMatch(/CREATE POLICY "aislamiento_cuenta" ON public\.despacho_devolucion_intercambios AS RESTRICTIVE/)
  })

  it('318 restaura 26 tablas sin DISABLE TRIGGER USER, con C3 previo, M3 unión de llaves y timeout 180s', () => {
    const sql = stripSqlComments(fs.readFileSync(path.join(MIG, '318_prod_respaldo_restauracion_atomica_26_tablas.sql'), 'utf8'))
    expect(sql).not.toMatch(/DISABLE\s+TRIGGER/i)
    expect(sql).toMatch(/set_config\('app\.restaurando_respaldo',\s*'on',\s*true\)/)
    expect(sql).toMatch(/set_config\('statement_timeout',\s*'180000',\s*true\)/)
    expect(sql).toMatch(/LATERAL\s+jsonb_object_keys/i)
    expect(sql).toMatch(/ordenes_compra/)
    expect(sql).toMatch(/pagos_transportistas_despachos/)
    expect(sql).toMatch(/trg_archivar_cxc_borrado/)
    expect(sql).toMatch(/bloquear_edicion_flete_pagado/)
    const idxPreCheck = sql.indexOf('RESPALDO_CON_FILAS_DE_OTRA_EMPRESA: préstamos o devoluciones existentes')
    const idxLoop = sql.indexOf('FOREACH v_t IN ARRAY v_orden LOOP')
    expect(idxPreCheck).toBeGreaterThan(0)
    expect(idxPreCheck).toBeLessThan(idxLoop)
  })

  it('315 incluye validación de precios de devolución, origen Kardex y cierre N44-INV', () => {
    const sql = stripSqlComments(fs.readFileSync(path.join(MIG, '315_prod_prestamos_devoluciones_y_reapertura.sql'), 'utf8'))
    expect(sql).toMatch(/PRECIO_DEVOLUCION_SUPERA_DESPACHO/)
    expect(sql).toMatch(/TOTAL_DE_FILA_INTERCAMBIO_INCONSISTENTE/)
    expect(sql).toMatch(/ITEM_PRESTAMO_NO_DEVOLVIBLE_PARCIAL/)
    expect(sql).toMatch(/verificar_prestamos_despacho_reaperturable/)
    expect(sql).not.toMatch(/facturar_prestamo_atomico/)
  })

  it('admin.js exige completo === true al restaurar y soporta respaldo v1.3 de 26 tablas', () => {
    const src = fs.readFileSync(path.join(ROOT, 'api', 'handlers', 'admin.js'), 'utf8')
    expect(src).toMatch(/version:\s*'1\.3'/)
    expect(src).toMatch(/backup\.completo !== true/)
    expect(src).toMatch(/restaurar_respaldo_atomico/)
    expect(src).toMatch(/pagos_transportistas_despachos/)
  })
})
