// src/lib/mutationQueue.js
// Cola de mutaciones offline persistida en IndexedDB (idb-keyval)
// Cada item: { id, type, payload, createdAt, attempts, status, error? }
// Tipos soportados: 'VENTA_RAPIDA', 'GUARDAR_COTIZACION'
//
// REGLA DE INVENTARIO: El stock NO se descuenta localmente cuando la venta está en cola.
// El usuario ve un warning claro. El stock se descuenta al sincronizar con el worker.
import { get, set, del, keys } from 'idb-keyval'

const QUEUE_PREFIX = 'mq_'
const MAX_ATTEMPTS = 3

// ─── Encolar una nueva mutación ───────────────────────────────────────────────
export async function enqueue(type, payload) {
  const id = `${QUEUE_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const item = {
    id,
    type,
    payload,
    createdAt: Date.now(),
    snapshotAt: Date.now(), // para detectar conflictos en Fase 3
    attempts: 0,
    status: 'pending', // 'pending' | 'failed'
    error: null,
  }
  await set(id, item)
  return id
}

// ─── Leer todos los items pendientes ordenados por fecha ──────────────────────
export async function dequeuePending() {
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  const items = await Promise.all(allKeys.map((k) => get(k)))
  return items
    .filter((i) => i?.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt)
}

// ─── Leer todos los items fallidos ────────────────────────────────────────────
export async function dequeueFailed() {
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  const items = await Promise.all(allKeys.map((k) => get(k)))
  return items.filter((i) => i?.status === 'failed').sort((a, b) => a.createdAt - b.createdAt)
}

// ─── Contar todos los items (pending + failed) ────────────────────────────────
export async function countAll() {
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  return allKeys.length
}

// ─── Marcar como procesado (eliminar) ─────────────────────────────────────────
export async function markDone(id) {
  await del(id)
}

// ─── Marcar como fallido ──────────────────────────────────────────────────────
export async function markFailed(id, errorMsg) {
  const item = await get(id)
  if (!item) return
  const attempts = (item.attempts || 0) + 1
  await set(id, {
    ...item,
    status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
    error: errorMsg,
    attempts,
    lastAttemptAt: Date.now(),
  })
}

// ─── Guardar cambios en un item (p. ej. fijar su identidad antes de reenviar) ──
export async function updateItem(id, cambios) {
  const item = await get(id)
  if (!item) return null
  const nuevo = { ...item, ...cambios }
  await set(id, nuevo)
  return nuevo
}

// ─── Reintentar un item fallido (volver a pending) ────────────────────────────
export async function retryFailed(id) {
  const item = await get(id)
  if (!item) return
  await set(id, { ...item, status: 'pending', attempts: 0, error: null, lastAttemptAt: null })
}

// ─── OP-2026-069: rescatar cotizaciones que fallaron por el defecto del PIN ────
// Antes del arreglo, el reenvío iba sin la sesión del vendedor y el servidor respondía
// "No hay operador seleccionado" (o pedía el PIN); tras 3 intentos quedaban "fallidas".
// Esas vuelven a la fila de pendientes para que se suban solas con el reenvío corregido.
export const ERROR_DEFECTO_PIN = /operador|PIN|sesi[oó]n|No autenticado/i
export async function rescatarCotizacionesFallidas() {
  const fallidas = await dequeueFailed()
  let rescatadas = 0
  for (const item of fallidas) {
    if (item.type !== 'GUARDAR_COTIZACION' || !ERROR_DEFECTO_PIN.test(item.error || '')) continue
    await set(item.id, { ...item, status: 'pending', attempts: 0, error: null, lastAttemptAt: null })
    rescatadas++
  }
  return rescatadas
}

// ─── Eliminar un item fallido (descartar) ─────────────────────────────────────
export async function discardFailed(id) {
  await del(id)
}

// ─── Procesador principal: llamado por SW (Background Sync) o por online event ─
// Recibe una función `dispatch(item) => Promise<void>` que hace el fetch real
export async function processQueue(dispatch) {
  const pending = await dequeuePending()
  const results = { done: 0, failed: 0, postponed: 0 }

  for (const item of pending) {
    try {
      await dispatch(item)
      await markDone(item.id)
      results.done++
    } catch (err) {
      // OP-2026-069: "posponer" (falta el PIN del dueño, sin conexión) no gasta intentos.
      if (err?.posponer) {
        await updateItem(item.id, { error: err.message || null })
        results.postponed++
        continue
      }
      await markFailed(item.id, err?.message || 'Error desconocido')
      results.failed++
    }
  }

  return results
}
