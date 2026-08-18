import { describe, expect, it } from 'vitest'
import { rankEntities, scoreSearchEntity } from '../entitySearch'

describe('entitySearch', () => {
  const clientes = [
    { id: '1', nombre: 'Constructora Sanchéz', rif_cedula: 'J-12.345.678-9', codigo_cliente: 'CLI-009', telefono: '+58 414-1234567' },
    { id: '2', nombre: 'Suministros del Norte', rif_cedula: 'J-98.765.432-1', codigo_cliente: 'CLI-001', telefono: '0414-9876543' },
    { id: '3', nombre: 'San Carlos Ferretera', rif_cedula: 'V-12.345.678', codigo_cliente: 'CLI-120', telefono: '0412-1112233' },
  ]

  it('ignora acentos y separadores en identificadores', () => {
    expect(rankEntities(clientes, 'j123456789', [
      { key: 'nombre', weight: 2 },
      { key: 'rif_cedula', weight: 10 },
    ])[0].id).toBe('1')
  })

  it('busca teléfonos aunque la consulta no tenga formato', () => {
    expect(rankEntities(clientes, '4141234567', [{ key: 'telefono', weight: 10 }])[0].id).toBe('1')
  })

  it('exige todos los términos y conserva el mejor resultado primero', () => {
    const ranked = rankEntities(clientes, 'constructora sanchez', [
      { key: 'nombre', weight: 10 },
      { key: 'rif_cedula', weight: 8 },
    ])

    expect(ranked.map(item => item.id)).toEqual(['1'])
  })

  it('tolera un error tipográfico en nombres largos', () => {
    expect(rankEntities(clientes, 'sanchez', [{ key: 'nombre', weight: 10 }])[0].id).toBe('1')
  })

  it('prioriza coincidencia exacta de código sobre coincidencia parcial', () => {
    const ranked = rankEntities(clientes, 'cli-001', [{ key: 'codigo_cliente', weight: 10 }])
    expect(ranked[0].id).toBe('2')
  })

  it('rankea placas, RIF y vehículo de transportistas', () => {
    const transportistas = [
      { id: 't1', nombre: 'Camiones del Centro', rif: 'J-111-222', placa_chuto: 'ABC-123', vehiculo: 'Iveco Trakker' },
      { id: 't2', nombre: 'Transporte Norte', rif: 'V-333-444', placa_chuto: 'XYZ-999', vehiculo: 'Ford Cargo' },
    ]
    expect(rankEntities(transportistas, 'abc123', [
      { key: 'placa_chuto', weight: 10 },
      { key: 'nombre', weight: 5 },
      { key: 'vehiculo', weight: 4 },
    ])[0].id).toBe('t1')
    expect(rankEntities(transportistas, 'iveco traker', [
      { key: 'vehiculo', weight: 10 },
    ])[0].id).toBe('t1')
  })

  it('resuelve consultas compuestas de documentos por correlativo y cliente', () => {
    const documentos = [
      { id: 'd1', numero: 123, cliente: 'Constructora Sanchez', total: 260 },
      { id: 'd2', numero: 124, cliente: 'Suministros del Norte', total: 100 },
    ]
    const ranked = rankEntities(documentos, 'dsp-00123 constructora', [
      { get: row => `dsp-${String(row.numero).padStart(5, '0')} ${row.numero}`, weight: 10 },
      { key: 'cliente', weight: 9 },
      { key: 'total', weight: 7 },
    ])
    expect(ranked.map(item => item.id)).toEqual(['d1'])
  })

  it('devuelve métricas de cobertura sin mutar el registro', () => {
    const result = scoreSearchEntity(clientes[0], 'constructora', [{ key: 'nombre', weight: 10 }])
    expect(result.match).toBe(true)
    expect(result.coverage).toBe(1)
    expect(clientes[0]).not.toHaveProperty('_score')
  })
})
