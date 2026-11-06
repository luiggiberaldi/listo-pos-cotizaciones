import { describe, expect, it } from 'vitest'
import { construirReporteMisVentas, metodosDePago, validarRangoMisVentas } from '../misVentas.js'

describe('validarRangoMisVentas', () => {
  it('convierte los días de Venezuela en un rango de horas (el último día completo)', () => {
    expect(validarRangoMisVentas('2026-10-30', '2026-11-05')).toEqual({
      desde: '2026-10-30', hasta: '2026-11-05', dias: 7,
      desdeTs: '2026-10-30T00:00:00-04:00', hastaTs: '2026-11-06T00:00:00-04:00',
    })
  })
  it('rechaza fechas mal escritas, invertidas o rangos de más de un año', () => {
    expect(validarRangoMisVentas('2026-13-01', '2026-13-02').error).toBeTruthy()
    expect(validarRangoMisVentas('30/10/2026', '2026-11-05').error).toBeTruthy()
    expect(validarRangoMisVentas('2026-11-05', '2026-11-01').error).toMatch(/posterior/)
    expect(validarRangoMisVentas('2025-01-01', '2026-11-05').error).toMatch(/366/)
    expect(validarRangoMisVentas(null, '2026-11-05').error).toBeTruthy()
  })
})

describe('metodosDePago', () => {
  it('lee el JSON guardado en texto o arreglo y quita repetidos', () => {
    expect(metodosDePago('[{"metodo":"Zelle","monto":10},{"metodo":"Zelle","monto":5},{"metodo":"Cta por cobrar"}]')).toEqual(['Zelle', 'Cta por cobrar'])
    expect(metodosDePago([{ metodo: 'Efectivo $' }])).toEqual(['Efectivo $'])
    expect(metodosDePago('Efectivo')).toEqual(['Efectivo'])
    expect(metodosDePago(null)).toEqual([])
  })
})

describe('construirReporteMisVentas', () => {
  const datos = {
    despachos: [
      { id: 'd2', numero: 12, cotizacion_id: 'c2', cliente_id: 'cl1', estado: 'entregada', creado_en: '2026-11-02T15:00:00Z', total_usd: 60, flete_usd: 10, descuento_total_usd: 0, forma_pago: '[{"metodo":"Zelle"}]' },
      { id: 'd1', numero: 11, cotizacion_id: 'c1', cliente_id: 'cl2', estado: 'despachada', creado_en: '2026-10-31T15:00:00Z', total_usd: 100, flete_usd: 0, descuento_total_usd: 5, forma_pago: [{ metodo: 'Cta por cobrar' }], tiene_devoluciones: true },
    ],
    items: [
      { despacho_id: 'd1', codigo_snap: 'CAB-12', nombre_snap: 'Cabilla 1/2', unidad_snap: 'und', cantidad: 10, precio_unit_usd: 8, descuento_pct: 0, total_linea_usd: 80, orden: 1 },
      { despacho_id: 'd1', codigo_snap: 'ALA-1', nombre_snap: 'Alambre', unidad_snap: 'kg', cantidad: 5, precio_unit_usd: 5, descuento_pct: 0, total_linea_usd: 25, orden: 2 },
      { despacho_id: 'd1', codigo_snap: 'X', nombre_snap: 'Devuelto completo', unidad_snap: 'und', cantidad: 0, precio_unit_usd: 1, descuento_pct: 0, total_linea_usd: 0, orden: 3 },
      { despacho_id: 'd2', codigo_snap: 'CAB-12', nombre_snap: 'Cabilla 1/2', unidad_snap: 'und', cantidad: 5, precio_unit_usd: 8, descuento_pct: 0, total_linea_usd: 40, orden: 1 },
    ],
    clientes: [{ id: 'cl1', nombre: 'Ferretería Sol', rif_cedula: 'J-1' }, { id: 'cl2', nombre: 'Constructora Luna', rif_cedula: 'J-2' }],
    cotizaciones: [{ id: 'c1', numero: 301 }, { id: 'c2', numero: 302 }],
    comisiones: [{ despachoid: 'd1', totalcomision: 3 }, { despachoid: 'd2', totalcomision: 1.5 }],
  }

  it('ordena los despachos por fecha y trae artículos, cliente, pago y montos', () => {
    const r = construirReporteMisVentas(datos)
    expect(r.despachos.map(d => d.numero)).toEqual([11, 12])
    expect(r.despachos[0]).toMatchObject({
      cotizacion: 301, cliente: 'Constructora Luna', clienteRif: 'J-2', estado: 'despachada',
      formasPago: ['Cta por cobrar'], subtotalArticulosUsd: 105, descuentoUsd: 5, totalUsd: 100, comisionUsd: 3, tieneDevoluciones: true,
    })
    // la línea devuelta por completo (cantidad 0) no aparece
    expect(r.despachos[0].articulos.map(a => a.nombre)).toEqual(['Cabilla 1/2', 'Alambre'])
  })

  it('resume totales, por artículo y por cliente', () => {
    const r = construirReporteMisVentas(datos)
    expect(r.resumen).toEqual({ totalUsd: 160, despachos: 2, clientes: 2, unidades: 20, comisionUsd: 4.5 })
    expect(r.porArticulo[0]).toEqual({ codigo: 'CAB-12', nombre: 'Cabilla 1/2', unidad: 'und', cantidad: 15, totalUsd: 120, despachos: 2 })
    expect(r.porCliente).toEqual([
      { nombre: 'Constructora Luna', rif: 'J-2', despachos: 1, totalUsd: 100 },
      { nombre: 'Ferretería Sol', rif: 'J-1', despachos: 1, totalUsd: 60 },
    ])
  })

  it('sin comisión: no muestra montos de comisión', () => {
    const r = construirReporteMisVentas({ ...datos, comisiones: [], conComision: false })
    expect(r.resumen.comisionUsd).toBeNull()
    expect(r.despachos.every(d => d.comisionUsd === null)).toBe(true)
  })

  it('sin ventas: reporte vacío, no falla', () => {
    expect(construirReporteMisVentas({})).toEqual({
      resumen: { totalUsd: 0, despachos: 0, clientes: 0, unidades: 0, comisionUsd: 0 }, despachos: [], porArticulo: [], porCliente: [],
    })
  })
})
