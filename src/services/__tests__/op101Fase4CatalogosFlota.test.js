import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../pdf/pdfLogo', () => ({ cargarLogo: vi.fn(async () => null) }))
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal()
  class JsPdfEspia extends mod.jsPDF {
    constructor(...a) {
      super(...a)
      const originalText = this.text
      this.text = (t, ...r) => {
        ;(globalThis.__f4Textos ||= []).push(Array.isArray(t) ? t.join(' ') : String(t))
        return originalText.call(this, t, ...r)
      }
      this.save = (name) => {
        globalThis.__f4Nombre = name
        return this
      }
    }
  }
  return { ...mod, jsPDF: JsPdfEspia }
})

import { generarClientesPDF } from '../pdf/clientesPDF'
import { generarTransportistasPDF } from '../pdf/transportistasPDF'
import { generarFlotaChoferesPDF } from '../pdf/flotaChoferesPDF'

describe('OP-2026-101 Fase 4: catálogos, Personal, Transportistas y Flota', () => {
  beforeEach(() => {
    globalThis.__f4Textos = []
    globalThis.__f4Nombre = ''
  })

  it('4.3 Personal guarda como Reporte_de_Personal_YYYY-MM-DD.pdf, incluye filtro y no falla sin config', async () => {
    await generarClientesPDF({
      items: [{
        codigo_cliente: 'P-01',
        rif_cedula: 'V-12345678',
        nombre: 'ALEJANDRA HIDALGO DE LOS ANGELES MARQUEZ',
        categoria: 'ADMINISTRACION',
        telefono: '04141234567',
        activo: true,
        creado_en: '2026-11-27T02:30:00Z',
      }],
      title: 'Reporte de Personal',
      filtroTexto: 'Activos · Con deuda',
      config: {},
    })

    const textos = globalThis.__f4Textos.join(' | ')
    expect(textos).toContain('Activos · Con deuda')
    expect(textos).toContain('ADMINISTRACION')
    expect(globalThis.__f4Nombre).toMatch(/^Reporte_de_Personal_\d{4}-\d{2}-\d{2}\.pdf$/)
  })

  it('4.1 Transportistas incluye filtro, teléfono y datos de camión enriquecidos', async () => {
    await generarTransportistasPDF({
      items: [{
        nombre: 'PEDRO CHOFER',
        rif: 'V-9999999',
        telefono: '04121234567',
        vehiculo: 'MACK GRANITE',
        color: 'BLANCO',
        placa_chuto: 'A12BC3D',
        placa_batea: 'B99ZZ1',
        zona_cobertura: 'CARABOBO',
        capacidad: '30 Ton',
      }],
      filtroTexto: 'Solo Locales',
      config: { nombre_negocio: 'CONSTRUACERO' },
    })

    const textos = globalThis.__f4Textos.join(' | ')
    expect(textos).toContain('Solo Locales')
    expect(textos).toContain('Tel: 04121234567')
    expect(textos).toContain('MACK GRANITE (BLANCO)')
    expect(globalThis.__f4Nombre).toMatch(/^Base_de_Datos_Choferes_\d{4}-\d{2}-\d{2}\.pdf$/)
  })

  it('4.2 Flota muestra 0% cuando los camiones tienen 0 viajes en el período', async () => {
    await generarFlotaChoferesPDF({
      modo: 'resumido',
      action: 'download',
      desde: '2026-11-01',
      hasta: '2026-11-27',
      tablaChoferes: [],
      porVehiculo: [{ vehiculo_id: 'v1', nombre: 'MACK 1', placa: 'AAA111', total_viajes: 0, dias_trabajados: 0, total_flete_usd: 0, comision_choferes_usd: 0, empresa_usd: 0 }],
      porChofer: [],
      sinCamion: { viajes: 0, flete: 0 },
      config: { nombre_negocio: 'CONSTRUACERO' },
    })

    const textos = globalThis.__f4Textos.join(' | ')
    expect(textos).toContain('0%')
    expect(textos).not.toContain('100%')
  })
})
