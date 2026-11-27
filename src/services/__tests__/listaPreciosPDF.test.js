import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../pdf/pdfLogo', () => ({ cargarLogo: vi.fn(async () => null) }))
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal()
  class JsPdfEspia extends mod.jsPDF {
    constructor(...a) {
      super(...a)
      const originalText = this.text
      this.text = (t, ...r) => {
        ;(globalThis.__lpTextos ||= []).push(Array.isArray(t) ? t.join(' ') : String(t))
        return originalText.call(this, t, ...r)
      }
      this.save = (name) => {
        globalThis.__lpNombre = name
        return this
      }
    }
  }
  return { ...mod, jsPDF: JsPdfEspia }
})

import { generarListaPreciosPDF } from '../pdf/listaPreciosPDF'

describe('OP-2026-101: listaPreciosPDF exactitud BCV, inactivos y fecha Caracas', () => {
  beforeEach(() => {
    globalThis.__lpTextos = []
    globalThis.__lpNombre = ''
  })

  it('convierte precios a Dolar BCV usando factorBcv en vez de imprimir USDT crudo', async () => {
    await generarListaPreciosPDF({
      productos: [
        { id: '1', codigo: 'CAB-1', nombre: 'CABILLA 1/2', categoria: 'CABILLAS', unidad: 'Und', precio_usd: 10, precio_2: 8, stock_actual: 50, activo: true },
        { id: '2', codigo: 'OLD-1', nombre: 'PRODUCTO DESACTIVADO', categoria: 'CABILLAS', unidad: 'Und', precio_usd: 99, stock_actual: 10, activo: false },
      ],
      config: { nombre_negocio: 'CONSTRUACERO CARABOBO C.A.' },
      opciones: {
        moneda: 'bcv',
        tasa: 60,
        factorBcv: 1.5,
        columnas: { codigo: true, unidad: true, precio2: true },
        fechaEmision: new Date('2026-11-27T02:30:00Z'), // 26-nov 22:30 VE
      },
    })

    const textos = globalThis.__lpTextos
    // 10 * 1.5 = 15,00 y 8 * 1.5 = 12,00
    expect(textos.some(t => t.includes('15,00'))).toBe(true)
    expect(textos.some(t => t.includes('12,00'))).toBe(true)
    expect(textos.some(t => t.includes('10,00'))).toBe(false)
    // Producto inactivo excluido
    expect(textos.some(t => t.includes('PRODUCTO DESACTIVADO'))).toBe(false)
    // Nombre de archivo en fecha Caracas (26-nov, no 27-nov UTC)
    expect(globalThis.__lpNombre).toBe('Lista_Precios_2026-11-26.pdf')
  })

  it('rechaza generar lista en Dolar BCV o Bolívares si falta la tasa', async () => {
    await expect(generarListaPreciosPDF({
      productos: [{ id: '1', nombre: 'CABILLA', precio_usd: 10, activo: true }],
      opciones: { moneda: 'bcv', tasa: 60, factorBcv: 0 },
    })).rejects.toThrow(/BCV/i)

    await expect(generarListaPreciosPDF({
      productos: [{ id: '1', nombre: 'CABILLA', precio_usd: 10, activo: true }],
      opciones: { moneda: 'bs', tasa: 0 },
    })).rejects.toThrow(/Bolívares/i)
  })
})
