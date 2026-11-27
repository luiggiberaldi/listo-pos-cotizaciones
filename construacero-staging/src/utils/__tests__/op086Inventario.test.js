import { describe, expect, it } from 'vitest'
import { esMovimientoManualRevertible } from '../kardexRevertible.js'
import { claveDeterministica } from '../idempotencyKey.js'

describe('OP-2026-086 · Kardex: solo se revierten ajustes manuales y conteos (M1)', () => {
  it('permite ajustes manuales y conteos físicos', () => {
    expect(esMovimientoManualRevertible({ origen_tipo: 'movimiento_inventario', motivo_tipo: 'ajuste_inventario' })).toBe(true)
    expect(esMovimientoManualRevertible({ origen_tipo: 'conteo_fisico', motivo_tipo: 'ajuste_inventario' })).toBe(true)
    expect(esMovimientoManualRevertible({ origen_tipo: 'compra', motivo_tipo: 'compra_proveedor' })).toBe(true)
  })

  it('bloquea movimientos viejos sin origen, aunque sean ajustes', () => {
    expect(esMovimientoManualRevertible({ origen_tipo: null, motivo_tipo: 'ajuste_inventario' })).toBe(false)
    expect(esMovimientoManualRevertible({ origen_tipo: null, motivo_tipo: 'devolucion' })).toBe(false)
  })

  it('bloquea ventas, devoluciones, préstamos, cortes, lotes y reversiones', () => {
    for (const origen_tipo of ['despacho', 'devolucion', 'loan_return', 'transformacion_inventario', 'batch_ingest', 'reversion_inventario', 'product_create', 'product_delete', 'reconciliacion_kardex', 'algo_nuevo_desconocido']) {
      expect(esMovimientoManualRevertible({ origen_tipo, motivo_tipo: 'ajuste_inventario' })).toBe(false)
    }
    expect(esMovimientoManualRevertible({ origen_tipo: 'movimiento_inventario', motivo_tipo: 'venta' })).toBe(false)
    expect(esMovimientoManualRevertible({ origen_tipo: 'movimiento_inventario', motivo_tipo: 'devolucion' })).toBe(false)
  })
})

describe('OP-2026-086 · Importador CSV: clave estable por fila (M3)', () => {
  it('la misma fila produce siempre la misma clave, con formato válido', async () => {
    const fila = JSON.stringify({ codigo: 'TUB-1', nombre: 'Tubo', stock_actual: 4 })
    const a = await claveDeterministica(fila)
    const b = await claveDeterministica(fila)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('filas distintas producen claves distintas', async () => {
    const a = await claveDeterministica(JSON.stringify({ nombre: 'Tubo', stock_actual: 4 }))
    const b = await claveDeterministica(JSON.stringify({ nombre: 'Tubo', stock_actual: 5 }))
    expect(a).not.toBe(b)
  })
})
