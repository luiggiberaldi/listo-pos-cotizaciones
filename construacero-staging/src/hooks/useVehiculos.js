// src/hooks/useVehiculos.js
// Queries y mutations para los vehículos de la flota propia (Fase 3 del plan de flota)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { showToast } from '../components/ui/Toast'

const KEY = ['vehiculos']

async function pedir(path, opciones = {}) {
  const headers = await getAuthHeaders()
  const res = await fetch(apiUrl(path), { headers, ...opciones })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(data.error || data.mensaje || `Error ${res.status}`)
  }
  return data
}

// ─── Lista de vehículos (activos o incluyendo inactivos) ─────────────────────
export function useVehiculos({ incluirInactivos = false } = {}) {
  return useQuery({
    queryKey: [...KEY, incluirInactivos ? 'todos' : 'activos'],
    queryFn: async () => {
      const data = await pedir(`/api/vehiculos/listar?incluir_inactivos=${incluirInactivos ? 'true' : 'false'}`)
      return data.vehiculos || []
    },
    staleTime: 1000 * 60,
  })
}

// ─── Crear vehículo ──────────────────────────────────────────────────────────
export function useCrearVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (campos) => pedir('/api/vehiculos/crear', {
      method: 'POST',
      body: JSON.stringify(campos),
    }),
    onSuccess: (data) => {
      showToast.success(`Vehículo ${data?.vehiculo?.codigo || ''} creado`)
      qc.invalidateQueries({ queryKey: KEY, exact: false })
    },
    onError: (e) => showToast.error(e.message || 'Error al crear vehículo'),
  })
}

// ─── Actualizar vehículo (edición y reactivación) ────────────────────────────
export function useActualizarVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...campos }) => pedir('/api/vehiculos/actualizar', {
      method: 'POST',
      body: JSON.stringify({ id, ...campos }),
    }),
    onSuccess: (data) => {
      showToast.success(`Vehículo ${data?.vehiculo?.codigo || ''} actualizado`)
      qc.invalidateQueries({ queryKey: KEY, exact: false })
    },
    onError: (e) => showToast.error(e.message || 'Error al actualizar vehículo'),
  })
}

// ─── Baja inteligente (borra sin historial, desactiva con historial) ─────────
// Devuelve el resultado de la RPC ({ accion, viajes_historicos,
// choferes_desvinculados, ... }) para que la vista muestre el mensaje exacto.
export function useEliminarVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const data = await pedir('/api/vehiculos/eliminar', {
        method: 'POST',
        body: JSON.stringify({ id }),
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY, exact: false })
      qc.invalidateQueries({ queryKey: ['transportistas'], exact: false })
    },
    onError: (e) => showToast.error(e.message || 'Error al dar de baja el vehículo'),
  })
}

// ─── Reporte gerencial de flota y choferes locales (Fase 4 del plan) ─────────
// Mismos roles que el reporte de transportistas (raíl R13: el supervisor no ve
// comisiones). Devuelve { por_vehiculo, por_chofer_local }.
const ROLES_REPORTE_FLOTA = ['jefe', 'administracion', 'logistica', 'desarrollador']

export function puedeVerReporteFlota(rol) {
  return ROLES_REPORTE_FLOTA.includes(rol)
}

export function useReporteFlota({ desde = null, hasta = null, rol = null, enabled = true } = {}) {
  return useQuery({
    queryKey: [...KEY, 'reporte', desde, hasta],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (desde) params.set('desde', desde)
      if (hasta) params.set('hasta', hasta)
      const qs = params.toString() ? `?${params}` : ''
      const data = await pedir(`/api/reportes/flota-choferes${qs}`)
      return {
        porVehiculo: Array.isArray(data.por_vehiculo) ? data.por_vehiculo : [],
        porChofer: Array.isArray(data.por_chofer_local) ? data.por_chofer_local : [],
        sinCamion: data.viajes_sin_camion || { viajes: 0, flete_usd: 0 },
      }
    },
    enabled: puedeVerReporteFlota(rol) && enabled,
    staleTime: 1000 * 60 * 2,
  })
}

// Detalle viaje por viaje (migración 286): de un camión, de todos, o solo los
// viajes de choferes locales sin camión registrado.
export function useDetalleViajesFlota({ desde = null, hasta = null, vehiculoId = null, sinCamion = false, rol = null, enabled = true } = {}) {
  return useQuery({
    queryKey: [...KEY, 'detalle', desde, hasta, vehiculoId, sinCamion],
    queryFn: () => cargarDetalleViajesFlota({ desde, hasta, vehiculoId, sinCamion }),
    enabled: puedeVerReporteFlota(rol) && enabled,
    staleTime: 1000 * 60 * 2,
  })
}

export async function cargarDetalleViajesFlota({ desde = null, hasta = null, vehiculoId = null, sinCamion = false } = {}) {
  const params = new URLSearchParams()
  if (desde) params.set('desde', desde)
  if (hasta) params.set('hasta', hasta)
  if (vehiculoId) params.set('vehiculo_id', vehiculoId)
  if (sinCamion) params.set('sin_camion', 'true')
  const data = await pedir(`/api/reportes/flota-viajes?${params}`)
  return Array.isArray(data.viajes) ? data.viajes : []
}

// Carga directa del reporte de flota (sin caché), para armar el PDF del botón "Reporte".
export async function cargarReporteFlota({ desde = null, hasta = null } = {}) {
  const params = new URLSearchParams()
  if (desde) params.set('desde', desde)
  if (hasta) params.set('hasta', hasta)
  const data = await pedir(`/api/reportes/flota-choferes${params.toString() ? `?${params}` : ''}`)
  return {
    porVehiculo: Array.isArray(data.por_vehiculo) ? data.por_vehiculo : [],
    porChofer: Array.isArray(data.por_chofer_local) ? data.por_chofer_local : [],
    sinCamion: data.viajes_sin_camion || { viajes: 0, flete_usd: 0 },
  }
}
