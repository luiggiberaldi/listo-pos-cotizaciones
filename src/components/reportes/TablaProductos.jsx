// src/components/reportes/TablaProductos.jsx
import { useState } from 'react'
import { ShoppingBag, Layers } from 'lucide-react'
import { fmtUsd } from '../../utils/format'

function Barra({ pct, color = '#6366f1' }) {
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex-1 max-w-[100px]">
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max(pct, 2)}%`, background: color }} />
    </div>
  )
}

const CAT_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

function TabProductos({ data }) {
  if (data.length === 0) return <p className="text-sm text-slate-400 text-center py-6">Sin datos</p>
  const maxUsd = Math.max(...data.map(p => p.totalUsd), 1)

  return (
    <>
      {/* Desktop */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
              <th className="text-left px-4 py-2.5 font-semibold w-8">#</th>
              <th className="text-left px-4 py-2.5 font-semibold">Producto</th>
              <th className="text-center px-4 py-2.5 font-semibold w-20">Unidades</th>
              <th className="text-right px-4 py-2.5 font-semibold w-28">Monto USD</th>
              <th className="px-4 py-2.5 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {data.map((p, i) => (
              <tr key={p.id || p.nombre} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-4 py-3 text-slate-400 font-bold">{i + 1}</td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-700 truncate max-w-[250px]">{p.nombre}</p>
                  {p.codigo && <p className="text-xs text-slate-400 font-mono">{p.codigo}</p>}
                </td>
                <td className="px-4 py-3 text-center text-slate-600 font-medium">{Number(p.unidades).toLocaleString('es-VE')}</td>
                <td className="px-4 py-3 text-right font-bold text-slate-800">{fmtUsd(p.totalUsd)}</td>
                <td className="px-4 py-3"><Barra pct={(p.totalUsd / maxUsd) * 100} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <div className="sm:hidden divide-y divide-slate-100">
        {data.map((p, i) => (
          <div key={p.id || p.nombre} className="px-4 py-3 flex items-center gap-3">
            <span className="text-xs font-bold text-slate-400 w-5 shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-700 truncate">{p.nombre}</p>
              <p className="text-xs text-slate-400">{Number(p.unidades).toLocaleString('es-VE')} und</p>
            </div>
            <span className="text-sm font-bold text-slate-800 shrink-0">{fmtUsd(p.totalUsd)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function TabCategorias({ data }) {
  if (data.length === 0) return <p className="text-sm text-slate-400 text-center py-6">Sin datos</p>
  const maxUsd = Math.max(...data.map(c => c.totalUsd), 1)
  const totalGlobal = data.reduce((s, c) => s + c.totalUsd, 0)

  return (
    <div className="divide-y divide-slate-100">
      {data.map((c, i) => {
        const pctGlobal = totalGlobal > 0 ? (c.totalUsd / totalGlobal) * 100 : 0
        return (
          <div key={c.categoria} className="px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />
                <span className="text-sm font-semibold text-slate-700">{c.categoria}</span>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                  {pctGlobal.toFixed(1)}%
                </span>
              </div>
              <span className="text-sm font-bold text-slate-800">{fmtUsd(c.totalUsd)}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden flex-1">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(c.totalUsd / maxUsd) * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
              </div>
              <span className="text-xs text-slate-400 shrink-0 w-20 text-right">
                {Number(c.unidades).toLocaleString('es-VE')} und
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function TablaProductos({ porProducto = [], porCategoria = [] }) {
  const [tab, setTab] = useState('productos')

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingBag size={16} className="text-indigo-500" />
          <h3 className="text-sm font-black text-slate-800">Productos y categorías</h3>
        </div>
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => setTab('productos')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
              tab === 'productos' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
            }`}>
            Productos
          </button>
          <button onClick={() => setTab('categorias')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
              tab === 'categorias' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
            }`}>
            Categorías
          </button>
        </div>
      </div>
      {tab === 'productos' ? <TabProductos data={porProducto} /> : <TabCategorias data={porCategoria} />}
    </div>
  )
}
