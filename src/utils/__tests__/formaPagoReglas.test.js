// src/utils/__tests__/formaPagoReglas.test.js
// OP-2026-055: el Cruce en la forma de pago del despacho debe decir contra qué se cruzó (N3), y
// "revertir" pasa a anular con motivo y copia en el archivo (I3).
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { errorCruceSinExplicacion } from '../formaPagoReglas.js'

const cxc = fs.readFileSync(new URL('../../../api/handlers/cxc.js', import.meta.url), 'utf8')
const despachos = fs.readFileSync(new URL('../../../api/handlers/despachos.js', import.meta.url), 'utf8')
const cotizaciones = fs.readFileSync(new URL('../../../api/handlers/cotizaciones.js', import.meta.url), 'utf8')
const migracion = fs.readFileSync(new URL('../../../supabase/migrations/308_cxc_nada_se_borra_sin_rastro.sql', import.meta.url), 'utf8')
const ficha = fs.readFileSync(new URL('../../components/clientes/FichaClienteModal.jsx', import.meta.url), 'utf8')

describe('N3 — Cruce con explicación', () => {
  it('Cruce sin explicación → mensaje claro', () => {
    expect(errorCruceSinExplicacion([{ metodo: 'Cruce', monto: 634 }])).toMatch(/contra qué se cruzó/)
    expect(errorCruceSinExplicacion(JSON.stringify([{ metodo: 'Cruce', monto: 10, referencia: 'abc' }]))).toMatch(/mínimo 5/)
  })
  it('Cruce explicado, otros métodos o monto 0 → sin error', () => {
    expect(errorCruceSinExplicacion([{ metodo: 'Cruce', monto: 634, referencia: 'Factura flete #45' }])).toBeNull()
    expect(errorCruceSinExplicacion([{ metodo: 'Zelle', monto: 634 }])).toBeNull()
    expect(errorCruceSinExplicacion([{ metodo: 'Cruce', monto: 0 }])).toBeNull()
    expect(errorCruceSinExplicacion(null)).toBeNull()
  })
  it('un Cruce viejo sin explicación que no cambia se respeta; si cambia el monto, se exige', () => {
    const viejo = [{ metodo: 'Cruce', monto: 634 }]
    expect(errorCruceSinExplicacion([{ metodo: 'Cruce', monto: 634 }], viejo)).toBeNull()
    expect(errorCruceSinExplicacion([{ metodo: 'Cruce', monto: 700 }], viejo)).toMatch(/contra qué se cruzó/)
  })
  it('se aplica al crear, editar pago, editar ítems y en la venta rápida', () => {
    expect(despachos.match(/errorCruceSinExplicacion\(/g).length).toBeGreaterThanOrEqual(4)
    expect(cotizaciones).toContain('errorCruceSinExplicacion(formaPago)')
  })
})

describe('I3 — anular con motivo y copia en el archivo', () => {
  it('revertir llama a la anulación de la base y exige motivo', () => {
    expect(cxc).toContain('rpc/cxc_anular_movimiento')
    expect(cxc).toContain('Escribe el motivo de la anulación (mínimo 10 caracteres).')
    expect(cxc).not.toMatch(/method: 'DELETE',\s*headers: \{ \.\.\.headers, Prefer: 'return=minimal' \},\s*\}\);\s*if \(!delRes\.ok\)/)
  })
  it('la base copia TODO borrado de cuentas por cobrar y bloquea anular movimientos de devolución', () => {
    expect(migracion).toContain('before delete on public.cuentas_por_cobrar')
    expect(migracion).toContain("raise exception 'MOVIMIENTO_DE_DEVOLUCION'")
  })
  it('la ficha pide el motivo y muestra los movimientos anulados', () => {
    expect(ficha).toContain('data-testid="anular-movimiento-motivo"')
    expect(ficha).toContain('/api/cxc/movimientos-borrados?clienteId=')
  })
})
