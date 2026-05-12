// src/services/supabase/inventarioBroadcast.js
// Referencia al canal de inventario que gestiona useRealtimeSync.
// Las mutations de useInventario llaman a broadcastInventarioUpdate()
// para notificar a TODOS los demás dispositivos conectados.
// — NO crea su propio canal (evita duplicados)
// — El canal es asignado por useRealtimeSync al crearlo
export const INVENTARIO_CH = 'inventario-realtime'
export const INVENTARIO_EV = 'inv-updated'

let _ch = null

/** Registrar el canal (llamado por useRealtimeSync al crear el canal) */
export function setInventarioChannel(ch) {
  _ch = ch
}

/** Emitir cambio a todos los dispositivos (llamado desde mutations onSuccess) */
export function broadcastInventarioUpdate() {
  if (!_ch) return
  _ch.send({
    type:    'broadcast',
    event:   INVENTARIO_EV,
    payload: { ts: Date.now() },
  }).catch(() => {}) // fail silently — el visibilitychange sirve de fallback
}
