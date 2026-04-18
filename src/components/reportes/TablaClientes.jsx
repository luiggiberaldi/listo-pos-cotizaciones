// src/components/reportes/TablaClientes.jsx
import { Users } from 'lucide-react'
import { fmtUsd } from '../../utils/format'

function Barra({ pct }) {
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex-1 max-w-[100px]">
      <div className="h-full rounded-full bg-indigo-400 transition-all duration-500"
        style={{ width: `${Math.max(pct, 2)}%` }} />
    </div>
  )
}

export default function TablaClientes({ data = [] }) {
  if (data.length === 0) return null
  const maxUsd = Math.max(...data.map(c => c.totalUsd), 1)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Users size={16} className="text-indigo-500" />
        <h3 className="text-sm font-black text-slate-800">Top 10 clientes</h3>
      </div>

      {/* Desktop */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
              <th className="text-left px-4 py-2.5 font-semibold w-8">#</th>
              <th className="text-left px-4 py-2.5 font-semibold">Cliente</th>
              <th className="text-center px-4 py-2.5 font-semibold w-20">Despachos</th>
              <th className="text-right px-4 py-2.5 font-semibold w-28">Total USD</th>
              <th className="px-4 py-2.5 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {data.map((c, i) => (
              <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-4 py-3 text-slate-400 font-bold">{i + 1}</td>
                <td className="px-4 py-3 font-semibold text-slate-700">{c.nombre}</td>
                <td className="px-4 py-3 text-center text-slate-600">{c.despachos}</td>
                <td className="px-4 py-3 text-right font-bold text-slate-800">{fmtUsd(c.totalUsd)}</td>
                <td className="px-4 py-3"><Barra pct={(c.totalUsd / maxUsd) * 100} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="sm:hidden divide-y divide-slate-100">
        {data.map((c, i) => (
          <div key={c.id} className="px-4 py-3 flex items-center gap-3">
            <span className="text-xs font-bold text-slate-400 w-5 shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-700 truncate">{c.nombre}</p>
              <p className="text-xs text-slate-400">{c.despachos} despacho{c.despachos !== 1 ? 's' : ''}</p>
            </div>
            <span className="text-sm font-bold text-slate-800 shrink-0">{fmtUsd(c.totalUsd)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
