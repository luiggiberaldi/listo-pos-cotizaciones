// src/components/clientes/FichaClienteModal.jsx
// Modal ficha del cliente: historial de crédito + formulario de abono
import { useState } from 'react'
import { X, CreditCard, ArrowUpCircle, ArrowDownCircle, AlertCircle, RefreshCw, DollarSign, Hash, Phone } from 'lucide-react'
import { useCuentasCobrar, useRegistrarAbono } from '../../hooks/useCuentasCobrar'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'

function fmtFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}

// ─── Formulario de abono ────────────────────────────────────────────────────
function FormAbono({ clienteId, onSuccess }) {
  const [monto, setMonto] = useState('')
  const [formaPago, setFormaPago] = useState('Efectivo')
  const [referencia, setReferencia] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const registrar = useRegistrarAbono()

  async function handleSubmit(e) {
    e.preventDefault()
    const montoNum = parseFloat(monto)
    if (!montoNum || montoNum <= 0) return
    await registrar.mutateAsync({
      clienteId,
      monto: montoNum,
      formaPago,
      referencia,
      descripcion: descripcion || 'Abono recibido',
    })
    setMonto('')
    setReferencia('')
    setDescripcion('')
    onSuccess?.()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-black text-emerald-800 flex items-center gap-2">
        <ArrowDownCircle size={15} className="text-emerald-600" />
        Registrar abono
      </h4>

      <div className="grid grid-cols-2 gap-3">
        {/* Monto */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Monto USD *</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={monto}
            onChange={e => setMonto(e.target.value)}
            placeholder="0.00"
            required
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
        </div>

        {/* Forma de pago */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Forma de pago</label>
          <select
            value={formaPago}
            onChange={e => setFormaPago(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            {['Efectivo', 'Zelle', 'Pago Móvil', 'USDT', 'Transferencia'].map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Referencia */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Referencia (opcional)</label>
        <input
          type="text"
          value={referencia}
          onChange={e => setReferencia(e.target.value)}
          placeholder="Nº de confirmación, comprobante..."
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
        />
      </div>

      {/* Descripción */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción (opcional)</label>
        <input
          type="text"
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          placeholder="Ej: Pago parcial factura #123"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
        />
      </div>

      <button
        type="submit"
        disabled={registrar.isPending || !monto}
        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors"
      >
        {registrar.isPending ? 'Registrando...' : 'Confirmar abono'}
      </button>
    </form>
  )
}

// ─── Modal principal ─────────────────────────────────────────────────────────
export default function FichaClienteModal({ cliente, isOpen, onClose }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const { data: movimientos = [], isLoading, refetch } = useCuentasCobrar(isOpen ? cliente?.id : null)

  if (!isOpen || !cliente) return null

  const saldo = Number(cliente.saldo_pendiente || 0)
  const color = cliente.vendedor?.color || '#64748b'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="relative px-5 py-4 shrink-0" style={{ background: `linear-gradient(135deg, ${color}dd, ${color}88)` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
                style={{ background: 'rgba(255,255,255,0.25)', color: 'white', border: '2px solid rgba(255,255,255,0.4)' }}>
                {cliente.nombre?.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 className="font-black text-white text-base leading-tight truncate">{cliente.nombre}</h2>
                <div className="flex items-center gap-3 mt-0.5">
                  {cliente.rif_cedula && (
                    <span className="flex items-center gap-1 text-xs text-white/70"><Hash size={10} />{cliente.rif_cedula}</span>
                  )}
                  {cliente.telefono && (
                    <span className="flex items-center gap-1 text-xs text-white/70"><Phone size={10} />{cliente.telefono}</span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors shrink-0">
              <X size={16} className="text-white" />
            </button>
          </div>

          {/* Saldo */}
          <div className={`mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-black ${
            saldo > 0 ? 'bg-red-500/30 text-white border border-red-300/40' : 'bg-white/20 text-white border border-white/30'
          }`}>
            {saldo > 0 ? <AlertCircle size={14} /> : <DollarSign size={14} />}
            {saldo > 0 ? `Deuda: ${fmtUsd(saldo)}` : 'Sin deuda pendiente'}
          </div>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Formulario abono (solo supervisor si hay deuda) */}
          {esSupervisor && saldo > 0 && (
            <FormAbono clienteId={cliente.id} onSuccess={refetch} />
          )}

          {/* Historial */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                <CreditCard size={14} className="text-slate-500" />
                Historial de cuenta
              </h3>
              <button onClick={refetch} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => (
                  <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : movimientos.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <CreditCard size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Sin movimientos registrados</p>
              </div>
            ) : (
              <div className="space-y-2">
                {movimientos.map(mov => (
                  <div key={mov.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${
                    mov.tipo === 'cargo'
                      ? 'bg-red-50 border-red-100'
                      : 'bg-emerald-50 border-emerald-100'
                  }`}>
                    {mov.tipo === 'cargo'
                      ? <ArrowUpCircle size={18} className="text-red-500 shrink-0" />
                      : <ArrowDownCircle size={18} className="text-emerald-500 shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{mov.descripcion}</p>
                      <p className="text-[10px] text-slate-400">{fmtFecha(mov.creado_en)}</p>
                      {mov.referencia && (
                        <p className="text-[10px] text-slate-400">Ref: {mov.referencia}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-black ${mov.tipo === 'cargo' ? 'text-red-600' : 'text-emerald-600'}`}>
                        {mov.tipo === 'cargo' ? '+' : '-'}{fmtUsd(mov.monto_usd)}
                      </p>
                      <p className="text-[10px] text-slate-400">Saldo: {fmtUsd(mov.saldo_usd)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
