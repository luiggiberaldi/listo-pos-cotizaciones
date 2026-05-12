// src/components/reportes/TablaVendedores.jsx
import { Trophy } from 'lucide-react'
import { fmtUsd } from '../../utils/format'

function Barra({ pct, color }) {
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex-1 max-w-[120px]">
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max(pct, 2)}%`, background: color }} />
    </div>
  )
}

export default function TablaVendedores({ data = [] }) {
  if (data.length === 0) return null
  const maxUsd = Math.max(...data.map(v => v.totalUsd), 1)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Trophy size={16} className="text-amber-500" />
        <h3 className="text-sm font-black text-slate-800">Ventas por vendedor</h3>
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
              <th className="text-left px-4 py-2.5 font-semibold w-8">#</th>
              <th className="text-left px-4 py-2.5 font-semibold">Vendedor</th>
              <th className="text-center px-4 py-2.5 font-semibold w-20">Despachos</th>
              <th className="text-right px-4 py-2.5 font-semibold w-28">Total USD</th>
              <th className="text-right px-4 py-2.5 font-semibold w-28">Ticket prom.</th>
              <th className="text-right px-4 py-2.5 font-semibold w-24">Comisión</th>
              <th className="px-4 py-2.5 w-32"></th>
            </tr>
          </thead>
          <tbody>
            {data.map((v, i) => (
              <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-4 py-3 text-slate-400 font-bold">{i + 1}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0"
                      style={{ background: v.color }}>
                      {v.nombre[0].toUpperCase()}
                    </div>
                    <span className="font-semibold text-slate-700">{v.nombre}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center text-slate-600 font-medium">{v.despachos}</td>
                <td className="px-4 py-3 text-right font-bold text-slate-800">{fmtUsd(v.totalUsd)}</td>
                <td className="px-4 py-3 text-right text-slate-500">{fmtUsd(v.despachos > 0 ? v.totalUsd / v.despachos : 0)}</td>
                <td className="px-4 py-3 text-right text-emerald-600 font-semibold">{fmtUsd(v.comision)}</td>
                <td className="px-4 py-3"><Barra pct={(v.totalUsd / maxUsd) * 100} color={v.color} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-slate-100">
        {data.map((v, i) => (
          <div key={v.id} className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 w-5">{i + 1}</span>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black"
                  style={{ background: v.color }}>
                  {v.nombre[0].toUpperCase()}
                </div>
                <span className="text-sm font-bold text-slate-700">{v.nombre}</span>
              </div>
              <span className="text-sm font-black text-slate-800">{fmtUsd(v.totalUsd)}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 ml-12">
              <span>{v.despachos} despacho{v.despachos !== 1 ? 's' : ''}</span>
              <span>Comisión: <span className="text-emerald-600 font-semibold">{fmtUsd(v.comision)}</span></span>
            </div>
            <div className="ml-12"><Barra pct={(v.totalUsd / maxUsd) * 100} color={v.color} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}
