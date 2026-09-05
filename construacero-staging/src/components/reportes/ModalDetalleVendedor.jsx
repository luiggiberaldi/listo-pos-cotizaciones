// src/components/reportes/ModalDetalleVendedor.jsx
import { useState, useMemo } from 'react'
import { DollarSign, Percent, Download, FileText, Printer, Loader2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import Skeleton from '../ui/Skeleton'
import { useComisiones } from '../../hooks/useComisiones'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsd, fmtBs } from '../../utils/format'
import { apiUrl, getAuthHeaders } from '../../services/apiBase'
import supabase from '../../services/supabase/client'

export function prepararComisionParaPDF(evento, cotizacion = null, vendedorFallback = null) {
  const event = evento || {}
  const com = event.comisiones || {}
  const despacho = com.despacho || event.despacho || null
  const cot = cotizacion || com.cotizacion || event.cotizacion || null
  const vendedor = event.vendedor || com.vendedor || vendedorFallback || null

  return {
    ...event,
    monto: Number(event.monto ?? com.totalcomision ?? 0),
    creado_en: event.creado_en || event.creadoen || null,
    comisiones: {
      ...com,
      id: com.id || event.id,
      totalcomision: Number(com.totalcomision ?? event.monto ?? 0),
      comisioncabilla: Number(com.comisioncabilla || 0),
      comisionotros: Number(com.comisionotros || 0),
      pctcabilla: Number(com.pctcabilla || 0),
      pctotros: Number(com.pctotros || 0),
      estado: 'generada',
      despacho: despacho ? {
        ...despacho,
        totalusd: despacho.totalusd !== undefined ? despacho.totalusd : despacho.total_usd,
        creado_en: despacho.creado_en || despacho.creadoEn || null,
        cliente_nombre: despacho.cliente_nombre || despacho.clienteNombre || despacho.cliente?.nombre || null,
        productos: despacho.productos || [],
      } : null,
      cotizacion: cot ? {
        ...cot,
        cliente_nombre: cot.cliente_nombre || cot.cliente?.nombre || null,
      } : null,
    },
    vendedor,
  }
}

function KpiCardMini({ icon: Icon, label, value, gradient, border }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl sm:rounded-2xl p-2.5 sm:p-3 md:p-4 flex flex-col gap-1 sm:gap-2 min-w-0"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
    >
      <div className="absolute -bottom-4 -right-4 w-16 sm:w-20 h-16 sm:h-20 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-start gap-1.5 relative z-10 min-w-0">
        <div className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={12} className="text-white sm:w-3.5 sm:h-3.5 md:w-4 md:h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] sm:text-xs font-medium leading-tight truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</p>
        </div>
      </div>
      <p className="text-base sm:text-xl md:text-2xl font-black leading-tight text-white relative z-10 truncate">{value}</p>
    </div>
  )
}

function SkeletonDetalle() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
}

export default function ModalDetalleVendedor({ vendedor, rango, isOpen, onClose, configNeg, ajustesManuales = {} }) {
  const { data: comisionesRes, isLoading } = useComisiones({
    desde: rango?.from,
    hasta: rango?.to,
    vendedorId: vendedor?.id,
    pageSize: 1000,
  })
  const detalle = comisionesRes?.data ?? []

  const { perfil } = useAuthStore()
  const { tasaEuro, tasaUsdt } = useTasaCambio()
  const [tipoTasaComision, setTipoTasaComision] = useState('euro')
  const tasaSeleccionadaInfo = tipoTasaComision === 'usdt' ? tasaUsdt : tasaEuro
  const tasaSeleccionada = tasaSeleccionadaInfo?.precio || 0
  const tipoTasaLabel = tipoTasaComision === 'usdt' ? 'USDT' : 'Euro BCV'
  const tasaDisponible = Number(tasaSeleccionada) > 0

  const catPrincipal = configNeg?.comision_categoria_cabilla || 'Cabilla'
  const esExterno = !!vendedor?.es_externo || (vendedor?.markup_pct != null && Number(vendedor.markup_pct) > 0)
  const pctCabilla = esExterno ? (configNeg?.comision_ext_pct_cabilla || 2) : (configNeg?.comision_pct_cabilla || 2)
  const labelCabillaHeader = esExterno ? `Cemento (${pctCabilla}%)` : `${catPrincipal} (${pctCabilla}%)`

  const tasaComision = () => tasaSeleccionada || 0

  const totales = detalle.reduce((acc, item) => {
    const total = Number(item.totalcomision || 0)
    acc.totalUsd += total
    acc.comBs += total * tasaSeleccionada
    return acc
  }, { totalUsd: 0, comBs: 0 })

  const [exportando, setExportando] = useState(false)
  const [formatoReporte, setFormatoReporte] = useState('detallado')

  const totalConAjustes = useMemo(() => {
    if (!vendedor) return totales
    const aj = ajustesManuales[vendedor.id] || { cxc: '', descuentoCarro: '' }
    const cxcVal = Number(aj.cxc) || 0
    const descVal = Number(aj.descuentoCarro) || 0
    const rateVal = tasaSeleccionada || 0

    if (formatoReporte === 'resumido') {
      const adjustedUsd = totales.totalUsd + cxcVal - descVal
      const adjustedBs = adjustedUsd * rateVal
      return { totalUsd: adjustedUsd, comBs: adjustedBs }
    }
    return totales
  }, [totales, vendedor, ajustesManuales, formatoReporte, tasaSeleccionada])

  async function exportarPDF(action = 'download') {
    if (!tasaDisponible) {
      alert(`No hay una tasa ${tipoTasaLabel} disponible para generar el PDF.`)
      return
    }
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../../services/pdf/comisionesGeneradasPDF')

      const params = new URLSearchParams()
      params.set('vista', 'eventos')
      params.set('page', '1')
      params.set('pageSize', '1000')
      if (rango?.from) params.set('desde', rango.from)
      if (rango?.to) params.set('hasta', rango.to)
      if (vendedor?.id) params.set('vendedorId', vendedor.id)

      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const resJson = await res.json()
      const rawEvents = resJson.data || []

      if (rawEvents.length === 0) {
        alert(`🔍 SIN DATOS: No hay liberaciones de comisiones para ${vendedor?.nombre || 'este vendedor'} en el periodo seleccionado.`)
        return
      }

      const cotizacionIds = [...new Set(rawEvents.map(r => r.comisiones?.cotizacionid).filter(Boolean))]
      let cotizacionesMap = {}
      if (cotizacionIds.length > 0) {
        const { data: cotList, error: cotErr } = await supabase
          .from('cotizaciones')
          .select('id, numero, tasa_bcv_snapshot, cliente:clientes(id, nombre)')
          .in('id', cotizacionIds)
        if (!cotErr && cotList) {
          cotizacionesMap = Object.fromEntries(cotList.map(c => [c.id, c]))
        }
      }

      const comisionesParaPDF = rawEvents.map(r => prepararComisionParaPDF(
        r,
        r.comisiones?.cotizacion || cotizacionesMap[r.comisiones?.cotizacionid],
        vendedor ? {
          id: vendedor.id,
          nombre: vendedor.nombre,
          color: vendedor.color,
          markup_pct: vendedor.markup_pct,
          es_externo: vendedor.es_externo,
        } : null,
      ))

      await generarComisionesPDF({
        comisiones: comisionesParaPDF,
        vendedor: { nombre: vendedor?.nombre, color: vendedor?.color, markup_pct: vendedor?.markup_pct, es_externo: vendedor?.es_externo },
        rango,
        config: configNeg ?? {},
        action,
        formato: formatoReporte,
        tasaEuro: tasaSeleccionada,
        tasaAplicada: tasaSeleccionada,
        tipoTasa: tipoTasaLabel,
        tasaFuente: tasaSeleccionadaInfo?.fuente,
        tasaActualizadaEn: tasaSeleccionadaInfo?.ultimaActualizacion,
        ajustesManuales,
        modoCorteSemanal: formatoReporte === 'detallado',
      })
    } catch (e) {
      console.error('Error generando PDF individual:', e)
      alert('❌ Error al generar el PDF: ' + e.message)
    } finally {
      setExportando(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <span>Detalle de Comisiones - {vendedor?.nombre || 'Vendedor'}</span>
          {vendedor && (!!vendedor.es_externo || (vendedor.markup_pct != null && Number(vendedor.markup_pct) > 0)) && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded px-1.5 py-0.5">
              💼 {vendedor.markup_pct ? `Externo (+${vendedor.markup_pct}%)` : 'Externo'}
            </span>
          )}
        </div>
      }
      className="max-w-6xl"
    >
      {isLoading ? <SkeletonDetalle /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <KpiCardMini icon={DollarSign} label="Total Comisión USD" value={fmtUsd(totalConAjustes.totalUsd)} gradient="linear-gradient(135deg, #1e293b, #0f172a)" border="rgba(255,255,255,0.05)" />
            <KpiCardMini icon={Percent} label={`Total Comisión Bs (${tipoTasaLabel})`} value={fmtBs(totalConAjustes.comBs)} gradient="linear-gradient(135deg, #065f46, #064e3b)" border="rgba(255,255,255,0.05)" />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={(e) => { e.stopPropagation(); exportarPDF('download') }}
              disabled={exportando || !tasaDisponible}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition-all duration-200 border border-slate-700 shadow-md active:scale-95 disabled:opacity-50 group font-bold text-xs tracking-wide"
              title="Descargar Reporte PDF"
            >
              {exportando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} className="group-hover:translate-y-0.5 transition-transform" />}
              <span>Descargar PDF</span>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); exportarPDF('print') }}
              disabled={exportando || !tasaDisponible}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-900/10 hover:bg-blue-900/20 text-blue-900 transition-all duration-200 border border-blue-900/20 shadow-md active:scale-95 disabled:opacity-50 group font-bold text-xs tracking-wide"
              title="Imprimir Reporte PDF"
            >
              {exportando ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} className="group-hover:scale-110 transition-transform" />}
              <span>Imprimir</span>
            </button>

            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs font-bold shrink-0 h-9">
              <button
                type="button"
                onClick={() => setTipoTasaComision('euro')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${tipoTasaComision === 'euro' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                title="Calcular comisiones con tasa Euro Oficial BCV"
              >
                <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black shrink-0">€</span>
                <span>Euro BCV:</span>
                <b>{tasaEuro?.precio > 0 ? fmtBs(tasaEuro.precio) : 'N/D'}</b>
              </button>
              <button
                type="button"
                onClick={() => setTipoTasaComision('usdt')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${tipoTasaComision === 'usdt' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                title="Calcular comisiones con tasa USDT (Binance P2P)"
              >
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-black shrink-0 font-mono">₮</span>
                <span>USDT:</span>
                <b>{tasaUsdt?.precio > 0 ? fmtBs(tasaUsdt.precio) : 'N/D'}</b>
              </button>
            </div>

            <div className="flex p-0.5 bg-slate-100 rounded-xl h-9 min-w-[180px] border border-slate-200 ml-auto">
              <button
                type="button"
                onClick={() => setFormatoReporte('detallado')}
                className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${formatoReporte === 'detallado' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              >Detallado</button>
              <button
                type="button"
                onClick={() => setFormatoReporte('resumido')}
                className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${formatoReporte === 'resumido' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              >Resumido</button>
            </div>
          </div>

          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
              <FileText size={14} className="text-indigo-500 sm:w-4 sm:h-4" />
              <h3 className="text-xs sm:text-sm font-black text-slate-800 flex-1">Comisiones generadas</h3>
            </div>
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-xs sm:text-sm">
                <thead className="sticky top-0 bg-white shadow-sm z-10">
                  <tr className="text-[10px] sm:text-xs text-slate-400 uppercase border-b border-slate-100">
                    <th className="px-2 sm:px-4 py-2 font-semibold text-left">Fecha</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-left">Cliente / Operación</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">Venta ($)</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">{labelCabillaHeader}</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">Otros</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">Com. ($)</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">Tasa {tipoTasaLabel}</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">Com. (Bs)</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.map((d, i) => {
                    const total = Number(d.totalcomision || 0)
                    const tasa = tasaComision(d)
                    const comBs = total * tasa
                    const valCabilla = Number(d.comisioncabilla || 0)
                    const valOtros = Number(d.comisionotros || 0)
                    const clienteNombre = d.despacho?.cliente_nombre || d.cotizacion?.cliente_nombre || 'Sin cliente'

                    return (
                      <tr
                        key={d.id || i}
                        className="border-b border-slate-50 transition-colors duration-150 hover:bg-slate-50/50"
                      >
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5">
                          <span className="font-bold text-slate-700">{new Date(d.creadoen).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}</span>
                        </td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5">
                          <div className="flex flex-col">
                            <span className="text-[11px] font-bold text-slate-800 truncate max-w-[240px]">
                              {clienteNombre.toUpperCase()}
                            </span>
                            <div className="text-[10px] leading-tight font-mono font-bold space-y-0.5 mt-0.5">
                              <span className="text-slate-500">
                                Desp #{d.despacho?.numero || '—'}{d.cotizacion?.numero ? ` · Cot #${d.cotizacion.numero}` : ''}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-right font-medium text-slate-500">{fmtUsd(d.despacho?.totalusd || 0)}</td>
                        <td className={`px-2 sm:px-4 py-2 sm:py-2.5 text-right font-semibold ${valCabilla === 0 ? 'text-slate-300 font-normal' : 'text-slate-800'}`}>{fmtUsd(valCabilla)}</td>
                        <td className={`px-2 sm:px-4 py-2 sm:py-2.5 text-right font-semibold ${valOtros === 0 ? 'text-slate-300 font-normal' : 'text-slate-800'}`}>{fmtUsd(valOtros)}</td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-right font-black text-slate-900 bg-slate-50/50">{fmtUsd(total)}</td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-right text-[11px] text-slate-500 font-semibold">{tasa > 0 ? `Bs ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : '—'}</td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-right font-black text-indigo-600 bg-indigo-50/20">{fmtBs(comBs)}</td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-center">
                          <span className="text-[9px] font-semibold text-slate-400">generada</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
