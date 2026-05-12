// src/lib/mutationQueue.js
// Cola de mutaciones offline persistida en IndexedDB (idb-keyval)
// Cada item: { id, type, payload, createdAt, attempts, status, error? }
// Tipos soportados: 'VENTA_RAPIDA'
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

// ─── Reintentar un item fallido (volver a pending) ────────────────────────────
export async function retryFailed(id) {
  const item = await get(id)
  if (!item) return
  await set(id, { ...item, status: 'pending', attempts: 0, error: null, lastAttemptAt: null })
}

// ─── Eliminar un item fallido (descartar) ─────────────────────────────────────
export async function discardFailed(id) {
  await del(id)
}

// ─── Procesador principal: llamado por SW (Background Sync) o por online event ─
// Recibe una función `dispatch(item) => Promise<void>` que hace el fetch real
export async function processQueue(dispatch) {
  const pending = await dequeuePending()
  const results = { done: 0, failed: 0 }

  for (const item of pending) {
    try {
      await dispatch(item)
      await markDone(item.id)
      results.done++
    } catch (err) {
      await markFailed(item.id, err?.message || 'Error desconocido')
      results.failed++
    }
  }

  return results
}
