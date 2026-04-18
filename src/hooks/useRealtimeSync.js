// src/hooks/useRealtimeSync.js
// Escucha cambios en tablas clave vía Supabase Realtime
// Solo invalida el cache de React Query — no transmite datos pesados
// Consumo: ~10 conexiones (1 por dispositivo), pocos mensajes/mes
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { INVENTARIO_KEY } from './useInventario'
import { DESPACHOS_KEY } from './useDespachos'
import { COMISIONES_KEY } from './useComisiones'

const COTIZACIONES_KEY = ['cotizaciones']
const CLIENTES_KEY = ['clientes']

// Tablas que escuchamos y sus query keys correspondientes
const TABLAS = [
  { tabla: 'productos',       keys: [INVENTARIO_KEY] },
  { tabla: 'cotizaciones',    keys: [COTIZACIONES_KEY] },
  { tabla: 'clientes',        keys: [CLIENTES_KEY] },
  { tabla: 'notas_despacho',  keys: [DESPACHOS_KEY, INVENTARIO_KEY] },
  { tabla: 'comisiones',      keys: [COMISIONES_KEY] },
]

export function useRealtimeSync() {
  const qc = useQueryClient()
  const { perfil } = useAuthStore()

  useEffect(() => {
    if (!perfil) return

    const channel = supabase
      .channel('db-changes')

    // Suscribirse a cambios en cada tabla
    for (const { tabla, keys } of TABLAS) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabla },
        () => {
          // Mark data as stale without immediately refetching
          // Data will be refetched when the user navigates to the view
          // This saves significant egress vs refetching on every change
          for (const key of keys) {
            qc.invalidateQueries({ queryKey: key, refetchType: 'none' })
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
