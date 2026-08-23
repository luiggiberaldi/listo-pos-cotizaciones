// src/views/ComisionesView.jsx
// Vista de comisiones generadas; la liquidacion se realiza fuera del sistema.
import { useState, useMemo } from 'react'
import {
  DollarSign, Percent, FileText, Download, ChevronDown,
  ChevronLeft, ChevronRight, Calendar, User, Briefcase,
} from 'lucide-react'
import { useComisiones, useComisionesResumen } from '../hooks/useComisiones'
import { useVendedores } from '../hooks/useClientes'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import useAuthStore from '../store/useAuthStore'
import { fmtUsd, fmtFecha, fmtBs } from '../utils/format'
import PageHeader from '../components/ui/PageHeader'
import Skeleton from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { countUniqueDispatches } from '../utils/comisionUtils'

function ResumenCard({ icon: Icon, label, value, sub, gradient, border }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.10)' }}
    >
      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-center gap-2.5 relative z-10">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={18} className="text-white" />
        </div>
        <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>{label}</p>
      </div>
      <div className="relative z-10">
        <p className="text-2xl font-black leading-tight text-white">{value}</p>
        {sub && <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{sub}</div>}
      </div>
    </div>
  )
}

function VendedorCard({ vendedor, comisiones, onExportarPDF, config }) {
  const [abierto, setAbierto] = useState(false)
  const esExterno = !!vendedor?.es_externo || (vendedor?.markup_pct != null && Number(vendedor.markup_pct) > 0)
  const totalGenerado = useMemo(
    () => comisiones.reduce((sum, item) => sum + Number(item.totalcomision || 0), 0),
    [comisiones],
  )
  const despachosUnicos = useMemo(() => countUniqueDispatches(comisiones), [comisiones])
  const catName = esExterno
    ? `Cemento (${config?.comision_ext_pct_cabilla || 2}%)`
    : `${config?.comision_categoria_cabilla || 'Cabilla'} (${config?.comision_pct_cabilla || 2}%)`

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg transition-all duration-200">
      <button
        type="button"
        onClick={() => setAbierto(value => !value)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-50/50 transition-colors"
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-black shadow-inner"
          style={{ background: esExterno ? '#D97706' : (vendedor?.color || '#1B365D') }}
        >
          {(vendedor?.nombre || '?')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-bold text-slate-800 truncate">{vendedor?.nombre || 'Sin asignar'}{esExterno && ' (E)'}</h3>
            {esExterno && <span className="text-[9px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded px-1.5 py-0.5">Externo</span>}
            {onExportarPDF && (
              <span
                role="button"
                tabIndex={0}
                onClick={event => { event.stopPropagation(); onExportarPDF(vendedor) }}
                onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); onExportarPDF(vendedor) } }}
                className="p-1.5 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent hover:border-indigo-100"
                title="Exportar reporte PDF"
              >
                <Download size={14} />
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-medium">{despachosUnicos} despachos únicos</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Generada</p>
          <p className="text-lg font-black text-emerald-600 leading-none">{fmtUsd(totalGenerado)}</p>
        </div>
      </button>

      {abierto && (
        <div className="border-t border-slate-100 bg-slate-50/30 overflow-x-auto">
          <table className="w-full min-w-[650px] text-xs text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] text-slate-400 uppercase tracking-wider bg-slate-50/80">
                <th className="px-3 py-2 font-semibold">Operación</th>
                <th className="px-3 py-2 font-semibold">{catName} / Otros</th>
                <th className="px-3 py-2 font-semibold text-right">Comisión</th>
                <th className="px-3 py-2 font-semibold text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/60">
              {comisiones.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-bold text-slate-800 truncate max-w-[220px]">
                        {(item.despacho?.cliente_nombre || item.cotizacion?.cliente_nombre || 'Sin cliente').toUpperCase()}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">#{item.despacho?.numero ?? '---'} · {fmtFecha(item.creadoen)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col text-[11px]">
                      <span className="text-slate-500">{catName}: <b className="text-slate-700">{fmtUsd(item.comisioncabilla)}</b></span>
                      <span className="text-slate-500">Otros: <b className="text-slate-700">{fmtUsd(item.comisionotros)}</b></span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-black text-slate-900">{fmtUsd(item.totalcomision)}</td>
                  <td className="px-3 py-2.5 text-center"><span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">Generada</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SkeletonComisiones() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-3"><Skeleton className="w-10 h-10 rounded-full shrink-0" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-2/3 rounded" /><Skeleton className="h-2.5 w-1/3 rounded" /></div><Skeleton className="h-5 w-20 rounded" /></div>
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ))}
    </div>
  )
}

function TablaLiquidacionInteractiva({ sellers, ajustes, onChange, tasaSeleccionada, tipoTasaLabel = 'Euro BCV' }) {
  const rate = Number(tasaSeleccionada || 0)
  const totalPeriodo = sellers.reduce((sum, seller) => sum + seller.generadoUsd, 0)
  const totalCxC = sellers.reduce((sum, seller) => sum + Number(ajustes[seller.id]?.cxc || 0), 0)
  const totalDesc = sellers.reduce((sum, seller) => sum + Number(ajustes[seller.id]?.descuentoCarro || 0), 0)
  const totalGeneralUsd = totalPeriodo + totalCxC - totalDesc

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><div className="w-1.5 h-4 bg-indigo-600 rounded-full" /><h4 className="text-xs font-black text-slate-700 uppercase tracking-wider">Resumen de comisiones</h4></div>
        <p className="text-[10px] text-slate-400 font-bold uppercase">CxC y descuento se registran manualmente</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left border-collapse text-xs">
          <thead><tr className="border-b border-slate-100 text-[10px] text-slate-400 uppercase font-black tracking-wider bg-slate-50/30">
            <th className="px-4 py-3">Vendedor</th><th className="px-4 py-3 text-right">Comisión período ($)</th><th className="px-4 py-3 text-center bg-amber-50/40 text-amber-700">Comisión CxC ($)</th><th className="px-4 py-3 text-center">Descuento Carro ($)</th><th className="px-4 py-3 text-right">Total a Pagar ($)</th><th className="px-4 py-3 text-right">Total en Bs ({tipoTasaLabel})</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {sellers.map(seller => {
              const adjustment = ajustes[seller.id] || { cxc: '', descuentoCarro: '' }
              const totalRowUsd = seller.generadoUsd + Number(adjustment.cxc || 0) - Number(adjustment.descuentoCarro || 0)
              return (
                <tr key={seller.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 flex items-center gap-2.5"><div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-black" style={{ background: seller.color || '#1B365D' }}>{seller.nombre[0]?.toUpperCase()}</div><span className="font-bold text-slate-800">{seller.nombre}{seller.esExterno && ' (E)'}</span></td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{fmtUsd(seller.generadoUsd)}</td>
                  <td className="px-4 py-3 text-center bg-amber-50/10"><input type="number" min="0" step="0.01" placeholder="0.00" value={adjustment.cxc} onChange={event => onChange(seller.id, 'cxc', event.target.value)} className="w-32 h-8 px-2 text-right text-xs font-black text-amber-700 bg-amber-50 border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/40" /></td>
                  <td className="px-4 py-3 text-center"><input type="number" min="0" step="0.01" placeholder="0.00" value={adjustment.descuentoCarro} onChange={event => onChange(seller.id, 'descuentoCarro', event.target.value)} className="w-32 h-8 px-2 text-right text-xs font-black text-red-700 bg-red-50 border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400/40" /></td>
                  <td className="px-4 py-3 text-right font-black text-slate-900">{fmtUsd(totalRowUsd)}</td>
                  <td className="px-4 py-3 text-right font-black text-slate-600">{rate > 0 ? fmtBs(totalRowUsd * rate) : 'N/D'}</td>
                </tr>
              )
            })}
            <tr className="bg-slate-50 font-bold border-t-2 border-slate-200"><td className="px-4 py-3 font-black text-indigo-900">TOTAL GENERAL</td><td className="px-4 py-3 text-right font-black">{fmtUsd(totalPeriodo)}</td><td className="px-4 py-3 text-center font-black text-amber-700">{fmtUsd(totalCxC)}</td><td className="px-4 py-3 text-center font-black text-red-700">{fmtUsd(totalDesc)}</td><td className="px-4 py-3 text-right font-black text-slate-900">{fmtUsd(totalGeneralUsd)}</td><td className="px-4 py-3 text-right font-black text-slate-700">{rate > 0 ? fmtBs(totalGeneralUsd * rate) : 'N/D'}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ComisionesView() {
  const perfil = useAuthStore(state => state.perfil)
  const esPrivilegiado = ['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [page, setPage] = useState(1)
  const [formatoReporte, setFormatoReporte] = useState('detallado')
  const [ajustesManuales, setAjustesManuales] = useState({})
  const { tasaEuro, tasaUsdt } = useTasaCambio()
  const [tipoTasaComision, setTipoTasaComision] = useState('euro')
  const tasaSeleccionadaInfo = tipoTasaComision === 'usdt' ? tasaUsdt : tasaEuro
  const tasaSeleccionada = Number(tasaSeleccionadaInfo?.precio || 0)
  const tipoTasaLabel = tipoTasaComision === 'usdt' ? 'USDT' : 'Euro BCV'
  const tasaDisponible = tasaSeleccionada > 0
  const pageSize = 1000

  const { data: comisionesRes, isLoading, isError, refetch } = useComisiones({
    vendedorId: esPrivilegiado ? filtroVendedor : '',
    desde: fechaDesde,
    hasta: fechaHasta,
    page,
    pageSize,
  })
  const { data: resumen, isLoading: resumenLoading } = useComisionesResumen({
    vendedorId: esPrivilegiado ? filtroVendedor : '',
    desde: fechaDesde,
    hasta: fechaHasta,
  })
  const { data: vendedores = [] } = useVendedores()
  const { data: configNeg = {} } = useConfigNegocio()
  const comisiones = comisionesRes?.data ?? []

  const [exportando, setExportando] = useState(false)
  const [vendedorSeleccionado, setVendedorSeleccionado] = useState(null)

  const handleAjusteChange = (sellerId, field, value) => {
    setAjustesManuales(previous => ({ ...previous, [sellerId]: { ...(previous[sellerId] || { cxc: '', descuentoCarro: '' }), [field]: value } }))
  }

  const grupos = useMemo(() => {
    const map = new Map()
    comisiones.forEach(item => {
      const id = item.vendedorid || '00000000-0000-0000-0000-000000000000'
      if (!map.has(id)) map.set(id, { id, vendedor: item.vendedor || { nombre: 'Sin asignar', color: '#64748b' }, items: [] })
      map.get(id).items.push(item)
    })
    return [...map.values()]
  }, [comisiones])

  const sellersSummary = useMemo(() => grupos.map(group => {
    const seller = group.vendedor || {}
    const esExterno = !!seller.es_externo || (seller.markup_pct != null && Number(seller.markup_pct) > 0)
    return {
      id: group.id,
      nombre: seller.nombre || 'Sin asignar',
      color: seller.color || '#64748b',
      esExterno,
      generadoUsd: group.items.reduce((sum, item) => sum + Number(item.totalcomision || 0), 0),
      cantidad: countUniqueDispatches(group.items),
    }
  }).sort((a, b) => a.nombre.localeCompare(b.nombre)), [grupos])

  const vendedoresDisponibles = useMemo(() => {
    const map = new Map()
    comisiones.forEach(item => {
      if (item.vendedor?.id && !map.has(item.vendedor.id)) map.set(item.vendedor.id, item.vendedor)
    })
    vendedores.forEach(item => { if (!map.has(item.id)) map.set(item.id, item) })
    return [...map.values()].filter(item => item.rol !== 'administracion' && item.rol !== 'desarrollador' && item.rol !== 'logistica').sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
  }, [comisiones, vendedores])

  async function exportarPDF(vendedor = null, accion = 'download') {
    if (!tasaDisponible) {
      alert(`No hay una tasa ${tipoTasaLabel} disponible para generar el PDF.`)
      return
    }
    setExportando(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '1000' })
      if (fechaDesde) params.set('desde', fechaDesde)
      if (fechaHasta) params.set('hasta', fechaHasta)
      if (vendedor?.id || filtroVendedor) params.set('vendedorId', vendedor?.id || filtroVendedor)
      const headers = await getAuthHeaders()
      const response = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      const payload = await response.json()
      const rows = payload.data || []
      if (rows.length === 0) throw new Error('No hay comisiones generadas en el período seleccionado')
      const { generarComisionesPDF } = await import('../services/pdf/comisionesGeneradasPDF')
      await generarComisionesPDF({
        comisiones: rows,
        vendedor: vendedor ? { nombre: vendedor.nombre, color: vendedor.color, markup_pct: vendedor.markup_pct, es_externo: vendedor.es_externo } : null,
        rango: { from: fechaDesde, to: fechaHasta },
        config: configNeg,
        action: accion,
        formato: formatoReporte,
        tasaAplicada: tasaSeleccionada,
        tipoTasa: tipoTasaLabel,
        tasaFuente: tasaSeleccionadaInfo?.fuente,
        tasaActualizadaEn: tasaSeleccionadaInfo?.ultimaActualizacion,
        ajustesManuales,
        modoCorteSemanal: formatoReporte === 'detallado',
      })
    } catch (error) {
      console.error('Error generando PDF de comisiones:', error)
      alert(`No se pudo generar el PDF: ${error.message}`)
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-4">
      <PageHeader icon={DollarSign} title="Comisiones" subtitle="Comisiones generadas y ajustes manuales para el corte" />
      {resumenLoading ? <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div> : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ResumenCard icon={DollarSign} label="Comisión generada" value={fmtUsd(resumen?.totalAcumulado || 0)} sub={`${resumen?.totalDespachos || 0} despachos únicos`} gradient="linear-gradient(135deg, #1e293b, #0f172a)" border="rgba(255,255,255,0.05)" />
          <ResumenCard icon={Percent} label="Comisión CxC manual" value="Aparte" sub="La administra el responsable del corte" gradient="linear-gradient(135deg, #92400e, #78350f)" border="rgba(255,255,255,0.05)" />
          <ResumenCard icon={FileText} label="Estado del registro" value="Generada" sub="Sin pago dentro del sistema" gradient="linear-gradient(135deg, #065f46, #064e3b)" border="rgba(255,255,255,0.05)" />
        </div>
      )}

      <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[9px] font-black text-slate-400 uppercase tracking-wider">Desde<input type="date" value={fechaDesde} max={fechaHasta || undefined} onChange={event => { setFechaDesde(event.target.value); setPage(1) }} className="bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700" /></label>
          <label className="flex flex-col gap-1 text-[9px] font-black text-slate-400 uppercase tracking-wider">Hasta<input type="date" value={fechaHasta} min={fechaDesde || undefined} onChange={event => { setFechaHasta(event.target.value); setPage(1) }} className="bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700" /></label>
          {esPrivilegiado && <label className="flex flex-col gap-1 text-[9px] font-black text-slate-400 uppercase tracking-wider">Vendedor<select value={filtroVendedor} onChange={event => { setFiltroVendedor(event.target.value); setPage(1) }} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700"><option value="">Todos los vendedores</option>{vendedoresDisponibles.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>}
          <div className="flex p-0.5 bg-slate-100 rounded-xl h-9 border border-slate-200"><button type="button" onClick={() => setFormatoReporte('detallado')} className={`px-3 text-[11px] font-bold rounded-lg ${formatoReporte === 'detallado' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>Detallado</button><button type="button" onClick={() => setFormatoReporte('resumido')} className={`px-3 text-[11px] font-bold rounded-lg ${formatoReporte === 'resumido' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>Resumido</button></div>
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs font-bold h-9"><button type="button" onClick={() => setTipoTasaComision('euro')} className={`px-2.5 py-1 rounded-lg ${tipoTasaComision === 'euro' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>€ Euro BCV: {tasaEuro?.precio > 0 ? fmtBs(tasaEuro.precio) : 'N/D'}</button><button type="button" onClick={() => setTipoTasaComision('usdt')} className={`px-2.5 py-1 rounded-lg ${tipoTasaComision === 'usdt' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>₮ USDT: {tasaUsdt?.precio > 0 ? fmtBs(tasaUsdt.precio) : 'N/D'}</button></div>
          <div className="flex gap-2 ml-auto"><button type="button" onClick={() => exportarPDF(null, 'print')} disabled={exportando || !comisiones.length || !tasaDisponible} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 disabled:opacity-50"><FileText size={13} /> Imprimir PDF</button><button type="button" onClick={() => exportarPDF()} disabled={exportando || !comisiones.length || !tasaDisponible} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-50"><Download size={13} /> {exportando ? 'Generando...' : 'Descargar PDF'}</button></div>
        </div>
      </div>

      {isLoading ? <SkeletonComisiones /> : isError ? <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700"><p className="font-semibold">Error al cargar comisiones</p><button type="button" onClick={refetch} className="mt-3 text-sm underline">Intentar de nuevo</button></div> : comisiones.length === 0 ? <EmptyState icon={DollarSign} title="Sin comisiones generadas" description="No hay registros en el período seleccionado." /> : formatoReporte === 'resumido' ? <TablaLiquidacionInteractiva sellers={sellersSummary} ajustes={ajustesManuales} onChange={handleAjusteChange} tasaSeleccionada={tasaSeleccionada} tipoTasaLabel={tipoTasaLabel} /> : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {grupos.map(group => <VendedorCard key={group.id} vendedor={group.vendedor} comisiones={group.items} onExportarPDF={seller => exportarPDF(seller)} config={configNeg} />)}
          </div>
          {comisionesRes?.totalPages > 1 && <div className="flex items-center justify-center gap-4 pt-4"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)} className="p-2.5 rounded-xl border border-slate-200 bg-white disabled:opacity-30"><ChevronLeft size={20} /></button><span className="text-sm font-bold text-slate-600">Página {page} de {comisionesRes.totalPages}</span><button type="button" disabled={page >= comisionesRes.totalPages} onClick={() => setPage(value => value + 1)} className="p-2.5 rounded-xl border border-slate-200 bg-white disabled:opacity-30"><ChevronRight size={20} /></button></div>}
        </>
      )}
      {vendedorSeleccionado && <span className="hidden">{vendedorSeleccionado.id}</span>}
    </div>
  )
}
