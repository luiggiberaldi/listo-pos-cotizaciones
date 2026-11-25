// src/hooks/useMutationQueue.js
// Hook para leer el estado de la cola de mutaciones offline y procesarla.
// Muestra badge de "N ventas pendientes" y permite reintentar fallidas.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  dequeuePending,
  dequeueFailed,
  retryFailed,
  discardFailed,
  processQueue,
  countAll,
  updateItem,
  rescatarCotizacionesFallidas,
} from '../lib/mutationQueue'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { getOperatorSession, subscribeOperatorSession } from '../services/operatorSession'
import supabase from '../services/supabase/client'
import { showToast } from '../components/ui/Toast'
import { DESPACHOS_KEY } from './useDespachos'
import { INVENTARIO_KEY } from './useInventario'
import { COTIZACIONES_KEY } from './useCotizaciones'
import { COMISIONES_KEY } from './useComisiones'
import { CXC_KEY } from './useCuentasCobrar'

function posponer(mensaje) {
  const err = new Error(mensaje)
  err.posponer = true
  return err
}

// Quién hizo la cotización pendiente (las encoladas antes de OP-2026-067 no lo guardaban).
export function duenoDeCotizacionEncolada(item) {
  return item?.payload?._operadorId || item?.payload?.headerData?.vendedor_id || null
}

// OP-2026-067 (N28): el reenvío de cotizaciones lleva la sesión del vendedor (PIN),
// igual que un guardado normal. Antes iba sin ella y el servidor la rechazaba siempre.
async function dispatchCotizacion(item) {
  if (!navigator.onLine) throw posponer('Sin conexión')
  const sesion = getOperatorSession()
  const dueno = duenoDeCotizacionEncolada(item)
  if (!sesion) throw posponer('Esperando que el vendedor entre con su PIN')
  if (dueno && sesion.operatorId !== dueno) throw posponer('Esperando que entre con su PIN el vendedor que la hizo')

  // Identidad fija antes de enviar: si el servidor ya la recibió, no se duplica.
  let actual = item
  if (!actual.payload?.nuevoId) {
    const nuevoId = globalThis.crypto?.randomUUID?.()
    if (nuevoId) actual = (await updateItem(item.id, { payload: { ...item.payload, nuevoId } })) || { ...item, payload: { ...item.payload, nuevoId } }
  }
  const { _operadorId, ...payload } = actual.payload // eslint-disable-line no-unused-vars
  if (payload.cotizacionId?.startsWith?.('local_')) payload.cotizacionId = null

  let headers
  try { headers = await getAuthHeaders() } catch (e) { throw posponer(e?.message || 'Vuelve a introducir tu PIN') }
  let res
  try {
    res = await fetch(apiUrl('/api/cotizaciones/guardar'), { method: 'POST', headers, body: JSON.stringify(payload) })
  } catch {
    throw posponer('Sin conexión con el servidor')
  }
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(result.error || 'Error al subir la cotización')
  return result
}

// ─── Dispatcher: convierte un item de la cola en un fetch real ────────────────
async function dispatchItem(item) {
  if (item.type === 'GUARDAR_COTIZACION') return dispatchCotizacion(item)

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sin sesión — posponer sync')

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }

  if (item.type === 'VENTA_RAPIDA') {
    const res = await fetch(apiUrl('/api/ventas-rapidas/crear'), {
      method: 'POST',
      headers,
      body: JSON.stringify(item.payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al sincronizar venta')
    return result
  }

  throw new Error(`Tipo de mutación desconocido: ${item.type}`)
}

// ─── Hook principal ───────────────────────────────────────────────────────────
export function useMutationQueue() {
  const qc = useQueryClient()
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState([])
  const [syncing, setSyncing] = useState(false)
  const processingRef = useRef(false)

  // Refrescar contadores
  const refresh = useCallback(async () => {
    const [p, f] = await Promise.all([dequeuePending(), dequeueFailed()])
    setPending(p.length)
    setFailed(f)
  }, [])

  // Procesar la cola (se llama al detectar 'online' o desde Background Sync)
  const sync = useCallback(async ({ silent = false } = {}) => {
    if (processingRef.current) return
    const total = await countAll()
    if (total === 0) return

    processingRef.current = true
    setSyncing(true)

    try {
      const { done, failed: failedCount } = await processQueue(dispatchItem)

      if (done > 0) {
        // Invalidar queries afectadas
        qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
        qc.invalidateQueries({ queryKey: COMISIONES_KEY })
        qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
        qc.invalidateQueries({ queryKey: CXC_KEY })
        if (!silent) showToast(`${done} pendiente${done > 1 ? 's' : ''} subida${done > 1 ? 's' : ''} al sistema. Las cotizaciones quedan como borrador: ábrelas y pulsa Enviar.`, 'success', 8000)
      }

      if (failedCount > 0 && !silent) {
        showToast(`${failedCount} pendiente${failedCount > 1 ? 's' : ''} no se pudo${failedCount > 1 ? 'ieron' : ''} subir`, 'error')
      }
    } finally {
      processingRef.current = false
      setSyncing(false)
      await refresh()
    }
  }, [qc, refresh])

  // Reintentar un item fallido
  const retry = useCallback(async (id) => {
    await retryFailed(id)
    await refresh()
    await sync()
  }, [refresh, sync])

  // Descartar un item fallido
  const discard = useCallback(async (id) => {
    await discardFailed(id)
    await refresh()
  }, [refresh])

  // Escuchar reconexión → procesar automáticamente
  useEffect(() => {
    refresh()
    // OP-2026-067: intentar también al abrir la app y al entrar con el PIN.
    // Primero se rescatan las que fallaron por el defecto viejo del PIN.
    rescatarCotizacionesFallidas().catch(() => 0).then(() => sync({ silent: false }))
    const quitarSuscripcion = subscribeOperatorSession(() => {
      if (getOperatorSession()) sync({ silent: false })
    })

    function handleOnline() {
      sync({ silent: false })
    }

    window.addEventListener('online', handleOnline)

    // Registrar Background Sync si el SW lo soporta
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.sync.register('sync-mutations').catch(() => {
          // Browser no soporta BG Sync (iOS) — el 'online' event ya cubre este caso
        })
      })
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      quitarSuscripcion()
    }
  }, [refresh, sync])

  // Polling liviano (cada 10s) para mantener badge actualizado
  useEffect(() => {
    const interval = setInterval(refresh, 10_000)
    return () => clearInterval(interval)
  }, [refresh])

  return { pending, failed, syncing, sync, retry, discard, refresh }
}
