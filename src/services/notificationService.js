// src/services/notificationService.js
// Sistema de alertas internas — adaptado de Listo POS Lite

const NOTIF_KEY = 'listo_cotizaciones_notifications_v1'
const MAX_NOTIFS = 100

export const NOTIF_TYPES = {
  STOCK_BAJO:           'stock_bajo',
  COTIZACION_ENVIADA:   'cotizacion_enviada',
  COTIZACION_ACEPTADA:  'cotizacion_aceptada',
  COTIZACION_CREADA:    'cotizacion_creada',
  DESPACHO_CREADO:      'despacho_creado',
  COTIZACION_ANULADA:   'cotizacion_anulada',
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

  window.dispatchEvent(new CustomEvent('listo-notification', { detail: notif }))
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
  window.dispatchEvent(new CustomEvent('listo-notification-read'))
}

export function markRead(id) {
  saveNotifs(readNotifs().map(n => n.id === id ? { ...n, read: true } : n))
  window.dispatchEvent(new CustomEvent('listo-notification-read'))
}

export function clearNotifications() {
  saveNotifs([])
  window.dispatchEvent(new CustomEvent('listo-notification-read'))
}

// ─── Helpers de alto nivel ─────────────────────────────────────────────────────

export function notifyStockBajo(productos) {
  const bajos = productos.filter(p => p.stock_actual <= p.stock_minimo)
  if (!bajos.length) return

  if (bajos.length === 1) {
    const p = bajos[0]
    createNotification(
      NOTIF_TYPES.STOCK_BAJO,
      'Stock Bajo',
      `${p.nombre} — solo ${p.stock_actual} ${p.unidad || 'und'} (mínimo: ${p.stock_minimo})`,
      { productoId: p.id }
    )
  } else {
    createNotification(
      NOTIF_TYPES.STOCK_BAJO,
      `${bajos.length} Productos con Stock Bajo`,
      bajos.slice(0, 3).map(p => `${p.nombre}: ${p.stock_actual}`).join(' · ') + (bajos.length > 3 ? '…' : ''),
    )
  }
}

export function notifyCotizacionEnviada(numero, clienteNombre) {
  createNotification(
    NOTIF_TYPES.COTIZACION_ENVIADA,
    'Cotización Enviada',
    `Cotización #${numero} enviada al cliente ${clienteNombre}`,
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
