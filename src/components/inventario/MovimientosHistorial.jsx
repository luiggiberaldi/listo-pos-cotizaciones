// src/components/inventario/MovimientosHistorial.jsx
// Historial de movimientos de inventario (ingreso/egreso)
import { useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Clock, Package, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMovimientosInventario } from '../../hooks/useMovimientosInventario'

const PAGE_SIZE = 20

export default function MovimientosHistorial() {
  const [page, setPage] = useState(0)
  const [filtroTipo, setFiltroTipo] = useState('')

  const { data, isLoading } = useMovimientosInventario({ page, pageSize: PAGE_SIZE, tipo: filtroTipo })
  const movimientos = data?.movimientos ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  function formatFecha(ts) {
    return new Date(ts).toLocaleString('es-VE', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // Agrupar movimientos por lote_id para visual
  const lotes = []
  const loteMap = new Map()
  movimientos.forEach(m => {
    if (!loteMap.has(m.lote_id)) {
      const lote = { id: m.lote_id, tipo: m.tipo, motivo: m.motivo, usuario: m.usuario_nombre, fecha: m.creado_en, items: [] }
      loteMap.set(m.lote_id, lote)
      lotes.push(lote)
    }
    loteMap.get(m.lote_id).items.push(m)
  })

  return (
    <div className="space-y-4">
      {/* Filtro por tipo */}
      <div className="flex items-center gap-2">
        {['', 'ingreso', 'egreso'].map(t => (
          <button key={t} onClick={() => { setFiltroTipo(t); setPage(0) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filtroTipo === t
                ? t === 'ingreso' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                  : t === 'egreso' ? 'bg-red-100 text-red-700 border border-red-200'
                  : 'bg-sky-100 text-sky-700 border border-sky-200'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 border border-transparent'
            }`}>
            {t === '' ? 'Todos' : t === 'ingreso' ? 'Ingresos' : 'Egresos'}
          </button>
        ))}
        <span className="text-xs text-slate-400 ml-auto">{total} movimiento{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Lista de lotes */}
      {isLoading ? (
        <div className="text-center py-16">
          <div className="w-6 h-6 border-[3px] border-sky-300 border-t-sky-500 rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-400 mt-3">Cargando movimientos…</p>
        </div>
      ) : lotes.length === 0 ? (
        <div className="text-center py-16">
          <Package size={36} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-bold text-slate-400">Sin movimientos registrados</p>
          <p className="text-xs text-slate-300 mt-1">Los ingresos y egresos aparecerán aquí</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lotes.map(lote => {
            const esIngreso = lote.tipo === 'ingreso'
            return (
              <div key={lote.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {/* Header del lote */}
                <div className={`flex items-center gap-3 px-4 py-2.5 ${esIngreso ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    esIngreso ? 'bg-emerald-100' : 'bg-red-100'
                  }`}>
                    {esIngreso
                      ? <ArrowDownToLine size={14} className="text-emerald-600" />
                      : <ArrowUpFromLine size={14} className="text-red-600" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        esIngreso ? 'bg-emerald-200/60 text-emerald-700' : 'bg-red-200/60 text-red-700'
                      }`}>
                        {esIngreso ? 'INGRESO' : 'EGRESO'}
                      </span>
                      <span className="text-xs text-slate-400 truncate">{lote.motivo}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Clock size={10} className="text-slate-300" />
                      <span className="text-[10px] text-slate-400">{formatFecha(lote.fecha)}</span>
                      <span className="text-[10px] text-slate-300">·</span>
                      <span className="text-[10px] text-slate-400">{lote.usuario}</span>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-slate-400">{lote.items.length} item{lote.items.length > 1 ? 's' : ''}</span>
                </div>

                {/* Items del lote */}
                <div className="divide-y divide-slate-50">
                  {lote.items.map(m => (
                    <div key={m.id} className="flex items-center gap-3 px-4 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{m.producto_nombre}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-sm font-bold ${esIngreso ? 'text-emerald-600' : 'text-red-600'}`}>
                          {esIngreso ? '+' : '-'}{m.cantidad}
                        </span>
                        <p className="text-[10px] text-slate-400">
                          {m.stock_anterior} → {m.stock_nuevo}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 disabled:opacity-30 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-medium text-slate-500">
            {page + 1} de {totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 disabled:opacity-30 transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
