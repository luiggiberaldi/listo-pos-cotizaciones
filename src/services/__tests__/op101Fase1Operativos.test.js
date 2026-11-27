import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../pdf/pdfLogo', () => ({ cargarLogo: vi.fn(async () => null) }))
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal()
  class JsPdfEspia extends mod.jsPDF {
    constructor(...a) {
      super(...a)
      const originalText = this.text
      this.text = (t, ...r) => {
        ;(globalThis.__op1Textos ||= []).push(Array.isArray(t) ? t.join(' ') : String(t))
        return originalText.call(this, t, ...r)
      }
      this.save = (name) => {
        globalThis.__op1Nombre = name
        return this
      }
    }
  }
  return { ...mod, jsPDF: JsPdfEspia }
})

import { generarOrdenCompraPDF } from '../pdf/ordenCompraPDF'
import { generarFacturaPDF } from '../pdf/facturaPDF'
import { generarOrdenDespachoPDF } from '../pdf/ordenDespachoPDF'
import { generarPDF as generarCotizacionPDF } from '../pdf/cotizacionPDF'

describe('OP-2026-101 Fase 1: integridad de PDFs operativos', () => {
  beforeEach(() => {
    globalThis.__op1Textos = []
    globalThis.__op1Nombre = ''
  })

  it('ordenCompraPDF imprime proveedor_contacto en ATENCIÓN A y usa fecha Caracas', async () => {
    await generarOrdenCompraPDF({
      orden: {
        numero: 42,
        proveedor_nombre: 'ACEROS DEL CENTRO',
        proveedor_contacto: 'ING. CARLOS PEREZ',
        fecha_emision: '2026-11-27T02:30:00Z', // 26-nov 22:30 VE
        total_usd: 500,
      },
      items: [{ cantidad: 2, nombre_snap: 'TUBO 2X1', unidad_snap: 'Und', precio_unit_usd: 250, total_linea_usd: 500 }],
      config: { nombre_negocio: 'CONSTRUACERO CARABOBO C.A.', supervisorNombre: 'SUPERVISOR INTERNO', telefono_negocio: '04141234567' },
    })

    const textos = globalThis.__op1Textos
    expect(textos.some(t => t.includes('CARLOS PEREZ'))).toBe(true)
    expect(textos.some(t => t.includes('SUPERVISOR INTERNO'))).toBe(false)
    expect(globalThis.__op1Nombre).toContain('2026-11-26.pdf')
  })

  it('facturaPDF corrige typo R.I.F./C.I. y usa fecha Caracas', async () => {
    await generarFacturaPDF({
      despacho: {
        numero: 1001,
        creado_en: '2026-11-27T02:30:00Z',
        total_usd: 100,
        cliente: { nombre: 'CLIENTE TEST', rif_cedula: 'J-12345678-9' },
      },
      items: [{ cantidad: 1, nombre_snap: 'CABILLA', unidad_snap: 'Und', precio_unit_usd: 100, total_linea_usd: 100 }],
      config: { nombre_negocio: 'CONSTRUACERO CARABOBO C.A.' },
    })

    const textos = globalThis.__op1Textos
    expect(textos.some(t => t.includes('R.I.F./C.I.'))).toBe(true)
    expect(textos.some(t => t.includes('R.F.I/C.I.'))).toBe(false)
    expect(globalThis.__op1Nombre).toContain('2026-11-26.pdf')
  })

  it('ordenDespachoPDF con devoluciones y porcentaje != 100 no inventa CTA POR COBRAR falsa', async () => {
    await generarOrdenDespachoPDF({
      despacho: {
        numero: 1002,
        creado_en: '2026-11-27T02:30:00Z',
        total_usd: 100,
        tiene_devoluciones: true,
        forma_pago: JSON.stringify([{ metodo: 'Efectivo $', monto: 100 }]),
        cliente: { nombre: 'CLIENTE DEV' },
      },
      items: [{ cantidad: 1, nombre_snap: 'LAMINA', unidad_snap: 'Und', precio_unit_usd: 100, total_linea_usd: 100 }],
      formaPago: JSON.stringify([{ metodo: 'Efectivo $', monto: 100 }]),
      porcentaje: 110,
      config: { nombre_negocio: 'CONSTRUACERO CARABOBO C.A.' },
    })

    const textos = globalThis.__op1Textos
    expect(textos.some(t => t.includes('CTA POR COBRAR (DIFERENCIA)'))).toBe(false)
    expect(textos.some(t => t.includes('SALDO A FAVOR (DEVOLUCIÓN)'))).toBe(false)
    expect(globalThis.__op1Nombre).toContain('2026-11-26.pdf')
  })

  it('cotizacionPDF dibuja ANULADA cuando estado es anulada y usa fecha Caracas', async () => {
    await generarCotizacionPDF({
      cotizacion: {
        numero: 77,
        estado: 'anulada',
        creado_en: '2026-11-27T02:30:00Z',
        subtotal_usd: 100,
        total_usd: 100,
        cliente: { nombre: 'CLIENTE ANULADO' },
      },
      items: [{ cantidad: 1, nombre_snap: 'ANGULO', unidad_snap: 'Und', precio_unit_usd: 100, total_linea_usd: 100 }],
      config: { nombre_negocio: 'CONSTRUACERO CARABOBO C.A.' },
    })

    const textos = globalThis.__op1Textos
    expect(textos.some(t => t === 'ANULADA')).toBe(true)
    expect(globalThis.__op1Nombre).toContain('2026-11-26.pdf')
  })
})
