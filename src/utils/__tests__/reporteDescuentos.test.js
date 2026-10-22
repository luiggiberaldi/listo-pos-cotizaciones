import { describe, expect, it } from 'vitest'
import { aplicarDescuentosItems } from '../reporteDescuentos'

describe('aplicarDescuentosItems (F-03 reporte de ventas)', () => {
  it('sin descuentos devuelve los ítems intactos', () => {
    const items = [{ id: 'a', total_linea_usd: 100 }]
    const out = aplicarDescuentosItems(items, [])
    expect(out).toEqual([{ id: 'a', total_linea_usd: 100 }])
  })

  it('resta el monto por despacho_item_id', () => {
    const items = [{ id: 'item-1', total_linea_usd: 100 }]
    const out = aplicarDescuentosItems(items, [{ despacho_item_id: 'item-1', monto_usd: 25 }])
    expect(out[0].total_linea_usd).toBe(75)
  })

  it('soporta filas legacy emparejadas por cotizacion_item_id', () => {
    const items = [{ id: 'item-x', cotizacion_item_id: 'ci-9', total_linea_usd: 80 }]
    const out = aplicarDescuentosItems(items, [{ cotizacion_item_id: 'ci-9', monto_usd: 30 }])
    expect(out[0].total_linea_usd).toBe(50)
  })

  it('suma varios descuentos sobre el mismo ítem', () => {
    const items = [{ id: 'item-1', total_linea_usd: 100 }]
    const out = aplicarDescuentosItems(items, [
      { despacho_item_id: 'item-1', monto_usd: 10 },
      { despacho_item_id: 'item-1', monto_usd: 15 },
    ])
    expect(out[0].total_linea_usd).toBe(75)
  })

  it('nunca deja total negativo si el descuento excede la línea', () => {
    const items = [{ id: 'item-1', total_linea_usd: 20 }]
    const out = aplicarDescuentosItems(items, [{ despacho_item_id: 'item-1', monto_usd: 50 }])
    expect(out[0].total_linea_usd).toBe(0)
  })

  it('ignora descuentos sin monto o con monto no positivo', () => {
    const items = [{ id: 'item-1', total_linea_usd: 100 }]
    const out = aplicarDescuentosItems(items, [
      { despacho_item_id: 'item-1', monto_usd: 0 },
      { despacho_item_id: 'item-1', monto_usd: -5 },
      { despacho_item_id: 'other', monto_usd: 30 },
    ])
    expect(out[0].total_linea_usd).toBe(100)
  })

  it('no muta los ítems de entrada', () => {
    const items = [{ id: 'item-1', total_linea_usd: 100 }]
    const out = aplicarDescuentosItems(items, [{ despacho_item_id: 'item-1', monto_usd: 40 }])
    expect(out[0].total_linea_usd).toBe(60)
    expect(items[0].total_linea_usd).toBe(100)
    expect(out[0]).not.toBe(items[0])
  })
})