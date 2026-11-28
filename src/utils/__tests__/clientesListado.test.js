import { describe, expect, it } from 'vitest'
import { filtrarClientes, resumenFiltrosClientes } from '../clientesListado.js'

const muestra = [
  { id: '1', nombre: 'Enzo Patty', tipo_cliente: 'natural', vendedor_id: 'v1', activo: true, saldo_pendiente: 0, saldo_a_favor: 0, tiene_prestamos_activos: false },
  { id: '2', nombre: 'Inversiones Solidere', tipo_cliente: 'juridico', vendedor_id: 'v2', activo: true, saldo_pendiente: 500, saldo_a_favor: 0, tiene_prestamos_activos: false },
  { id: '3', nombre: 'Alejandra Hidalgo', tipo_cliente: 'personal', vendedor_id: 'v2', activo: true, saldo_pendiente: 100, saldo_a_favor: 0, tiene_prestamos_activos: false },
  { id: '4', nombre: 'Cliente Inactivo', tipo_cliente: 'natural', vendedor_id: 'v1', activo: false, saldo_pendiente: 0, saldo_a_favor: 25, tiene_prestamos_activos: false },
]

describe('filtrarClientes y resumenFiltrosClientes', () => {
  it('excluye personal en vista Clientes, aplica toggle Mis datos y prioriza deuda', () => {
    const todos = filtrarClientes(muestra, { esPersonal: false, mostrarToggle: true, verTodos: true, perfilId: 'v1' })
    expect(todos.map(c => c.id)).toEqual(['2', '1'])

    const misDatos = filtrarClientes(muestra, { esPersonal: false, mostrarToggle: true, verTodos: false, perfilId: 'v1' })
    expect(misDatos.map(c => c.id)).toEqual(['1'])
  })

  it('filtra solo personal en vista Personal', () => {
    const personal = filtrarClientes(muestra, { esPersonal: true })
    expect(personal.map(c => c.id)).toEqual(['3'])
  })

  it('construye resumen legible de filtros activos para el subtítulo del PDF', () => {
    expect(resumenFiltrosClientes({ esPersonal: false, mostrarToggle: true, verTodos: false, filtroEstado: 'activos' }))
      .toBe('Mis clientes · Solo activos')

    expect(resumenFiltrosClientes({
      esPersonal: false,
      mostrarToggle: true,
      verTodos: true,
      filtroEstado: 'activos',
      filtroTipo: 'juridico',
      filtroVendedor: 'v2',
      vendedores: [{ id: 'v2', nombre: 'EMPRESA' }],
      filtroConDeuda: true,
    })).toBe('Todos los clientes · Solo activos · Jurídico · Vendedor: EMPRESA · Con deuda')
  })
})
