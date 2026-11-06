// Prueba de humo: los PDF se generan sin errores y se guardan en tmp/pdf-demo para revisarlos a ojo.
// El peso va solo en los reportes de flota; la guía del chofer no lo lleva.
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

vi.mock('../pdf/pdfLogo', () => ({ cargarLogo: vi.fn(async () => null) }))
// jsPDF.save descarga un archivo en el navegador: aquí se intercepta para guardarlo en disco
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal()
  mod.jsPDF.API.save = function guardar(nombre) { (globalThis.__pdfsGuardados ||= []).push([nombre, this.output('arraybuffer')]) }
  return mod
})

import { generarGuiaDespachoPDF } from '../pdf/guiaDespachoPDF.js'
import { generarFlotaChoferesPDF } from '../pdf/flotaChoferesPDF.js'

const OUT = 'tmp/pdf-demo'
const guardar = async (blob, nombre) => {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(`${OUT}/${nombre}`, Buffer.from(await blob.arrayBuffer()))
}

const despacho = {
  id: 'd1', numero: 3354, creado_en: '2026-11-03T20:00:00Z', estado: 'pendiente', flete_usd: 90, corte_usd: 0,
  cliente: { nombre: 'TEST R17 CLIENTE', rif_cedula: 'J-12345678-9', telefono: '04141234567', direccion: 'Av. Principal' },
  transportista_id: 't1', transportista: { nombre: 'Chofer Flota A', rif: 'V-1', color: 'AZUL' },
  vehiculo_viaje: { id: 'v1', nombre: 'CAM-01 NPR Blanco', placa: 'TST-001', capacidad_kg: 3500 },
}
const itemsConPeso = [
  { cantidad: 100, codigo_snap: 'ELE0432001', nombre_snap: 'Tuberia PVC sanitaria 4" x 6m', unidad_snap: 'und', peso_unit_kg: 15 },
  { cantidad: 10, codigo_snap: 'CAB0112001', nombre_snap: 'Cabilla 1/2" x 12m', unidad_snap: 'und', peso_unit_kg: 10.7 },
  { cantidad: 5, codigo_snap: 'XXX0000001', nombre_snap: 'Artículo sin peso cargado', unidad_snap: 'und', peso_unit_kg: null },
]

describe('PDF con peso', () => {
  it('la guía del chofer NO lleva peso, aunque los ítems lo traigan (por ahora el peso solo va en los reportes)', async () => {
    const { blob } = await generarGuiaDespachoPDF({ despacho, items: itemsConPeso, config: {}, returnBlob: true })
    const { blob: sinPeso } = await generarGuiaDespachoPDF({ despacho, items: itemsConPeso.map(({ peso_unit_kg, ...r }) => r), config: {}, returnBlob: true })
    expect(blob.size).toBe(sinPeso.size)
    await guardar(blob, 'guia_sin_peso.pdf')
  })
  it('reporte de flota con peso (resumen y detallado)', async () => {
    globalThis.__pdfsGuardados = []
    const porVehiculo = [{ vehiculo_id: 'v1', nombre: 'CAM-01 NPR Blanco', placa: 'TST-001', capacidad_kg: 3500, activo: true, total_viajes: 3, total_flete_usd: 175, empresa_usd: 175, comision_choferes_usd: 0, dias_trabajados: 2, total_mercancia_usd: 900, viajes_en_carabobo: 3, viajes_fuera_carabobo: 0, destinos_top: [], desglose_choferes: [], ultimo_viaje_en: '2026-11-03T20:00:00Z', ultimo_chofer_nombre: 'Chofer Flota A' }]
    const pesoViajes = [
      { despacho_id: 'a', numero: 3254, fecha: '2026-10-30T15:00:00Z', vehiculo_id: 'v1', transportista_id: 't1', flete_usd: 100, capacidad_kg: 3500, peso_total_kg: 2800, items_sin_peso: 0, items_total: 2 },
      { despacho_id: 'b', numero: 3253, fecha: '2026-10-29T15:00:00Z', vehiculo_id: 'v1', transportista_id: 't1', flete_usd: 40, capacidad_kg: 3500, peso_total_kg: 5000, items_sin_peso: 0, items_total: 1 },
      { despacho_id: 'c', numero: 3252, fecha: '2026-10-28T15:00:00Z', vehiculo_id: 'v1', transportista_id: 't1', flete_usd: 35, capacidad_kg: 3500, peso_total_kg: 900, items_sin_peso: 0, items_total: 1 },
    ]
    const detalle = pesoViajes.map(v => ({ despacho_id: v.despacho_id, numero: v.numero, fecha: v.fecha, cliente_nombre: 'Cliente', ciudad: 'Valencia', estado_destino: 'Carabobo', chofer_nombre: 'Chofer Flota A', vehiculo_nombre: 'CAM-01', flete_usd: v.flete_usd, chofer_usd: 0, empresa_usd: v.flete_usd, mercancia_usd: 500 }))
    for (const modo of ['resumido', 'detallado']) {
      await generarFlotaChoferesPDF({ modo, desde: '2026-10-01', hasta: '2026-11-03', porVehiculo, porChofer: [], pesoViajes, pesoAnterior: null, detalle, detalleSinCamion: [], tablaChoferes: [], config: {} })
    }
    const saved = globalThis.__pdfsGuardados
    expect(saved).toHaveLength(2)
    fs.mkdirSync(OUT, { recursive: true })
    for (const [nombre, buf] of saved) fs.writeFileSync(`${OUT}/${nombre}`, Buffer.from(buf))
  })
})
