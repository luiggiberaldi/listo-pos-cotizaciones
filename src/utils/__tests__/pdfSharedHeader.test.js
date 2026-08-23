import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import {
  MARGIN,
  drawPremiumHeader,
  drawSimplifiedHeader,
  getPremiumHeaderLayout,
} from '../../services/pdf/pdfShared'

const config = { nombre_negocio: 'CONSTRUACERO CARABOBO C.A.' }
const black = [0, 0, 0]
const longTitle = 'Corte semanal de comisiones · Euro BCV'

function makeDoc(orientation = 'portrait') {
  return new jsPDF({ unit: 'mm', format: 'letter', orientation })
}

describe('PDF shared headers', () => {
  it('reserva zonas separadas para marca y reporte en carta vertical', () => {
    const doc = makeDoc()
    const layout = getPremiumHeaderLayout(doc)
    const pageWidth = doc.internal.pageSize.getWidth()

    expect(layout.brandX + layout.brandWidth).toBeLessThan(layout.reportX)
    expect(layout.reportX + layout.reportWidth).toBeLessThanOrEqual(pageWidth - MARGIN)

    expect(() => drawPremiumHeader({
      doc,
      logoData: null,
      config,
      title: longTitle,
      subtitle: 'Continuacion',
      customBgColor: [255, 255, 255],
      customAccentColor: black,
      customTextColor: black,
      customSubtitleColor: black,
      customBorderColor: black,
      centerBusinessName: true,
    })).not.toThrow()
  })

  it('mantiene el layout separado en carta horizontal', () => {
    const doc = makeDoc('landscape')
    const layout = getPremiumHeaderLayout(doc)
    const pageWidth = doc.internal.pageSize.getWidth()

    expect(layout.brandX + layout.brandWidth).toBeLessThan(layout.reportX)
    expect(layout.reportX + layout.reportWidth).toBeLessThanOrEqual(pageWidth - MARGIN)

    expect(() => drawPremiumHeader({
      doc,
      logoData: null,
      config,
      title: longTitle,
      subtitle: '14/08/2026 al 20/08/2026',
      customBgColor: [255, 255, 255],
      customAccentColor: black,
      customTextColor: black,
      customSubtitleColor: black,
      customBorderColor: black,
      centerBusinessName: true,
    })).not.toThrow()
  })

  it('mantiene marca y titulo separados en continuaciones', () => {
    const doc = makeDoc()
    const rightTitle = 'Reporte Articulos Externos (Cont.)'
    const rightWidth = 66
    const brandX = MARGIN + 18
    const brandWidth = Math.max(54, doc.internal.pageSize.getWidth() - MARGIN - rightWidth - brandX - 4)

    expect(() => drawSimplifiedHeader(
      doc,
      null,
      config,
      rightTitle,
      [255, 255, 255],
      black,
    )).not.toThrow()

    doc.setFont('times', 'bold')
    doc.setFontSize(7)
    expect(doc.getTextWidth(config.nombre_negocio) <= brandWidth).toBe(true)
  })
})
