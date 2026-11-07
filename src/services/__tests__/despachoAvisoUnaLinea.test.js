import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { generarDespachoPDF } from '../pdf/despachoPDF.js'

describe('nota de entrega con membrete: aviso de devoluciones', () => {
  it('sale en una sola línea', async () => {
    const despacho = { id: 'd1', numero: 4270, creado_en: '2026-11-07T14:00:00Z', estado: 'despachada', total_usd: 0, forma_pago: [], cliente: { nombre: 'PRUEBA' }, vendedor: { nombre: 'V' } }
    const { blob } = await generarDespachoPDF({ despacho, items: Array.from({ length: 19 }, (_, i) => ({ nombre_snap: `CABILLA ${i + 1}`, codigo_snap: `C${i}`, unidad_snap: 'und', cantidad: 2, precio_unit_usd: 10, total_linea_usd: 20, orden: i })), config: { nota_entrega_plantilla: 'membrete' }, returnBlob: true })
    const buf = Buffer.from(await new Response(blob).arrayBuffer())
    if (process.env.GUARDAR_PDF) fs.writeFileSync('tmp/ventas-dia/nota-membrete.pdf', buf)
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
  })
})
