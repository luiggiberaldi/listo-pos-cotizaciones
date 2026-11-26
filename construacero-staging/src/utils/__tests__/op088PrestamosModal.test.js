// OP-2026-088 — la ficha del cliente usa la tasa BCV como número (tasaBcv es un objeto) y muestra vista previa.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const leer = f => readFileSync(path.resolve(__dirname, '../../..', f), 'utf8')

describe('OP-2026-088 facturar préstamo desde la ficha', () => {
  const modal = leer('src/components/clientes/FichaClienteModal.jsx')
  it('toma el número de la tasa desde tasaBcv.precio, nunca Number(tasaBcv)', () => {
    expect(modal).toContain('Number(tasaBcv?.precio)')
    expect(modal).not.toMatch(/Number\(tasaBcv\)/)
  })
  it('envía la tasa del día al servidor', () => {
    expect(modal).toContain('const tasa = tasaDelDia')
    expect(modal).toContain('tasaBcv: tasa')
  })
  it('muestra vista previa del cobro y bloquea cantidades inválidas', () => {
    expect(modal).toContain('data-testid="prestamo-vista-previa"')
    expect(modal).toContain('Se sumará a su deuda')
    expect(modal).toContain('qtyNum <= restante + 0.0001')
  })
  it('el servidor calcula el precio de la vista previa con la misma función que el cobro', () => {
    expect(leer('api/handlers/clientes.js')).toContain('precios_unitarios_prestamos')
    const m = leer('supabase/migrations/325_staging_precio_prestamo_compartido.sql')
    expect(m).toContain('v_precio_unit := public.precio_unitario_prestamo(v_cp.id);')
  })
})
