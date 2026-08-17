// src/components/reportes/TabTransportistas.jsx
// Pestaña del reporte de transportistas locales: comisión externa pendiente + pago FIFO al chofer.
import { useState, useMemo } from 'react'
import { Truck, RefreshCw, FileText, Wallet, DollarSign, RotateCcw } from 'lucide-react'
import {
  useReporteTransportistas,
  useDetalleTransportista,
  usePagarTransportista,
  useRevertirPagoTransportista,
} from '../../hooks/useTransportistas'
import useAuthStore from '../../store/useAuthStore'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import DateRangeSelector from './DateRangeSelector'
import Skeleton from '../ui/Skeleton'
import { Modal } from '../ui/Modal'

function fmt(n) {
  const v = Number(n) || 0
  return v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function TabTransportistas() {
  const [filtro, setFiltro] = useState('pendientes')
  const [pagoModal, setPagoModal] = useState(null)
  const [exportando, setExportando] = useState(false)
  // S3-T2: estado de rango de fechas
  const [rango, setRango] = useState({ from: null, to: null })
  const { data: items = [], isLoading, isError, refetch } = useReporteTransportistas({
    desde: rango.from || null,
    hasta: rango.to   || null,
  })
  const { data: configNegocio } = useConfigNegocio()
  const perfil = useAuthStore(s => s.perfil)
  const puedePagar = ['administracion', 'desarrollador'].includes(perfil?.rol)

  const filtrados = useMemo(() => {
    if (!Array.isArray(items)) return []
    if (filtro === 'pagados')   return items.filter(t => (t.saldo_usd || 0) <= 0.001)
    if (filtro === 'pendientes') return items.filter(t => (t.saldo_usd || 0) > 0.001)
    return items
  }, [items, filtro])

  const totales = useMemo(() => ({
    flete:       filtrados.reduce((s, t) => s + (t.flete_total_usd || 0), 0),
    comision:    filtrados.reduce((s, t) => s + (t.neto_total_usd || 0), 0),
    pagado:      filtrados.reduce((s, t) => s + (t.pagado_usd || 0), 0),
    saldo:       filtrados.reduce((s, t) => s + (t.saldo_usd || 0), 0),
    fleteNomina: filtrados.reduce((s, t) => s + (t.flete_nomina_usd || 0), 0),
  }), [filtrados])

  async function exportarPDF() {
    setExportando(true)
    try {
      const { generarTransportistaResumenPDF } = await import('../../services/pdf/transportistaResumenPDF')
      await generarTransportistaResumenPDF({ items: filtrados, config: configNegocio ?? {}, action: 'download' })
    } catch (e) {
      console.error('[TabTransportistas] exportarPDF error:', e)
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Truck}      label="Choferes locales"       value={filtrados.length}                 color="indigo" />
        <KpiCard icon={DollarSign} label="Flete cobrado"          value={`$${fmt(totales.flete)}`}         color="slate" />
        <KpiCard icon={Wallet}     label="Comisión externa pagada" value={`$${fmt(totales.pagado)}`}        color="green" />
        <KpiCard icon={DollarSign} label="Saldo comisión externa"  value={`$${fmt(totales.saldo)}`}         color="amber" />
      </div>

      {/* Filtros + rango de fechas + acciones */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'pendientes', label: 'Con saldo pendiente' },
          { id: 'pagados',    label: 'Liquidados' },
          { id: 'todos',      label: 'Todos' },
        ].map(f => (
          <button key={f.id} onClick={() => setFiltro(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filtro === f.id ? 'bg-primary text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            {f.label}
          </button>
        ))}

        {/* Selector de rango — S3-T2 */}
        <div className="ml-auto">
          <DateRangeSelector value={rango} onChange={setRango} />
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Recargar">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportarPDF} disabled={exportando || isLoading || filtrados.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold">
            <FileText size={12} />
            {exportando ? 'Generando...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Error al cargar el reporte. <button onClick={() => refetch()} className="underline font-bold">Reintentar</button>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          {filtro === 'pendientes'
            ? 'No hay saldos pendientes por liquidar'
            : filtro === 'pagados'
              ? 'No hay choferes liquidados todavía'
              : 'No hay transportistas locales en el sistema'}
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Chofer</th>
                <th className="text-right px-3 py-2">Despachos</th>
                <th className="text-right px-3 py-2">Flete cobrado</th>
                <th className="text-right px-3 py-2">Comisión externa</th>
                <th className="text-right px-3 py-2">Pagado</th>
                <th className="text-right px-3 py-2">Saldo comisión</th>
                <th className="text-right px-3 py-2">Nómina Carabobo</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(t => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <span>{t.nombre}</span>
                      {t.activo === false && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold uppercase">
                          Inactivo
                        </span>
                      )}
                    </div>
                    {t.config && (
                      <span className="inline-block mt-0.5 text-[10px] text-slate-500 font-medium">
                        {t.config.tipo_calculo === 'porcentaje'
                          ? `${t.config.pct_comision}% del flete fuera de Carabobo`
                          : `Tarifa fija $${Number(t.config.tarifa_fija_usd ?? 0).toFixed(0)} fuera de Carabobo`}
                      </span>
                    )}
                  </td>
                  <td className="text-right px-3 py-2 text-slate-600">{t.despachos}</td>
                  <td className="text-right px-3 py-2 text-slate-600">${fmt(t.flete_total_usd)}</td>
                  <td className="text-right px-3 py-2 font-semibold text-slate-800">${fmt(t.neto_total_usd)}</td>
                  <td className="text-right px-3 py-2 text-green-600">${fmt(t.pagado_usd)}</td>
                  <td className="text-right px-3 py-2 font-black text-amber-600">${fmt(t.saldo_usd)}</td>
                  <td className="text-right px-3 py-2 text-slate-500">
                    {t.despachos_nomina > 0 ? `${t.despachos_nomina} · $${fmt(t.flete_nomina_usd)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {t.saldo_usd > 0.001 && puedePagar && t.activo !== false && (
                      <button onClick={() => setPagoModal(t)}
                        className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold">
                        Pagar
                      </button>
                    )}
                    {t.saldo_usd > 0.001 && t.activo === false && (
                      <span className="text-[10px] text-slate-400" title="Reactiva el transportista para registrar el pago">
                        Reactivar para pagar
                      </span>
                    )}
                    {t.despachos_nomina > 0 && (
                      <span className="text-[10px] text-slate-400" title="El flete dentro de Carabobo se procesa por nómina externa">
                        Nómina externa
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagoModal && (
        <PagarTransportistaModal
          transportista={pagoModal}
          onClose={() => setPagoModal(null)}
        />
      )}
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, color }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-700',
    slate:  'bg-slate-50 text-slate-700',
    green:  'bg-green-50 text-green-700',
    amber:  'bg-amber-50 text-amber-700',
  }
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon size={16} />
        </div>
        <span className="text-xs text-slate-500 font-medium">{label}</span>
      </div>
      <div className="text-lg font-black text-slate-800">{value}</div>
    </div>
  )
}

function PagarTransportistaModal({ transportista, onClose }) {
  const { data: detalle, isLoading: detalleCargando } = useDetalleTransportista(transportista.id)
  const pagar    = usePagarTransportista()
  const revertir = useRevertirPagoTransportista()
  const [monto, setMonto] = useState('')
  const [referencia, setReferencia] = useState('')
  const [nota, setNota] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [confirmandoRevertir, setConfirmandoRevertir] = useState(null) // pagoId pendiente de confirm
  const perfil = useAuthStore(s => s.perfil)
  const puedePagar = ['administracion', 'desarrollador'].includes(perfil?.rol)

  const saldo     = detalle?.saldo_pendiente_usd ?? 0
  const pendientes = detalle?.despachos_pendientes ?? []
  const historico  = detalle?.historico_pagos ?? []

  async function handlePagar(e) {
    if (e) e.preventDefault()
    const m = Number(monto) || 0
    if (m <= 0) return
    try {
      const key = idempotencyKey || crypto.randomUUID()
      setIdempotencyKey(key)
      await pagar.mutateAsync({
        transportistaId: transportista.id,
        monto: m,
        referencia: referencia || undefined,
        nota: nota || undefined,
        idempotencyKey: key,
      })
      setIdempotencyKey('')
      onClose()
    } catch {
      // El hook ya muestra toast de error
    }
  }

  async function handleRevertir(pagoId) {
    try {
      await revertir.mutateAsync(pagoId)
      setConfirmandoRevertir(null)
    } catch {
      // El hook ya muestra toast de error
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Pagar a ${transportista.nombre}`} className="max-w-md">
      <div className="space-y-3">
        {/* Saldo pendiente */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
          <span className="text-amber-700 font-medium">Saldo pendiente: </span>
          <span className="font-black text-amber-600">${fmt(saldo)}</span>
        </div>

        {!puedePagar && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">
            Solo administración o desarrollador pueden liquidar. Tu rol ({perfil?.rol}) no permite esta acción.
          </div>
        )}

        {/* Despachos pendientes */}
        {detalleCargando ? (
          <Skeleton className="h-24" />
        ) : pendientes.length > 0 && (
          <div className="bg-slate-50 rounded-lg p-2 text-xs">
            <div className="font-semibold text-slate-600 mb-1">Despachos pendientes ({pendientes.length}):</div>
            <div className="max-h-28 overflow-y-auto space-y-0.5">
              {pendientes.map(d => (
                <div key={d.id} className="flex justify-between font-mono text-[11px] text-slate-500">
                  <span>#{d.numero} · {new Date(d.creado_en).toLocaleDateString()}</span>
                  <span className="font-bold">${fmt(d.neto_usd)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Formulario de pago */}
        <form onSubmit={handlePagar} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Monto a pagar (USD) *</label>
            <input type="number" min="0" step="0.01" value={monto}
              onChange={e => setMonto(e.target.value)}
              placeholder={`Sugerido: ${saldo.toFixed(2)}`}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Referencia (opcional)</label>
            <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)}
              placeholder="Ej: Transferencia BNC 12345"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Nota (opcional)</label>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
          </div>
        </form>

        {/* Historial de pagos — S2-T6 UI */}
        {!detalleCargando && historico.length > 0 && (
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Historial de pagos ({historico.length})
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
              {historico.map(p => (
                <div key={p.id}
                  className={`flex items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-xs border ${
                    p.revertido
                      ? 'bg-slate-50 border-slate-100 opacity-60'
                      : 'bg-amber-50/60 border-amber-100'
                  }`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-black text-slate-800">${fmt(p.monto_usd)}</span>
                      {p.revertido && (
                        <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[9px] font-bold uppercase tracking-wide">
                          Revertido
                        </span>
                      )}
                    </div>
                    <div className="text-slate-500 truncate mt-0.5">
                      {new Date(p.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                      {(p.excedente_usd || 0) > 0 && ` · Aplicado: $${fmt(p.monto_aplicado_usd)} · Excedente: $${fmt(p.excedente_usd)}`}
                      {p.referencia && ` · ${p.referencia}`}
                    </div>
                    {p.revertido && p.revertido_por_nombre && (
                      <div className="text-slate-400 text-[9px] mt-0.5">
                        Revertido por {p.revertido_por_nombre}
                      </div>
                    )}
                  </div>

                  {/* Botón revertir — solo si no está revertido y puede pagar */}
                  {!p.revertido && puedePagar && (
                    confirmandoRevertir === p.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleRevertir(p.id)}
                          disabled={revertir.isPending}
                          className="px-2 py-1 rounded bg-red-500 hover:bg-red-600 text-white font-bold text-[10px] disabled:opacity-50">
                          {revertir.isPending ? '...' : '¿Sí?'}
                        </button>
                        <button
                          onClick={() => setConfirmandoRevertir(null)}
                          className="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-600 font-bold text-[10px]">
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmandoRevertir(p.id)}
                        title="Revertir este pago"
                        className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <RotateCcw size={12} />
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
        <button onClick={onClose} type="button"
          className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold">
          Cancelar
        </button>
        <button onClick={handlePagar} disabled={pagar.isPending || !puedePagar || !monto}
          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold">
          {pagar.isPending ? 'Procesando...' : 'Pagar'}
        </button>
      </div>
    </Modal>
  )
}
