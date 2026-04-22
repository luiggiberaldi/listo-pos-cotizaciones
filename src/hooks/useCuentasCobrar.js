// src/hooks/useCuentasCobrar.js
// Queries y mutations para el sistema de cuentas por cobrar
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { CLIENTES_KEY } from './useClientes'
import { showToast } from '../components/ui/Toast'

export const CXC_KEY = ['cuentas-cobrar']

// ─── Historial CxC de un cliente ──────────────────────────────────────────
export function useCuentasCobrar(clienteId) {
  return useQuery({
    queryKey: [...CXC_KEY, clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cuentas_por_cobrar')
        .select(`
          id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion,
          registrado_por, creado_en
        `)
        .eq('cliente_id', clienteId)
        .order('creado_en', { ascending: false })
        .limit(100)

      if (error) throw error
      return data ?? []
    },
    enabled: !!clienteId,
    staleTime: 1000 * 60 * 2,
  })
}

// ─── Resumen global CxC (para reporte) ────────────────────────────────────
export function useResumenCxC() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...CXC_KEY, 'resumen', esSupervisor, perfil?.id],
    queryFn: async () => {
      // Obtener clientes con saldo pendiente > 0
      let query = supabase
        .from('clientes')
        .select(`
          id, nombre, rif_cedula, telefono,
          saldo_pendiente,
          vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre, color)
        `)
        .gt('saldo_pendiente', 0)
        .eq('activo', true)
        .order('saldo_pendiente', { ascending: false })

      if (!esSupervisor) query = query.eq('vendedor_id', perfil.id)

      const { data: clientesConDeuda, error } = await query
      if (error) throw error

      const clientes = clientesConDeuda ?? []
      const totalDeuda = clientes.reduce((s, c) => s + Number(c.saldo_pendiente || 0), 0)

      // Obtener transacciones recientes para aging
      const clienteIds = clientes.map(c => c.id)
      let cargos = []
      if (clienteIds.length > 0) {
        for (let i = 0; i < clienteIds.length; i += 50) {
          const batch = clienteIds.slice(i, i + 50)
          const { data } = await supabase
            .from('cuentas_por_cobrar')
            .select('id, cliente_id, monto_usd, saldo_usd, creado_en')
            .eq('tipo', 'cargo')
            .in('cliente_id', batch)
            .order('creado_en', { ascending: false })
          cargos = cargos.concat(data ?? [])
        }
      }

      // Aging por rangos
      const now = new Date()
      const aging = [
        { rango: '0 – 30 días', count: 0, totalUsd: 0 },
        { rango: '31 – 60 días', count: 0, totalUsd: 0 },
        { rango: '61 – 90 días', count: 0, totalUsd: 0 },
        { rango: '90+ días', count: 0, totalUsd: 0 },
      ]

      // Deduplicar por despacho (tomar solo cargos sin abono completo)
      const cargosPorCliente = {}
      cargos.forEach(c => {
        if (!cargosPorCliente[c.cliente_id]) cargosPorCliente[c.cliente_id] = []
        cargosPorCliente[c.cliente_id].push(c)
      })

      cargos.forEach(c => {
        const dias = Math.floor((now - new Date(c.creado_en)) / (1000 * 60 * 60 * 24))
        const bucket = dias <= 30 ? 0 : dias <= 60 ? 1 : dias <= 90 ? 2 : 3
        aging[bucket].count++
        aging[bucket].totalUsd += Number(c.monto_usd || 0)
      })

      // Deuda más antigua
      const cargoMasAntiguo = cargos.length > 0
        ? cargos.reduce((oldest, c) => new Date(c.creado_en) < new Date(oldest.creado_en) ? c : oldest)
        : null

      const diasMasAntiguo = cargoMasAntiguo
        ? Math.floor((now - new Date(cargoMasAntiguo.creado_en)) / (1000 * 60 * 60 * 24))
        : 0

      return {
        kpis: {
          totalDeuda,
          numClientesConDeuda: clientes.length,
          diasMasAntiguo,
          numCargos: cargos.length,
        },
        clientesConDeuda: clientes,
        aging,
      }
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 3,
  })
}

// ─── Registrar abono (pago del cliente, via Worker API) ─────────────────────
export function useRegistrarAbono() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ clienteId, monto, formaPago, referencia, descripcion }) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/cxc/abono'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ clienteId, monto, formaPago: formaPago || null, referencia: referencia || null, descripcion: descripcion || 'Abono recibido' }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al registrar abono')
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      showToast('Abono registrado exitosamente', 'success')
    },
  })
}
