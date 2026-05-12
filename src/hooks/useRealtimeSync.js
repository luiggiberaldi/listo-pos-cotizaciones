// src/hooks/useRealtimeSync.js
// Escucha cambios en tablas clave vía Supabase Realtime
// Invalida cache de React Query para mantener datos sincronizados entre terminales
//
// Canales:
//  • "inventario-realtime-N" (broadcast) — sync instantáneo de productos.
//    Un solo canal que escucha Y envía; nombre único por sesión (evita reusar canal suscrito)
//  • "db-changes-N" (postgres_changes) — sync de otras tablas (cotizaciones, despachos…)
//
// Resiliencia:
//  • Reconexión automática si el WebSocket se cae (móvil en fondo, cambio de red)
//  • visibilitychange → refetch de inventario al volver de fondo
//  • perfil?.id como dependencia (no el objeto entero) para no remontar en cada SIGNED_IN
import { useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { INVENTARIO_KEY } from './useInventario'
import { DESPACHOS_KEY } from './useDespachos'
import { COMISIONES_KEY } from './useComisiones'
import {
  INVENTARIO_EV,
  setInventarioChannel,
} from '../services/supabase/inventarioBroadcast'

const COTIZACIONES_KEY = ['cotizaciones']
const CLIENTES_KEY     = ['clientes']
const CONFIG_KEY       = ['config_negocio']
const USUARIOS_KEY     = ['usuarios']

const TABLAS_LAZY = [
  { tabla: 'clientes',   keys: [CLIENTES_KEY],  debounceMs: 500 },
  { tabla: 'comisiones', keys: [COMISIONES_KEY], debounceMs: 500 },
  { tabla: 'usuarios',   keys: [USUARIOS_KEY],   debounceMs: 500 },
]

const TABLAS_INMEDIATAS = [
  { tabla: 'configuracion_negocio', keys: [CONFIG_KEY],                    debounceMs: 500 },
  { tabla: 'cotizaciones',          keys: [COTIZACIONES_KEY],              debounceMs: 500 },
  { tabla: 'notas_despacho',        keys: [DESPACHOS_KEY, INVENTARIO_KEY], debounceMs: 500 },
]

const RECONNECT_DELAY_MS = 3000

// Contador global: garantiza nombre de canal único por reconexión
// Supabase JS reutiliza el objeto canal suscrito si el nombre coincide —
// esto causaba el error "cannot add postgres_changes after subscribe()".
let _chSeq = 0

export function useRealtimeSync() {
  const qc      = useQueryClient()
  const perfilId = useAuthStore(useCallback(s => s.perfil?.id, []))
  const timers          = useRef({})
  const dbCh            = useRef(null)
  const invCh           = useRef(null)
  const reconnectTimers = useRef({})

  useEffect(() => {
    if (!perfilId) return

    function debouncedInvalidate(key, queryKeys, refetchType, ms) {
      if (timers.current[key]) clearTimeout(timers.current[key])
      timers.current[key] = setTimeout(() => {
        for (const k of queryKeys) qc.invalidateQueries({ queryKey: k, refetchType })
        delete timers.current[key]
      }, ms)
    }

    function scheduleReconnect(label, createFn) {
      if (reconnectTimers.current[label]) return
      reconnectTimers.current[label] = setTimeout(() => {
        delete reconnectTimers.current[label]
        createFn()
      }, RECONNECT_DELAY_MS)
    }

    // ── Canal 1: postgres_changes para tablas lazy e inmediatas ──────────────
    // Nombre único (db-changes-N) para evitar reusar canal ya suscrito
    function createDbChannel() {
      if (dbCh.current) { supabase.removeChannel(dbCh.current); dbCh.current = null }

      const name = `db-changes-${++_chSeq}`
      const ch   = supabase.channel(name)

      for (const { tabla, keys, debounceMs } of TABLAS_LAZY) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: tabla },
          () => debouncedInvalidate(tabla, keys, 'none', debounceMs))
      }
      for (const { tabla, keys, debounceMs } of TABLAS_INMEDIATAS) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: tabla },
          () => debouncedInvalidate(tabla, keys, 'active', debounceMs))
      }

      ch.subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleReconnect('db', createDbChannel)
        }
      })
      dbCh.current = ch
    }

    // ── Canal 2: broadcast para inventario (sync instantáneo cross-device) ───
    // Nombre único (inventario-realtime-N) por la misma razón
    function createInventarioChannel() {
      if (invCh.current) {
        setInventarioChannel(null)
        supabase.removeChannel(invCh.current)
        invCh.current = null
      }

      const name = `inventario-realtime-${++_chSeq}`
      const ch   = supabase
        .channel(name)
        .on('broadcast', { event: INVENTARIO_EV }, () => {
          // Otro dispositivo cambió un producto → invalidar y refetch inmediato
          qc.invalidateQueries({ queryKey: INVENTARIO_KEY, refetchType: 'active' })
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setInventarioChannel(null)
            scheduleReconnect('inv', createInventarioChannel)
          }
        })

      invCh.current = ch
      // Registrar el canal para que las mutations puedan emitir en él
      setInventarioChannel(ch)
    }

    createDbChannel()
    createInventarioChannel()

    // Refetch al volver de fondo (cubre caso de móvil en background)
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY, refetchType: 'active' })
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      Object.values(timers.current).forEach(clearTimeout)
      timers.current = {}
      Object.values(reconnectTimers.current).forEach(clearTimeout)
      reconnectTimers.current = {}
      if (dbCh.current)  { supabase.removeChannel(dbCh.current);  dbCh.current  = null }
      if (invCh.current) {
        setInventarioChannel(null)
        supabase.removeChannel(invCh.current)
        invCh.current = null
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [perfilId, qc])  // perfilId (string), no perfil (objeto) — evita re-montar por referencia
}
