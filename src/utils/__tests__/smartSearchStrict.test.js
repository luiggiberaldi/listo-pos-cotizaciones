import { describe, expect, it } from 'vitest'
import { smartSearchProductos } from '../smartSearch'

describe('smartSearchProductos — búsqueda estricta de productos', () => {
  const productos = [
    { codigo: 'TUB-01', nombre: 'TUBO VENT. 3 1/2"', categoria: 'TUBERIAS', stock_actual: 8 },
    { codigo: 'CON-01', nombre: 'TEE A.F 1/2 ROSC', categoria: 'CONEXIONES', stock_actual: 5 },
    { codigo: 'CAB-01', nombre: 'CABILLA ESTRIADA 1/2 X 12 MTS', categoria: 'CABILLAS', stock_actual: 2 },
    { codigo: 'CAB-02', nombre: 'CABILLA ESTRIADA 3/8 X 12 MTS', categoria: 'CABILLAS', stock_actual: 10 },
  ]

  it('no devuelve productos que solo coinciden con la medida de una consulta compuesta', () => {
    const resultados = smartSearchProductos(productos, 'cabilla media')

    expect(resultados.map(producto => producto.codigo)).toEqual(['CAB-01'])
    expect(resultados.some(producto => producto.codigo.startsWith('TUB-'))).toBe(false)
    expect(resultados.some(producto => producto.codigo.startsWith('CON-'))).toBe(false)
  })

  it('mantiene la medida solicitada y excluye otra fracción', () => {
    const resultados = smartSearchProductos(productos, 'cabilla 3/8')

    expect(resultados.map(producto => producto.codigo)).toEqual(['CAB-02'])
  })

  it('prioriza coincidencia directa por código', () => {
    const resultados = smartSearchProductos(productos, 'CAB-02')

    expect(resultados[0].codigo).toBe('CAB-02')
    expect(resultados[0]._score).toBe(100000)
  })
})
