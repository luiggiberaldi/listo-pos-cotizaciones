// src/components/reportes/KpiCards.jsx
import { DollarSign, Package, TrendingUp, Percent } from 'lucide-react'
import { fmtUsd } from '../../utils/format'

function variacion(actual, anterior) {
  if (anterior === 0) return actual > 0 ? 100 : 0
  return ((actual - anterior) / anterior) * 100
}

function Badge({ pct }) {
  if (pct === 0) return null
  const positivo = pct > 0
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
      positivo ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
    }`}>
      {positivo ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function KpiCard({ icon: Icon, label, value, sub, badge, gradient, border }) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-3 sm:p-4 flex flex-col gap-2 sm:gap-2.5 min-w-0"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full pointer-events-none"
        style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-start gap-1.5 sm:gap-2 relative z-10 min-w-0">
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={14} className="text-white sm:w-4 sm:h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] sm:text-[11px] font-medium leading-tight" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</p>
          {badge && <div className="mt-0.5">{badge}</div>}
        </div>
      </div>
      <p className="text-xl sm:text-2xl font-black leading-tight text-white relative z-10">{value}</p>
      {sub && <p className="text-[10px] sm:text-[11px] relative z-10" style={{ color: 'rgba(255,255,255,0.4)' }}>{sub}</p>}
    </div>
  )
}

export default function KpiCards({ kpis }) {
  if (!kpis) return null

  const varVentas = variacion(kpis.totalVentas, kpis.prevTotalVentas)
  const varDespachos = variacion(kpis.numDespachos, kpis.prevNumDespachos)
  const varTicket = variacion(kpis.ticketPromedio, kpis.prevTicketPromedio)
  const varComisiones = variacion(kpis.totalComisiones, kpis.prevTotalComisiones)

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        icon={DollarSign} label="Ventas totales"
        value={fmtUsd(kpis.totalVentas)}
        sub={`Anterior: ${fmtUsd(kpis.prevTotalVentas)}`}
        badge={<Badge pct={varVentas} />}
        gradient="linear-gradient(135deg, #1B365D 0%, #0d1f3c 100%)"
        border="rgba(255,255,255,0.07)"
      />
      <KpiCard
        icon={Package} label="Despachos entregados"
        value={kpis.numDespachos}
        sub={`Anterior: ${kpis.prevNumDespachos}`}
        badge={<Badge pct={varDespachos} />}
        gradient="linear-gradient(135deg, #065f46 0%, #047857 100%)"
        border="rgba(255,255,255,0.10)"
      />
      <KpiCard
        icon={TrendingUp} label="Ticket promedio"
        value={fmtUsd(kpis.ticketPromedio)}
        sub={`Anterior: ${fmtUsd(kpis.prevTicketPromedio)}`}
        badge={<Badge pct={varTicket} />}
        gradient="linear-gradient(135deg, #92400e 0%, #B8860B 100%)"
        border="rgba(255,255,255,0.10)"
      />
      <KpiCard
        icon={Percent} label="Comisiones"
        value={fmtUsd(kpis.totalComisiones)}
        sub={`Anterior: ${fmtUsd(kpis.prevTotalComisiones)}`}
        badge={<Badge pct={varComisiones} />}
        gradient="linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)"
        border="rgba(255,255,255,0.10)"
      />
    </div>
  )
}
