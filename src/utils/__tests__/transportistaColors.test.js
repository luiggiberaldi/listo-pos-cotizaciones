import { describe, expect, it } from 'vitest'
import { colorTransportista } from '../transportistaColors'

describe('colorTransportista', () => {
  it('genera colores deterministas y válidos con transparencia dentro de hsl()', () => {
    const first = colorTransportista('Adalberto Rojas')
    const second = colorTransportista('Adalberto Rojas')

    expect(first).toEqual(second)
    expect(first.gradientStart).toMatch(/^hsl\(\d+ \d+% \d+% \/ 0\.93\)$/)
    expect(first.gradientEnd).toMatch(/^hsl\(\d+ \d+% \d+% \/ 0\.60\)$/)
    expect(first.border).toMatch(/^hsl\(\d+ \d+% \d+% \/ 0\.18\)$/)
    expect(first.shadow).toMatch(/^hsl\(\d+ \d+% \d+% \/ 0\.06\)$/)
  })

  it('funciona aunque el nombre esté vacío', () => {
    const colors = colorTransportista()
    expect(colors.solid).toMatch(/^hsl\(0, 65%, 45%\)$/)
    expect(colors.gradientStart).toBe('hsl(0 65% 45% / 0.93)')
  })
})

