// src/components/clientes/FichaClienteModal.jsx
// Modal ficha del cliente: historial de crédito + formulario de abono
import { useState, useEffect, useRef } from 'react'
import { X, CreditCard, ArrowUpCircle, ArrowDownCircle, AlertCircle, RefreshCw, DollarSign, Hash, Phone, FileText, ChevronRight, Handshake, RotateCcw, ShoppingBag, ChevronDown, Briefcase, Repeat } from 'lucide-react'
import { useCuentasCobrar, useRegistrarAbono, useRevertirAbono, useRegistrarSaldoFavor, useRegistrarDevolucionCredito, useCruzarSaldoFavor, useResumenCuentaCliente } from '../../hooks/useCuentasCobrar'
import { useVentasCliente } from '../../hooks/useClientes'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import { rankEntities } from '../../utils/entitySearch'
import { saldosCorridos, saldoDeLinea } from '../../utils/cxcSaldos'
import EstadoBadge from '../cotizaciones/EstadoBadge'
import { showToast } from '../ui/Toast'
import { apiUrl } from '../../services/apiBase'
import { authFetch } from '../../services/authFetch'
import ConfirmModal from '../ui/ConfirmModal'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { crearGeneradorClaveIdempotente } from '../../utils/idempotencyKey'

function fmtFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}

const METODOS = ['Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT', 'Cruce']

function etiquetaDespacho(p) {
  const num = p.numero != null ? `#${p.numero}` : (p.descripcion || 'Cargo sin número')
  return `${num} · pendiente ${fmtUsd(p.pendiente)}${p.pendiente < p.monto_usd - 0.005 ? ` de ${fmtUsd(p.monto_usd)}` : ''}`
}

// ─── OP-2026-049: envío seguro de formularios de dinero ──────────────────────
// N10: si el guardado falla, el formulario muestra un aviso rojo y conserva lo
//      escrito (antes no se mostraba nada y el operador podía creer que se guardó).
// G4:  un candado inmediato evita que un doble clic envíe dos veces (el botón
//      deshabilitado llega tarde: el segundo clic se dispara antes de redibujar).
function useEnvioUnico() {
  const enviandoRef = useRef(false)
  const [error, setError] = useState(null)
  async function enviar(fn) {
    if (enviandoRef.current) return { ok: false, ignorado: true }
    enviandoRef.current = true
    setError(null)
    try {
      const r = await fn()
      return { ok: true, r }
    } catch (e) {
      setError(e)
      return { ok: false, error: e }
    } finally {
      enviandoRef.current = false
    }
  }
  return { enviar, error, setError }
}

function AvisoNoGuardado({ error, que = 'el movimiento', testid }) {
  if (!error || error.code === 'POSIBLE_DUPLICADO') return null
  return (
    <div data-testid={testid} role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 flex items-start gap-1.5">
      <AlertCircle size={14} className="shrink-0 mt-0.5" />
      <span>
        <b>No se guardó {que}.</b> {error.message} Lo escrito sigue en el formulario: revisa y vuelve a intentar.
      </span>
    </div>
  )
}

function nuevaClaveOperacion() {
  try { return crypto.randomUUID() } catch { return `op-${Date.now()}-${Math.random().toString(36).slice(2)}` }
}

// OP-2026-051: huella por operación para cualquier movimiento de dinero. Se reutiliza en
// los reintentos del MISMO movimiento y se renueva cuando cambian los datos o tras guardar.
function useClaveOperacion(deps) {
  const claveRef = useRef(null)
  const [duplicado, setDuplicado] = useState(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { claveRef.current = null; setDuplicado(null) }, deps)
  return {
    clave() { if (!claveRef.current) claveRef.current = nuevaClaveOperacion(); return claveRef.current },
    renovar() { claveRef.current = null; setDuplicado(null) },
    duplicado, setDuplicado,
  }
}

function AvisoPosibleRepetido({ duplicado, testid, onConfirmar, onCancelar }) {
  if (!duplicado) return null
  return (
    <div data-testid={testid} role="alert" className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg p-2.5 space-y-2">
      <p className="flex items-start gap-1.5">
        <AlertCircle size={14} className="shrink-0 mt-0.5" />
        <span><b>¿Es otro movimiento?</b> {duplicado.message}</span>
      </p>
      <div className="flex gap-2">
        <button type="button" data-testid={`${testid}-confirmar`} onClick={onConfirmar}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg">
          Sí, es otro: registrarlo
        </button>
        <button type="button" data-testid={`${testid}-cancelar`} onClick={onCancelar}
          className="px-3 py-1.5 bg-white border border-amber-300 text-amber-900 font-bold rounded-lg">
          No, cancelar
        </button>
      </div>
    </div>
  )
}

function FormAbono({ clienteId, saldo, pendientes = [], onSuccess }) {
  // Cada línea de pago: { metodo, monto, referencia }
  const [lineas, setLineas] = useState([{ metodo: 'Efectivo $', monto: '', referencia: '' }])
  const [descripcion, setDescripcion] = useState('')
  // OP-2026-042: despacho que paga este abono ('' = sin despacho específico)
  const [despachoId, setDespachoId] = useState('')
  const registrar = useRegistrarAbono()
  const { enviar, error: errorAbono, setError: setErrorAbono } = useEnvioUnico()
  // G4: una clave por operación. Se reutiliza en los reintentos del MISMO abono
  // (si la respuesta se perdió, el servidor devuelve el ya guardado) y se renueva
  // cuando cambian los datos o después de guardar.
  const claveRef = useRef(null)
  const [duplicado, setDuplicado] = useState(null) // aviso del servidor: abono igual reciente
  useEffect(() => { claveRef.current = null; setDuplicado(null) }, [lineas, descripcion, despachoId])

  // Total acumulado de todas las líneas
  const totalIngresado = lineas.reduce((acc, l) => acc + (parseFloat(l.monto) || 0), 0)
  const excede = saldo > 0 && totalIngresado > saldo + 0.001
  const sinMonto = totalIngresado <= 0
  const despachosConDeuda = pendientes.filter(p => p.despacho_id)
  const despachoElegido = despachosConDeuda.find(p => p.despacho_id === despachoId) || null
  const superaDespacho = !!despachoElegido && totalIngresado > despachoElegido.pendiente + 0.005
  // OP-2026-042: un "Cruce" debe decir contra qué se cruzó (regla de trabajo)
  const usaCruce = lineas.some(l => l.metodo === 'Cruce' && (parseFloat(l.monto) || 0) > 0)
  const faltaMotivoCruce = usaCruce && descripcion.trim().length < 5

  function actualizarLinea(idx, campo, valor) {
    setLineas(prev => prev.map((l, i) => i === idx ? { ...l, [campo]: valor } : l))
  }

  function agregarLinea() {
    setLineas(prev => [...prev, { metodo: 'Efectivo $', monto: '', referencia: '' }])
  }

  function quitarLinea(idx) {
    setLineas(prev => prev.filter((_, i) => i !== idx))
  }

  function ponerTotal() {
    if (lineas.length === 1) {
      setLineas([{ ...lineas[0], monto: saldo.toFixed(2) }])
    }
  }

  async function guardarAbono({ confirmarDuplicado = false } = {}) {
    if (excede || sinMonto || faltaMotivoCruce) return

    // Enviar como JSON array de formas de pago (igual que despachos)
    const formasPagoJson = JSON.stringify(lineas.map(l => ({
      metodo: l.metodo,
      monto: parseFloat(l.monto) || 0,
      referencia: l.referencia || '',
    })))
    if (!claveRef.current) claveRef.current = nuevaClaveOperacion()
    const monto = totalIngresado

    const res = await enviar(() => registrar.mutateAsync({
      clienteId,
      monto,
      formaPago: formasPagoJson,
      referencia: lineas[0]?.referencia || '',
      descripcion: descripcion || 'Abono recibido',
      despachoId: despachoId || null,
      idempotencyKey: claveRef.current,
      confirmarDuplicado,
      manejaDuplicado: true,
    }))
    if (res.ignorado) return
    if (!res.ok) {
      if (res.error?.code === 'POSIBLE_DUPLICADO') setDuplicado(res.error)
      return
    }
    claveRef.current = null
    setDuplicado(null)
    setLineas([{ metodo: 'Efectivo $', monto: '', referencia: '' }])
    setDescripcion('')
    setDespachoId('')
    onSuccess?.(monto)
  }

  function handleSubmit(e) {
    e.preventDefault()
    guardarAbono()
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

      {/* OP-2026-042: ¿Qué despacho paga? */}
      {despachosConDeuda.length > 0 && (
        <div>
          <label htmlFor="abono-despacho" className="block text-xs font-semibold text-slate-600 mb-1">¿Qué despacho paga? (recomendado)</label>
          <select
            id="abono-despacho"
            data-testid="abono-despacho"
            value={despachoId}
            onChange={e => setDespachoId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            <option value="">Sin despacho específico (se aplica al más antiguo)</option>
            {despachosConDeuda.map(p => (
              <option key={p.id} value={p.despacho_id}>{etiquetaDespacho(p)}</option>
            ))}
          </select>
          {superaDespacho && (
            <p className="text-[11px] text-amber-700 mt-1">
              El abono supera lo pendiente de ese despacho ({fmtUsd(despachoElegido.pendiente)}). El resto se aplicará a los despachos más antiguos.
            </p>
          )}
        </div>
      )}

      {/* Descripción */}
      <div>
        <label htmlFor="abono-descripcion" className="block text-xs font-semibold text-slate-600 mb-1">
          {usaCruce ? 'Contra qué se cruzó (obligatorio)' : 'Descripción (opcional)'}
        </label>
        <input
          id="abono-descripcion"
          type="text"
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          placeholder={usaCruce ? 'Ej: Cruce contra factura de flete #45 que les debemos' : 'Ej: Pago parcial factura #123'}
          className={`w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 ${faltaMotivoCruce ? 'border-amber-300' : 'border-slate-200'}`}
        />
        {usaCruce && (
          <p className="text-[11px] text-amber-700 mt-1">
            Un cruce es para compensar algo real (por ejemplo, una deuda nuestra con el cliente). Si el cliente devolvió mercancía, usa la pantalla de devoluciones del despacho, no un cruce.
          </p>
        )}
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

      <AvisoNoGuardado error={errorAbono} que="el abono" testid="abono-error" />

      {duplicado && (
        <div data-testid="abono-posible-duplicado" role="alert" className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg p-2.5 space-y-2">
          <p className="flex items-start gap-1.5">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span><b>¿Es otro pago?</b> {duplicado.message}</span>
          </p>
          <div className="flex gap-2">
            <button type="button" data-testid="abono-duplicado-confirmar"
              onClick={() => { setDuplicado(null); setErrorAbono(null); guardarAbono({ confirmarDuplicado: true }) }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg">
              Sí, es otro pago: registrarlo
            </button>
            <button type="button" data-testid="abono-duplicado-cancelar"
              onClick={() => { setDuplicado(null); setErrorAbono(null) }}
              className="px-3 py-1.5 bg-white border border-amber-300 text-amber-900 font-bold rounded-lg">
              No, cancelar
            </button>
          </div>
        </div>
      )}

      <button
        type="submit"
        data-testid="abono-confirmar"
        disabled={registrar.isPending || sinMonto || excede || faltaMotivoCruce || !!duplicado}
        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
      >
        {registrar.isPending ? 'Registrando...' : 'Confirmar abono'}
      </button>
    </form>
  )
}

function FormSaldoFavor({ clienteId, onSuccess }) {
  const [monto, setMonto] = useState('')
  const [formaPago, setFormaPago] = useState('Efectivo $')
  const [referencia, setReferencia] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const registrarSaldoFavor = useRegistrarSaldoFavor()
  const { enviar, error: errorSaldoFavor, setError: setErrorSaldoFavor } = useEnvioUnico()
  const op = useClaveOperacion([monto, formaPago, referencia, descripcion])

  const sinMonto = !monto || parseFloat(monto) <= 0

  async function guardar({ confirmarDuplicado = false } = {}) {
    if (sinMonto) return
    const res = await enviar(() => registrarSaldoFavor.mutateAsync({
      clienteId,
      monto: parseFloat(monto),
      formaPago,
      referencia: referencia || null,
      descripcion: descripcion || 'Crédito / Saldo a favor recibido',
      idempotencyKey: op.clave(),
      confirmarDuplicado,
      manejaDuplicado: true,
    }))
    if (res.ignorado) return
    if (!res.ok) {
      if (res.error?.code === 'POSIBLE_DUPLICADO') op.setDuplicado(res.error)
      return
    }
    op.renovar()
    setMonto('')
    setReferencia('')
    setDescripcion('')
    onSuccess?.()
  }

  function handleSubmit(e) {
    e.preventDefault()
    guardar()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-black text-blue-800 flex items-center gap-2">
        <ArrowDownCircle size={15} className="text-blue-600" />
        Cargar saldo a favor
      </h4>

      <div className="bg-white border border-blue-100 rounded-xl p-3 space-y-2">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Monto USD</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={monto}
            onChange={e => setMonto(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Forma de pago</label>
          <div className="flex flex-wrap gap-1">
            {METODOS.filter(m => m !== 'Cruce').map(m => (
              <button key={m} type="button"
                onClick={() => setFormaPago(m)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                  formaPago === m
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                }`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Referencia (opcional)</label>
          <input
            type="text"
            value={referencia}
            onChange={e => setReferencia(e.target.value)}
            placeholder="Nº de confirmación, comprobante..."
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción (opcional)</label>
        <input
          type="text"
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          placeholder="Ej: Anticipo para futuros despachos"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      <AvisoNoGuardado error={errorSaldoFavor} que="el saldo a favor" testid="saldo-favor-error" />
      <AvisoPosibleRepetido duplicado={op.duplicado} testid="saldo-favor-posible-duplicado"
        onConfirmar={() => { op.setDuplicado(null); setErrorSaldoFavor(null); guardar({ confirmarDuplicado: true }) }}
        onCancelar={() => { op.setDuplicado(null); setErrorSaldoFavor(null) }} />

      <button
        type="submit"
        data-testid="saldo-favor-confirmar"
        disabled={registrarSaldoFavor.isPending || sinMonto || !!op.duplicado}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
      >
        {registrarSaldoFavor.isPending ? 'Cargando...' : 'Confirmar saldo a favor'}
      </button>
    </form>
  )
}

function FormDevolucionCredito({ clienteId, saldoFavor, onSuccess }) {
  const [monto, setMonto] = useState('')
  const [formaPago, setFormaPago] = useState('Efectivo $')
  const [referencia, setReferencia] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const registrarDevolucion = useRegistrarDevolucionCredito()
  const { enviar, error: errorDevolucion, setError: setErrorDevolucion } = useEnvioUnico()
  const op = useClaveOperacion([monto, formaPago, referencia, descripcion])

  const sinMonto = !monto || parseFloat(monto) <= 0
  const excede = saldoFavor > 0 && parseFloat(monto) > saldoFavor + 0.001

  function ponerTotal() {
    setMonto(saldoFavor.toFixed(2))
  }

  async function guardar({ confirmarDuplicado = false } = {}) {
    if (sinMonto || excede) return
    const res = await enviar(() => registrarDevolucion.mutateAsync({
      clienteId,
      monto: parseFloat(monto),
      formaPago,
      referencia: referencia || null,
      descripcion: descripcion || 'Devolución de saldo a favor registrada',
      idempotencyKey: op.clave(),
      confirmarDuplicado,
      manejaDuplicado: true,
    }))
    if (res.ignorado) return
    if (!res.ok) {
      if (res.error?.code === 'POSIBLE_DUPLICADO') op.setDuplicado(res.error)
      return
    }
    op.renovar()
    setMonto('')
    setReferencia('')
    setDescripcion('')
    onSuccess?.(parseFloat(monto))
  }

  function handleSubmit(e) {
    e.preventDefault()
    guardar()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-black text-amber-800 flex items-center gap-2">
        <ArrowUpCircle size={15} className="text-amber-600" />
        Devolver saldo a favor (Reembolso)
      </h4>

      <div className="bg-white border border-amber-100 rounded-xl p-3 space-y-2">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Monto USD</label>
          <div className="flex gap-1">
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={saldoFavor}
              value={monto}
              onChange={e => setMonto(e.target.value)}
              placeholder="0.00"
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
            {saldoFavor > 0 && (
              <button
                type="button"
                onClick={ponerTotal}
                className="px-3 py-2 rounded-lg bg-amber-100 text-amber-700 text-xs font-bold hover:bg-amber-200 transition-colors whitespace-nowrap"
              >
                Total
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Forma de devolución</label>
          <div className="flex flex-wrap gap-1">
            {METODOS.filter(m => m !== 'Cruce').map(m => (
              <button key={m} type="button"
                onClick={() => setFormaPago(m)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                  formaPago === m
                    ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:text-amber-600'
                }`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Referencia (opcional)</label>
          <input
            type="text"
            value={referencia}
            onChange={e => setReferencia(e.target.value)}
            placeholder="Nº de confirmación, comprobante..."
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción (opcional)</label>
        <input
          type="text"
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          placeholder="Ej: Devolución por excedente de pago"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
        />
      </div>

      {excede && (
        <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
          <AlertCircle size={12} />
          El monto supera el saldo a favor disponible ({fmtUsd(saldoFavor)}). Reduce el monto.
        </p>
      )}

      <AvisoNoGuardado error={errorDevolucion} que="la devolución de saldo" testid="devolucion-saldo-error" />
      <AvisoPosibleRepetido duplicado={op.duplicado} testid="devolucion-saldo-posible-duplicado"
        onConfirmar={() => { op.setDuplicado(null); setErrorDevolucion(null); guardar({ confirmarDuplicado: true }) }}
        onCancelar={() => { op.setDuplicado(null); setErrorDevolucion(null) }} />

      <button
        type="submit"
        data-testid="devolucion-saldo-confirmar"
        disabled={registrarDevolucion.isPending || sinMonto || excede || !!op.duplicado}
        className="w-full py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
      >
        {registrarDevolucion.isPending ? 'Procesando...' : 'Confirmar devolución'}
      </button>
    </form>
  )
}

function FormCruzarSaldoFavor({ clienteId, saldo, saldoFavor, onSuccess }) {
  const maxCruzar = Math.max(0, Math.round(Math.min(saldo, saldoFavor) * 100) / 100)
  const [monto, setMonto] = useState(maxCruzar > 0 ? maxCruzar.toFixed(2) : '')
  const cruzar = useCruzarSaldoFavor()
  const { enviar: enviarCruce, error: errorCruce } = useEnvioUnico()
  const op = useClaveOperacion([monto])

  const numMonto = parseFloat(monto) || 0
  const sinMonto = numMonto <= 0
  const excede = numMonto > maxCruzar + 0.001

  const resultanteDeuda = Math.max(0, Math.round((saldo - numMonto) * 100) / 100)
  const resultanteFavor = Math.max(0, Math.round((saldoFavor - numMonto) * 100) / 100)

  function ponerTotal() {
    setMonto(maxCruzar.toFixed(2))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (sinMonto || excede || cruzar.isPending) return

    const res = await enviarCruce(() => cruzar.mutateAsync({ clienteId, monto: numMonto, idempotencyKey: op.clave() }))
    if (!res.ok) return
    op.renovar()
    onSuccess?.(numMonto)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-black text-indigo-900 flex items-center gap-2">
        <Repeat size={15} className="text-indigo-600" />
        Cruzar saldo a favor contra deuda
      </h4>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-white/90 p-2 rounded-lg border border-indigo-100">
          <span className="text-slate-500 block text-[10px]">Deuda actual</span>
          <strong className="text-rose-600 font-bold">{fmtUsd(saldo)}</strong>
        </div>
        <div className="bg-white/90 p-2 rounded-lg border border-indigo-100">
          <span className="text-slate-500 block text-[10px]">Saldo a favor actual</span>
          <strong className="text-emerald-600 font-bold">{fmtUsd(saldoFavor)}</strong>
        </div>
      </div>

      <div className="bg-white border border-indigo-100 rounded-xl p-3 space-y-2">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Monto a cruzar (USD)</label>
          <div className="flex gap-1">
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={maxCruzar}
              value={monto}
              onChange={e => setMonto(e.target.value)}
              placeholder="0.00"
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            {maxCruzar > 0 && (
              <button
                type="button"
                onClick={ponerTotal}
                className="px-3 py-2 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-bold hover:bg-indigo-200 transition-colors whitespace-nowrap"
              >
                Máximo ({fmtUsd(maxCruzar)})
              </button>
            )}
          </div>
        </div>

        <div className="p-2.5 bg-indigo-50/50 rounded-lg text-[11px] space-y-1 border border-indigo-100/60">
          <div className="flex justify-between text-slate-600">
            <span>Deuda resultante estimada:</span>
            <strong className="text-slate-800">{fmtUsd(resultanteDeuda)}</strong>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Saldo a favor resultante estimado:</span>
            <strong className="text-slate-800">{fmtUsd(resultanteFavor)}</strong>
          </div>
        </div>
      </div>

      {excede && (
        <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
          <AlertCircle size={12} />
          El monto supera el límite máximo cruzable ({fmtUsd(maxCruzar)}).
        </p>
      )}

      <AvisoNoGuardado error={errorCruce} que="el cruce" testid="cruce-error" />

      <button
        type="submit"
        disabled={cruzar.isPending || sinMonto || excede}
        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-indigo-200 flex justify-center items-center gap-2"
      >
        {cruzar.isPending ? 'Procesando cruce...' : `Confirmar cruce de ${fmtUsd(numMonto)}`}
      </button>
    </form>
  )
}


// ─── Historial de Ventas Aprobadas con Acordeón ──────────────────────────────
function HistorialVentas({ clienteId }) {
  const { data: ventas = [], isLoading } = useVentasCliente(clienteId)
  const [expandedId, setExpandedId] = useState(null)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1,2,3].map(i => (
          <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (ventas.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400 border border-dashed border-slate-200 rounded-2xl">
        <ShoppingBag size={28} className="mx-auto mb-2 opacity-30 text-slate-300" />
        <p className="text-sm">Sin ventas aprobadas registradas</p>
      </div>
    )
  }

  function toggleExpand(id) {
    setExpandedId(prev => prev === id ? null : id)
  }

  return (
    <div className="space-y-2">
      {ventas.map(v => {
        const totalFinal = Number(v.total_usd || 0) - Number(v.descuento_total_usd || 0)
        const totalItems = v.items?.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0) || 0
        const displayNum = `DES-${String(v.numero).padStart(5, '0')}`
        const isExpanded = expandedId === v.id

        // Detección robusta de préstamos del despacho
        let tienePrestamos = false
        try {
          const fp = typeof v.forma_pago === 'string' ? JSON.parse(v.forma_pago) : (v.forma_pago || [])
          if (Array.isArray(fp) && fp.some(f => f.metodo === 'Préstamo' || f.metodo === 'Prestamo')) {
            tienePrestamos = true
          }
        } catch (e) {
          if (typeof v.forma_pago === 'string' && (v.forma_pago === 'Préstamo' || v.forma_pago === 'Prestamo')) {
            tienePrestamos = true
          }
        }

        // Aplicar fallback si el despacho completo es de tipo préstamo pero los ítems individuales no lo tienen marcado
        const itemsConFallback = tienePrestamos && !v.items?.some(x => x.es_prestamo)
          ? v.items?.map(it => ({ ...it, es_prestamo: true }))
          : v.items

        return (
          <div key={v.id} className="border border-slate-100 rounded-xl bg-slate-50 overflow-hidden transition-all shadow-sm">
            {/* Header del Item / Botón de Toggle */}
            <button
              onClick={() => toggleExpand(v.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-100/70 transition-colors text-left focus:outline-none"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <ShoppingBag size={14} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800 font-mono">{displayNum}</span>
                  <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase shrink-0 ${
                    v.estado === 'entregada'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200/50'
                      : 'bg-blue-100 text-blue-800 border border-blue-200/50'
                  }`}>
                    {v.estado}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 animate-fade-in duration-100">
                  {new Date(v.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {v.vendedor?.nombre ? ` · ${v.vendedor.nombre}` : ''}
                  {` · ${v.items?.length || 0} arts (${totalItems} unds)`}
                </p>
              </div>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-black text-slate-700">${totalFinal.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {/* Contenido Desplegable (Artículos) */}
            {isExpanded && (
              <div className="bg-white border-t border-slate-100 px-4 py-3 animate-fade-in duration-150">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                  Detalle de Artículos
                </div>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                  {itemsConFallback?.map(it => (
                    <div key={it.id} className="flex justify-between items-center text-xs py-1 border-b border-slate-50 last:border-0 gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-800 uppercase leading-snug break-words">
                          <span>{it.nombre_snap || 'Artículo sin nombre'}</span>
                          {it.es_prestamo && (
                            <span className="inline-flex items-center ml-2 bg-amber-100 text-amber-800 text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0 border border-amber-200 select-none">
                              Préstamo
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] font-mono text-slate-400 mt-0.5">Cód: {it.codigo_snap || 'S/C'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-black text-slate-700">
                          {it.cantidad} {it.unidad_snap?.toLowerCase()} x ${Number(it.precio_unit_usd || 0).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold">${Number(it.total_linea_usd || 0).toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Modal principal ─────────────────────────────────────────────────────────
export default function FichaClienteModal({ cliente, isOpen, onClose }) {
  const { perfil } = useAuthStore()
  const { data: config = {} } = useConfigNegocio()
  const puedeRegistrarAbono = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const puedeRevertirAbono = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const puedeCruzarSaldo = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const { data: movimientos = [], isLoading, refetch } = useCuentasCobrar(isOpen ? cliente?.id : null)
  // OP-2026-057 (M1): saldo de cada línea calculado con los movimientos de hoy (no el saldo "foto" guardado)
  const saldosLinea = saldosCorridos(movimientos)
  // OP-2026-042: cuenta completa (sin tope de 100) para el selector y el "pagado de más"
  const { data: resumenCuenta } = useResumenCuentaCliente(isOpen ? cliente?.id : null)
  const pagadoDeMasCliente = Number(resumenCuenta?.pagadoDeMas || 0)

  const [activeTab, setActiveTab] = useState('cuenta')
  const [abonoARevertir, setAbonoARevertir] = useState(null)
  const revertirMutation = useRevertirAbono()
  // OP-2026-055 (I3): motivo obligatorio al anular y lista de movimientos anulados
  const [motivoAnular, setMotivoAnular] = useState('')
  const [errorAnular, setErrorAnular] = useState(null)
  const [verAnulados, setVerAnulados] = useState(false)
  const [anulados, setAnulados] = useState(null)
  useEffect(() => { setMotivoAnular(''); setErrorAnular(null) }, [abonoARevertir])
  useEffect(() => {
    if (!verAnulados || !cliente?.id) return
    let vivo = true
    authFetch(`/api/cxc/movimientos-borrados?clienteId=${cliente.id}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (vivo) setAnulados(Array.isArray(d) ? d : []) })
      .catch(() => { if (vivo) setAnulados([]) })
    return () => { vivo = false }
  }, [verAnulados, cliente?.id, revertirMutation.isSuccess])
  const [prestamos, setPrestamos] = useState([])
  const [cargandoPrestamos, setCargandoPrestamos] = useState(false)
  const [busquedaPrestamos, setBusquedaPrestamos] = useState('')
  const [activeAction, setActiveAction] = useState(null)
  const [actionQty, setActionQty] = useState('')
  // OP-2026-095 Fase 3 (decisión del dueño): ocultar "Facturar préstamo" y dejar solo "Devolver"
  // hasta confirmar reglas de cobro y comisiones con el cliente.
  const FACTURACION_PRESTAMOS_HABILITADA = false
  // OP-2026-086: tasa del día para facturar préstamos y sello único por envío (doble clic / reintento)
  // OP-2026-091: se factura con la TASA PRINCIPAL elegida en el sistema (BCV, USDT o manual).
  const { tasaEfectiva, modoTasa, refrescar: refrescarTasa } = useTasaCambio()
  const tasaDelDia = Number(tasaEfectiva) > 0 ? Number(tasaEfectiva) : 0
  const etiquetaTasa = modoTasa === 'usdt' ? 'USDT' : modoTasa === 'manual' ? 'manual' : 'BCV'
  // Cómo se cobra al facturar: 'credito' (se suma a la deuda) o 'ahora' (paga en el momento)
  const [pagoModo, setPagoModo] = useState('credito')
  const [pagoMetodo, setPagoMetodo] = useState('Efectivo $')
  const [pagoReferencia, setPagoReferencia] = useState('')
  const claveAccionPrestamoRef = useRef(null)
  if (!claveAccionPrestamoRef.current) claveAccionPrestamoRef.current = crearGeneradorClaveIdempotente()
  const [actionLoading, setActionLoading] = useState(false)

  const [cargadoUnaVez, setCargadoUnaVez] = useState(false)

  const fetchPrestamos = async () => {
    if (!cliente?.id) return
    setCargandoPrestamos(true)
    try {
      const res = await authFetch(`/api/clientes/prestamos?clienteId=${cliente.id}`)
      if (res.ok) {
        const data = await res.json()
        setPrestamos(data || [])
        setCargadoUnaVez(true)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setCargandoPrestamos(false)
    }
  }

  useEffect(() => {
    if (isOpen && cliente?.id) {
      fetchPrestamos()
    } else if (!isOpen) {
      setCargadoUnaVez(false)
      setPrestamos([])
    }
  }, [isOpen, cliente?.id])

  const handleActionSubmit = async (prestamo, type) => {
    const qty = Number(actionQty)
    if (isNaN(qty) || qty <= 0) {
      showToast('Cantidad inválida', 'error')
      return
    }
    setActionLoading(true)
    try {
      if (type === 'facturar' && !FACTURACION_PRESTAMOS_HABILITADA) {
        showToast('La facturación de préstamos está deshabilitada temporalmente.', 'error')
        return
      }
      const url = type === 'devolver' ? '/api/clientes/prestamos/devolver' : '/api/clientes/prestamos/facturar'
      const tasa = tasaDelDia
      if (type === 'facturar' && !(tasa > 0)) {
        showToast('Todavía no hay tasa del día. Espera unos segundos o toca "Actualizar tasa" e intenta de nuevo.', 'error')
        return
      }
      const firma = JSON.stringify({ type, prestamoId: prestamo.id, cantidad: qty, pago: type === 'facturar' ? (pagoModo === 'ahora' ? pagoMetodo : 'credito') : null })
      const idempotencyKey = claveAccionPrestamoRef.current.resolver(firma)
      const res = await authFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          prestamoId: prestamo.id,
          cantidad: qty,
          idempotencyKey,
          ...(type === 'facturar' ? {
            tasa,
            tasaModo: modoTasa || 'bcv',
            ...(pagoModo === 'ahora' ? { pago: { metodo: pagoMetodo, referencia: pagoReferencia } } : {}),
          } : {})
        })
      })
      const result = await res.json()
      if (!res.ok) {
        // Error de negocio: se permite corregir y reenviar con una clave nueva.
        if ([400, 403, 404, 409].includes(res.status)) claveAccionPrestamoRef.current.limpiar(firma)
        showToast(result.error || 'Error al procesar la acción', 'error')
      } else {
        claveAccionPrestamoRef.current.limpiar(firma)
        const com = result?.comision
        const avisoCom = type === 'facturar' && com?.aplica
          ? ` · Comisión del vendedor: $${Number(com.comision_usd).toFixed(2)}${com.liberada ? '' : ' (retenida hasta que se cobre)'}`
          : ''
        showToast(type === 'devolver' ? 'Devolución física registrada con éxito ✓' : `${result?.pago_metodo ? 'Facturado y cobrado' : 'Facturado a la cuenta del cliente'} ✓${avisoCom}`, 'success', 6000)
        setActiveAction(null)
        setActionQty('')
        fetchPrestamos()
        refetch()
      }
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const prestamosFiltrados = busquedaPrestamos.trim()
    ? rankEntities(prestamos, busquedaPrestamos, [
        { get: p => p.producto?.nombre, weight: 10 },
        { get: p => p.producto?.codigo, weight: 9 },
      ])
    : prestamos

  // Saldo local para actualización inmediata tras abonar (sin esperar cache del padre)
  const [saldoLocal, setSaldoLocal] = useState(null)
  const [saldoFavorLocal, setSaldoFavorLocal] = useState(null)
  const [cxcAction, setCxcAction] = useState('abono')
  const [prevClienteId, setPrevClienteId] = useState(null)

  // Sincronizar cuando el prop cambia (al abrir el modal o cuando el padre refresca)
  useEffect(() => {
    const pDeuda = Number(cliente?.saldo_pendiente || 0);
    const pFavor = Number(cliente?.saldo_a_favor || 0);
    setSaldoLocal(pDeuda)
    setSaldoFavorLocal(pFavor)

    // Solo cambiar acción si es un cliente distinto
    if (cliente?.id !== prevClienteId) {
      setPrevClienteId(cliente?.id)
      if (pDeuda > 0) {
        setCxcAction('abono')
      } else {
        setCxcAction('saldo_favor')
      }
    } else {
      // Si el mismo cliente actualizó saldos, verificar validez de la acción actual
      if (cxcAction === 'abono' && pDeuda <= 0) {
        setCxcAction('saldo_favor')
      } else if (cxcAction === 'devolucion_credito' && pFavor <= 0) {
        setCxcAction(pDeuda > 0 ? 'abono' : 'saldo_favor')
      }
    }
  }, [cliente?.id, cliente?.saldo_pendiente, cliente?.saldo_a_favor, cxcAction, prevClienteId])

  if (!isOpen || !cliente) return null

  const saldo = saldoLocal ?? Number(cliente.saldo_pendiente || 0)
  const saldoFavor = saldoFavorLocal ?? Number(cliente.saldo_a_favor || 0)
  const color = cliente.vendedor?.color || '#64748b'

  const tienePrestamosActivos = cargadoUnaVez
    ? prestamos.some(p => p.estado === 'pendiente' || p.estado === 'devuelto_parcial')
    : !!cliente.tiene_prestamos_activos

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
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-black text-white text-base leading-tight truncate">{cliente.nombre}</h2>
                  {cliente.tipo_cliente === 'personal' && (
                    <span className="inline-flex items-center gap-1 bg-[#FEF3C7] text-[#B45309] text-[11px] font-black px-2 py-0.5 rounded-lg border border-[#FDE68A] shrink-0 uppercase tracking-wider shadow-sm">
                      Personal (Desc. {config.descuento_personal_pct ?? 10}%)
                    </span>
                  )}
                  {cliente.codigo_cliente && (
                    <span 
                      className="bg-white text-slate-900 font-mono font-black text-[11px] px-2 py-0.5 rounded-lg shadow-md border border-white/80 shrink-0 select-all cursor-pointer transition-all active:scale-95 hover:bg-slate-100" 
                      title="Código de cliente (haz clic para copiar)"
                      onClick={() => {
                        navigator.clipboard.writeText(cliente.codigo_cliente);
                      }}
                    >
                      #{cliente.codigo_cliente}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {cliente.rif_cedula && (
                    <span className="flex items-center gap-1 text-xs text-white/70"><Hash size={10} />{cliente.rif_cedula}</span>
                  )}
                  {cliente.telefono && (
                    <span className="flex items-center gap-1 text-xs text-white/70"><Phone size={10} />{cliente.telefono}</span>
                  )}
                  {cliente.tipo_cliente === 'personal' && cliente.categoria && (
                    <span className="inline-flex items-center gap-1 bg-white/20 text-white text-[11px] font-bold px-2 py-0.5 rounded-lg border border-white/30 shrink-0 uppercase tracking-wider">
                      <Briefcase size={10} className="text-white/80" />
                      {cliente.categoria}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors shrink-0">
              <X size={16} className="text-white" />
            </button>
          </div>

          {/* Saldo y Préstamos */}
          <div className="flex gap-2 flex-wrap mt-3">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-black ${
              saldo > 0 ? 'bg-red-500/30 text-white border border-red-300/40' : 'bg-white/20 text-white border border-white/30'
            }`}>
              {saldo > 0 ? <AlertCircle size={14} /> : <DollarSign size={14} />}
              {saldo > 0 ? `Deuda: ${fmtUsd(saldo)}` : 'Sin deuda pendiente'}
            </div>
            {saldoFavor > 0 && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-black bg-emerald-500/30 text-white border border-emerald-300/40">
                <DollarSign size={14} className="text-emerald-200" />
                Saldo a Favor: {fmtUsd(saldoFavor)}
              </div>
            )}
            {pagadoDeMasCliente > 0.005 && (
              <div
                data-testid="ficha-pagado-de-mas"
                title="Abonos que no corresponden a ninguna deuda. Si el cliente vuelve a comprar a crédito, se descontarán solos."
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-black bg-amber-400/40 text-white border border-amber-200/60"
              >
                <AlertCircle size={14} className="text-amber-100" />
                Pagado de más: {fmtUsd(pagadoDeMasCliente)}
              </div>
            )}
            {tienePrestamosActivos && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-black bg-amber-500/30 text-white border border-amber-300/40 animate-pulse">
                <Handshake size={14} className="text-amber-200" />
                Tiene préstamos activos
              </div>
            )}
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="flex border-b border-slate-100 bg-slate-50/50 p-1 gap-1 shrink-0">
          <button
            onClick={() => setActiveTab('cuenta')}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'cuenta'
                ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
            }`}
          >
            <CreditCard size={13} />
            Cuenta
          </button>
          <button
            onClick={() => setActiveTab('ventas')}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'ventas'
                ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
            }`}
          >
            <ShoppingBag size={13} />
            Ventas
          </button>
          <button
            onClick={() => setActiveTab('prestamos')}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'prestamos'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-500 hover:text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            <Handshake size={13} />
            Préstamos
          </button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          
          {/* PESTAÑA: CUENTA Y MOVIMIENTOS */}
          {activeTab === 'cuenta' && (
            <div className="space-y-4">
              {/* OP-2026-042 (falla G3): pagos de más visibles */}
              {pagadoDeMasCliente > 0.005 && (
                <div className="flex gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-snug" data-testid="ficha-aviso-pagado-de-mas">
                  <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                  <p>
                    <b>Este cliente tiene {fmtUsd(pagadoDeMasCliente)} en pagos que no corresponden a ninguna deuda.</b>{' '}
                    No aparecen como deuda ni como saldo a favor, pero si vuelve a comprar a crédito se descontarán solos de la nueva deuda.
                    Revisa el historial con administración (puede ser un abono duplicado o un registro viejo).
                  </p>
                </div>
              )}
              {/* Selector de Acción CxC */}
              {puedeRegistrarAbono && (
                <div className="flex gap-1 p-1 bg-slate-100 rounded-xl text-xs shrink-0 select-none">
                  <button
                    type="button"
                    onClick={() => setCxcAction('abono')}
                    disabled={saldo <= 0}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                      cxcAction === 'abono'
                        ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                        : 'text-slate-500 hover:text-slate-700 disabled:opacity-40 disabled:hover:bg-transparent'
                    }`}
                  >
                    Abonar Deuda
                  </button>
                  <button
                    type="button"
                    onClick={() => setCxcAction('saldo_favor')}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                      cxcAction === 'saldo_favor'
                        ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Cargar Crédito
                  </button>
                  {saldoFavor > 0 && (
                    <button
                      type="button"
                      onClick={() => setCxcAction('devolucion_credito')}
                      className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                        cxcAction === 'devolucion_credito'
                          ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Devolver Crédito
                    </button>
                  )}
                  {puedeCruzarSaldo && saldo > 0 && saldoFavor > 0 && (
                    <button
                      type="button"
                      onClick={() => setCxcAction('cruzar_favor')}
                      className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                        cxcAction === 'cruzar_favor'
                          ? 'bg-indigo-600 text-white shadow-sm font-black'
                          : 'text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 font-black'
                      }`}
                    >
                      Cruzar Saldo
                    </button>
                  )}
                </div>
              )}

              {/* Formulario según acción seleccionada */}
              {puedeRegistrarAbono && cxcAction === 'abono' && saldo > 0 && (
                <FormAbono
                  clienteId={cliente.id}
                  saldo={saldo}
                  pendientes={resumenCuenta?.pendientes || []}
                  onSuccess={(montoAbonado) => {
                    setSaldoLocal(prev => Math.max(0, (prev ?? saldo) - montoAbonado))
                    refetch()
                  }}
                />
              )}

              {puedeRegistrarAbono && cxcAction === 'saldo_favor' && (
                <FormSaldoFavor
                  clienteId={cliente.id}
                  onSuccess={() => {
                    refetch()
                  }}
                />
              )}

              {puedeRegistrarAbono && cxcAction === 'devolucion_credito' && saldoFavor > 0 && (
                <FormDevolucionCredito
                  clienteId={cliente.id}
                  saldoFavor={saldoFavor}
                  onSuccess={(montoDevuelto) => {
                    setSaldoFavorLocal(prev => Math.max(0, (prev ?? saldoFavor) - montoDevuelto))
                    refetch()
                  }}
                />
              )}

              {puedeCruzarSaldo && cxcAction === 'cruzar_favor' && saldo > 0 && saldoFavor > 0 && (
                <FormCruzarSaldoFavor
                  clienteId={cliente.id}
                  saldo={saldo}
                  saldoFavor={saldoFavor}
                  onSuccess={(montoCruzado) => {
                    setSaldoLocal(prev => Math.max(0, Math.round(((prev ?? saldo) - montoCruzado) * 100) / 100))
                    setSaldoFavorLocal(prev => Math.max(0, Math.round(((prev ?? saldoFavor) - montoCruzado) * 100) / 100))
                    refetch()
                  }}
                />
              )}

              {/* OP-2026-055 (I3): movimientos anulados o borrados (copia completa, quién, cuándo y por qué) */}
              {puedeRevertirAbono && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60">
                  <button type="button" data-testid="ver-movimientos-anulados" onClick={() => setVerAnulados(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-slate-600">
                    <span>Movimientos anulados</span>
                    <ChevronDown size={14} className={verAnulados ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </button>
                  {verAnulados && (
                    <div className="px-3 pb-3 space-y-1.5" data-testid="lista-movimientos-anulados">
                      {anulados === null && <p className="text-xs text-slate-400">Cargando…</p>}
                      {anulados?.length === 0 && <p className="text-xs text-slate-400">Este cliente no tiene movimientos anulados.</p>}
                      {(anulados || []).map(a => (
                        <div key={a.id} className="text-xs bg-white border border-slate-200 rounded-lg p-2">
                          <div className="flex justify-between font-bold text-slate-700">
                            <span>{a.tipo === 'abono' ? 'Abono' : a.tipo === 'credito' ? 'Saldo a favor' : a.tipo === 'cargo' ? 'Deuda' : a.tipo} {fmtUsd(a.monto_usd)}</span>
                            <span className="text-slate-400 font-normal">{fmtFecha(a.borrado_en)}</span>
                          </div>
                          <p className="text-slate-600">
                            {a.fila?.referencia ? `Ref. ${a.fila.referencia} · ` : ''}
                            {a.motivo ? `Motivo: ${a.motivo}` : `Borrado por: ${a.origen || 'sin identificar'}`}
                            {a.borrado_por_nombre ? ` · ${a.borrado_por_nombre}` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
                          : mov.tipo === 'credito'
                          ? 'bg-blue-50 border-blue-100'
                          : mov.tipo === 'devolucion_credito'
                          ? 'bg-amber-50 border-amber-100'
                          : mov.tipo === 'consumo_credito'
                          ? 'bg-purple-50 border-purple-100'
                          : 'bg-emerald-50 border-emerald-100'
                      }`}>
                        {mov.tipo === 'cargo' ? (
                          <ArrowUpCircle size={18} className="text-red-500 shrink-0" />
                        ) : mov.tipo === 'credito' ? (
                          <ArrowDownCircle size={18} className="text-blue-500 shrink-0" />
                        ) : mov.tipo === 'devolucion_credito' ? (
                          <ArrowUpCircle size={18} className="text-amber-500 shrink-0" />
                        ) : mov.tipo === 'consumo_credito' ? (
                          <ArrowDownCircle size={18} className="text-purple-500 shrink-0" />
                        ) : (
                          <ArrowDownCircle size={18} className="text-emerald-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold text-slate-700 truncate">{mov.descripcion}</p>
                            {mov.metodo_pago === 'cod' && (
                              <span className="bg-blue-100 text-blue-800 text-[8.5px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0 border border-blue-200">
                                COD
                              </span>
                            )}
                            {mov.tipo === 'consumo_credito' && (
                              <span className="bg-purple-100 text-purple-800 text-[8.5px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0 border border-purple-200">
                                Consumo saldo a favor
                              </span>
                            )}
                            {mov.tipo === 'abono' && mov.forma_pago_abono === 'Saldo a favor' && (
                              <span className="bg-purple-100 text-purple-800 text-[8.5px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0 border border-purple-200">
                                {mov.referencia?.startsWith('Despacho')
                                  ? `Compra ${mov.referencia.replace('Despacho ', '')}`
                                  : 'Compra'}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400">{fmtFecha(mov.creado_en)}</p>
                          {mov.referencia && (
                            <p className="text-[10px] text-slate-400">Ref: {mov.referencia}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0 flex items-center gap-2">
                          <div>
                            <p className={`text-sm font-black ${
                              mov.tipo === 'cargo' 
                                ? 'text-red-600' 
                                : mov.tipo === 'credito' 
                                ? 'text-blue-600' 
                                : mov.tipo === 'devolucion_credito'
                                ? 'text-amber-600'
                                : mov.tipo === 'consumo_credito'
                                ? 'text-purple-600'
                                : 'text-emerald-600'
                            }`}>
                              {mov.tipo === 'cargo' || mov.tipo === 'devolucion_credito' ? '+' : '-'}{fmtUsd(mov.monto_usd)}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {mov.tipo === 'consumo_credito' ? 'Favor restante' : (mov.tipo === 'credito' || mov.tipo === 'devolucion_credito') ? 'Crédito' : 'Saldo'}: {fmtUsd(saldoDeLinea(mov, saldosLinea))}
                            </p>
                          </div>
                          {(mov.tipo === 'abono' || mov.tipo === 'credito' || mov.tipo === 'devolucion_credito' || mov.tipo === 'consumo_credito') && puedeRevertirAbono && (
                            <button
                              type="button"
                              onClick={() => setAbonoARevertir(mov)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                              title={mov.tipo === 'credito' ? "Revertir saldo a favor" : mov.tipo === 'devolucion_credito' ? "Revertir devolución" : mov.tipo === 'consumo_credito' ? "Revertir consumo de saldo a favor" : "Revertir abono"}
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PESTAÑA: HISTORIAL DE VENTAS */}
          {activeTab === 'ventas' && (
            <div>
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-3">
                <ShoppingBag size={14} className="text-slate-500" />
                Historial de Ventas Aprobadas
              </h3>
              <HistorialVentas clienteId={cliente.id} />
            </div>
          )}


          {/* PESTAÑA: PRÉSTAMOS (NUEVA) */}
          {activeTab === 'prestamos' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <Handshake size={14} className="text-emerald-600 animate-pulse" />
                  Artículos en Préstamo
                </h3>
                <button 
                  onClick={fetchPrestamos} 
                  disabled={cargandoPrestamos}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <RefreshCw size={13} className={cargandoPrestamos ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* Buscador local */}
              <input
                type="text"
                placeholder="Buscar artículo en préstamo..."
                value={busquedaPrestamos}
                onChange={e => setBusquedaPrestamos(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:border-emerald-400 focus:bg-white transition-all focus:ring-2 focus:ring-emerald-50"
              />

              {cargandoPrestamos ? (
                <div className="space-y-2">
                  {[1,2].map(i => (
                    <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : prestamosFiltrados.length === 0 ? (
                <div className="text-center py-8 text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                  <RefreshCw size={28} className="mx-auto mb-2 opacity-30 text-slate-300" />
                  <p className="text-xs">No se encontraron artículos en préstamo</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {prestamosFiltrados.map(p => {
                    const cantPrestada = Number(p.cantidad_prestada)
                    const cantDevuelta = Number(p.cantidad_devuelta || 0)
                    const cantFacturada = Number(p.cantidad_facturada || 0)
                    const restante = Math.max(0, cantPrestada - cantDevuelta - cantFacturada)
                    
                    const isActionActive = activeAction?.id === p.id
                    const isDevolver = activeAction?.type === 'devolver'
                    const isFacturar = activeAction?.type === 'facturar'

                    return (
                      <div 
                        key={p.id} 
                        className={`p-3.5 rounded-xl border transition-all ${
                          p.estado === 'pendiente' 
                            ? 'bg-white border-slate-200 shadow-sm'
                            : p.estado === 'devuelto_parcial'
                            ? 'bg-amber-50/20 border-amber-200'
                            : p.estado === 'facturado'
                            ? 'bg-sky-50/10 border-sky-100'
                            : 'bg-emerald-50/20 border-emerald-100 opacity-80'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <h4 className="text-xs font-black text-slate-800 leading-snug">
                              {p.producto?.nombre || 'Producto sin nombre'}
                            </h4>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                              Cód: {p.producto?.codigo || 'S/C'} · F. Préstamo: {new Date(p.creado_en).toLocaleDateString('es-VE')}
                            </p>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] font-bold text-slate-500">
                              <span>Préstamo: <strong className="text-slate-700">{cantPrestada} {p.producto?.unidad || 'und'}</strong></span>
                              {cantDevuelta > 0 && <span className="text-emerald-600">Devuelto: <strong>{cantDevuelta}</strong></span>}
                              {cantFacturada > 0 && <span className="text-sky-600">Facturado: <strong>{cantFacturada}</strong></span>}
                              {restante > 0 && <span className="text-rose-500">Pendiente: <strong>{restante}</strong></span>}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">
                              Despacho: <span className="font-mono text-slate-600">DES-{String(p.despacho?.numero || '').padStart(5, '0')}</span>
                              {Number(p.precio_facturacion_usd) > 0
                                ? <> · Precio del despacho: <strong className="text-slate-600">${Number(p.precio_facturacion_usd).toFixed(2)}</strong>/{p.producto?.unidad || 'und'} · Pendiente vale: <strong className="text-slate-600">${(restante * Number(p.precio_facturacion_usd)).toFixed(2)}</strong></>
                                : <> · Valor ref: ${p.producto?.precio_usd ? (restante * p.producto.precio_usd).toFixed(2) : '0.00'}</>}
                            </p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase shrink-0 ${
                            p.estado === 'pendiente'
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : p.estado === 'devuelto_parcial'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : p.estado === 'facturado'
                              ? 'bg-sky-100 text-sky-800 border border-sky-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}>
                            {p.estado === 'pendiente' ? 'Pendiente' : p.estado === 'devuelto_parcial' ? 'Parcial' : p.estado === 'facturado' ? 'Facturado' : 'Devuelto'}
                          </span>
                        </div>

                        {/* Botones de acción inline */}
                        {restante > 0 && !isActionActive && puedeRegistrarAbono && (
                          <div className="flex gap-2 mt-3 pt-2.5 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveAction({ id: p.id, type: 'devolver' })
                                setActionQty(String(restante))
                              }}
                              className="flex-1 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold transition-all active:scale-[0.98]"
                            >
                              Devolver
                            </button>
                            {FACTURACION_PRESTAMOS_HABILITADA && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveAction({ id: p.id, type: 'facturar' })
                                  setActionQty(String(restante))
                                  setPagoModo('credito'); setPagoReferencia('')
                                }}
                                className="flex-1 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[10px] font-bold transition-all active:scale-[0.98]"
                              >
                                Facturar
                              </button>
                            )}
                          </div>
                        )}

                        {/* Formulario de Acción Inline (OP-2026-088: con vista previa del cobro) */}
                        {isActionActive && (() => {
                          const qtyNum = Number(actionQty)
                          const qtyValida = Number.isFinite(qtyNum) && qtyNum > 0 && qtyNum <= restante + 0.0001
                          const precioU = Number(p.precio_facturacion_usd) > 0 ? Number(p.precio_facturacion_usd) : 0
                          const totalUsd = qtyValida && precioU > 0 ? Math.round(qtyNum * precioU * 100) / 100 : 0
                          const totalBs = totalUsd > 0 && tasaDelDia > 0 ? totalUsd * tasaDelDia : 0
                          const unidad = p.producto?.unidad || 'und'
                          const faltaTasa = isFacturar && tasaDelDia <= 0
                          const sinPrecio = isFacturar && precioU <= 0
                          const puedeEnviar = qtyValida && !actionLoading && !faltaTasa && !sinPrecio
                          const fmtN = (n, d = 2) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d })
                          return (
                            <div className={`mt-3 p-3 rounded-xl border space-y-2.5 animate-in slide-in-from-top-1 duration-150 ${isDevolver ? 'bg-emerald-50/40 border-emerald-200' : 'bg-sky-50/40 border-sky-200'}`}>
                              <div className="flex items-center justify-between">
                                <span className={`text-[11px] font-black uppercase tracking-wider ${isDevolver ? 'text-emerald-700' : 'text-sky-700'}`}>
                                  {isDevolver ? 'Devolver mercancía física' : 'Cobrar a la cuenta del cliente'}
                                </span>
                                <span className="text-[10px] font-bold text-slate-500">Pendiente: {restante} {unidad}</span>
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                  {isDevolver ? '¿Cuántas devuelve?' : '¿Cuántas se cobran?'}
                                </label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step="any"
                                    min="0"
                                    max={restante}
                                    value={actionQty}
                                    onChange={e => setActionQty(e.target.value)}
                                    placeholder="0"
                                    aria-label="Cantidad"
                                    data-testid="prestamo-cantidad"
                                    className={`w-24 px-2.5 py-2 text-sm font-bold border rounded-lg focus:outline-none bg-white ${qtyValida || actionQty === '' ? 'border-slate-300 focus:border-slate-500' : 'border-rose-400 focus:border-rose-500'}`}
                                    autoFocus
                                  />
                                  <span className="text-xs text-slate-500">{unidad}</span>
                                  <div className="ml-auto flex gap-1">
                                    {restante > 1 && (
                                      <button type="button" onClick={() => setActionQty(String(Math.round(restante / 2 * 10000) / 10000))}
                                        className="px-2 py-1 text-[10px] font-bold rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">Mitad</button>
                                    )}
                                    <button type="button" onClick={() => setActionQty(String(restante))}
                                      className="px-2 py-1 text-[10px] font-bold rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">Todo ({restante})</button>
                                  </div>
                                </div>
                                {actionQty !== '' && !qtyValida && (
                                  <p role="alert" className="text-[10px] text-rose-600 font-semibold mt-1">
                                    {qtyNum > restante ? `Solo quedan ${restante} ${unidad} pendientes.` : 'Escribe una cantidad mayor que cero.'}
                                  </p>
                                )}
                              </div>

                              {isFacturar && (
                                <div data-testid="prestamo-vista-previa" className="rounded-lg bg-white border border-slate-200 p-2.5 text-[11px] space-y-1">
                                  <div className="flex justify-between text-slate-500">
                                    <span>Precio del despacho original</span>
                                    <strong className="text-slate-700">{precioU > 0 ? `$${fmtN(precioU)} / ${unidad}` : 'sin precio'}</strong>
                                  </div>
                                  <div className="flex justify-between text-slate-500">
                                    <span>Tasa principal ({etiquetaTasa})</span>
                                    {tasaDelDia > 0
                                      ? <strong className="text-slate-700">Bs {fmtN(tasaDelDia)}</strong>
                                      : <button type="button" onClick={() => refrescarTasa?.()} className="font-bold text-sky-700 underline">Actualizar tasa</button>}
                                  </div>
                                  <div className="flex justify-between items-baseline border-t border-slate-100 pt-1.5">
                                    <span className="font-bold text-slate-600">{pagoModo === 'ahora' ? 'Se cobra ahora' : 'Se sumará a su deuda'}</span>
                                    <span className="text-right">
                                      <strong className="block text-base text-sky-700">${fmtN(totalUsd)}</strong>
                                      {totalBs > 0 && <span className="block text-[10px] text-slate-400">≈ Bs {fmtN(totalBs)}</span>}
                                    </span>
                                  </div>
                                  {sinPrecio && <p className="text-[10px] text-rose-600 font-semibold">Este préstamo no tiene precio en el despacho; no se puede facturar desde aquí.</p>}
                                </div>
                              )}
                              {isFacturar && (
                                <div data-testid="prestamo-forma-cobro" className="space-y-1.5">
                                  <p className="text-[10px] font-bold text-slate-500">¿Cómo se cobra?</p>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <button type="button" onClick={() => setPagoModo('credito')} data-testid="prestamo-a-credito"
                                      className={`py-1.5 rounded-lg text-[11px] font-bold border ${pagoModo === 'credito' ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>
                                      A crédito
                                    </button>
                                    <button type="button" onClick={() => setPagoModo('ahora')} data-testid="prestamo-paga-ahora"
                                      className={`py-1.5 rounded-lg text-[11px] font-bold border ${pagoModo === 'ahora' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200'}`}>
                                      Paga ahora
                                    </button>
                                  </div>
                                  {pagoModo === 'ahora' ? (
                                    <div className="grid grid-cols-2 gap-1.5">
                                      <select value={pagoMetodo} onChange={e => setPagoMetodo(e.target.value)} aria-label="Método de pago" data-testid="prestamo-metodo"
                                        className="px-2 py-1.5 text-[11px] border border-slate-300 rounded-lg bg-white">
                                        {METODOS.filter(m => m !== 'Cruce').map(m => <option key={m} value={m}>{m}</option>)}
                                      </select>
                                      <input type="text" value={pagoReferencia} onChange={e => setPagoReferencia(e.target.value)} placeholder="Referencia (opcional)" aria-label="Referencia del pago"
                                        className="px-2 py-1.5 text-[11px] border border-slate-300 rounded-lg bg-white" />
                                    </div>
                                  ) : (
                                    <p className="text-[10px] text-slate-400">El monto se suma a lo que el cliente debe. Su comisión queda retenida hasta que se cobre.</p>
                                  )}
                                </div>
                              )}
                              {isDevolver && (
                                <p className="text-[10px] text-slate-500">La mercancía vuelve al inventario y no se cobra nada al cliente.</p>
                              )}

                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => { setActiveAction(null); setActionQty('') }}
                                  className="px-3 py-2 text-xs text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg font-bold transition-all"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleActionSubmit(p, activeAction.type)}
                                  disabled={!puedeEnviar}
                                  data-testid="prestamo-confirmar"
                                  className={`flex-1 py-2 text-xs font-black text-white rounded-lg transition-all flex items-center justify-center gap-1 shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${
                                    isDevolver ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-600 hover:bg-sky-700'
                                  }`}
                                >
                                  {actionLoading ? 'Procesando…' : isDevolver ? `Devolver ${qtyValida ? qtyNum : ''} ${unidad}` : (totalUsd > 0 ? `${pagoModo === 'ahora' ? 'Facturar y cobrar' : 'Facturar'} $${fmtN(totalUsd)}` : 'Facturar')}
                                </button>
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {abonoARevertir && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" data-testid="anular-movimiento-modal">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3">
            <h3 className="text-base font-black text-slate-900">
              {abonoARevertir.tipo === 'credito' ? '¿Anular saldo a favor?' : abonoARevertir.tipo === 'devolucion_credito' ? '¿Anular devolución de saldo?' : abonoARevertir.tipo === 'consumo_credito' ? '¿Anular consumo de saldo a favor?' : '¿Anular abono?'}
            </h3>
            <p className="text-sm text-slate-700">
              Monto: <b>{fmtUsd(abonoARevertir.monto_usd)}</b>{abonoARevertir.referencia ? ` · Ref. ${abonoARevertir.referencia}` : ''}.{' '}
              {abonoARevertir.tipo === 'abono' ? 'La deuda del cliente subirá.' : abonoARevertir.tipo === 'credito' ? 'El saldo a favor bajará.' : abonoARevertir.tipo === 'devolucion_credito' ? 'El monto vuelve al saldo a favor.' : 'El saldo a favor vuelve al cliente.'}{' '}
              El movimiento queda guardado en “Movimientos anulados” con tu nombre y el motivo.
            </p>
            <textarea data-testid="anular-movimiento-motivo" value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)}
              placeholder="Motivo de la anulación (mínimo 10 caracteres)"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm min-h-[80px]" />
            {errorAnular && (
              <p data-testid="anular-movimiento-error" role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{errorAnular}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAbonoARevertir(null)} disabled={revertirMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg">Cancelar</button>
              <button type="button" data-testid="anular-movimiento-confirmar"
                disabled={motivoAnular.trim().length < 10 || revertirMutation.isPending}
                onClick={async () => {
                  const mov = abonoARevertir
                  setErrorAnular(null)
                  try {
                    await revertirMutation.mutateAsync({ abonoId: mov.id, motivo: motivoAnular.trim() })
                    if (mov.tipo === 'credito') {
                      setSaldoFavorLocal(prev => Math.max(0, (prev ?? Number(cliente.saldo_a_favor || 0)) - Number(mov.monto_usd)))
                    } else if (mov.tipo === 'devolucion_credito') {
                      setSaldoFavorLocal(prev => (prev ?? Number(cliente.saldo_a_favor || 0)) + Number(mov.monto_usd))
                    } else if (mov.tipo === 'abono') {
                      setSaldoLocal(prev => (prev ?? Number(cliente.saldo_pendiente || 0)) + Number(mov.monto_usd))
                    }
                    setAbonoARevertir(null)
                  } catch (e) {
                    setErrorAnular(e?.message || 'No se pudo anular el movimiento')
                  }
                }}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
                {revertirMutation.isPending ? 'Anulando…' : 'Anular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmación anterior (sin motivo) desactivada en OP-2026-055 */}
      <ConfirmModal
        isOpen={false}
        onClose={() => setAbonoARevertir(null)}
        onConfirm={async () => {
          if (!abonoARevertir) return
          try {
            await revertirMutation.mutateAsync({ abonoId: abonoARevertir.id })
            if (abonoARevertir.tipo === 'credito') {
              setSaldoFavorLocal(prev => Math.max(0, (prev ?? Number(cliente.saldo_a_favor || 0)) - Number(abonoARevertir.monto_usd)))
            } else if (abonoARevertir.tipo === 'devolucion_credito') {
              setSaldoFavorLocal(prev => (prev ?? Number(cliente.saldo_a_favor || 0)) + Number(abonoARevertir.monto_usd))
            } else {
              setSaldoLocal(prev => (prev ?? Number(cliente.saldo_pendiente || 0)) + Number(abonoARevertir.monto_usd))
            }
          } catch (err) {
            // Error handling if mutateAsync fails (usually handled inside the hook or via global toast)
          }
          setAbonoARevertir(null)
        }}
        title={abonoARevertir?.tipo === 'credito' ? "¿Revertir saldo a favor?" : abonoARevertir?.tipo === 'devolucion_credito' ? "¿Revertir devolución?" : "¿Revertir abono?"}
        message={
          abonoARevertir?.tipo === 'credito'
            ? `¿Estás seguro de que deseas revertir esta carga de crédito por valor de ${fmtUsd(abonoARevertir?.monto_usd)}?`
            : abonoARevertir?.tipo === 'devolucion_credito'
            ? `¿Estás seguro de que deseas revertir esta devolución de saldo a favor por valor de ${fmtUsd(abonoARevertir?.monto_usd)}?`
            : `¿Estás seguro de que deseas revertir este abono por valor de ${fmtUsd(abonoARevertir?.monto_usd)}?`
        }
        details={
          abonoARevertir?.tipo === 'credito'
            ? "Esta acción eliminará el crédito de la cuenta del cliente."
            : abonoARevertir?.tipo === 'devolucion_credito'
            ? "Esta acción devolverá el monto al saldo a favor del cliente."
            : "Esta acción eliminará el abono y aumentará la deuda del cliente."
        }
        confirmText="Revertir"
        variant="danger"
      />
    </div>
  )
}
