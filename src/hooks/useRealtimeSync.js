// src/hooks/useRealtimeSync.js
// Escucha cambios en tablas clave vía Supabase Realtime
// Invalida cache de React Query para mantener datos sincronizados entre terminales
// Debounce 2s para evitar refetches duplicados cuando el mismo usuario genera el cambio
import { useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { INVENTARIO_KEY } from './useInventario'
import { DESPACHOS_KEY } from './useDespachos'
import { COMISIONES_KEY } from './useComisiones'

const COTIZACIONES_KEY = ['cotizaciones']
const CLIENTES_KEY = ['clientes']
const CONFIG_KEY = ['config_negocio']
const USUARIOS_KEY = ['usuarios']

// Tablas con invalidación lazy (refetch al navegar a la vista)
const TABLAS_LAZY = [
  { tabla: 'clientes',        keys: [CLIENTES_KEY] },
  { tabla: 'comisiones',      keys: [COMISIONES_KEY] },
  { tabla: 'usuarios',        keys: [USUARIOS_KEY] },
]

// Tablas con refetch inmediato (datos críticos para operación del POS)
const TABLAS_INMEDIATAS = [
  { tabla: 'productos',              keys: [INVENTARIO_KEY] },
  { tabla: 'configuracion_negocio',  keys: [CONFIG_KEY] },
  { tabla: 'cotizaciones',           keys: [COTIZACIONES_KEY] },
  { tabla: 'notas_despacho',         keys: [DESPACHOS_KEY, INVENTARIO_KEY] },
]

const DEBOUNCE_MS = 2000

export function useRealtimeSync() {
  const qc = useQueryClient()
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const timers = useRef({})

  useEffect(() => {
    if (!perfil) return

    const channel = supabase.channel('db-changes')

    // Debounced invalidation — coalesces rapid changes into a single refetch
    function debouncedInvalidate(tabla, keys, refetchType) {
      const key = tabla
      if (timers.current[key]) clearTimeout(timers.current[key])
      timers.current[key] = setTimeout(() => {
        for (const k of keys) {
          qc.invalidateQueries({ queryKey: k, refetchType })
        }
        delete timers.current[key]
      }, DEBOUNCE_MS)
    }

    // Lazy: marca como stale, refetch cuando el usuario visite la vista
    for (const { tabla, keys } of TABLAS_LAZY) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabla },
        () => debouncedInvalidate(tabla, keys, 'none')
      )
    }

    // Inmediato: refetch al instante (con debounce para evitar ráfagas)
    for (const { tabla, keys } of TABLAS_INMEDIATAS) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabla },
        () => debouncedInvalidate(tabla, keys, 'active')
      )
    }

    channel.subscribe()

    return () => {
      // Clear all pending timers
      Object.values(timers.current).forEach(clearTimeout)
      timers.current = {}
      supabase.removeChannel(channel)
    }
  }, [perfil, qc])
}
