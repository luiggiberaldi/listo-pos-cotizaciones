// src/components/ui/MetricCard.jsx
// Tarjeta de métrica con gradiente — reutilizable en dashboards
import { memo } from 'react'

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
  red: {
    bg:    'linear-gradient(135deg, #991b1b 0%, #dc2626 100%)',
    icon:  'rgba(255,255,255,0.15)',
    value: '#ffffff',
    label: 'rgba(255,255,255,0.65)',
    sub:   'rgba(255,255,255,0.45)',
    border:'rgba(255,255,255,0.1)',
  },
  purple: {
    bg:    'linear-gradient(135deg, #6b21a8 0%, #7c3aed 100%)',
    icon:  'rgba(255,255,255,0.15)',
    value: '#ffffff',
    label: 'rgba(255,255,255,0.65)',
    sub:   'rgba(255,255,255,0.45)',
    border:'rgba(255,255,255,0.1)',
  },
}

const MetricCard = memo(function MetricCard({ icon: Icon, label, value, sub, color = 'primary', onClick }) {
  const t = themes[color] ?? themes.primary
  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-3 sm:p-4 flex flex-col gap-2.5 sm:gap-3 ${onClick ? 'cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform' : ''}`}
      style={{ background: t.bg, border: `1px solid ${t.border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
      onClick={onClick}
    >
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

export default MetricCard
