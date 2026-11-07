import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { construirVentasDia } from '../../utils/ventasDia.js'
import { generarVentasDiaPDF } from '../pdf/ventasDiaPDF.js'

const tasa = 1012
// Datos reales del 24-10-2026 (nota, cliente, pagos en dólares como los guarda el sistema)
const hoja = [
  ['Alejandro Cortes', 4248, [['Punto de Venta', 20.9]]],
  ['GOLFAN MARQUEZ', 4251, [['Efectivo $', 41], ['Efectivo Bs', 0.29]]],
  ['Antonio Carrillo', 4252, [['Efectivo $', 499.8]]],
  ['Raul Souto', 4255, [['Punto de Venta', 5]]],
  ['Andreidi Fagundes', 4256, [['Efectivo $', 116.96]]],
  ['Andreidi Fagundes', 4257, [['Punto de Venta', 106.83]]],
  ['Duglas Asçanio', 4259, [['Efectivo $', 51], ['Efectivo Bs', 1]]],
  ['José Hernández', 4260, [['Punto de Venta', 10]]],
  ['Andreidi Fagundes', 4261, [['Punto de Venta', 119.9]]],
  ['Juan Inojosa', 4262, [['Punto de Venta', 32.5]]],
  ['Linares Ramos', 4263, [['Punto de Venta', 13.99]]],
  ['Andreidi Fagundes', 4264, [['Punto de Venta', 31]]],
  ['Jesús Medina 2', 4265, [['Efectivo $', 12], ['Efectivo Bs', 0.2]]],
  ['Juan Inojosa', 4266, [['Efectivo $', 13]]],
  ['FERRETERIA EL GRAN ADONAY', 4268, [['Efectivo $', 80], ['Efectivo Bs', 0.6]]],
  ['Ana Rivero', 4270, [['Cta por cobrar', 20]]],
]
const nota = (nombre, numero, pagos, extra = {}) => ({
  id: `d${numero}`, numero, cliente_id: nombre, estado: 'entregada',
  creado_en: '2026-10-24T14:00:00Z', entregada_en: '2026-10-24T14:30:00Z',
  total_usd: Math.round(pagos.reduce((s, p) => s + p[1], 0) * 100) / 100,
  forma_pago: JSON.stringify(pagos.map(([metodo, monto]) => ({ metodo, monto }))), ...extra,
})

export const reporteEjemplo = () => {
  const despachos = hoja.map(([nombre, numero, pagos]) => nota(nombre, numero, pagos))
  despachos.push(
    nota('Leidys Serrado', 4269, [['Efectivo $', 471]], { creado_en: '2026-10-26T17:00:00Z', entregada_en: '2026-10-26T17:56:00Z' }),
    nota('Pedro Pendiente', 4271, [['Zelle', 48]], { estado: 'pendiente', entregada_en: null, creado_en: '2026-10-24T19:00:00Z' }),
    nota('Rosa Retraso', 4272, [['Efectivo $', 35]], { creado_en: '2026-10-24T19:10:00Z', entregada_en: '2026-10-26T15:00:00Z' }),
    nota('Vicente Viernes', 4240, [['Efectivo $', 62]], { creado_en: '2026-10-23T15:00:00Z', entregada_en: '2026-10-24T13:00:00Z' }),
    nota('Anulado Anulado', 4249, [['Zelle', 10]], { estado: 'anulada', entregada_en: null }),
  )
  return {
    ...construirVentasDia({ fecha: '2026-10-24', despachos, clientes: [...hoja.map(([n]) => n), 'Leidys Serrado', 'Pedro Pendiente', 'Rosa Retraso', 'Vicente Viernes', 'Anulado Anulado'].map(n => ({ id: n, nombre: n })) }),
    preparadoPor: 'Logística (prueba)', generadoEn: '2026-10-24T22:00:00Z',
  }
}

describe('ventasDiaPDF', () => {
  it('genera la hoja con subtotales, resumen y las dos secciones aparte', () => {
    const reporte = reporteEjemplo()
    expect(reporte.filas).toHaveLength(16)
    expect(reporte.resumen.efectivoUsdEsperado).toBe(813.76)
    expect(reporte.resumen.porCobrarUsd).toBe(20)
    expect(reporte.sinEntregar.map(f => f.numero)).toEqual([4271, 4272])
    expect(reporte.entregadasOtroDia.map(f => f.numero)).toEqual([4240])
    const { doc, filename } = generarVentasDiaPDF({ reporte, tasa, comprimir: false })
    expect(filename).toBe('Ventas_del_dia_2026-10-24.pdf')
    const texto = doc.output()
    for (const t of ['SUBTOTALES', 'TOTAL VENDIDO', '813,76', 'Ana Rivero', 'CREADAS ESTE D', 'ENTREGADAS ESTE D', 'Pedro Pendiente', 'Rosa Retraso', 'Vicente Viernes', 'Pendiente de aprobar', 'Notas anuladas este d']) {
      expect(texto).toContain(t)
    }
    expect(texto).not.toContain('Leidys Serrado') // es del 26-10: no aparece en la hoja del 24
    if (process.env.GUARDAR_PDF) fs.writeFileSync('tmp/ventas-dia/ejemplo-24-10-2026.pdf', Buffer.from(doc.output('arraybuffer')))
  })
})
