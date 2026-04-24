// src/hooks/useClientes.js
// Queries y mutations para la tabla public.clientes
// RLS se encarga del aislamiento: vendedor solo ve sus clientes
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { sanitizePostgrestSearch } from '../utils/format'
import { authFetch } from '../services/authFetch'

// ─── Keys de caché ────────────────────────────────────────────────────────────
export const CLIENTES_KEY = ['clientes']

// ─── Consulta principal: listar clientes ─────────────────────────────────────
// Todos los usuarios ven todos los clientes (via worker API que bypasea RLS)
export function useClientes(busqueda = '') {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: [...CLIENTES_KEY, busqueda],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (busqueda.trim()) params.set('busqueda', busqueda.trim())

      const res = await authFetch(`/api/clientes?${params}`)
      if (!res.ok) throw new Error('Error al cargar clientes')
      return await res.json()
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Consulta: obtener un cliente por ID ──────────────────────────────────────
export function useCliente(id) {
  return useQuery({
    queryKey: [...CLIENTES_KEY, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clientes')
        .select(`
          id, nombre, rif_cedula, telefono, email,
          direccion, notas, tipo_cliente, activo,
          vendedor_id, asignado_en, saldo_pendiente,
          vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre)
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

// ─── Mutation: crear cliente ──────────────────────────────────────────────────
// El vendedor_id se auto-asigna al usuario actual (validado también en RLS)
export function useCrearCliente() {
  const qc = useQueryClient()
  const { perfil } = useAuthStore()

  return useMutation({
    mutationFn: async (campos) => {
      const { data, error } = await supabase
        .from('clientes')
        .insert({
          nombre:      campos.nombre.trim(),
          rif_cedula:  campos.rif_cedula?.trim() || null,
          telefono:    campos.telefono?.trim() || null,
          email:       campos.email?.trim()     || null,
          direccion:   campos.direccion?.trim() || null,
          notas:       campos.notas?.trim()     || null,
          tipo_cliente: campos.tipo_cliente || 'natural',
          vendedor_id: perfil.id,
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') throw new Error('Ya existe un cliente con ese RIF/cédula')
        throw error
      }
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
    },
  })
}

// ─── Mutation: actualizar cliente ─────────────────────────────────────────────
// Vendedor solo puede editar sus propios clientes (RLS lo valida)
// No puede cambiar vendedor_id — eso es responsabilidad de reasignar_cliente
export function useActualizarCliente() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, campos }) => {
      const { data, error } = await supabase
        .from('clientes')
        .update({
          nombre:      campos.nombre.trim(),
          rif_cedula:  campos.rif_cedula?.trim() || null,
          telefono:    campos.telefono?.trim() || null,
          email:       campos.email?.trim()     || null,
          direccion:   campos.direccion?.trim() || null,
          notas:       campos.notas?.trim()     || null,
          tipo_cliente: campos.tipo_cliente || 'natural',
        })
        .eq('id', id)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') throw new Error('Ya existe un cliente con ese RIF/cédula')
        throw error
      }
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
    },
  })
}

// ─── Mutation: desactivar cliente (soft delete) ───────────────────────────────
export function useDesactivarCliente() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('clientes')
        .update({ activo: false })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
    },
  })
}

// ─── Mutation: reasignar cliente (solo supervisor, via Worker API) ───────────
export function useReasignarCliente() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ clienteId, nuevoVendedorId, motivo }) => {
      const res = await authFetch('/api/clientes/reasignar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId, nuevoVendedorId, motivo }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al reasignar cliente')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
    },
  })
}

// ─── Query: lista de vendedores activos (para selector de reasignación) ───────
export function useVendedores() {
  return useQuery({
    queryKey: ['vendedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, rol, color')
        .eq('activo', true)
        .order('nombre', { ascending: true })

      if (error) throw error
      // Ocultar cuenta "Super Admin" de todo el sistema
      return (data ?? []).filter(u => u.nombre !== 'Super Admin')
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  })
}
