import { describe, expect, it } from 'vitest'
import { CARGA_BAJA_PCT, clasificarViaje, resumirPor, resumirViajes, soloConCamion, textoKilos, textoPeso, textoToneladas, usoPct } from '../pesoFlota.js'

const viaje = (o = {}) => ({ despacho_id: 'd', vehiculo_id: 'v1', transportista_id: 't1', flete_usd: 100, capacidad_kg: 5000, peso_total_kg: 2500, items_total: 2, items_sin_peso: 0, ...o })

describe('clasificarViaje', () => {
  it('completo, incompleto y sin datos', () => {
    expect(clasificarViaje(viaje())).toBe('completo')
    expect(clasificarViaje(viaje({ items_sin_peso: 1 }))).toBe('incompleto')
    expect(clasificarViaje(viaje({ items_sin_peso: 2 }))).toBe('sin_datos')
    expect(clasificarViaje(viaje({ items_total: 0, items_sin_peso: 0 }))).toBe('sin_datos')
    expect(clasificarViaje(undefined)).toBe('sin_datos')
  })
})

describe('usoPct', () => {
  it('porcentaje de la capacidad', () => { expect(usoPct(viaje({ peso_total_kg: 3200 }))).toBe(64) })
  it('sin capacidad o sin datos → null', () => {
    expect(usoPct(viaje({ capacidad_kg: null }))).toBeNull()
    expect(usoPct(viaje({ items_sin_peso: 2 }))).toBeNull()
  })
})

describe('resumirViajes', () => {
  it('toneladas, costo por tonelada y uso promedio con viajes completos', () => {
    const r = resumirViajes([viaje({ peso_total_kg: 2000, flete_usd: 80 }), viaje({ peso_total_kg: 4000, flete_usd: 120 })])
    expect(r.toneladas).toBe(6)
    expect(r.costoPorTonelada).toBeCloseTo(200 / 6, 6)
    expect(r.usoPromedioPct).toBe(60) // (40% + 80%) / 2
    expect(r.completos).toBe(2)
    expect(r.sobrecargados).toBe(0)
  })
  it('detecta sobrecarga y carga baja', () => {
    const r = resumirViajes([viaje({ peso_total_kg: 5200 }), viaje({ peso_total_kg: 1000 }), viaje({ peso_total_kg: 3000 })])
    expect(r.sobrecargados).toBe(1)
    expect(r.cargaBaja).toBe(1)
    expect(CARGA_BAJA_PCT).toBe(40)
  })
  it('exactamente la capacidad no es sobrecarga; exactamente 40 % no es carga baja', () => {
    const r = resumirViajes([viaje({ peso_total_kg: 5000 }), viaje({ peso_total_kg: 2000 })])
    expect(r.sobrecargados).toBe(0)
    expect(r.cargaBaja).toBe(0)
  })
  it('un viaje incompleto suma sus kilos conocidos, no entra al costo por tonelada ni al uso, pero sí puede marcar sobrecarga', () => {
    const r = resumirViajes([viaje({ peso_total_kg: 5500, items_sin_peso: 1, flete_usd: 999 })])
    expect(r.incompletos).toBe(1)
    expect(r.toneladas).toBe(5.5)
    expect(r.costoPorTonelada).toBeNull()
    expect(r.usoPromedioPct).toBeNull()
    expect(r.sobrecargados).toBe(1)
  })
  it('viajes sin datos no inventan nada', () => {
    const r = resumirViajes([viaje({ items_sin_peso: 2, peso_total_kg: 0 })])
    expect(r).toMatchObject({ viajes: 1, sinDatos: 1, completos: 0, toneladas: 0, costoPorTonelada: null, usoPromedioPct: null })
  })
  it('sin capacidad cargada no calcula uso ni sobrecarga', () => {
    const r = resumirViajes([viaje({ capacidad_kg: 0, peso_total_kg: 9999 })])
    expect(r.usoPromedioPct).toBeNull()
    expect(r.sobrecargados).toBe(0)
    expect(r.toneladas).toBeCloseTo(9.999, 6)
  })
  it('lista vacía', () => {
    expect(resumirViajes([])).toMatchObject({ viajes: 0, toneladas: 0, costoPorTonelada: null, usoPromedioPct: null })
  })
})

describe('resumirPor / soloConCamion', () => {
  it('agrupa por camión e ignora viajes sin camión', () => {
    const lista = [viaje({ vehiculo_id: 'a', peso_total_kg: 1000 }), viaje({ vehiculo_id: 'a', peso_total_kg: 2000 }), viaje({ vehiculo_id: 'b' }), viaje({ vehiculo_id: null })]
    const g = resumirPor(lista, 'vehiculo_id')
    expect(Object.keys(g).sort()).toEqual(['a', 'b'])
    expect(g.a.toneladas).toBe(3)
    expect(soloConCamion(lista)).toHaveLength(3)
  })
})

describe('textoPeso', () => {
  it('kg por debajo de 1000 y toneladas por encima', () => {
    expect(textoPeso(850)).toBe('850 kg')
    expect(textoPeso(12400)).toBe('12,4 t')
    expect(textoPeso(0)).toBe('0 kg')
  })
})

describe('textoToneladas / textoKilos (totales del reporte)', () => {
  it('siempre toneladas con 2 decimales', () => {
    expect(textoToneladas(850)).toBe('0,85 t')
    expect(textoToneladas(1500)).toBe('1,50 t')
    expect(textoToneladas(0)).toBe('0,00 t')
    expect(textoToneladas(42300)).toBe('42,30 t')
    expect(textoToneladas(null)).toBe('0,00 t')
  })
  it('kilos exactos para la ayuda', () => {
    expect(textoKilos(1500)).toMatch(/^1\.?500 kg$/)
    expect(textoKilos(10.7)).toBe('10,7 kg')
  })
})
