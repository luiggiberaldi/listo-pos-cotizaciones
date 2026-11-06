import { describe, expect, it } from 'vitest'
import { generarMisVentasPDF, nombreArchivoMisVentas } from '../pdf/misVentasPDF.js'
import { construirReporteMisVentas } from '../../utils/misVentas.js'

function reporte({ conComision = true, despachos = 1 } = {}) {
  const ds = Array.from({ length: despachos }, (_, i) => ({
    id: `d${i}`, numero: 100 + i, cotizacion_id: 'c1', cliente_id: 'cl1', estado: 'entregada',
    creado_en: '2026-11-01T15:00:00Z', total_usd: 150, flete_usd: 10, descuento_total_usd: 5, forma_pago: '[{"metodo":"Zelle"}]',
  }))
  const items = ds.flatMap(d => [
    { despacho_id: d.id, codigo_snap: 'CAB-12', nombre_snap: 'Cabilla 1/2 x 12m', unidad_snap: 'und', cantidad: 10, precio_unit_usd: 8, descuento_pct: 0, total_linea_usd: 80, orden: 1 },
    { despacho_id: d.id, codigo_snap: 'ALA-1', nombre_snap: 'Alambre dulce', unidad_snap: 'kg', cantidad: 13, precio_unit_usd: 5, descuento_pct: 10, total_linea_usd: 58.5, orden: 2 },
  ])
  return {
    vendedor: { nombre: 'Edgar Ramírez', rol: conComision ? 'vendedor' : 'vendedor_sin_comision' },
    periodo: { desde: '2026-10-30', hasta: '2026-11-05' },
    ...construirReporteMisVentas({
      despachos: ds, items,
      clientes: [{ id: 'cl1', nombre: 'Ferretería Sol', rif_cedula: 'J-123' }],
      cotizaciones: [{ id: 'c1', numero: 301 }],
      comisiones: conComision ? ds.map(d => ({ despachoid: d.id, totalcomision: 3 })) : [],
      conComision,
    }),
  }
}

describe('PDF Mis ventas', () => {
  it('incluye vendedor, período, despachos, artículos, cliente y totales', () => {
    const { doc, filename, blob } = generarMisVentasPDF({ reporte: reporte(), comprimir: false })
    const texto = doc.output()
    for (const esperado of ['Edgar Ram', '30/10/2026 al 05/11/2026', 'DES-00100', 'COT-00301', 'Ferreter', 'J-123', 'CAB-12', 'Alambre dulce', 'Total despacho', 'Resumen por art', 'Resumen por cliente', 'Comisi']) {
      expect(texto).toContain(esperado)
    }
    expect(filename).toBe('Mis_Ventas_Edgar_Ramirez_2026-10-30_2026-11-05.pdf')
    expect(blob.size).toBeGreaterThan(1000)
  })

  it('sin comisión: el PDF no la menciona', () => {
    const { doc } = generarMisVentasPDF({ reporte: reporte({ conComision: false }), comprimir: false })
    expect(doc.output()).not.toContain('Comisi')
  })

  it('el PDF que se descarga va comprimido: liviano para WhatsApp', () => {
    const { blob } = generarMisVentasPDF({ reporte: reporte({ despachos: 15 }) })
    expect(blob.size).toBeLessThan(5 * 1024 * 1024)
  }, 30_000)

  it('muchos despachos: pasa a varias páginas sin fallar', () => {
    const { doc } = generarMisVentasPDF({ reporte: reporte({ despachos: 40 }) })
    expect(doc.internal.getNumberOfPages()).toBeGreaterThan(3)
  }, 30_000) // generar 40 despachos tarda cuando corre toda la suite a la vez

  it('nombre de archivo sin acentos ni espacios', () => {
    expect(nombreArchivoMisVentas({ vendedor: { nombre: 'Josué  Marciales' }, periodo: { desde: '2026-11-01', hasta: '2026-11-07' } }))
      .toBe('Mis_Ventas_Josue_Marciales_2026-11-01_2026-11-07.pdf')
  })
})
