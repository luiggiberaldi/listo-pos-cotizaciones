import { describe, it, expect } from 'vitest'
import { expandCommissionRows } from '../../services/pdf/comisionesGeneradasPDF'

// El PDF de comisiones generadas debe mostrar el % NOMINAL almacenado en la
// fila (pctcabilla/pctotros, ya sea 2% normal o 1.5%/0.5% del split de
// sábados), no el % derivado del prorrateo de centavos por ítem.
//
// Fixture sintético con valores que reproducen el bug reportado el 2026-09-05:
// con prorrateo de centavos, una línea de $18.90 con comisión de $0.09 daba
// 0.48% en pantalla aunque el % aplicado por la BD fue 0.5% (split designado).
const filaSplitDueno = {
  id: 'fix-dueno',
  despachoid: 'd-2964',
  despachonumero: 2964,
  estado: 'generada',
  creado_en: '2026-09-05T15:00:00+00:00',
  pctcabilla: 0,
  pctotros: 1.5,
  totalcomision: 1.05,
  comisioncabilla: 0,
  comisionotros: 1.05,
  vendedor: { id: 'niki', nombre: 'Niki Ramírez', color: '#1B365D', es_externo: false },
  despacho: {
    numero: 2964,
    total_usd: 70.3,
    productos: [
      { codigo_snap: 'LAM19150904', nombre_snap: 'LAM. PREPINTADO ROJO LADRILLO', total_linea_usd: 68.5 },
      { codigo_snap: 'ELE0433003', nombre_snap: 'CAJETIN 4X2 RECTANGULAR EMT', total_linea_usd: 1.8 },
    ],
  },
}

const filaSplitDesignado = {
  ...filaSplitDueno,
  id: 'fix-designado',
  despachoid: 'd-2964',
  pctotros: 0.5,
  totalcomision: 0.35,
  comisionotros: 0.35,
  vendedor: { id: 'josue', nombre: 'Josué Marciales', color: '#2E7D32', es_externo: false },
}

const filaNormal = {
  ...filaSplitDueno,
  id: 'fix-normal',
  despachoid: 'd-2968',
  despachonumero: 2968,
  pctotros: 2,
  totalcomision: 7.8,
  comisionotros: 7.8,
  vendedor: { id: 'josue', nombre: 'Josué Marciales', color: '#2E7D32', es_externo: false },
  despacho: {
    numero: 2968,
    total_usd: 390,
    productos: [
      { codigo_snap: 'LAM19150007', nombre_snap: 'LOSACERO 6.10 X 0.76 MTS CAL 24', total_linea_usd: 390 },
    ],
  },
}

const config = { comision_pct_cabilla: 2, comision_pct_otros: 2, comision_categoria_cabilla: 'cabilla' }

describe('expandCommissionRows — % nominal (no derivado del prorrateo)', () => {
  const expanded = expandCommissionRows([filaSplitDueno, filaSplitDesignado, filaNormal], { config, rate: 36.4 })

  it('genera filas para las 3 comisiones', () => {
    expect(expanded.length).toBeGreaterThanOrEqual(3)
  })

  it('cada % mostrado es un nominal exacto (0.5, 1.5 o 2)', () => {
    for (const row of expanded) {
      expect([0.5, 1.5, 2]).toContain(row.pct)
    }
  })

  it('la fila del dueño split muestra 1.5%', () => {
    const dueno = expanded.filter(r => r.despachonumero === 2964 && r.pct === 1.5)
    expect(dueno.length).toBeGreaterThan(0)
  })

  it('la fila del designado split muestra 0.5% (no 0.48% por redondeo)', () => {
    const designado = expanded.filter(r => r.despachonumero === 2964 && r.vendedor.id === 'josue')
    expect(designado.length).toBeGreaterThan(0)
    for (const r of designado) expect(r.pct).toBe(0.5)
  })

  it('la fila normal (sin split) muestra 2%', () => {
    const normal = expanded.filter(r => r.despachonumero === 2968)
    expect(normal.length).toBeGreaterThan(0)
    for (const r of normal) expect(r.pct).toBe(2)
  })
})
