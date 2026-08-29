// src/hooks/useOrdenesCompra.js
// Hook de gestión de Órdenes de Compra para React Query y Supabase
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

const KEY_LIST = ['ordenes_compra']
const KEY_ITEMS = (id) => ['orden_compra_items', id]

// ─── 1. Listar Órdenes de Compra ──────────────────────────────────────────────
export function useOrdenesCompra() {
  const { perfil } = useAuthStore()
  
  return useQuery({
    queryKey: KEY_LIST,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ordenes_compra')
        .select('*, vendedor:usuarios(nombre)')
        .order('numero', { ascending: false })
      
      if (error) throw error
      return data ?? []
    },
    // Solo disponible para roles autorizados
    enabled: ['supervisor', 'jefe', 'desarrollador'].includes(perfil?.rol),
    staleTime: 1000 * 60 * 5, // 5 min
    gcTime: 1000 * 60 * 10,
  })
}

// ─── 2. Listar ítems de una Orden de Compra ───────────────────────────────────
export function useOrdenCompraItems(ordenId) {
  return useQuery({
    queryKey: KEY_ITEMS(ordenId),
    queryFn: async () => {
      if (!ordenId) return []
      const { data, error } = await supabase
        .from('orden_compra_items')
        .select('*')
        .eq('orden_compra_id', ordenId)
        .order('orden', { ascending: true })
      
      if (error) throw error
      return data ?? []
    },
    enabled: !!ordenId,
    staleTime: 1000 * 60 * 10,
  })
}

// ─── 3. Crear Orden de Compra ────────────────────────────────────────────────
export function useCrearOrdenCompra() {
  const qc = useQueryClient()
  const { perfil } = useAuthStore()

  return useMutation({
    mutationFn: async ({ orden, items }) => {
      if (!perfil?.id) throw new Error('Usuario no autenticado')
      if (!['supervisor', 'jefe', 'desarrollador'].includes(perfil?.rol)) {
        throw new Error('No tienes permisos para crear órdenes de compra')
      }

      // A) Insertar orden de compra
      const { data: newOrden, error: ordenError } = await supabase
        .from('ordenes_compra')
        .insert({
          proveedor_nombre: orden.proveedor_nombre,
          proveedor_rif: orden.proveedor_rif,
          proveedor_direccion: orden.proveedor_direccion || null,
          proveedor_telefono: orden.proveedor_telefono || null,
          proveedor_correo: orden.proveedor_correo || null,
          proveedor_contacto: orden.proveedor_contacto || null,
          condicion_pago: orden.condicion_pago,
          subtotal_usd: Number(orden.subtotal_usd),
          total_usd: Number(orden.total_usd),
          notas: orden.notas || null,
          estado: orden.estado || 'pendiente',
          vendedor_id: perfil.id,
        })
        .select()
        .single()

      if (ordenError) throw ordenError

      // B) Insertar ítems de la orden de compra
      const itemsToInsert = items.map((item, idx) => ({
        orden_compra_id: newOrden.id,
        cantidad: Number(item.cantidad),
        codigo_snap: item.codigo_snap || null,
        descripcion: item.descripcion,
        unidad: item.unidad || 'und',
        precio_unit_usd: Number(item.precio_unit_usd),
        total_usd: Number(item.total_usd),
        orden: idx,
      }))

      const { error: itemsError } = await supabase
        .from('orden_compra_items')
        .insert(itemsToInsert)

      if (itemsError) {
        // Rollback manual de la orden en caso de fallo (ya que no estamos en una transacción simple y queremos evitar registros huérfanos)
        await supabase.from('ordenes_compra').delete().eq('id', newOrden.id)
        throw itemsError
      }

      return { orden: newOrden, items: itemsToInsert }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_LIST })
    },
  })
}

// ─── 4. Cambiar estado / Anular / Aprobar Orden ──────────────────────────────
export function useActualizarEstadoOrdenCompra() {
  const qc = useQueryClient()
  const { perfil } = useAuthStore()

  return useMutation({
    mutationFn: async ({ id, estado }) => {
      if (!perfil?.id) throw new Error('Usuario no autenticado')
      if (!['supervisor', 'jefe', 'desarrollador'].includes(perfil?.rol)) {
        throw new Error('No tienes permisos para modificar órdenes de compra')
      }

      const { data, error } = await supabase
        .from('ordenes_compra')
        .update({ estado })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEY_LIST })
      qc.invalidateQueries({ queryKey: KEY_ITEMS(data.id) })
    },
  })
}

// ─── 5. Actualizar/Editar Orden de Compra ────────────────────────────────────
export function useActualizarOrdenCompra() {
  const qc = useQueryClient()
  const { perfil } = useAuthStore()

  return useMutation({
    mutationFn: async ({ id, orden, items }) => {
      if (!perfil?.id) throw new Error('Usuario no autenticado')
      if (!['supervisor', 'jefe', 'desarrollador'].includes(perfil?.rol)) {
        throw new Error('No tienes permisos para modificar órdenes de compra')
      }

      // A) Actualizar orden de compra
      const { data: updatedOrden, error: ordenError } = await supabase
        .from('ordenes_compra')
        .update({
          proveedor_nombre: orden.proveedor_nombre,
          proveedor_rif: orden.proveedor_rif,
          proveedor_direccion: orden.proveedor_direccion || null,
          proveedor_telefono: orden.proveedor_telefono || null,
          proveedor_correo: orden.proveedor_correo || null,
          proveedor_contacto: orden.proveedor_contacto || null,
          condicion_pago: orden.condicion_pago,
          subtotal_usd: Number(orden.subtotal_usd),
          total_usd: Number(orden.total_usd),
          notas: orden.notas || null,
        })
        .eq('id', id)
        .select()
        .single()

      if (ordenError) throw ordenError

      // B) Eliminar ítems existentes
      const { error: deleteError } = await supabase
        .from('orden_compra_items')
        .delete()
        .eq('orden_compra_id', id)

      if (deleteError) throw deleteError

      // C) Insertar nuevos ítems
      const itemsToInsert = items.map((item, idx) => ({
        orden_compra_id: id,
        cantidad: Number(item.cantidad),
        codigo_snap: item.codigo_snap || null,
        descripcion: item.descripcion,
        unidad: item.unidad || 'und',
        precio_unit_usd: Number(item.precio_unit_usd),
        total_usd: Number(item.total_usd),
        orden: idx,
      }))

      const { error: itemsError } = await supabase
        .from('orden_compra_items')
        .insert(itemsToInsert)

      if (itemsError) throw itemsError

      return { orden: updatedOrden, items: itemsToInsert }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEY_LIST })
      qc.invalidateQueries({ queryKey: KEY_ITEMS(data.orden.id) })
    },
  })
}

// ── ELIMINAR ORDEN DE COMPRA (COMPLETA) ──
export function useEliminarOrdenCompra() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      // 1. Borrar ítems
      const { error: errItems } = await supabase
        .from('orden_compra_items')
        .delete()
        .eq('orden_compra_id', id)
      
      if (errItems) throw errItems

      // 2. Borrar orden
      const { error: errOrden } = await supabase
        .from('ordenes_compra')
        .delete()
        .eq('id', id)
      
      if (errOrden) throw errOrden

      return true
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_LIST })
    },
  })
}
