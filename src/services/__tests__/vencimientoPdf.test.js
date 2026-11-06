// La fecha de vencimiento sale SOLO en la orden de despacho (no en la nota de entrega) y solo si es a crédito.
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

vi.mock('../pdf/pdfLogo', () => ({ cargarLogo: vi.fn(async () => null) }))
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal()
  // Igual que jsPDF, pero anota cada texto que se escribe en la página
  class JsPdfEspia extends mod.jsPDF {
    constructor(...a) {
      super(...a)
      const original = this.text
      this.text = (t, ...r) => { (globalThis.__textos ||= []).push(Array.isArray(t) ? t.join(' ') : String(t)); return original.call(this, t, ...r) }
    }
  }
  return { ...mod, jsPDF: JsPdfEspia }
})

import { generarOrdenDespachoPDF } from '../pdf/ordenDespachoPDF.js'
import { generarDespachoPDF } from '../pdf/despachoPDF.js'

const base = {
  id: 'd1', numero: 3354, creado_en: '2026-11-06T15:00:00Z', estado: 'pendiente', flete_usd: 0, corte_usd: 0,
  cliente: { nombre: 'CLIENTE PRUEBA', rif_cedula: 'J-12345678-9', telefono: '04141234567', direccion: 'Av. Principal' },
}
const items = [{ cantidad: 2, codigo_snap: 'A1', nombre_snap: 'Artículo', unidad_snap: 'und', precio_unit_usd: 10, total_linea_usd: 20 }]
const credito = { ...base, forma_pago: JSON.stringify([{ metodo: 'Cta por cobrar', monto: 20, diasVencimiento: 15 }]) }
const contado = { ...base, forma_pago: JSON.stringify([{ metodo: 'Zelle', monto: 20 }]) }

async function textosDe(fn, despacho) {
  globalThis.__textos = []
  const { blob } = await fn({ despacho, items, config: {}, returnBlob: true })
  return { textos: globalThis.__textos.join(' | '), blob }
}

describe('vencimiento en el PDF', () => {
  it('la ORDEN de despacho a crédito lleva la fecha de vencimiento', async () => {
    const { textos, blob } = await textosDe(generarOrdenDespachoPDF, credito)
    expect(textos).toContain('CRÉDITO:')
    expect(textos).toContain('Crédito 15 días · Vence: 21/11/2026')
    fs.mkdirSync('tmp/pdf-demo', { recursive: true })
    fs.writeFileSync('tmp/pdf-demo/orden_credito.pdf', Buffer.from(await blob.arrayBuffer()))
  })
  it('la orden de despacho de contado no cambia', async () => {
    const { textos } = await textosDe(generarOrdenDespachoPDF, contado)
    expect(textos).not.toContain('CRÉDITO:')
    expect(textos).not.toContain('Vence')
  })
  it('la NOTA DE ENTREGA no lleva la línea de crédito, ni a crédito', async () => {
    const { textos } = await textosDe(generarDespachoPDF, credito)
    expect(textos).not.toContain('CRÉDITO:')
    expect(textos).not.toContain('Vence')
  })
})
