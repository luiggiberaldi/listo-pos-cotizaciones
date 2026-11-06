// src/services/__tests__/despachoItemsService.test.js
// Pruebas del consolidador de ítems de despacho: descuenta devoluciones (con o
// sin enlace a su línea) y añade productos de intercambio. Caso real DES-04161:
// la edición profunda reescribió las líneas y la FK con ON DELETE SET NULL dejó
// las devoluciones sin enlace, por lo que la vista y los PDFs mostraban los dos
// juegos de artículos a la vez (6 m y 12 m).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { respuestas } = vi.hoisted(() => ({ respuestas: {} }))

vi.mock('../supabase/client', () => ({
  default: {
    from(tabla) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve(respuestas[tabla]),
        then: (ok, err) => Promise.resolve(respuestas[tabla]).then(ok, err),
      }
      return builder
    },
  },
}))

import { fetchDespachoConsolidado } from '../despachoItemsService'

function item(id, productoId, cantidad, extra = {}) {
  return {
    id,
    producto_id: productoId,
    codigo_snap: 'COD',
    nombre_snap: `Producto ${productoId}`,
    unidad_snap: 'und',
    cantidad,
    precio_unit_usd: 10,
    descuento_pct: 0,
    total_linea_usd: cantidad * 10,
    orden: 0,
    es_prestamo: false,
    productos: null,
    ...extra,
  }
}

function intercambio(productoId, cantidad, precio = 20) {
  return {
    id: `int-${productoId}`,
    producto_id: productoId,
    nombre_snap: `Producto ${productoId}`,
    codigo_snap: 'CPC',
    unidad_snap: 'und',
    cantidad,
    precio_unit_usd: precio,
    total_usd: cantidad * precio,
  }
}

function preparar({ items = [], devoluciones = [], intercambios = [] }) {
  respuestas.notas_despacho_items = { data: items, error: null }
  respuestas.despacho_devoluciones = { data: devoluciones, error: null }
  respuestas.despacho_devolucion_intercambios = { data: intercambios, error: null }
}

const DESPACHO = { id: 'desp-1', tiene_devoluciones: true }

describe('fetchDespachoConsolidado — devoluciones con enlace perdido', () => {
  beforeEach(() => preparar({}))

  it('descuenta por producto cuando la devolución quedó sin enlace (caso DES-04161)', async () => {
    preparar({
      items: [item(1, 'pa', 10), item(2, 'pb', 5, { orden: 1 })],
      devoluciones: [{ despacho_item_id: null, producto_id: 'pa', cantidad_devuelta: 10 }],
      intercambios: [intercambio('pc', 5)],
    })
    const { itemsConsolidados } = await fetchDespachoConsolidado('desp-1', DESPACHO)
    // La línea totalmente devuelta desaparece y NO queda duplicada junto al intercambio
    expect(itemsConsolidados.map(i => i.producto_id)).toEqual(['pb', 'pc'])
    expect(itemsConsolidados[0].cantidad).toBe(5)
    expect(itemsConsolidados[1]).toMatchObject({ cantidad: 5, es_intercambio: true })
  })

  it('descuenta por producto aunque la devolución traiga el enlace viejo de una línea borrada', async () => {
    preparar({
      items: [item(1, 'pa', 10)],
      devoluciones: [{ despacho_item_id: 'linea-ya-borrada', producto_id: 'pa', cantidad_devuelta: 4 }],
    })
    const { itemsConsolidados } = await fetchDespachoConsolidado('desp-1', DESPACHO)
    expect(itemsConsolidados).toHaveLength(1)
    expect(itemsConsolidados[0].cantidad).toBe(6)
    expect(itemsConsolidados[0].total_linea_usd).toBe(60)
  })

  it('reparte la devolución por producto entre líneas repetidas, en orden', async () => {
    preparar({
      items: [item(1, 'pa', 3), item(2, 'pa', 3, { orden: 1 }), item(3, 'pb', 2, { orden: 2 })],
      devoluciones: [{ despacho_item_id: null, producto_id: 'pa', cantidad_devuelta: 5 }],
    })
    const { itemsConsolidados } = await fetchDespachoConsolidado('desp-1', DESPACHO)
    expect(itemsConsolidados.map(i => [i.producto_id, i.cantidad])).toEqual([['pa', 1], ['pb', 2]])
  })

  it('conserva el comportamiento clásico: la devolución con enlace descuenta su línea', async () => {
    preparar({
      items: [item(1, 'pa', 10), item(2, 'pb', 5, { orden: 1 })],
      devoluciones: [{ despacho_item_id: 2, producto_id: 'pb', cantidad_devuelta: 2 }],
    })
    const { itemsConsolidados } = await fetchDespachoConsolidado('desp-1', DESPACHO)
    expect(itemsConsolidados.map(i => [i.producto_id, i.cantidad])).toEqual([['pa', 10], ['pb', 3]])
  })

  it('la devolución de un producto de intercambio descuenta el intercambio, no los originales', async () => {
    preparar({
      items: [item(1, 'pa', 10)],
      devoluciones: [{ despacho_item_id: null, producto_id: 'pc', cantidad_devuelta: 2 }],
      intercambios: [intercambio('pc', 5)],
    })
    const { itemsConsolidados } = await fetchDespachoConsolidado('desp-1', DESPACHO)
    expect(itemsConsolidados.map(i => [i.producto_id, i.cantidad])).toEqual([['pa', 10], ['pc', 3]])
    expect(itemsConsolidados[1].total_linea_usd).toBe(60)
  })

  it('si el intercambio no trae código, usa el código del producto (caso DES-04243)', async () => {
    preparar({
      items: [item(1, 'pa', 5)],
      devoluciones: [{ despacho_item_id: null, producto_id: 'pa', cantidad_devuelta: 5 }],
      intercambios: [{ ...intercambio('pc', 5), codigo_snap: null, productos: { codigo: 'PC-001' } }],
    })
    const { itemsConsolidados } = await fetchDespachoConsolidado('desp-1', DESPACHO)
    expect(itemsConsolidados).toHaveLength(1)
    expect(itemsConsolidados[0]).toMatchObject({
      producto_id: 'pc',
      codigo_snap: 'PC-001',
      cantidad: 5,
      es_intercambio: true,
    })
  })

  it('sin devoluciones devuelve los ítems tal cual', async () => {
    preparar({ items: [item(1, 'pa', 10)] })
    const { itemsConsolidados, tieneDevoluciones } = await fetchDespachoConsolidado('desp-1', {
      id: 'desp-1',
      tiene_devoluciones: false,
    })
    expect(tieneDevoluciones).toBe(false)
    expect(itemsConsolidados).toHaveLength(1)
    expect(itemsConsolidados[0].cantidad).toBe(10)
  })
})

describe('regresión DES-04161 — cambio a 12 m + edición profunda', () => {
  // Datos reales del caso: las 4 cabillas de 6 m se devolvieron completas
  // (22/10, motivo "CLIENTE LAS QUIZO DE 12 MTS") y entraron sus equivalentes
  // de 12 m (media cantidad a precio doble). Luego una edición profunda
  // reescribió las líneas con ids nuevos, lo que dejó las devoluciones sin
  // enlace y duplicó la vista. La vista debe mostrar SIEMPRE los artículos netos.
  const INTERCAMBIOS = [
    { id: 'int-1', producto_id: 'p12-10', codigo_snap: 'CAB0114017', nombre_snap: 'CABILLA ESTRIADA  10 mm X 12,00 mts SIDETUR', unidad_snap: 'und', cantidad: 1875, precio_unit_usd: 9.8, total_usd: 18375 },
    { id: 'int-2', producto_id: 'p12-12', codigo_snap: 'CAB0114006', nombre_snap: 'CABILLA ESTRIADA 12 mm X 12,00 mts  SIDETUR', unidad_snap: 'und', cantidad: 445, precio_unit_usd: 12.9, total_usd: 5740.5 },
    { id: 'int-3', producto_id: 'p12-16', codigo_snap: 'CAB0114009', nombre_snap: 'CABILLA ESTRIADA 16 mm X 12,00 mts SIDETUR', unidad_snap: 'und', cantidad: 755, precio_unit_usd: 23.9, total_usd: 18044.5 },
    { id: 'int-4', producto_id: 'p12-20', codigo_snap: 'CAB0114018', nombre_snap: 'CABILLA ESTRIADA 20 mm X 12,00 mts SIDETUR', unidad_snap: 'und', cantidad: 75, precio_unit_usd: 35.5, total_usd: 2662.5 },
  ]

  // Lo único que debe verse: la malla (no entró al cambio) + las 4 de 12 m
  const ARTICULOS_NETOS = [
    ['MAL0138002', 15, 139.8, 2097],
    ['CAB0114017', 1875, 9.8, 18375],
    ['CAB0114006', 445, 12.9, 5740.5],
    ['CAB0114009', 755, 23.9, 18044.5],
    ['CAB0114018', 75, 35.5, 2662.5],
  ]

  function items6m(prefijo, precio16mm) {
    return [
      item(`${prefijo}-1`, 'p6-10', 3750, { codigo_snap: 'CAB0114005', nombre_snap: 'CABILLA ESTRIADA  10 mm X 6,00 mts SIDETUR', precio_unit_usd: 4.9, total_linea_usd: 18375, orden: 0 }),
      item(`${prefijo}-2`, 'p6-12', 890, { codigo_snap: 'CAB0114007', nombre_snap: 'CABILLA ESTRIADA 12 mm X 6,00 mts  SIDETUR', precio_unit_usd: 6.45, total_linea_usd: 5740.5, orden: 1 }),
      item(`${prefijo}-3`, 'p6-16', 1510, { codigo_snap: 'CAB0114016', nombre_snap: 'CABILLA ESTRIADA 16 mm X 6,00 mts SIDETUR', precio_unit_usd: precio16mm, total_linea_usd: 1510 * precio16mm, orden: 2 }),
      item(`${prefijo}-4`, 'p6-20', 150, { codigo_snap: 'CAB0114019', nombre_snap: 'CABILLA ESTRIADA 20 mm X 6,00 mts SIDETUR', precio_unit_usd: 17.75, total_linea_usd: 2662.5, orden: 3 }),
      item(`${prefijo}-5`, 'p-malla', 15, { codigo_snap: 'MAL0138002', nombre_snap: 'MALLA TRUCKSON 6 X 6 X 100 mts', precio_unit_usd: 139.8, total_linea_usd: 2097, orden: 4 }),
    ]
  }

  function devoluciones6m(enlazadas) {
    return [
      { despacho_item_id: enlazadas ? 'li-1' : null, producto_id: 'p6-10', cantidad_devuelta: 3750 },
      { despacho_item_id: enlazadas ? 'li-2' : null, producto_id: 'p6-12', cantidad_devuelta: 890 },
      { despacho_item_id: enlazadas ? 'li-3' : null, producto_id: 'p6-16', cantidad_devuelta: 1510 },
      { despacho_item_id: enlazadas ? 'li-4' : null, producto_id: 'p6-20', cantidad_devuelta: 150 },
    ]
  }

  function resumen(lista) {
    return lista.map(i => [i.codigo_snap, Number(i.cantidad), Number(i.precio_unit_usd), Number(i.total_linea_usd)])
  }

  function sinDuplicados(lista) {
    const claves = lista.map(i => [
      i.producto_id,
      Number(i.precio_unit_usd || 0),
      Number(i.descuento_pct || 0),
      i.es_prestamo ? 'prestamo' : 'venta',
    ].join('|'))
    return new Set(claves).size === claves.length
  }

  it('la vista muestra los artículos netos antes y después de la edición profunda, sin duplicar', async () => {
    // 1) Antes de editar: la devolución está enlazada a su línea original
    preparar({
      items: items6m('li', 11.95),
      devoluciones: devoluciones6m(true),
      intercambios: INTERCAMBIOS,
    })
    const antes = (await fetchDespachoConsolidado('desp-1', DESPACHO)).itemsConsolidados

    // 2) La edición profunda reescribe las líneas con ids nuevos (y corrige el
    //    precio de la de 16 mm). La FK con ON DELETE SET NULL deja las
    //    devoluciones sin enlace: es exactamente lo que duplicó la vista en DES-04161.
    preparar({
      items: items6m('nueva', 11.5),
      devoluciones: devoluciones6m(false),
      intercambios: INTERCAMBIOS,
    })
    const despues = (await fetchDespachoConsolidado('desp-1', DESPACHO)).itemsConsolidados

    // La vista nunca debe duplicar artículos: netos, iguales antes y después
    expect(resumen(antes)).toEqual(ARTICULOS_NETOS)
    expect(resumen(despues)).toEqual(ARTICULOS_NETOS)
    expect(sinDuplicados(antes)).toBe(true)
    expect(sinDuplicados(despues)).toBe(true)
  })
})
