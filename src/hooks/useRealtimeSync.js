// src/hooks/useRealtimeSync.js
// Escucha cambios en tablas clave vía Supabase Realtime
// Invalida cache de React Query para mantener datos sincronizados entre terminales
// productos y configuracion_negocio hacen refetch inmediato (datos críticos para POS)
import { useEffect } from 'react'
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
  { tabla: 'cotizaciones',    keys: [COTIZACIONES_KEY] },
  { tabla: 'clientes',        keys: [CLIENTES_KEY] },
  { tabla: 'notas_despacho',  keys: [DESPACHOS_KEY, INVENTARIO_KEY] },
  { tabla: 'comisiones',      keys: [COMISIONES_KEY] },
  { tabla: 'usuarios',        keys: [USUARIOS_KEY] },
]

// Tablas con refetch inmediato (datos críticos para operación del POS)
const TABLAS_INMEDIATAS = [
  { tabla: 'productos',              keys: [INVENTARIO_KEY] },
  { tabla: 'configuracion_negocio',  keys: [CONFIG_KEY] },
]

export function useRealtimeSync() {
  const qc = useQueryClient()
  const { perfil } = useAuthStore()

  useEffect(() => {
    if (!perfil) return

    const channel = supabase.channel('db-changes')

    // Lazy: marca como stale, refetch cuando el usuario visite la vista
    for (const { tabla, keys } of TABLAS_LAZY) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabla },
        () => {
          for (const key of keys) {
            qc.invalidateQueries({ queryKey: key, refetchType: 'none' })
          }
        }
      )
    }

    // Inmediato: refetch al instante (stock y config son críticos)
    for (const { tabla, keys } of TABLAS_INMEDIATAS) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabla },
        () => {
          for (const key of keys) {
            qc.invalidateQueries({ queryKey: key })
          }
        }
      )
    }

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [perfil, qc])
}
