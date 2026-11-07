import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { construirVentasDia } from '../../utils/ventasDia.js'
import { generarVentasDiaPDF } from '../pdf/ventasDiaPDF.js'

const tasa = 1012
const bs = v => Math.round((v / tasa) * 100) / 100
const hoja = [
  ['ALEJANDRO CORTEZ', 4248, [['Transf. / Pago Móvil', bs(21150.80), '204518']]],
  ['GUILTAN MARQUEZ', 4251, [['Efectivo $', 41], ['Transf. / Pago Móvil', bs(293.48), '338120']]],
  ['ANTONIO CARRILLO', 4252, [['Efectivo $', 499.80]]],
  ['RAUL SUOTO', 4255, [['Transf. / Pago Móvil', bs(5060), '991204']]],
  ['ANDREIDI FAGUNDES', 4256, [['Efectivo $', 116.96]]],
  ['ANDREIDI FAGUNDES', 4257, [['Transf. / Pago Móvil', bs(108111.96), '771023']]],
  ['JOSE HERNANDEZ', 4260, [['Transf. / Pago Móvil', bs(10120), '118833']]],
  ['DOUGLAS ASCANIO', 4259, [['Efectivo $', 51], ['Transf. / Pago Móvil', bs(1000), '550017']]],
  ['ANDREIDI FAGUNDES', 4261, [['Transf. / Pago Móvil', bs(121338.80), '600212']]],
  ['JUAN INOJOSA', 4262, [['Transf. / Pago Móvil', bs(32890), '410098']]],
  ['LINARES RAMOS', 4263, [['Transf. / Pago Móvil', bs(14157), '300441']]],
  ['ANDREIDI FAGUNDES', 4264, [['Transf. / Pago Móvil', bs(31272), '228810']]],
  ['JESUS MEDINA', 4265, [['Efectivo $', 12], ['Transf. / Pago Móvil', bs(200), '100200']]],
  ['JUAN INOJOSA', 4266, [['Efectivo $', 13]]],
  ['GRAN ADONAY', 4268, [['Efectivo $', 80], ['Transf. / Pago Móvil', bs(600), '700300'], ['Cta por cobrar', 20]]],
  ['ANA RIVERO', 4270, [['Efectivo $', 0]]],
]
export const reporteEjemplo = () => {
  const despachos = hoja.map(([nombre, numero, pagos]) => ({
    id: `d${numero}`, numero, cliente_id: nombre, estado: 'despachada', creado_en: '2026-10-24T14:00:00Z',
    total_usd: Math.round(pagos.reduce((s, p) => s + p[1], 0) * 100) / 100,
    forma_pago: JSON.stringify(pagos.map(([metodo, monto, referencia]) => ({ metodo, monto, ...(referencia ? { referencia } : {}) }))),
  }))
  despachos.push({ id: 'x', numero: 4249, estado: 'anulada', creado_en: '2026-10-24T14:00:00Z', total_usd: 10, forma_pago: '[]' })
  return {
    ...construirVentasDia({
      fecha: '2026-10-24', despachos,
      clientes: hoja.map(([nombre]) => ({ id: nombre, nombre })),
      otrosNumeros: [{ numero: 4250, estado: 'entregada', creado_en: '2026-10-23T15:00:00Z' }],
    }),
    preparadoPor: 'Logística (prueba)', generadoEn: '2026-10-24T22:00:00Z',
  }
}

describe('ventasDiaPDF', () => {
  it('genera la hoja con las columnas usadas, subtotales, resumen y faltantes', () => {
    const reporte = reporteEjemplo()
    expect(reporte.resumen.efectivoUsdEsperado).toBe(813.76)
    expect(reporte.resumen.porCobrarUsd).toBe(20)
    const { doc, filename } = generarVentasDiaPDF({ reporte, tasa, comprimir: false })
    expect(filename).toBe('Ventas_del_dia_2026-10-24.pdf')
    const texto = doc.output()
    for (const t of ['SUBTOTALES', 'TOTAL VENDIDO', '813,76', 'ANA RIVERO', 'Sin pago registrado', 'Anulada', 'Ref. 204518']) {
      expect(texto).toContain(t)
    }
    if (process.env.GUARDAR_PDF) fs.writeFileSync('tmp/ventas-dia/ejemplo-24-10-2026.pdf', Buffer.from(doc.output('arraybuffer')))
  })
})
