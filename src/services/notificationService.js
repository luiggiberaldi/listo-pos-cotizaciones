// src/services/notificationService.js
// Sistema de alertas internas — Construacero Carabobo

const NOTIF_KEY = 'construacero_notifications_v1'
const MAX_NOTIFS = 100

export const NOTIF_TYPES = {
  STOCK_BAJO:                'stock_bajo',
  COTIZACION_ENVIADA:        'cotizacion_enviada',
  COTIZACION_ACEPTADA:       'cotizacion_aceptada',
  COTIZACION_CREADA:         'cotizacion_creada',
  DESPACHO_CREADO:           'despacho_creado',
  COTIZACION_ANULADA:        'cotizacion_anulada',
  CLIENTE_AJENO:             'cliente_ajeno',
  COTIZACION_SIN_RESPUESTA:  'cotizacion_sin_respuesta',
  COTIZACION_POR_VENCER:     'cotizacion_por_vencer',
}

function readNotifs() {
  try {
    return JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]')
  } catch { return [] }
}

function saveNotifs(notifs) {
  try {
    localStorage.setItem(NOTIF_KEY, JSON.stringify(notifs))
  } catch { /* silencioso */ }
}

export function createNotification(type, title, body, meta = null) {
  const notif = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    type,
    title,
    body,
    read: false,
    meta,
  }

  const notifs = [notif, ...readNotifs()]
  if (notifs.length > MAX_NOTIFS) notifs.length = MAX_NOTIFS
  saveNotifs(notifs)

  window.dispatchEvent(new CustomEvent('construacero-notification', { detail: notif }))
  return notif
}

export function getNotifications() {
  return readNotifs()
}

export function getUnreadCount() {
  return readNotifs().filter(n => !n.read).length
}

export function markAllRead() {
  saveNotifs(readNotifs().map(n => ({ ...n, read: true })))
  window.dispatchEvent(new CustomEvent('construacero-notification-read'))
}

export function markRead(id) {
  saveNotifs(readNotifs().map(n => n.id === id ? { ...n, read: true } : n))
  window.dispatchEvent(new CustomEvent('construacero-notification-read'))
}

export function clearNotifications() {
  saveNotifs([])
  window.dispatchEvent(new CustomEvent('construacero-notification-read'))
}

// ─── Helpers de alto nivel ─────────────────────────────────────────────────────

const STOCK_BAJO_COOLDOWN_MS = 6 * 60 * 60 * 1000 // 6 horas

export function notifyStockBajo(productos) {
  const bajos = productos.filter(p => p.stock_actual <= 0 || (p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo))
  if (!bajos.length) return

  // No crear nueva notificación si la última tiene menos de 6 horas y la cantidad no cambió
  const existing = readNotifs().find(n => n.type === NOTIF_TYPES.STOCK_BAJO)
  if (existing) {
    const mismaCantidad = existing.meta?.total === bajos.length
    const reciente = Date.now() - existing.ts < STOCK_BAJO_COOLDOWN_MS
    if (mismaCantidad && reciente) return
  }

  createNotification(
    NOTIF_TYPES.STOCK_BAJO,
    bajos.length === 1
      ? `Stock Bajo: ${bajos[0].nombre}`
      : `${bajos.length} productos con stock bajo`,
    bajos.length === 1
      ? `Solo ${bajos[0].stock_actual} ${bajos[0].unidad || 'und'} (mín: ${bajos[0].stock_minimo})`
      : null,
    {
      productos: bajos.slice(0, 10).map(p => ({
        nombre: p.nombre,
        stock: p.stock_actual,
        unidad: p.unidad || 'und',
        minimo: p.stock_minimo,
      })),
      total: bajos.length,
    }
  )
}

export function notifyCotizacionEnviada(numero, clienteNombre, vendedorNombre, totalUsd) {
  const total = totalUsd ? ` — $${Number(totalUsd).toFixed(2)}` : ''
  const de = vendedorNombre ? ` de ${vendedorNombre}` : ''
  createNotification(
    NOTIF_TYPES.COTIZACION_ENVIADA,
    `COT-${numero} pendiente de aprobación`,
    `${clienteNombre}${total}${de}`,
  )
}

export function notifyCotizacionAceptada(numero, clienteNombre, totalUsd) {
  createNotification(
    NOTIF_TYPES.COTIZACION_ACEPTADA,
    'Cotización Aceptada',
    `Cotización #${numero} — ${clienteNombre} — $${Number(totalUsd).toFixed(2)}`,
  )
}

export function notifyDespachoCreado(numero, clienteNombre) {
  createNotification(
    NOTIF_TYPES.DESPACHO_CREADO,
    'Orden de Despacho Creada',
    `Despacho para cotización #${numero} — ${clienteNombre}`,
  )
}

export function notifyCotizacionAnulada(numero) {
  createNotification(
    NOTIF_TYPES.COTIZACION_ANULADA,
    'Cotización Anulada',
    `Cotización #${numero} fue anulada`,
  )
}

export function notifyClienteAjeno(vendedorNombre, clienteNombre, clienteVendedorNombre, numero) {
  createNotification(
    NOTIF_TYPES.CLIENTE_AJENO,
    'Cotización con Cliente Ajeno',
    `${vendedorNombre} creó cotización #${numero} con el cliente ${clienteNombre} (asignado a ${clienteVendedorNombre})`,
  )
}

// ─── Recordatorios proactivos (estilo Buildertrend) ──────────────────────────

const RECORDATORIO_COOLDOWN_KEY = 'construacero_recordatorios_v1'
const RECORDATORIO_COOLDOWN_MS  = 1 * 60 * 60 * 1000 // 1 hora por cotización

function readCooldowns() {
  try { return JSON.parse(localStorage.getItem(RECORDATORIO_COOLDOWN_KEY) || '{}') }
  catch { return {} }
}

function saveCooldowns(map) {
  try { localStorage.setItem(RECORDATORIO_COOLDOWN_KEY, JSON.stringify(map)) }
  catch { /* silencioso */ }
}

function hasCooldown(key) {
  const map = readCooldowns()
  const ts  = map[key]
  return ts && (Date.now() - ts < RECORDATORIO_COOLDOWN_MS)
}

function setCooldown(key) {
  const map = readCooldowns()
  map[key] = Date.now()
  // Limpiar entradas viejas (> 7 días) para no inflar localStorage
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  for (const k of Object.keys(map)) {
    if (map[k] < cutoff) delete map[k]
  }
  saveCooldowns(map)
}

/**
 * Llamar cuando se detecta una cotización enviada sin respuesta.
 * Genera una notificación máximo una vez cada 1 h por cotización.
 */
export function notifyCotizacionSinRespuesta(numero, clienteNombre, tiempoTexto, vendedorNombre) {
  const key = `sin_respuesta_${numero}`
  if (hasCooldown(key)) return
  setCooldown(key)
  const de = vendedorNombre ? ` — ${vendedorNombre}` : ''
  createNotification(
    NOTIF_TYPES.COTIZACION_SIN_RESPUESTA,
    `COT-${numero} sin respuesta (${tiempoTexto})`,
    `${clienteNombre}${de} — Enviada hace ${tiempoTexto} sin confirmar`,
    { numero, clienteNombre, tiempoTexto },
  )
}

/**
 * Llamar cuando una cotización está próxima a vencer.
 * Genera una notificación máximo una vez cada 24 h por cotización.
 */
export function notifyCotizacionPorVencer(numero, clienteNombre, diasRestantes) {
  const key = `por_vencer_${numero}`
  if (hasCooldown(key)) return
  setCooldown(key)
  const label = diasRestantes === 0
    ? 'vence hoy'
    : diasRestantes === 1
      ? 'vence mañana'
      : `vence en ${diasRestantes} días`
  createNotification(
    NOTIF_TYPES.COTIZACION_POR_VENCER,
    `COT-${numero} ${label}`,
    `${clienteNombre} — Cotización próxima a vencer`,
    { numero, clienteNombre, diasRestantes },
  )
}

