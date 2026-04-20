// src/views/DashboardView.jsx
// Panel de inicio — resumen de actividad y métricas clave
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { memo, useMemo } from 'react'
import { LayoutDashboard, FileText, Users, DollarSign, TrendingUp, Clock, Plus, UserCog, ClipboardList, ArrowRight, Zap, Phone } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import supabase     from '../services/supabase/client'
import { fmtUsd, fmtBs, usdToBs } from '../utils/format'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useComisionesResumen } from '../hooks/useComisiones'
import { useTurnoAtencion } from '../hooks/useTurnoAtencion'
import Skeleton     from '../components/ui/Skeleton'
import PageHeader  from '../components/ui/PageHeader'
import OnboardingTip from '../components/ui/OnboardingTooltip'

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

      // Todas las cotizaciones del usuario (o todas si supervisor) — solo columnas necesarias
      let q = supabase.from(tabla).select('estado, total_usd, creado_en').limit(1000)
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
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Tarjeta de métrica ───────────────────────────────────────────────────────
const MetricCard = memo(function MetricCard({ icon: Icon, label, value, sub, color = 'primary' }) {
  const themes = {
    primary: {
      bg:    'linear-gradient(135deg, #1B365D 0%, #0d1f3c 100%)',
      icon:  'rgba(255,255,255,0.15)',
      value: '#ffffff',
      label: 'rgba(255,255,255,0.65)',
      sub:   'rgba(255,255,255,0.45)',
      border:'rgba(255,255,255,0.08)',
    },
    emerald: {
      bg:    'linear-gradient(135deg, #065f46 0%, #047857 100%)',
      icon:  'rgba(255,255,255,0.15)',
      value: '#ffffff',
      label: 'rgba(255,255,255,0.65)',
      sub:   'rgba(255,255,255,0.45)',
      border:'rgba(255,255,255,0.1)',
    },
    blue: {
      bg:    'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)',
      icon:  'rgba(255,255,255,0.15)',
      value: '#ffffff',
      label: 'rgba(255,255,255,0.65)',
      sub:   'rgba(255,255,255,0.45)',
      border:'rgba(255,255,255,0.1)',
    },
    gold: {
      bg:    'linear-gradient(135deg, #92400e 0%, #B8860B 100%)',
      icon:  'rgba(255,255,255,0.15)',
      value: '#ffffff',
      label: 'rgba(255,255,255,0.65)',
      sub:   'rgba(255,255,255,0.45)',
      border:'rgba(255,255,255,0.1)',
    },
  }
  const t = themes[color] ?? themes.primary
  return (
    <div className="relative overflow-hidden rounded-2xl p-3 sm:p-4 flex flex-col gap-2.5 sm:gap-3"
      style={{ background: t.bg, border: `1px solid ${t.border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
      {/* Orbe decorativo */}
      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full pointer-events-none"
        style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-center gap-2 sm:gap-2.5 relative z-10">
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: t.icon }}>
          <Icon size={16} className="sm:w-[18px] sm:h-[18px]" style={{ color: 'white' }} />
        </div>
        <p className="text-xs font-medium leading-tight" style={{ color: t.label }}>{label}</p>
      </div>
      <div className="relative z-10">
        <p className="text-2xl font-black leading-tight" style={{ color: t.value }}>{value}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: t.sub }}>{sub}</p>}
      </div>
    </div>
  )
})

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function DashboardView() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const { data: m, isLoading } = useMetricas()
  const { data: comResumen } = useComisionesResumen()
  const { tasaEfectiva } = useTasaCambio()
  const { vendedorHoy, calendario, esDomingo } = useTurnoAtencion()
  const navigate = useNavigate()

  const mesActual = new Date().toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })

  const variacionMes = useMemo(() => m && m.totalMesAntUsd > 0
    ? Math.round(((m.totalMesUsd - m.totalMesAntUsd) / m.totalMesAntUsd) * 100)
    : null, [m?.totalMesUsd, m?.totalMesAntUsd])

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">

      {/* Tip de onboarding */}
      <OnboardingTip tipId="dashboard_intro">
        ¡Bienvenido! Usa el botón <strong>"Rápida"</strong> para crear cotizaciones al instante, o <strong>"Nueva"</strong> para el asistente paso a paso. En móvil, el botón dorado flotante ⚡ te lleva directo a cotizar.
      </OnboardingTip>

      {/* Encabezado */}
      <PageHeader
        icon={LayoutDashboard}
        title="Inicio"
        subtitle={`Bienvenido, ${perfil?.nombre?.split(' ')[0] ?? 'usuario'} · ${mesActual}`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/cotizaciones?rapida=1')} className="flex items-center gap-1.5 font-bold text-sm px-4 py-2.5 rounded-xl transition-all active:scale-[0.98] border-2 border-slate-300 text-slate-700 bg-white hover:bg-slate-50 shadow-sm">
              <Zap size={14} className="text-amber-600" />
              <span>Rápida</span>
            </button>
            <button onClick={() => navigate('/cotizaciones?nueva=1')} className="flex items-center gap-2 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              <Plus size={16} strokeWidth={2.5} />Nueva
            </button>
          </div>
        }
      />

      {/* Métricas principales */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
                <Skeleton className="h-3 w-2/3 rounded" />
              </div>
              <Skeleton className="h-6 w-1/2 rounded" />
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
            sub={tasaEfectiva > 0
              ? fmtBs(usdToBs(m?.totalMesUsd ?? 0, tasaEfectiva))
              : variacionMes !== null
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
            color="gold"
          />
        </div>
      )}

      {/* Turno de atención */}
      {vendedorHoy && !esDomingo && calendario.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
              <Phone size={14} />Turno de Atención
            </h2>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
              style={{ background: (vendedorHoy.color || '#1B365D') + '18', color: vendedorHoy.color || '#1B365D' }}>
              Hoy
            </span>
          </div>

          {/* Vendedor de turno */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0"
              style={{ background: vendedorHoy.color || '#1B365D' }}>
              {vendedorHoy.nombre.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-lg font-black text-slate-800 leading-tight">{vendedorHoy.nombre}</p>
              <p className="text-xs text-slate-400">Atención de llamadas y mensajes</p>
            </div>
          </div>

          {/* Calendario semanal */}
          <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
            {calendario.map(dia => {
              const iniciales = dia.vendedor
                ? dia.vendedor.nombre.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
                : '—'
              const nombre = dia.vendedor?.nombre?.split(' ')[0] ?? ''
              const color = dia.vendedor?.color || '#1B365D'
              return (
                <div key={dia.fecha.toISOString()} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-400 tracking-wide">
                    {dia.diaSemana.replace('.', '')}
                  </span>
                  <div className={`w-full aspect-square max-w-[48px] rounded-xl flex items-center justify-center font-black text-sm transition-all ${dia.esHoy ? 'shadow-lg scale-105' : ''}`}
                    style={dia.esHoy
                      ? { background: color, color: '#fff', boxShadow: `0 4px 12px ${color}40` }
                      : { background: '#f1f5f9', color: '#64748b' }
                    }>
                    {iniciales}
                  </div>
                  <span className={`text-[10px] leading-tight text-center truncate w-full ${dia.esHoy ? 'font-bold text-slate-700' : 'text-slate-400'}`}>
                    {nombre}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Mensaje de domingo */}
      {esDomingo && (
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
            <Phone size={18} className="text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500">Día de descanso</p>
            <p className="text-xs text-slate-400">Hoy domingo no hay turno de atención asignado</p>
          </div>
        </div>
      )}

      {/* Desglose por estado */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide">
          Cotizaciones por estado — histórico
        </h2>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-3 w-3 rounded-full" />
                  <Skeleton className="h-3 flex-1 rounded" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-2.5 w-full rounded-full ml-6" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {['enviada','borrador','aceptada','rechazada','vencida','anulada']
              .filter(e => m?.porEstado?.[e])
              .map(estado => {
                const { count, total } = m.porEstado[estado]
                const pct = m.total > 0 ? Math.round((count / m.total) * 100) : 0
                const col = ESTADO_COLOR[estado]
                // Gradientes por estado
                const gradients = {
                  aceptada:  'linear-gradient(90deg, #10b981, #059669)',
                  enviada:   'linear-gradient(90deg, #3b82f6, #2563eb)',
                  borrador:  'linear-gradient(90deg, #94a3b8, #64748b)',
                  rechazada: 'linear-gradient(90deg, #ef4444, #dc2626)',
                  vencida:   'linear-gradient(90deg, #f97316, #ea580c)',
                  anulada:   'linear-gradient(90deg, #cbd5e1, #94a3b8)',
                }
                return (
                  <div key={estado}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${col.dot}`} />
                        <span className="text-sm font-medium text-slate-700">{ESTADO_LABEL[estado]}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${col.bg} ${col.text}`}>{count}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
                        <span className="truncate max-w-[100px] sm:max-w-none">{fmtUsd(total)}{tasaEfectiva > 0 && <span className="ml-1 text-slate-300 hidden sm:inline">({fmtBs(usdToBs(total, tasaEfectiva))})</span>}</span>
                        <span className="font-semibold text-slate-500 w-8 text-right">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: gradients[estado] ?? gradients.borrador }} />
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

      {/* Actividad del mes + accesos rápidos */}
      {!isLoading && m && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Este mes */}
          <div className="relative overflow-hidden rounded-2xl p-5"
            style={{ background: 'linear-gradient(135deg, #1B365D 0%, #0d1f3c 100%)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="absolute -bottom-4 -right-4 w-24 h-24 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>Este mes</p>
            <p className="text-4xl font-black text-white leading-none">{m.delMesCount}</p>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>cotizaciones generadas</p>
            {variacionMes !== null && (
              <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{
                  background: variacionMes >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                  color: variacionMes >= 0 ? '#34d399' : '#f87171',
                }}>
                {variacionMes >= 0 ? '↑' : '↓'} {Math.abs(variacionMes)}% vs mes anterior
              </div>
            )}
          </div>

          {/* Accesos rápidos (supervisor) / info simple (vendedor) */}
          {esSupervisor ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Users size={12} />Accesos rápidos
              </p>
              <button onClick={() => navigate('/usuarios')}
                className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all group/btn hover:shadow-md"
                style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.06), rgba(184,134,11,0.06))', border: '1px solid rgba(27,54,93,0.12)' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                    <UserCog size={13} className="text-white" />
                  </div>
                  <span className="text-slate-700">Gestionar usuarios</span>
                </div>
                <ArrowRight size={14} className="text-slate-400 group-hover/btn:translate-x-0.5 transition-transform" />
              </button>
              <button onClick={() => navigate('/auditoria')}
                className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all group/btn hover:shadow-md"
                style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.06), rgba(184,134,11,0.06))', border: '1px solid rgba(27,54,93,0.12)' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                    <ClipboardList size={13} className="text-white" />
                  </div>
                  <span className="text-slate-700">Ver auditoría</span>
                </div>
                <ArrowRight size={14} className="text-slate-400 group-hover/btn:translate-x-0.5 transition-transform" />
              </button>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex items-center justify-center">
              <p className="text-sm text-slate-400 text-center">Contacta a tu supervisor para ver más detalles del equipo.</p>
            </div>
          )}
        </div>
      )}

      {/* Resumen de comisiones */}
      {!isLoading && comResumen && comResumen.total > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
              <DollarSign size={14} />Comisiones
            </h2>
            <button onClick={() => navigate('/comisiones')}
              className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1 transition-colors">
              Ver todas <ArrowRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 font-medium">Acumulado</p>
              <p className="text-lg font-black text-slate-800">{fmtUsd(comResumen.total)}</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-3">
              <p className="text-xs text-amber-600 font-medium">Pendiente</p>
              <p className="text-lg font-black text-amber-700">{fmtUsd(comResumen.pendiente)}</p>
              <p className="text-xs text-amber-500">{comResumen.countPendiente} por pagar</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-3">
              <p className="text-xs text-emerald-600 font-medium">Pagado</p>
              <p className="text-lg font-black text-emerald-700">{fmtUsd(comResumen.pagado)}</p>
              <p className="text-xs text-emerald-500">{comResumen.countPagado} pagadas</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
