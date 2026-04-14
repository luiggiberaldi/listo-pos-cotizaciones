// src/components/ui/PrecioDual.jsx
// Muestra un precio en USD y su equivalente en Bs
import { fmtBs, usdToBs } from '../../utils/format'

export default function PrecioDual({ usd, tasa, className = '', size = 'sm' }) {
  if (usd == null) return <span className="text-slate-400">—</span>

  const bs = usdToBs(usd, tasa)
  const formattedUsd = `$${Number(usd).toFixed(2)}`

  const sizes = {
    xs: { usd: 'text-xs font-semibold', bs: 'text-[10px]' },
    sm: { usd: 'text-sm font-bold', bs: 'text-[11px]' },
    base: { usd: 'text-base font-bold', bs: 'text-xs' },
    lg: { usd: 'text-lg font-bold', bs: 'text-sm' },
  }

  const s = sizes[size] || sizes.sm

  return (
    <div className={className}>
      <span className={`${s.usd} text-slate-800`}>{formattedUsd}</span>
      {tasa > 0 && (
        <div className={`${s.bs} text-slate-400`}>{fmtBs(bs)}</div>
      )}
    </div>
  )
}

// Versión inline para usar en texto corrido
export function PrecioDualInline({ usd, tasa, className = '' }) {
  if (usd == null) return <span className="text-slate-400">—</span>

  const bs = usdToBs(usd, tasa)
  const formattedUsd = `$${Number(usd).toFixed(2)}`

  return (
    <span className={className}>
      <span className="font-bold text-slate-800">{formattedUsd}</span>
      {tasa > 0 && (
        <span className="text-slate-400 ml-1 text-[11px]">({fmtBs(bs)})</span>
      )}
    </span>
  )
}
