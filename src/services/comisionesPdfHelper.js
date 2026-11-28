// src/services/comisionesPdfHelper.js
// Carga paginada y completa de eventos de comisiones + cotizaciones en tandas para PDFs.
import supabase from './supabase/client'
import { fetchComisionesTodas } from '../hooks/useComisiones'

const ROLES_EXCLUIDOS_COMISIONES = new Set(['desarrollador', 'administracion', 'logistica'])
const CHUNK_COTIZACIONES = 100

export function esVendedorExternoEvento(evento) {
  const v = evento?.vendedor || evento?.comisiones?.vendedor || {}
  return !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)
}

export function rolVendedorEvento(evento) {
  const v = evento?.vendedor || evento?.comisiones?.vendedor || {}
  return String(v.rol || '').toLowerCase()
}

/**
 * Trae TODOS los eventos de comisiones del rango (sin tope silencioso de 1.000 filas),
 * aplica filtro de roles y tipo (todos/internos/externos) y lee las cotizaciones en tandas de 100.
 */
export async function cargarEventosComisionesParaPdf({
  desde = '',
  hasta = '',
  vendedorId = '',
  tipoFiltro = 'todos',
  excluirRolesInternosSistema = true,
  fetchEventosFn = fetchComisionesTodas,
  supabaseClient = supabase,
} = {}) {
  const res = await fetchEventosFn({
    desde,
    hasta,
    vendedorId,
    vista: 'eventos',
  })
  const rawEvents = res?.data ?? []

  let filteredEvents = excluirRolesInternosSistema
    ? rawEvents.filter(r => !ROLES_EXCLUIDOS_COMISIONES.has(rolVendedorEvento(r)))
    : rawEvents

  if (tipoFiltro === 'internos') {
    filteredEvents = filteredEvents.filter(r => !esVendedorExternoEvento(r))
  } else if (tipoFiltro === 'externos') {
    filteredEvents = filteredEvents.filter(r => esVendedorExternoEvento(r))
  }

  const cotizacionIds = [...new Set(filteredEvents.map(r => r.comisiones?.cotizacionid).filter(Boolean))]
  const cotizacionesMap = {}

  for (let i = 0; i < cotizacionIds.length; i += CHUNK_COTIZACIONES) {
    const batch = cotizacionIds.slice(i, i + CHUNK_COTIZACIONES)
    const { data: cotList, error: cotErr } = await supabaseClient
      .from('cotizaciones')
      .select('id, numero, tasa_bcv_snapshot, cliente:clientes(id, nombre)')
      .in('id', batch)
    if (cotErr) throw cotErr
    for (const c of cotList ?? []) {
      cotizacionesMap[c.id] = c
    }
  }

  return { rawEvents, filteredEvents, cotizacionesMap }
}
