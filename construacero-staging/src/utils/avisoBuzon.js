// src/utils/avisoBuzon.js
// Lógica pura del aviso del Buzón de sugerencias para el desarrollador: qué mensajes están
// pendientes, cuáles aún no se le han avisado y qué texto lleva la notificación.

export const ETIQUETAS_BUZON = { sugerencia: 'Sugerencia', queja: 'Queja', error_tecnico: 'Error técnico' }

const MAX_RECORDADAS = 200

export function mensajesPendientes(mensajes) {
  return (Array.isArray(mensajes) ? mensajes : []).filter(m => m?.id && m.estado === 'pendiente')
}

// Pendientes de los que todavía no se avisó (ids recordados en este equipo).
export function pendientesSinAviso(pendientes, avisadas) {
  const ya = new Set(avisadas || [])
  return pendientes.filter(m => !ya.has(m.id))
}

// Ids a recordar: los ya avisados + los pendientes actuales (se acota para no crecer sin límite).
export function recordarAvisadas(avisadas, pendientes) {
  return [...new Set([...(avisadas || []), ...pendientes.map(m => m.id)])].slice(-MAX_RECORDADAS)
}

const cortar = (texto, max) => {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// Texto de la notificación. null si no hay nada nuevo que avisar.
export function textoAvisoBuzon(pendientes, nuevos) {
  if (!nuevos?.length) return null
  const ultimo = [...nuevos].sort((a, b) => String(b.creado_en || '').localeCompare(String(a.creado_en || '')))[0]
  const tipo = ETIQUETAS_BUZON[ultimo.tipo] || 'Mensaje'
  const quien = ultimo.usuario?.nombre || 'un operador'
  const resto = pendientes.length > nuevos.length ? ` · ${pendientes.length} pendientes en total` : ''
  return {
    title: nuevos.length === 1 ? '📬 Nuevo mensaje en el Buzón' : `📬 ${nuevos.length} mensajes nuevos en el Buzón`,
    body: `${tipo} de ${quien}: "${cortar(ultimo.mensaje, 90)}"${resto}`,
    urgente: nuevos.some(m => m.tipo === 'queja' || m.tipo === 'error_tecnico'),
  }
}
