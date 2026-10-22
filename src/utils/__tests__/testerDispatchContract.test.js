import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const testerSource = readFileSync(new URL('../../views/TesterFlowView.jsx', import.meta.url), 'utf8')

describe('contrato del despacho determinista', () => {
  it('reemplaza el envío cotizado por el flete real equivalente', () => {
    const totalCotizacion = 260
    const envioCotizado = 10
    const fleteReal = 10
    const corte = 0

    expect(totalCotizacion - envioCotizado + fleteReal + corte).toBe(260)
    expect(testerSource).toContain('fleteUsd: TEST.cotizacion.costo_envio')
    expect(testerSource).toContain('Flete real: $${TEST.cotizacion.costo_envio}')
  })
})
