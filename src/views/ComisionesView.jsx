// src/views/ComisionesView.jsx
// Vista de comisiones agrupadas por vendedor con soporte para paginación y resumen SQL
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { DollarSign, CheckCircle, Clock, Filter, TrendingUp, FileText, Download, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { useComisiones, useComisionesResumen, useMarcarComisionPagada } from '../hooks/useComisiones'
import { useVendedores } from '../hooks/useClientes'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import useAuthStore from '../store/useAuthStore'
import { fmtUsd, fmtFecha } from '../utils/format'
import { generarComisionesPDF } from '../services/pdf/comisionesPDF'
import PageHeader    from '../components/ui/PageHeader'
import Skeleton      from '../components/ui/Skeleton'
import EmptyState    from '../components/ui/EmptyState'
import ConfirmModal  from '../components/ui/ConfirmModal'

// ─── Tarjeta de resumen ───────────────────────────────────────────────────────
function ResumenCard({ icon: Icon, label, value, sub, gradient, border }) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-3 cursor-default"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.10)' }}>
      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full pointer-events-none"
        style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-center gap-2.5 relative z-10">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={18} className="text-white" />
        </div>
        <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>{label}</p>
      </div>
      <div className="relative z-10">
        <p className="text-2xl font-black leading-tight text-white">{value}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{sub}</p>}
      </div>
    </div>
  )
}

// ─── Tarjeta agrupada por vendedor ──────────────────────────────────────────
function VendedorCard({ vendedor, comisiones, esSupervisor, onMarcarPagada, marcando, onExportarPDF }) {
  const [abierto, setAbierto] = useState(false)

  // Cálculos locales para la tarjeta (basados solo en los datos visibles de la página)
  const totalGeneral = useMemo(() => comisiones.reduce((s, c) => s + Number(c.total_comision || 0), 0), [comisiones])
  const pendientesCount = useMemo(() => comisiones.filter(c => c.estado !== 'pagada').length, [comisiones])
  const pagadasCount = useMemo(() => comisiones.filter(c => c.estado === 'pagada').length, [comisiones])

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg transition-all duration-200">
      <button
        onClick={() => setAbierto(!abierto)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50/50 transition-colors"
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-black"
          style={{ background: vendedor?.color || '#1B365D' }}>
          {(vendedor?.nombre || '?')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 truncate">{vendedor?.nombre ?? 'Vendedor'}</p>
          <p className="text-xs text-slate-400">
            {comisiones.length} en esta página
          </p>
        </div>
        <div className="text-right shrink-0 mr-2">
          <p className="text-lg font-black text-slate-800">{fmtUsd(totalGeneral)}</p>
        </div>
        {abierto ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
      </button>

      <div className="grid grid-cols-2 gap-2 px-4 pb-3 -mt-1">
        <div className="bg-amber-50 rounded-xl px-2.5 py-2 border border-amber-100 text-center">
          <p className="text-[10px] text-amber-500 font-medium">Pendientes (pág)</p>
          <p className="text-sm font-black text-amber-600">{pendientesCount}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl px-2.5 py-2 border border-emerald-100 text-center">
          <p className="text-[10px] text-emerald-500 font-medium">Pagadas (pág)</p>
          <p className="text-sm font-black text-emerald-600">{pagadasCount}</p>
        </div>
      </div>

      {abierto && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2.5">
          {onExportarPDF && (
            <button
              onClick={() => onExportarPDF(vendedor)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors mb-1"
            >
              <Download size={12} />Exportar PDF (Pág)
            </button>
          )}
          {comisiones.map(c => {
            const esPendiente = c.estado !== 'pagada'
            const saldoPagar = Math.max(0, Number(c.comision_liberada || 0) - Number(c.comision_pagada_monto || 0))
            
            return (
              <div key={c.id} className="bg-slate-50 rounded-xl border border-slate-100 p-3 hover:bg-slate-100/60 transition-all">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={13} className="text-slate-400 shrink-0" />
                    <span className="text-xs font-mono text-slate-500">
                      Despacho #{c.notas_despacho?.numero ?? '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-400">{fmtFecha(c.creado_en)}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      esPendiente
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {esPendiente ? (c.estado === 'pago_parcial' ? 'Parcial' : 'Pendiente') : 'Pagada'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 text-xs mb-2">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2">
                    <div className="flex-1 bg-white rounded-lg px-2.5 py-1.5 border border-slate-100">
                      <span className="text-slate-400">Cabilla:</span>
                      <span className="ml-1.5 font-black text-emerald-600">{fmtUsd(c.comision_cabilla)}</span>
                    </div>
                    <div className="flex-1 bg-white rounded-lg px-2.5 py-1.5 border border-slate-100">
                      <span className="text-slate-400">Otros:</span>
                      <span className="ml-1.5 font-black text-emerald-600">{fmtUsd(c.comision_otros)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-base font-black text-slate-800">{fmtUsd(c.total_comision)}</span>
                    {c.comision_pagada_monto > 0 && c.estado !== 'pagada' && (
                      <span className="text-[10px] text-emerald-600 font-bold">Abonado: {fmtUsd(c.comision_pagada_monto)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {esSupervisor && esPendiente && saldoPagar > 0 && (
                      <button
                        onClick={() => onMarcarPagada(c)}
                        disabled={marcando}
                        className="flex items-center gap-1 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg transition-all active:scale-[0.98] disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}
                      >
                        <CheckCircle size={11} />Pagar {fmtUsd(saldoPagar)}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Skeleton de comisiones ───────────────────────────────────────────────────
function SkeletonComisiones() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3 rounded" />
              <Skeleton className="h-2.5 w-1/3 rounded" />
            </div>
            <Skeleton className="h-5 w-20 rounded" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function ComisionesView() {
  const navigate = useNavigate()
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const switchOut = useAuthStore(s => s.switchOut)
  const puedeGestionarPagos = ['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const puedePagarComisiones = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)

  const [filtroEstado,   setFiltroEstado]   = useState('')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [fechaDesde,     setFechaDesde]     = useState('')
  const [fechaHasta,     setFechaHasta]     = useState('')
  const [page,           setPage]           = useState(1)
  const pageSize = 48 // Agrupamos de a 48 para que la cuadrícula sea simétrica (3 col x 16 filas)

  const [comisionAPagar, setComisionAPagar] = useState(null)

  // Reset de página al cambiar filtros
  useEffect(() => { setPage(1) }, [filtroEstado, filtroVendedor, fechaDesde, fechaHasta])

  const { data: comisionesRes, isLoading } = useComisiones({
    estado:     filtroEstado,
    vendedorId: puedeGestionarPagos ? filtroVendedor : '',
    desde:      fechaDesde,
    hasta:      fechaHasta,
    page,
    pageSize
  })

  const { data: resumen, isLoading: resumenLoading } = useComisionesResumen({
    vendedorId: puedeGestionarPagos ? filtroVendedor : '',
    desde:      fechaDesde,
    hasta:      fechaHasta,
    estado:     filtroEstado
  })

  const { data: vendedores = [] } = useVendedores()
  const { data: configNeg = {} } = useConfigNegocio()
  const marcar = useMarcarComisionPagada()
  const [exportando, setExportando] = useState(false)

  const comisiones = comisionesRes?.data ?? []

  // Agrupar comisiones por vendedor
  const comisionesPorVendedor = useMemo(() => {
    const mapa = new Map()
    for (const c of comisiones) {
      const vid = c.vendedor_id || '00000000-0000-0000-0000-000000000000'
      const infoVendedor = c.usuarios || { nombre: 'Sin Asignar', color: '#64748b' }
      if (!mapa.has(vid)) mapa.set(vid, { id: vid, vendedor: infoVendedor, items: [] })
      mapa.get(vid).items.push(c)
    }
    return [...mapa.values()]
  }, [comisiones])

  async function exportarPDF(vendedorFiltro = null) {
    setExportando(true)
    try {
      const items = vendedorFiltro
        ? comisiones.filter(c => (c.vendedor_id || '00000000-0000-0000-0000-000000000000') === vendedorFiltro.id)
        : comisiones
      await generarComisionesPDF({ comisiones: items, vendedor: vendedorFiltro, config: configNeg })
    } catch (e) { console.error('Error PDF:', e) }
    setExportando(false)
  }

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">
      <PageHeader
        icon={DollarSign}
        title="Comisiones"
        subtitle="Reporte financiero de ventas y liquidaciones"
      />

      {/* KPIs (Fuente de verdad SQL) */}
      {resumenLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : resumen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ResumenCard
            icon={TrendingUp}
            label="Total General"
            value={fmtUsd(resumen.total)}
            sub="Histórico bruto"
            gradient="linear-gradient(135deg, #1e293b 0%, #0f172a 100%)"
            border="rgba(255,255,255,0.05)"
          />
          <ResumenCard
            icon={Clock}
            label="Pendiente Cobro"
            value={fmtUsd(resumen.pendiente)}
            sub={`${resumen.countPendiente} registros`}
            gradient="linear-gradient(135deg, #92400e 0%, #78350f 100%)"
            border="rgba(255,255,255,0.05)"
          />
          <ResumenCard
            icon={DollarSign}
            label="En Reserva"
            value={fmtUsd(resumen.retenida)}
            sub="Falta despachar"
            gradient="linear-gradient(135deg, #1B365D 0%, #0d1f3c 100%)"
            border="rgba(255,255,255,0.05)"
          />
          <ResumenCard
            icon={CheckCircle}
            label="Liquidado"
            value={fmtUsd(resumen.pagado)}
            sub={`${resumen.countPagado} pagadas`}
            gradient="linear-gradient(135deg, #065f46 0%, #064e3b 100%)"
            border="rgba(255,255,255,0.05)"
          />
        </div>
      )}

      {/* Filtros Avanzados */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
            <Calendar size={14} className="text-slate-500" />
            <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} className="bg-transparent text-xs font-bold focus:outline-none" />
            <span className="text-slate-300">→</span>
            <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} className="bg-transparent text-xs font-bold focus:outline-none" />
          </div>

          <div className="flex gap-1">
            {[{v:'',l:'Todas'}, {v:'pendiente',l:'Pendientes'}, {v:'pagada',l:'Pagadas'}].map(o => (
              <button key={o.v} onClick={() => setFiltroEstado(o.v)} className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${filtroEstado === o.v ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {o.l}
              </button>
            ))}
          </div>

          {puedeGestionarPagos && (
            <select value={filtroVendedor} onChange={e => setFiltroVendedor(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 outline-none hover:bg-slate-50 transition-all">
              <option value="">Todos los Vendedores</option>
              <option value="00000000-0000-0000-0000-000000000000">Sin Asignar</option>
              {vendedores.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          )}

          {comisiones.length > 0 && (
            <button onClick={() => exportarPDF(null)} disabled={exportando} className="ml-auto flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-slate-200 active:scale-95 transition-all disabled:opacity-50">
              <Download size={14} /> {exportando ? '...' : 'PDF PÁGINA ACTUAL'}
            </button>
          )}
        </div>
      </div>

      {/* Lista Paginada */}
      {isLoading ? <SkeletonComisiones /> : comisiones.length === 0 ? (
        <EmptyState icon={DollarSign} title="Sin resultados" description="No se encontraron comisiones con los filtros actuales." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {comisionesPorVendedor.map(g => (
              <VendedorCard key={g.id} vendedor={g.vendedor} comisiones={g.items} esSupervisor={puedePagarComisiones} onMarcarPagada={setComisionAPagar} marcando={marcar.isPending} onExportarPDF={exportarPDF} />
            ))}
          </div>

          {/* Paginación */}
          {comisionesRes?.totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-4">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 transition-all">
                <ChevronLeft size={20} />
              </button>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-400">Página</span>
                <span className="text-sm font-black text-slate-800">{page}</span>
                <span className="text-sm font-bold text-slate-400">de</span>
                <span className="text-sm font-black text-slate-800">{comisionesRes.totalPages}</span>
              </div>
              <button disabled={page >= comisionesRes.totalPages} onClick={() => setPage(p => p + 1)} className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 transition-all">
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </>
      )}

      <ConfirmModal
        isOpen={!!comisionAPagar}
        onConfirm={() => { marcar.mutate(comisionAPagar.id); setComisionAPagar(null) }}
        onClose={() => setComisionAPagar(null)}
        title="Registrar Pago de Comisión"
        message={comisionAPagar ? `Se registrará el pago de ${fmtUsd(Math.max(0, Number(comisionAPagar.comision_liberada || 0) - Number(comisionAPagar.comision_pagada_monto || 0)))}. Esta acción es atómica y final.` : ''}
        confirmText="Confirmar Pago"
        variant="success"
      />
    </div>
  )
}
