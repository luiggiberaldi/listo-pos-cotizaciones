// src/hooks/useInventario.js
// Queries y mutations para productos
// — Vendedor usa RPCs SECURITY DEFINER (sin costo_usd)
// — Supervisor usa la tabla productos directa (con costo_usd)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { buildSmartFilter, parseSearchTerms } from '../utils/smartSearch'
import { showToast } from '../components/ui/Toast'
import { MOVIMIENTOS_KEY } from './useMovimientosInventario'
import { broadcastInventarioUpdate } from '../services/supabase/realtimeBus'
import { authFetch } from '../services/authFetch'

export const INVENTARIO_KEY = ['inventario']

function nuevaIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  throw new Error('El navegador no soporta claves de idempotencia')
}

async function llamarMutacionProducto(path, method, payload, fallbackMessage) {
  const idempotencyKey = payload.idempotencyKey || nuevaIdempotencyKey()
  const res = await authFetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ ...payload, idempotencyKey }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (data.error?.includes('duplicate') || res.status === 409) {
      throw new Error('Ya existe un producto con ese código')
    }
    throw new Error(data.error || fallbackMessage || `Error ${res.status}`)
  }
  return data
}

// Prefijos que se consolidan en una sola categoría padre
export const CATEGORY_GROUPS = [
  'CONEXIONES',
  'ELECTRICIDAD',
  'LAMINAS',
  'PERFILES',
  'BARRAS',
  'TUBERIAS',
  'FERRETERIA',
]


// Dada una categoría raw de la DB, retorna el grupo padre
function getCategoryGroup(cat) {
  if (!cat) return cat
  const upper = cat.toUpperCase().trim()
  for (const prefix of CATEGORY_GROUPS) {
    if (upper.startsWith(prefix) && upper !== prefix) return prefix
  }
  return cat
}

// ─── Lista de productos ───────────────────────────────────────────────────────
export function useInventario({ busqueda = '', categoria = '', page = 0, pageSize = 100, mostrarInactivos = false } = {}) {
  const { perfil } = useAuthStore()
  const esPrivilegiado = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe') || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: [...INVENTARIO_KEY, busqueda, categoria, esPrivilegiado, page, pageSize, mostrarInactivos],
    queryFn: async () => {
      const isGroup = categoria ? CATEGORY_GROUPS.includes(categoria.toUpperCase().trim()) : false

      // Si hay texto de búsqueda, usamos el worker híbrido
      if (busqueda.trim() !== '') {
        try {
          const res = await authFetch('/api/productos/buscar', {
            method: 'POST',
            body: JSON.stringify({
              busqueda: busqueda.trim(),
              categoria: categoria || '',
              categoria_grupo: isGroup,
              page,
              limit: pageSize,
              incluir_inactivos: mostrarInactivos
            })
          })
          if (!res.ok) throw new Error('Error en búsqueda híbrida')
          const data = await res.json()
          return { productos: data.productos || [], totalCount: data.totalCount || 0 }
        } catch (error) {
          console.error('Error buscando productos híbrido:', error)
          // Fallback a comportamiento normal si falla
        }
      }

      // Modo "catálogo completo": los call-sites que pasan pageSize >= 1000
      // esperan TODOS los productos (búsqueda/cotización client-side).
      // Supabase corta cada respuesta en 1000 filas, así que paginamos hasta
      // el total real, con tope de seguridad. `truncado` avisa si se alcanzó.
      const esCatalogoCompleto = pageSize >= 1000 && page === 0
      const CHUNK = 1000
      const MAX_CATALOGO = 5000

      if (esPrivilegiado) {
        // Supervisor: tabla directa (con costo_usd)
        const buildQuery = (desde, hasta) => {
          let query = supabase
            .from('productos')
            .select('id, codigo, nombre, descripcion, categoria, unidad, precio_usd, precio_2, precio_3, precio1_porcentaje, precio2_porcentaje, precio3_porcentaje, costo_usd, stock_actual, stock_minimo, activo, imagen_url, creado_en, actualizado_en', { count: 'exact' })

          if (!mostrarInactivos) {
            query = query.eq('activo', true)
          }

          if (busqueda.trim()) {
            const filters = buildSmartFilter(busqueda)
            if (filters) {
              for (const orClause of filters) {
                query = query.or(orClause)
              }
            }
          }

          if (categoria) {
            if (isGroup) query = query.ilike('categoria', `${categoria}%`)
            else query = query.eq('categoria', categoria)
          }

          return query.order('nombre', { ascending: true }).range(desde, hasta)
        }

        const { data, error, count } = await buildQuery(page * pageSize, (page + 1) * pageSize - 1)
        if (error) throw error
        let productos = data ?? []
        const totalCount = count ?? productos.length

        // Traer las páginas restantes si el catálogo supera el primer chunk
        if (esCatalogoCompleto && totalCount > productos.length) {
          const objetivo = Math.min(totalCount, MAX_CATALOGO)
          const extraRanges = []
          for (let desde = productos.length; desde < objetivo; desde += CHUNK) {
            extraRanges.push([desde, Math.min(desde + CHUNK, objetivo) - 1])
          }
          const extras = await Promise.all(extraRanges.map(([d, h]) => buildQuery(d, h)))
          for (const r of extras) {
            if (r.error) throw r.error
            productos = productos.concat(r.data ?? [])
          }
        }

        return { productos, totalCount, truncado: totalCount > productos.length }
      }

      // Vendedor: RPC segura
      const fetchPagina = async (limit, offset) => {
        const { data, error } = await supabase.rpc('obtener_productos_vendedor', {
          p_busqueda: busqueda.trim(),
          p_categoria: categoria || '',
          p_categoria_grupo: isGroup,
          p_limit: limit,
          p_offset: offset,
        })
        if (error) throw error
        return data ?? []
      }

      const rows = await fetchPagina(Math.min(pageSize, CHUNK), page * pageSize)
      const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0
      let productos = rows.map(({ total_count, ...rest }) => rest)

      if (esCatalogoCompleto && totalCount > productos.length) {
        const objetivo = Math.min(totalCount, MAX_CATALOGO)
        const extraOffsets = []
        for (let offset = productos.length; offset < objetivo; offset += CHUNK) {
          extraOffsets.push(offset)
        }
        const extras = await Promise.all(extraOffsets.map(offset => fetchPagina(CHUNK, offset)))
        for (const extraRows of extras) {
          productos = productos.concat(extraRows.map(({ total_count, ...rest }) => rest))
        }
      }

      return { productos, totalCount, truncado: totalCount > productos.length }
    },
    enabled: !!perfil,
    staleTime: 1000 * 10,         // 10s — refresco instantáneo de stock real
    gcTime:    1000 * 60 * 5,
    refetchOnWindowFocus: true,
  })
}


// Procesa una lista plana de categorías y la convierte en una jerarquía plana para Selects
function processCategoriasHierarchy(rawCats) {
  // Normalizar los nombres (trim) para evitar duplicados como "CAT" y "CAT "
  const cleanedCats = rawCats.map(c => c?.trim()).filter(Boolean)
  const exactCats = [...new Set(cleanedCats)].sort()
  const result = []
  const processedGroups = new Set()

  for (const cat of exactCats) {
    const group = getCategoryGroup(cat)
    if (group !== cat) {
      // Es hija de un grupo
      if (!processedGroups.has(group)) {
        processedGroups.add(group)
        result.push({ value: group, label: `${group} (Todas)` })
      }
      result.push({ value: cat, label: `  ↳ ${cat}` })
    } else {
      // Es categoría independiente
      if (!processedGroups.has(cat)) {
        processedGroups.add(cat)
        result.push({ value: cat, label: cat })
      }
    }
  }
  return result
}

// ─── Categorías únicas (para el filtro) ──────────────────────────────────────
export function useCategorias({ mostrarInactivos = false } = {}) {
  const { perfil } = useAuthStore()
  const esPrivilegiado = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe') || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: [...INVENTARIO_KEY, 'categorias', mostrarInactivos],
    queryFn: async () => {
      if (esPrivilegiado) {
        let query = supabase
          .from('productos')
          .select('categoria')
          .not('categoria', 'is', null)
          .order('categoria', { ascending: true })

        if (!mostrarInactivos) {
          query = query.eq('activo', true)
        }

        const { data, error } = await query
        if (error) throw error
        const rawCats = (data ?? []).map(r => r.categoria).filter(Boolean)
        return processCategoriasHierarchy(rawCats)
      }

      // Vendedor: RPC segura (SECURITY DEFINER)
      const { data, error } = await supabase.rpc('obtener_categorias_vendedor')
      if (error) throw error
      const rawCats = (data ?? []).map(r => r.categoria).filter(Boolean)
      return processCategoriasHierarchy(rawCats)
    },
    enabled: !!perfil,
    staleTime: 1000 * 30,         // 30s — misma ventana que productos
  })
}

// Exportar para uso en useInventario
export { getCategoryGroup }

// ─── Mutation: crear producto (solo supervisor) ───────────────────────────────
// Usa RPC que registra stock inicial en kardex automáticamente
export function useCrearProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (campos) => llamarMutacionProducto('/api/productos/crear', 'POST', {
      codigo: campos.codigo?.trim() || null,
      nombre: campos.nombre.trim(),
      descripcion: campos.descripcion?.trim() || null,
      categoria: campos.categoria?.trim() || null,
      unidad: campos.unidad?.trim() || 'und',
      precio_usd: Number(campos.precio_usd) || 0,
      costo_usd: campos.costo_usd ? Number(campos.costo_usd) : null,
      stock_actual: Number(campos.stock_actual) || 0,
      stock_minimo: Number(campos.stock_minimo) || 0,
      precio_2: campos.precio_2 !== '' && campos.precio_2 != null ? Number(campos.precio_2) : null,
      precio_3: campos.precio_3 !== '' && campos.precio_3 != null ? Number(campos.precio_3) : null,
      precio1_porcentaje: campos.precio1_porcentaje !== '' && campos.precio1_porcentaje != null ? Number(campos.precio1_porcentaje) : null,
      precio2_porcentaje: campos.precio2_porcentaje !== '' && campos.precio2_porcentaje != null ? Number(campos.precio2_porcentaje) : null,
      precio3_porcentaje: campos.precio3_porcentaje !== '' && campos.precio3_porcentaje != null ? Number(campos.precio3_porcentaje) : null,
      imagen_url: null,
    }, 'Error al crear producto'),
    onSuccess: async () => {
      // Cancelar queries en vuelo para evitar race condition Vercel→Supabase:
      // el RPC puede tardar en ser visible en DB antes que el refetch inmediato complete.
      await qc.cancelQueries({ queryKey: INVENTARIO_KEY })
      await qc.cancelQueries({ queryKey: MOVIMIENTOS_KEY })
      broadcastInventarioUpdate()
      showToast('Producto creado', 'success')
      // Invalidar con delay para dar tiempo al commit de ser visible en Supabase
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
        qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      }, 300)
      const { operatorId } = useAuthStore.getState()
      if (operatorId) authFetch('/api/admin/sync-embeddings', { method: 'POST' }).catch(() => {})
    },
  })
}

// ─── Mutation: actualizar producto (solo supervisor) ──────────────────────────
// Usa RPC que registra cambios de stock en kardex automáticamente
export function useActualizarProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, campos, imagen_url }) => llamarMutacionProducto('/api/productos/actualizar', 'PATCH', {
      id,
      codigo: campos.codigo?.trim() || null,
      nombre: campos.nombre.trim(),
      descripcion: campos.descripcion?.trim() || null,
      categoria: campos.categoria?.trim() || null,
      unidad: campos.unidad?.trim() || 'und',
      precio_usd: Number(campos.precio_usd) || 0,
      costo_usd: campos.costo_usd ? Number(campos.costo_usd) : null,
      stock_actual: Number(campos.stock_actual) || 0,
      stock_minimo: Number(campos.stock_minimo) || 0,
      precio_2: campos.precio_2 !== '' && campos.precio_2 != null ? Number(campos.precio_2) : null,
      precio_3: campos.precio_3 !== '' && campos.precio_3 != null ? Number(campos.precio_3) : null,
      precio1_porcentaje: campos.precio1_porcentaje !== '' && campos.precio1_porcentaje != null ? Number(campos.precio1_porcentaje) : null,
      precio2_porcentaje: campos.precio2_porcentaje !== '' && campos.precio2_porcentaje != null ? Number(campos.precio2_porcentaje) : null,
      precio3_porcentaje: campos.precio3_porcentaje !== '' && campos.precio3_porcentaje != null ? Number(campos.precio3_porcentaje) : null,
      imagen_url: imagen_url ?? null,
    }, 'Error al actualizar producto'),
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: INVENTARIO_KEY })
      await qc.cancelQueries({ queryKey: MOVIMIENTOS_KEY })
      broadcastInventarioUpdate()
      showToast('Producto actualizado', 'success')
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
        qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      }, 300)
      const { operatorId } = useAuthStore.getState()
      if (operatorId) authFetch('/api/admin/sync-embeddings', { method: 'POST' }).catch(() => {})
    },
  })
}

// ─── Mutation: borrar producto (hard delete con kardex) ────────────────────────
// Usa RPC que registra egreso del stock restante antes de borrar
export function useBorrarProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => llamarMutacionProducto('/api/productos/borrar', 'DELETE', {
      id,
    }, 'Error al borrar producto'),
    onSuccess: (_, id) => {
      // Remover optimísticamente del cache para respuesta inmediata en UI
      qc.cancelQueries({ queryKey: INVENTARIO_KEY })
      qc.setQueriesData({ queryKey: INVENTARIO_KEY }, (old) => {
        if (!old?.productos) return old
        return { ...old, productos: old.productos.filter(p => p.id !== id), totalCount: Math.max((old.totalCount ?? old.productos.length) - 1, 0) }
      })
      broadcastInventarioUpdate()
      showToast('Producto eliminado y registrado en kardex', 'success')
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
        qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      }, 300)
    },
    onError: (error) => {
      showToast(error.message || 'Error al borrar producto', 'error')
    },
  })
}

// ─── Mutation: desactivar producto (soft delete) ──────────────────────────────
export function useDesactivarProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, activo }) => {
      // Migrado a Worker/service_role: 06 revoca UPDATE de productos a authenticated.
      const res = await authFetch('/api/productos/metadatos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, activo }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Error ${res.status}`)
      }
    },
    onSuccess: (_, { id, activo }) => {
      qc.cancelQueries({ queryKey: INVENTARIO_KEY })
      qc.setQueriesData({ queryKey: INVENTARIO_KEY }, (old) => {
        if (!old?.productos) return old
        return {
          ...old,
          productos: old.productos.map(p => p.id === id ? { ...p, activo } : p)
        }
      })
      showToast(activo ? 'Producto activado' : 'Producto desactivado', 'success')
      setTimeout(() => qc.invalidateQueries({ queryKey: INVENTARIO_KEY }), 300)
    },
    onError: (error, { activo }) => {
      showToast(error.message || `Error al ${activo ? 'activar' : 'desactivar'} producto`, 'error')
    },
  })
}
