import { describe, it, expect } from 'vitest'
import {
  smartSearchProductos,
  parseSearchTerms,
  extractInchSizes,
  sizesConflict,
  matchByCode,
} from '../smartSearch'

const CATALOGO = [
  // Cabillas y barras en milímetros (como están en inventario real)
  { id: 'c10', codigo: 'CAB0114005', nombre: 'CABILLA ESTRIADA 10 mm X 6,00 mts SIDETUR', categoria: 'CABILLAS', stock_actual: 20 },
  { id: 'c12a', codigo: 'CAB0114006', nombre: 'CABILLA ESTRIADA 12 mm X 12,00 mts SIDETUR', categoria: 'CABILLAS', stock_actual: 30 },
  { id: 'c12b', codigo: 'CAB0114007', nombre: 'CABILLA ESTRIADA 12 mm X 6,00 mts SIDOR', categoria: 'CABILLAS', stock_actual: 15 },
  { id: 'c16', codigo: 'CAB0114009', nombre: 'CABILLA ESTRIADA 16 mm X 12,00 mts SIDETUR', categoria: 'CABILLAS', stock_actual: 10 },
  { id: 'c20', codigo: 'CAB0114012', nombre: 'CABILLA ESTRIADA 20 mm X 12,00 mts SIDOR', categoria: 'CABILLAS', stock_actual: 10 },
  { id: 'c22', codigo: 'CAB0114014', nombre: 'CABILLA ESTRIADA 22 mm X 12,00 mts SIDETUR', categoria: 'CABILLAS', stock_actual: 5 },
  { id: 'c25', codigo: 'CAB0114015', nombre: 'CABILLA ESTRIADA 25 mm X 12,00 mts SIDETUR', categoria: 'CABILLAS', stock_actual: 5 },
  { id: 'b12', codigo: 'BAR0103002', nombre: 'BARRA REDONDA LISA 12mm X 6,00 mts', categoria: 'BARRAS REDONDA LISA', stock_actual: 12 },
  { id: 'alb6', codigo: 'ALB0141006', nombre: 'ALAMBRON 6,0 mm X 6 mts', categoria: 'ALAMBRON', stock_actual: 10 },
  // Electrodos (número de modelo + fracción)
  { id: 'e6013_332', codigo: 'FER1051004', nombre: 'ELECTRODO 6013 3/32 HOFFMAN', categoria: 'FERRETERIA', stock_actual: 50 },
  { id: 'e7018_18', codigo: 'FER1051001', nombre: 'ELECTRODO 7018 1/8 GRICON', categoria: 'FERRETERIA ACCESORIOS', stock_actual: 40 },
  { id: 'e6010_18', codigo: 'FER1051007', nombre: 'ELECTRODO 6010 1/8 ROSSMAN', categoria: 'FERRETERIA', stock_actual: 30 },
  // Pletinas, tubos, tornillos y discos con "x" y "/"
  { id: 'pl1_18', codigo: 'PER0112003', nombre: 'PLETINA 1 X 1/8 X 6,00 mts', categoria: 'PERFILES PLETINA', stock_actual: 10 },
  { id: 'pl1_14', codigo: 'PER0112006', nombre: 'PLETINA 1 X 1/4 X 6,00 mts', categoria: 'PERFILES PLETINA', stock_actual: 10 },
  { id: 'pl15_18', codigo: 'PER0112007', nombre: 'PLETINA 1 1/2 X 1/8 X 6,00 mts', categoria: 'PERFILES PLETINA', stock_actual: 10 },
  { id: 'lam_az', codigo: 'LAM1954006', nombre: 'LAMINA ARQUITECTONICA AZUL 6 mts x 1,08 x 0,35 cal', categoria: 'LAMINAS TECHO', stock_actual: 10 },
  { id: 't12', codigo: 'TUB0403005', nombre: 'TUBO GALV. C/ROSC. 1/2 X 2,3mm X 6,00 mts', categoria: 'TUBERIAS ACERO', stock_actual: 10 },
  { id: 't15_sq', codigo: 'TUB0201002', nombre: 'TUBO PULIDO CUAD. 1 1/2 X 1 1/2 X 0,90 mm X 6,00 mts', categoria: 'TUBOS PULIDO CUADRADO', stock_actual: 10 },
  { id: 't3_15', codigo: 'TUB0202018', nombre: 'TUBO PULIDO RECT 3 X 1 1/2 X 0,85 mm X 6,00 mts', categoria: 'TUBOS PULIDO RECTANGULAR', stock_actual: 10 },
  { id: 't_an4', codigo: 'TUB0803013', nombre: 'TUBO PVC A/N 4" X 2,2 mm X 3,00 mts MACOPLAS', categoria: 'TUBERIAS PVC', stock_actual: 10 },
  { id: 'codo_12', codigo: 'CON0422002', nombre: 'CODO HG 1/2 X 90', categoria: 'CONEXIONES EMT', stock_actual: 25 },
  { id: 'codo_an4', codigo: 'CON0822008', nombre: 'CODO A.N 4" X 90 TUBRICA', categoria: 'CONEXIONES PVC', stock_actual: 25 },
  { id: 'disc_45', codigo: 'FER1003001', nombre: 'DISCO DE CORTE 4 1/2', categoria: 'FERRETERIA ACCESORIOS', stock_actual: 20 },
  { id: 'disc_7', codigo: 'FER1003002', nombre: 'DISCO DE CORTE 7" X 1/16', categoria: 'FERRETERIA ACCESORIOS', stock_actual: 20 },
  { id: 'tor_58', codigo: 'FER0137003', nombre: 'TOR A325 HEX GALV CALIENTE NC 5/8 X 2 1/2 300 Grs.', categoria: 'FERRETERIA TORNILLERIA', stock_actual: 50 },
  { id: 'tor_58_3', codigo: 'FER0137006', nombre: 'TOR C. HEX 5/8 X 3"', categoria: 'FERRETERIA TORNILLERIA', stock_actual: 50 },
  { id: 'arv_20', codigo: 'ELE1603002', nombre: 'ARVIDAL 2/0', categoria: 'ELECTRICIDAD', stock_actual: 10 },
  { id: 'malla', codigo: 'MAL0138002', nombre: 'MALLA TRUCKSON 6 X 6 X 100 mts', categoria: 'MALLAS', stock_actual: 10 },
]

describe('smartSearch — OP-2026-035 barra "/" y fracciones', () => {
  it('encuentra cabillas en mm cuando se buscan en pulgadas con "/" o coloquial', () => {
    expect(smartSearchProductos(CATALOGO, 'cabillas de 1/2').map(p => p.id)).toEqual(['c12a', 'c12b'])
    expect(smartSearchProductos(CATALOGO, 'cabilla 1/2').map(p => p.id)).toEqual(['c12a', 'c12b'])
    expect(smartSearchProductos(CATALOGO, 'cabilla 1/2"').map(p => p.id)).toEqual(['c12a', 'c12b'])
    expect(smartSearchProductos(CATALOGO, 'cabilla media').map(p => p.id)).toEqual(['c12a', 'c12b'])
    expect(smartSearchProductos(CATALOGO, 'cabilla de media').map(p => p.id)).toEqual(['c12a', 'c12b'])
    expect(smartSearchProductos(CATALOGO, 'cabilla 1/2 x 12 mts').map(p => p.id)).toEqual(['c12a'])
    expect(smartSearchProductos(CATALOGO, 'cabilla 3/8').map(p => p.id)).toEqual(['c10'])
    expect(smartSearchProductos(CATALOGO, 'cabilla 5/8').map(p => p.id)).toEqual(['c16'])
    expect(smartSearchProductos(CATALOGO, 'cabilla 3/4').map(p => p.id)).toEqual(['c20'])
    expect(smartSearchProductos(CATALOGO, 'cabilla 7/8').map(p => p.id)).toEqual(['c22'])
    expect(smartSearchProductos(CATALOGO, 'cabilla 1"').map(p => p.id)).toEqual(['c25'])
    expect(smartSearchProductos(CATALOGO, 'barra 1/2').map(p => p.id)).toEqual(['b12'])
    expect(smartSearchProductos(CATALOGO, 'alambron 1/4').map(p => p.id)).toEqual(['alb6'])
  })

  it('encuentra electrodos con fracción sin pegar el número de modelo', () => {
    const res18 = smartSearchProductos(CATALOGO, 'electrodo 1/8').map(p => p.id)
    expect(res18).toContain('e7018_18')
    expect(res18).toContain('e6010_18')
    expect(res18).not.toContain('e6013_332')

    const res332 = smartSearchProductos(CATALOGO, 'electrodo 3/32').map(p => p.id)
    expect(res332).toEqual(['e6013_332'])

    expect(smartSearchProductos(CATALOGO, 'electrodo 6013 3/32').map(p => p.id)).toEqual(['e6013_332'])
    expect(smartSearchProductos(CATALOGO, 'electrodo 3/32 6013').map(p => p.id)).toEqual(['e6013_332'])
  })

  it('encuentra dimensiones con "x" y fracciones sin devolver láminas ni 0 resultados', () => {
    expect(smartSearchProductos(CATALOGO, 'pletina 1 x 1/8').map(p => p.id)).toEqual(['pl1_18'])
    expect(smartSearchProductos(CATALOGO, 'pletina 1 x 1/4').map(p => p.id)).toEqual(['pl1_14'])
    expect(smartSearchProductos(CATALOGO, 'pletina 1 1/2 x 1/8').map(p => p.id)).toEqual(['pl15_18'])
    expect(smartSearchProductos(CATALOGO, 'tubo 1 1/2 x 1 1/2').map(p => p.id)).toEqual(['t15_sq'])
    expect(smartSearchProductos(CATALOGO, 'tornillo 5/8 x 2 1/2').map(p => p.id)).toEqual(['tor_58'])
    expect(smartSearchProductos(CATALOGO, 'tornillo 5/8 x 3').map(p => p.id)).toEqual(['tor_58_3'])
    expect(smartSearchProductos(CATALOGO, 'disco 7"').map(p => p.id)).toEqual(['disc_7'])
  })

  it('preserva abreviaciones con "/" como a/n y c/rosc', () => {
    expect(smartSearchProductos(CATALOGO, 'codo a/n 4').map(p => p.id)).toEqual(['codo_an4'])
    const tubosAn = smartSearchProductos(CATALOGO, 'tubo a/n').map(p => p.id)
    expect(tubosAn[0]).toBe('t_an4')
    expect(tubosAn).not.toContain('t12')
    expect(tubosAn).not.toContain('t15_sq')
    expect(tubosAn).not.toContain('t3_15')
    expect(smartSearchProductos(CATALOGO, 'tubo c/rosc 1/2').map(p => p.id)).toEqual(['t12'])
  })

  it('normaliza espacios alrededor de "/" y guiones antes de fracciones', () => {
    expect(smartSearchProductos(CATALOGO, 'codo 1 / 2').map(p => p.id)).toEqual(['codo_12'])
    expect(smartSearchProductos(CATALOGO, 'tubo 1 / 2').map(p => p.id)).toEqual(['t12'])
    expect(smartSearchProductos(CATALOGO, 'tubo 1-1/2').map(p => p.id)).toContain('t15_sq')
    expect(smartSearchProductos(CATALOGO, 'disco 4-1/2').map(p => p.id)).toEqual(['disc_45'])
  })

  it('no confunde "tubo 1/2" con tubos de "1 1/2"', () => {
    const ids = smartSearchProductos(CATALOGO, 'tubo 1/2').map(p => p.id)
    expect(ids).toEqual(['t12'])
    expect(ids).not.toContain('t15_sq')
    expect(ids).not.toContain('t3_15')
  })

  it('matchByCode no genera falsos positivos al buscar fracciones con "/"', () => {
    expect(matchByCode(CATALOGO[0], '1/4')).toBe(false) // CAB0114005 no debe matchear "1/4" como "14"
    expect(matchByCode(CATALOGO[4], '1/2')).toBe(false) // CAB0114012 no debe matchear "1/2" como "12"
    expect(matchByCode(CATALOGO.find(p => p.id === 'malla'), '3/8')).toBe(false) // MAL0138002 != "3/8"
    expect(matchByCode(CATALOGO[1], 'CAB0114006')).toBe(true) // código real sí sigue funcionando

    // Buscar "2/0" solo trae ARVIDAL 2/0, no códigos con "20"
    expect(smartSearchProductos(CATALOGO, '2/0').map(p => p.id)).toEqual(['arv_20'])
  })

  it('extractInchSizes y sizesConflict manejan fracciones y dimensiones mixtas', () => {
    expect(extractInchSizes('PLETINA 1 X 1/8 X 6,00 mts')).toContain('1x1/8')
    expect(extractInchSizes('DISCO DE CORTE 7" X 1/16')).toContain('7x1/16')
    expect(extractInchSizes('ELECTRODO 6013 3/32 HOFFMAN')).toEqual(['3/32'])
    expect(sizesConflict('7', '7x1/16')).toBe(false)
    expect(sizesConflict('1/2', '3x1 1/2')).toBe(true)
    expect(sizesConflict('1 1/2', '3x1 1/2')).toBe(false)
    expect(parseSearchTerms('cabillas de 1/2')[1]).toContain('12mm')
  })
})
