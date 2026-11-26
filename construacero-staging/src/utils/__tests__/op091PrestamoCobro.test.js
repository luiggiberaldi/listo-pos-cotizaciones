// OP-2026-091 — facturar un préstamo: tasa principal, pago al facturar, comisión y freno N44-INV.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const leer = f => readFileSync(path.resolve(__dirname, '../../..', f), 'utf8')

describe('OP-2026-091 facturar préstamo', () => {
  const modal = leer('src/components/clientes/FichaClienteModal.jsx')
  const handler = leer('api/handlers/clientes.js')
  const sql = leer('supabase/migrations/326_staging_prestamo_pago_comision_tasa.sql')

  it('la pantalla ofrece "A crédito" y "Paga ahora" y manda el pago al servidor', () => {
    expect(modal).toContain('data-testid="prestamo-a-credito"')
    expect(modal).toContain('data-testid="prestamo-paga-ahora"')
    expect(modal).toContain("pago: { metodo: pagoMetodo, referencia: pagoReferencia }")
  })
  it('el servidor valida el tipo de tasa y pasa pago y tasa a la base', () => {
    expect(handler).toContain("['bcv', 'usdt', 'manual'].includes(tasaModo)")
    expect(handler).toContain('p_tasa_modo: tasaModo')
    expect(handler).toContain('p_pago_metodo: pagoMetodo')
  })
  it('la base registra el pago, la comisión y corrige el "##" del texto del cargo', () => {
    expect(sql).toContain("'abono', v_total")
    expect(sql).toContain('comision_prestamo_facturado_staging')
    expect(sql).not.toContain("00##")
    expect(sql).toContain("tasa principal (%s)")
  })
  it('cierra N44-INV: revisa los préstamos al revertir a cualquier estado', () => {
    expect(sql).toContain('PERFORM public.verificar_prestamos_despacho_reaperturable(p_despacho_id);')
  })
  it('la comisión usa las mismas reglas del motor 238b (sin inventar porcentajes)', () => {
    expect(sql).toContain('public.comision_238b_item_breakdown(')
    expect(sql).toContain("cn.cuenta_id = v_d.cuenta_id OR cn.id = 1")
  })
})
