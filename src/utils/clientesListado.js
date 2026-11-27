// src/utils/clientesListado.js
// Lógica compartida de filtrado, ordenamiento y resumen de filtros para Clientes y Personal.
import { buscarClientes } from './clienteSearch'

/**
 * Filtra y ordena la lista de clientes o personal con el mismo criterio visual de las pantallas:
 * deudores / con préstamo primero (por mayor deuda), luego relevancia de búsqueda o nombre A-Z.
 */
export function filtrarClientes(clientes = [], {
  esPersonal = false,
  mostrarToggle = false,
  verTodos = true,
  perfilId = null,
  busqueda = '',
  filtroTipo = '',
  filtroVendedor = '',
  filtroConDeuda = false,
  filtroConPrestamo = false,
  filtroSaldoFavor = false,
  filtroEstado = 'activos',
} = {}) {
  const query = String(busqueda || '').trim()

  const list = (clientes || []).filter(c => {
    if (esPersonal) {
      if (c.tipo_cliente !== 'personal') return false
    } else {
      if (c.tipo_cliente === 'personal') return false
      if (mostrarToggle && !verTodos && !query && c.vendedor_id !== perfilId) return false
      if (filtroTipo && c.tipo_cliente !== filtroTipo) return false
      if (filtroVendedor && c.vendedor_id !== filtroVendedor) return false
    }

    if (filtroConDeuda && !(Number(c.saldo_pendiente || 0) > 0)) return false
    if (filtroConPrestamo && !c.tiene_prestamos_activos) return false
    if (filtroSaldoFavor && !(Number(c.saldo_a_favor || 0) > 0)) return false

    if (filtroEstado === 'activos' && !c.activo) return false
    if (filtroEstado === 'desactivados' && c.activo) return false

    return true
  })

  const listaConBusqueda = query ? buscarClientes(list, query) : list

  return [...listaConBusqueda].sort((a, b) => {
    const deudaA = Number(a.saldo_pendiente || 0)
    const deudaB = Number(b.saldo_pendiente || 0)
    const prestamoA = !!a.tiene_prestamos_activos
    const prestamoB = !!b.tiene_prestamos_activos

    const esDeudorA = deudaA > 0 || prestamoA
    const esDeudorB = deudaB > 0 || prestamoB

    if (esDeudorA && !esDeudorB) return -1
    if (!esDeudorA && esDeudorB) return 1

    if (esDeudorA && esDeudorB) {
      if (deudaA !== deudaB) return deudaB - deudaA
      if (prestamoA && !prestamoB) return -1
      if (!prestamoA && prestamoB) return 1
    }

    return (a.nombre || '').localeCompare(b.nombre || '')
  })
}

/**
 * Construye una descripción corta y clara de los filtros activos para el subtítulo del PDF.
 */
export function resumenFiltrosClientes({
  esPersonal = false,
  esExterno = false,
  mostrarToggle = false,
  verTodos = true,
  busqueda = '',
  filtroTipo = '',
  filtroVendedor = '',
  vendedores = [],
  filtroConDeuda = false,
  filtroConPrestamo = false,
  filtroSaldoFavor = false,
  filtroEstado = 'activos',
} = {}) {
  const partes = []
  const query = String(busqueda || '').trim()

  if (!esPersonal) {
    if (esExterno || (mostrarToggle && !verTodos && !query)) {
      partes.push('Mis clientes')
    } else {
      partes.push('Todos los clientes')
    }
  }

  if (filtroEstado === 'activos') partes.push('Solo activos')
  else if (filtroEstado === 'desactivados') partes.push('Solo desactivados')
  else partes.push('Todos los estados')

  if (!esPersonal && filtroTipo) {
    partes.push(filtroTipo === 'juridico' ? 'Jurídico' : 'Natural')
  }

  if (!esPersonal && filtroVendedor) {
    const vend = (vendedores || []).find(v => v.id === filtroVendedor)
    if (vend?.nombre) partes.push(`Vendedor: ${vend.nombre}`)
  }

  if (filtroConDeuda) partes.push('Con deuda')
  if (filtroConPrestamo) partes.push('Con préstamo')
  if (filtroSaldoFavor) partes.push('Saldo a favor')
  if (query) partes.push(`Búsqueda: "${query}"`)

  return partes.join(' · ')
}
