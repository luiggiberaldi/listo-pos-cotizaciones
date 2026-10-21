import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readProjectFile = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')

describe('contrato release 17 — egreso de inventario al aprobar despacho', () => {
  const apply = readProjectFile('supabase/release/main/17_egreso_inventario_aprobacion_apply.sql')
  const backfill = readProjectFile('supabase/release/main/17_egreso_inventario_backfill.sql')
  const rollback = readProjectFile('supabase/release/main/17_egreso_inventario_rollback_review.sql')
  const worker = readProjectFile('api/handlers/despachos.js')

  it('aprobar v3 egresa al aprobar, con alertas y sin bloqueo por stock', () => {
    // egreso + kardex al aprobar
    expect(apply).toContain("'Despacho #' || v_despacho.numero || ' aprobado'")
    expect(apply).toContain("'Despacho #' || v_despacho.numero || ' aprobado [STOCK NEGATIVO]'")
    expect(apply).toContain("'egreso',")
    // alertas de stock (nunca bloquean)
    expect(apply).toContain('alertas_stock')
    expect(apply).toContain("WHEN v_nuevo_stock < 0 THEN 'NEGATIVO'")
    expect(apply).toContain("WHEN v_nuevo_stock < COALESCE(v_producto.stock_minimo, 0) THEN 'BAJO'")
    expect(apply).not.toContain('STOCK_INSUFICIENTE')
    // sella lote y alertas en el despacho
    expect(apply).toContain('egreso_lote_id = v_lote_id')
    expect(apply).toContain('alerta_stock = v_con_alertas')
  })

  it('la entrega normal no toca inventario; la entrega directa desde pendiente egresa', () => {
    expect(apply).toContain("v_egreso := (v_despacho.estado = 'pendiente')")
    expect(apply).toContain("'inventario', CASE WHEN v_egreso THEN 'egreso_directo' ELSE 'sin_movimiento' END")
  })

  it('revertir entrega a despachada no reingresa; a pendiente/anulada sí', () => {
    expect(apply).toContain("v_reingreso   BOOLEAN := p_nuevo_estado IN ('pendiente', 'anulada')")
    expect(apply).toContain("'reingreso_aplicado', v_reingreso")
  })

  it('la reversión desde despachada reingresa con kardex en la misma transacción', () => {
    expect(apply).toContain('revertir_despacho_inventario_atomica')
    expect(apply).toContain("'Despacho #' || v_despacho.numero || ' devuelto a pendiente'")
    expect(apply).toContain("'Anulación de despacho #' || v_despacho.numero")
  })

  it('editar_despacho_profundidad: delta solo en despachada, sin stock en pendiente', () => {
    expect(apply).toContain('v_mapa_viejo')
    expect(apply).toContain("IF v_estado = 'despachada' THEN")
    expect(apply).toContain("'Edición de ítems Despacho #' || v_despacho.numero || ' (ajuste)'")
    expect(apply).toContain('CASE WHEN v_delta.delta > 0 THEN \'egreso\' ELSE \'ingreso\' END')
  })

  it('retira las RPCs obsoletas del modelo antiguo (grants y marca OBSOLETA)', () => {
    expect(apply).toContain('REVOKE ALL ON FUNCTION public.obtener_stock_comprometido()')
    expect(apply).toContain('REVOKE ALL ON FUNCTION public.obtener_stock_comprometido_detalle(uuid)')
    expect(apply).toContain('REVOKE ALL ON FUNCTION public.crear_nota_despacho(uuid, text)')
    expect(apply).toContain('REVOKE ALL ON FUNCTION public.anular_despacho_atomico(uuid, uuid, text, text)')
    expect(apply).toContain('FROM PUBLIC, anon, authenticated, service_role')
    expect(apply).toContain('OBSOLETA release 17')
  })

  it('backfill idempotente por egreso_lote_id determinista', () => {
    expect(backfill).toContain("md5('migra-egreso-17-' || v_despacho.id)::uuid")
    expect(backfill).toContain('WHERE egreso_lote_id IS NULL')
    expect(backfill).toContain('MIGRACIÓN — egreso por cambio de modelo #')
    expect(backfill).toContain("md5('migra-egreso-17-legado-' || id)::uuid")
  })

  it('rollback con review gate y reingreso espejo solo de lotes de migración', () => {
    expect(rollback).toContain("RAISE EXCEPTION 'REVIEW_ONLY:")
    expect(rollback).toContain("v_lote_migra := md5('migra-egreso-17-' || v_despacho.id)::uuid")
    expect(rollback).toContain('ROLLBACK release 17')
  })

  it('el Worker egresa al aprobar y reingresa al devolver desde despachada', () => {
    expect(worker).toContain('revertir_despacho_inventario_atomica')
    expect(worker).toContain('alertas_stock')
    expect(worker).toContain('alerta_stock')
    // sin rutas legacy de inventario ni semántica antigua
    expect(worker).not.toContain('stock_faltantes')
    expect(worker).not.toContain('stock_comprometido')
    expect(worker).not.toContain('Entrega confirmada')
    expect(worker).not.toContain('Solo restaurar stock si ya')
  })

  it('el Worker degrada a la ruta desplegada si la base aún no tiene el release 17', () => {
    // Compatibilidad de rollout: sin la función T4 no hay egreso al aprobar que
    // reingresar, así que se continúa con la ruta desplegada (estado + marcas +
    // CxC + comisiones). Solo aplica cuando PostgREST responde "function not found".
    expect(worker).toContain('RELEASE17-FALLBACK')
    expect(worker).toContain("msgFalta.includes('Could not find the function')")
    expect(worker).toContain("msgFalta.includes('PGRST202')")
  })

  it('la UI ya no referencia el stock comprometido ni las RPCs retiradas', () => {
    const srcDir = path.join(projectRoot, 'src')
    const needles = ['useStock' + 'Comprometido', 'obtener_stock' + '_comprometido', 'Stock' + 'ComprometidoDetalle']
    const offenders = []
    for (const rel of fs.readdirSync(srcDir, { recursive: true })) {
      const relStr = String(rel)
      if (!/\.(js|jsx)$/.test(relStr) || relStr.includes('__tests__')) continue
      const text = fs.readFileSync(path.join(srcDir, relStr), 'utf8')
      if (needles.some((n) => text.includes(n))) offenders.push(relStr)
    }
    expect(offenders).toEqual([])
  })

  it('DespachoCard valida con stock físico y muestra la alerta persistente', () => {
    const card = readProjectFile('src/components/despachos/DespachoCard.jsx')
    expect(card).toContain('const disponible = Number(p?.stock_actual) || 0')
    expect(card).toContain('despacho.alerta_stock')
  })

  it('el e2e staging 228 refleja el egreso al aprobar', () => {
    const e2e = readProjectFile('supabase/staging/228_e2e_devolucion_staging.sql')
    expect(e2e).toContain('aprobar_despacho_inventario_atomico')
    expect(e2e).toContain('NO toca inventario — el egreso ocurrió al aprobar')
    expect(e2e).not.toContain('obtener_stock_comprometido')
  })
})
