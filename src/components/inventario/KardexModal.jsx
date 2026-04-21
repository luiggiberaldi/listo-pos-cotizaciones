// src/components/inventario/KardexModal.jsx
// Kardex — historial completo de movimientos de un producto
import { Modal } from '../ui/Modal'
import { ArrowDownToLine, ArrowUpFromLine, Clock, Package, Hash } from 'lucide-react'
import { useKardex } from '../../hooks/useMovimientosInventario'

function formatFecha(ts) {
  return new Date(ts).toLocaleString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function KardexModal({ isOpen, onClose, producto }) {
  const { data: movimientos = [], isLoading } = useKardex(producto?.id)

  if (!producto) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Kardex" className="max-w-lg sm:max-w-2xl">
      <div className="space-y-4">

        {/* Encabezado del producto */}
        <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
          <div className="w-10 h-10 rounded-lg bg-sky-100 flex items-center justify-center shrink-0 overflow-hidden">
            {producto.imagen_url
              ? <img src={producto.imagen_url} alt="" className="w-full h-full object-cover rounded-lg" />
              : <Package size={18} className="text-sky-500" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-slate-800 truncate">{producto.nombre}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              {producto.codigo && (
                <span className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                  <Hash size={9} />{producto.codigo}
                </span>
              )}
              <span className="text-[11px] text-slate-400">Stock actual: <span className="font-bold text-slate-600">{Number(producto.stock_actual).toLocaleString('es-VE')} {producto.unidad}</span></span>
            </div>
          </div>
        </div>

        {/* Tabla de movimientos */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-6 h-6 border-[3px] border-sky-300 border-t-sky-500 rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-400 mt-3">Cargando kardex…</p>
          </div>
        ) : movimientos.length === 0 ? (
          <div className="text-center py-12">
            <Package size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-bold text-slate-400">Sin movimientos</p>
            <p className="text-xs text-slate-300 mt-1">Este producto no tiene ingresos ni egresos registrados</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_80px_80px_80px] sm:grid-cols-[1fr_80px_80px_80px_1fr] gap-1 px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              <span>Fecha</span>
              <span className="text-center">Tipo</span>
              <span className="text-right">Cantidad</span>
              <span className="text-right">Saldo</span>
              <span className="hidden sm:block">Motivo</span>
            </div>

            {/* Filas */}
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar divide-y divide-slate-50">
              {movimientos.map(m => {
                const esIngreso = m.tipo === 'ingreso'
                return (
                  <div key={m.id} className="grid grid-cols-[1fr_80px_80px_80px] sm:grid-cols-[1fr_80px_80px_80px_1fr] gap-1 px-3 py-2.5 hover:bg-slate-50/50 transition-colors items-center">
                    {/* Fecha */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Clock size={10} className="text-slate-300 shrink-0" />
                        <span className="text-[11px] text-slate-500 truncate">{formatFecha(m.creado_en)}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 ml-4 block truncate">{m.usuario_nombre}</span>
                    </div>

                    {/* Tipo */}
                    <div className="flex justify-center">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        esIngreso ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {esIngreso
                          ? <ArrowDownToLine size={9} />
                          : <ArrowUpFromLine size={9} />
                        }
                        {esIngreso ? 'Ing' : 'Egr'}
                      </span>
                    </div>

                    {/* Cantidad */}
                    <span className={`text-sm font-bold text-right ${esIngreso ? 'text-emerald-600' : 'text-red-600'}`}>
                      {esIngreso ? '+' : '-'}{Number(m.cantidad).toLocaleString('es-VE')}
                    </span>

                    {/* Saldo */}
                    <span className="text-sm font-bold text-slate-700 text-right">
                      {Number(m.stock_nuevo).toLocaleString('es-VE')}
                    </span>

                    {/* Motivo */}
                    <span className="hidden sm:block text-[11px] text-slate-400 truncate">{m.motivo}</span>
                  </div>
                )
              })}
            </div>

            {/* Resumen */}
            <div className="border-t border-slate-200 px-3 py-2.5 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">{movimientos.length} movimiento{movimientos.length !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-4">
                <span className="text-[11px] text-emerald-600 font-bold">
                  + {movimientos.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.cantidad), 0).toLocaleString('es-VE')} ingresos
                </span>
                <span className="text-[11px] text-red-600 font-bold">
                  - {movimientos.filter(m => m.tipo === 'egreso').reduce((s, m) => s + Number(m.cantidad), 0).toLocaleString('es-VE')} egresos
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
