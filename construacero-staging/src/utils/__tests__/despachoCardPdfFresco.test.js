import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const carpeta = path.dirname(fileURLToPath(import.meta.url))
const fuente = fs.readFileSync(path.join(carpeta, '../../components/despachos/DespachoCard.jsx'), 'utf8')

describe('DespachoCard — los PDF usan el despacho releído (no la copia vieja de la tarjeta)', () => {
  const generadores = ['generarDespachoPDF', 'generarOrdenDespachoPDF', 'generarGuiaDespachoPDF', 'generarFacturaPDF']
  const llamadas = generadores.reduce((n, g) => n + (fuente.match(new RegExp(`await ${g}\\(`, 'g')) || []).length, 0)

  it('cada generación de PDF lee primero fetchDatosParaPdf()', () => {
    const lecturas = (fuente.match(/fetchDatosParaPdf\(\),/g) || []).length
    expect(llamadas).toBeGreaterThan(0)
    expect(lecturas).toBe(llamadas)
  })

  it('ninguna llamada a un generador pasa el despacho de la tarjeta sin releer', () => {
    // el patrón viejo era "despacho, items: itemsFinal" (la copia de la tarjeta)
    expect(fuente).not.toMatch(/\n\s+despacho, items: itemsFinal/)
    expect(fuente).not.toMatch(/formaPago: despacho\.forma_pago/)
  })

  it('el helper combina con la lógica verificada y no con un spread directo', () => {
    expect(fuente).toContain('combinarDespachoFresco(despacho')
    expect(fuente).toContain('SELECT_DESPACHO_PARA_PDF')
  })
})
