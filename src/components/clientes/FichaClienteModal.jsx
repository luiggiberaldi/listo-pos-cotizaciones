// src/components/clientes/FichaClienteModal.jsx
// Modal ficha del cliente: historial de crédito + formulario de abono
import { useState, useEffect } from 'react'
import { X, CreditCard, ArrowUpCircle, ArrowDownCircle, AlertCircle, RefreshCw, DollarSign, Hash, Phone, FileText, ChevronRight } from 'lucide-react'
import { useCuentasCobrar, useRegistrarAbono } from '../../hooks/useCuentasCobrar'
import { useCotizacionesCliente } from '../../hooks/useClientes'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import EstadoBadge from '../cotizaciones/EstadoBadge'

function fmtFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}

const METODOS = ['Efectivo', 'Zelle', 'Pago Móvil', 'Punto de Venta', 'USDT', 'Transferencia']

function FormAbono({ clienteId, saldo, onSuccess }) {
  // Cada línea de pago: { metodo, monto, referencia }
  const [lineas, setLineas] = useState([{ metodo: 'Efectivo', monto: '', referencia: '' }])
  const [descripcion, setDescripcion] = useState('')
  const registrar = useRegistrarAbono()

  // Total acumulado de todas las líneas
  const totalIngresado = lineas.reduce((acc, l) => acc + (parseFloat(l.monto) || 0), 0)
  const excede = saldo > 0 && totalIngresado > saldo + 0.001
  const sinMonto = totalIngresado <= 0

  function actualizarLinea(idx, campo, valor) {
    setLineas(prev => prev.map((l, i) => i === idx ? { ...l, [campo]: valor } : l))
  }

  function agregarLinea() {
    setLineas(prev => [...prev, { metodo: 'Efectivo', monto: '', referencia: '' }])
  }

  function quitarLinea(idx) {
    setLineas(prev => prev.filter((_, i) => i !== idx))
  }

  function ponerTotal() {
    if (lineas.length === 1) {
      setLineas([{ ...lineas[0], monto: saldo.toFixed(2) }])
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (excede || sinMonto) return

    // Enviar como JSON array de formas de pago (igual que despachos)
    const formasPagoJson = JSON.stringify(lineas.map(l => ({
      metodo: l.metodo,
      monto: parseFloat(l.monto) || 0,
      referencia: l.referencia || '',
    })))

    await registrar.mutateAsync({
      clienteId,
      monto: totalIngresado,
      formaPago: formasPagoJson,
      referencia: lineas[0]?.referencia || '',
      descripcion: descripcion || 'Abono recibido',
    })
    setLineas([{ metodo: 'Efectivo', monto: '', referencia: '' }])
    setDescripcion('')
    onSuccess?.(totalIngresado)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-black text-emerald-800 flex items-center gap-2">
        <ArrowDownCircle size={15} className="text-emerald-600" />
        Registrar abono
      </h4>

      {/* Líneas de pago */}
      <div className="space-y-2">
        {lineas.map((linea, idx) => (
          <div key={idx} className="bg-white border border-emerald-100 rounded-xl p-3 space-y-2">
            {/* Fila: monto + botón total + quitar */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Monto USD</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={linea.monto}
                    onChange={e => actualizarLinea(idx, 'monto', e.target.value)}
                    placeholder="0.00"
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                  {/* Botón Total solo en primera línea cuando hay 1 sola */}
                  {lineas.length === 1 && saldo > 0 && (
                    <button
                      type="button"
                      onClick={ponerTotal}
                      className="px-3 py-2 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold hover:bg-emerald-200 transition-colors whitespace-nowrap"
                    >
                      Total
                    </button>
                  )}
                </div>
              </div>
              {lineas.length > 1 && (
                <button
                  type="button"
                  onClick={() => quitarLinea(idx)}
                  className="mt-4 p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Quitar"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Métodos de pago */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Forma de pago</label>
              <div className="flex flex-wrap gap-1">
                {METODOS.map(m => (
                  <button key={m} type="button"
                    onClick={() => actualizarLinea(idx, 'metodo', m)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                      linea.metodo === m
                        ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
                    }`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Referencia por línea */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Referencia (opcional)</label>
              <input
                type="text"
                value={linea.referencia}
                onChange={e => actualizarLinea(idx, 'referencia', e.target.value)}
                placeholder="Nº de confirmación, comprobante..."
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </div>
          </div>
        ))}
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

      {/* Resumen total + error */}
      {totalIngresado > 0 && (
        <div className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm font-bold ${
          excede ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-emerald-100 text-emerald-800'
        }`}>
          <span>Total a abonar:</span>
          <span>${totalIngresado.toFixed(2)}</span>
        </div>
      )}
      {excede && (
        <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
          <AlertCircle size={12} />
          El monto supera la deuda ({fmtUsd(saldo)}). Reduce el abono.
        </p>
      )}

      <button
        type="submit"
        disabled={registrar.isPending || sinMonto || excede}
        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
      >
        {registrar.isPending ? 'Registrando...' : 'Confirmar abono'}
      </button>
    </form>
  )
}


// ─── Historial de cotizaciones ───────────────────────────────────────────────
function HistorialCotizaciones({ clienteId, onVerCotizacion }) {
  const { data: cotizaciones = [], isLoading } = useCotizacionesCliente(clienteId)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1,2,3].map(i => (
          <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (cotizaciones.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <FileText size={28} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm">Sin cotizaciones registradas</p>
      </div>
    )
  }

  function fmtNumero(cot) {
    const num = `COT-${String(cot.numero).padStart(5, '0')}`
    return num
  }

  function fmtFechaCorta(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <div className="space-y-2">
      {cotizaciones.map(cot => (
        <button
          key={cot.id}
          onClick={() => onVerCotizacion?.(cot)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-100 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FileText size={14} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 font-mono">{fmtNumero(cot)}</span>
              <EstadoBadge estado={cot.estado} />
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {fmtFechaCorta(cot.creado_en)}
              {cot.vendedor?.nombre ? ` · ${cot.vendedor.nombre}` : ''}
            </p>
          </div>
          <div className="text-right shrink-0 flex items-center gap-2">
            <span className="text-sm font-black text-slate-700">{fmtUsd(cot.total_usd)}</span>
            <ChevronRight size={14} className="text-slate-300" />
          </div>
        </button>
      ))}
    </div>
  )
}

// ─── Modal principal ─────────────────────────────────────────────────────────
export default function FichaClienteModal({ cliente, isOpen, onClose }) {
  const { perfil } = useAuthStore()
  const puedeRegistrarAbono = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const { data: movimientos = [], isLoading, refetch } = useCuentasCobrar(isOpen ? cliente?.id : null)

  // Saldo local para actualización inmediata tras abonar (sin esperar cache del padre)
  const [saldoLocal, setSaldoLocal] = useState(null)

  // Sincronizar cuando el prop cambia (al abrir el modal o cuando el padre refresca)
  useEffect(() => {
    setSaldoLocal(Number(cliente?.saldo_pendiente || 0))
  }, [cliente?.id, cliente?.saldo_pendiente])

  if (!isOpen || !cliente) return null

  const saldo = saldoLocal ?? Number(cliente.saldo_pendiente || 0)
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

          {/* Formulario abono (supervisor o administración si hay deuda) */}
          {puedeRegistrarAbono && saldo > 0 && (
            <FormAbono
              clienteId={cliente.id}
              saldo={saldo}
              onSuccess={(montoAbonado) => {
                setSaldoLocal(prev => Math.max(0, (prev ?? saldo) - montoAbonado))
                refetch()
              }}
            />
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

          {/* Historial de cotizaciones */}
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-3">
              <FileText size={14} className="text-slate-500" />
              Cotizaciones del cliente
            </h3>
            <HistorialCotizaciones clienteId={cliente.id} />
          </div>
        </div>
      </div>
    </div>
  )
}
