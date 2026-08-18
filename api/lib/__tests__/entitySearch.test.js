import { describe, expect, it } from 'vitest'
import { rankSearch } from '../entitySearch.js'

describe('api entitySearch', () => {
  const rows = [
    { id: '1', nombre: 'Constructora Sanchéz', rif_cedula: 'J-12.345.678-9', telefono: '+58 414-1234567' },
    { id: '2', nombre: 'Suministros del Norte', rif_cedula: 'J-98.765.432-1', telefono: '0414-9876543' },
  ]

  const fields = [
    { key: 'nombre', weight: 10 },
    { key: 'rif_cedula', weight: 9 },
    { key: 'telefono', weight: 7 },
  ]

  it('normaliza acentos y separadores', () => {
    expect(rankSearch(rows, 'j123456789', fields).map(row => row.id)).toEqual(['1'])
  })

  it('exige que coincidan todos los términos', () => {
    expect(rankSearch(rows, 'constructora norte', fields)).toEqual([])
  })

  it('tolera un typo en el nombre', () => {
    expect(rankSearch(rows, 'sanchez', fields).map(row => row.id)).toEqual(['1'])
  })
})
