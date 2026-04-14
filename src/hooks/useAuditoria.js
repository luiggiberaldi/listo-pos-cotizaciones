// src/hooks/useAuditoria.js
// Queries para el log de auditoría (solo supervisor)
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

const KEY = ['auditoria']

export function useAuditoria({ pagina = 0, porPagina = 50, usuarioId = '', categoria = '' } = {}) {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: [...KEY, pagina, usuarioId, categoria],
    queryFn: async () => {
      let q = supabase
        .from('auditoria')
        .select(`
          id, accion, descripcion, ts,
          categoria,
          entidad_tipo, entidad_id,
          usuario_nombre, usuario_rol,
          usuario:usuarios!auditoria_usuario_id_fkey(id, nombre, rol)
        `, { count: 'exact' })
        .order('ts', { ascending: false })
        .range(pagina * porPagina, (pagina + 1) * porPagina - 1)

      if (usuarioId) q = q.eq('usuario_id', usuarioId)
      // ENUM es uppercase en la BD
      if (categoria)  q = q.eq('categoria', categoria.toUpperCase())

      const { data, error, count } = await q
      if (error) throw error
      return { registros: data ?? [], total: count ?? 0 }
    },
    enabled: perfil?.rol === 'supervisor',
  })
}
