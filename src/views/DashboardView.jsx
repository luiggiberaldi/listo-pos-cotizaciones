// src/views/DashboardView.jsx
// Panel de inicio — resumen de actividad y métricas clave
import { useQuery } from '@tanstack/react-query'
import { LayoutDashboard, FileText, Users, DollarSign, TrendingUp, Clock } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import supabase     from '../services/supabase/client'
import { fmtUsd }   from '../utils/format'
import Skeleton     from '../components/ui/Skeleton'

// ─── Colores de estado ────────────────────────────────────────────────────────
const ESTADO_COLOR = {
  borrador:  { bg: 'bg-slate-100',   text: 'text-slate-600',   dot: 'bg-slate-400'   },
  enviada:   { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500'    },
  aceptada:  { bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  rechazada: { bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500'     },
  vencida:   { bg: 'bg-orange-50',   text: 'text-orange-700',  dot: 'bg-orange-500'  },
  anulada:   { bg: 'bg-slate-100',   text: 'text-slate-400',   dot: 'bg-slate-300'   },
}

const ESTADO_LABEL = {
  borrador: 'Borradores', enviada: 'Enviadas', aceptada: 'Aceptadas',
  rechazada: 'Rechazadas', vencida: 'Vencidas', anulada: 'Anuladas',
}

// ─── Hook de métricas ─────────────────────────────────────────────────────────
function useMetricas() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: ['dashboard_metricas', perfil?.id, esSupervisor],
    queryFn: async () => {
      const tabla = esSupervisor ? 'cotizaciones' : 'v_cotizaciones_vendedor'

      // Todas las cotizaciones del usuario (o todas si supervisor)
      let q = supabase.from(tabla).select('estado, total_usd, creado_en, vendedor_id')
      if (!esSupervisor) q = q.eq('vendedor_id', perfil.id)
      const { data: todas, error } = await q
      if (error) throw error

      const ahora     = new Date()
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString()
      const inicioMesAnt = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1).toISOString()
      const finMesAnt    = new Date(ahora.getFullYear(), ahora.getMonth(), 0, 23, 59, 59).toISOString()

      const delMes     = todas.filter(c => c.creado_en >= inicioMes)
      const delMesAnt  = todas.filter(c => c.creado_en >= inicioMesAnt && c.creado_en <= finMesAnt)

      // Conteo por estado (total histórico)
      const porEstado = {}
      todas.forEach(c => {
        if (!porEstado[c.estado]) porEstado[c.estado] = { count: 0, total: 0 }
        porEstado[c.estado].count  += 1
        porEstado[c.estado].total  += Number(c.total_usd || 0)
      })

      // Totales del mes actual
      const totalMesUsd = delMes
        .filter(c => c.estado !== 'anulada')
        .reduce((s, c) => s + Number(c.total_usd || 0), 0)

      const totalMesAntUsd = delMesAnt
        .filter(c => c.estado !== 'anulada')
        .reduce((s, c) => s + Number(c.total_usd || 0), 0)

      // Cotizaciones activas (enviadas) pendientes de respuesta
      const pendientesRespuesta = todas.filter(c => c.estado === 'enviada').length

      // Tasa de aceptación (aceptadas / (aceptadas + rechazadas))
      const aceptadas  = todas.filter(c => c.estado === 'aceptada').length
      const rechazadas = todas.filter(c => c.estado === 'rechazada').length
      const tasaAceptacion = (aceptadas + rechazadas) > 0
        ? Math.round((aceptadas / (aceptadas + rechazadas)) * 100)
        : null

      return {
        total:              todas.length,
        porEstado,
        totalMesUsd,
        totalMesAntUsd,
        delMesCount:        delMes.length,
        pendientesRespuesta,
        tasaAceptacion,
      }
    },
    enabled: !!perfil,
    staleTime: 2 * 60 * 1000,
  })
}

// ─── Tarjeta de métrica ───────────────────────────────────────────────────────
function MetricCard({ icon: Icon, label, value, sub, color = 'primary' }) {
  const colors = {
    primary: 'bg-primary-light text-primary',
    blue:    'bg-blue-100 text-blue-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    slate:   'bg-slate-100 text-slate-500',
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        <p className="text-2xl font-black text-slate-800 leading-tight">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function DashboardView() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const { data: m, isLoading } = useMetricas()

  const mesActual = new Date().toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })

  const variacionMes = m && m.totalMesAntUsd > 0
    ? Math.round(((m.totalMesUsd - m.totalMesAntUsd) / m.totalMesAntUsd) * 100)
    : null

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-screen-xl">

      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary-light rounded-xl flex items-center justify-center">
          <LayoutDashboard size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Inicio</h1>
          <p className="text-sm text-slate-500 capitalize">
            Bienvenido, {perfil?.nombre?.split(' ')[0] ?? 'usuario'} · {mesActual}
          </p>
        </div>
      </div>

      {/* Métricas principales */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4">
              <Skeleton className="w-11 h-11 rounded-xl shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-1/2 rounded" />
                <Skeleton className="h-6 w-2/3 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={FileText}
            label="Total cotizaciones"
            value={m?.total ?? 0}
            sub="histórico"
            color="primary"
          />
          <MetricCard
            icon={DollarSign}
            label={`Facturado en ${new Date().toLocaleDateString('es-VE',{month:'long'})}`}
            value={fmtUsd(m?.totalMesUsd ?? 0)}
            sub={variacionMes !== null
              ? `${variacionMes >= 0 ? '+' : ''}${variacionMes}% vs mes anterior`
              : 'Sin datos del mes anterior'}
            color="emerald"
          />
          <MetricCard
            icon={Clock}
            label="Esperando respuesta"
            value={m?.pendientesRespuesta ?? 0}
            sub="cotizaciones enviadas"
            color="blue"
          />
          <MetricCard
            icon={TrendingUp}
            label="Tasa de aceptación"
            value={m?.tasaAceptacion !== null ? `${m?.tasaAceptacion}%` : '—'}
            sub={m?.tasaAceptacion !== null ? 'aceptadas vs rechazadas' : 'sin datos suficientes'}
            color="primary"
          />
        </div>
      )}

      {/* Desglose por estado */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide">
          Cotizaciones por estado — histórico
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 flex-1 rounded" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {['enviada','borrador','aceptada','rechazada','vencida','anulada']
              .filter(e => m?.porEstado?.[e])
              .map(estado => {
                const { count, total } = m.porEstado[estado]
                const pct = m.total > 0 ? Math.round((count / m.total) * 100) : 0
                const col = ESTADO_COLOR[estado]
                return (
                  <div key={estado} className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${col.dot}`} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm text-slate-700">{ESTADO_LABEL[estado]}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">{fmtUsd(total)}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${col.bg} ${col.text}`}>
                            {count}
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${col.dot}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            {m?.total === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No hay cotizaciones aún.</p>
            )}
          </div>
        )}
      </div>

      {/* Actividad del mes */}
      {!isLoading && m && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-primary-light border border-primary-focus rounded-2xl p-5">
            <p className="text-xs font-bold text-primary-dark uppercase tracking-wide mb-1">Este mes</p>
            <p className="text-3xl font-black text-primary">{m.delMesCount}</p>
            <p className="text-sm text-primary-dark mt-1">cotizaciones generadas</p>
          </div>
          {esSupervisor && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <Users size={12} />
                Equipo de ventas
              </p>
              <p className="text-sm text-slate-600 mt-2">
                Revisa el módulo de <strong>Usuarios</strong> para gestionar el equipo y el módulo de <strong>Auditoría</strong> para ver toda la actividad.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
