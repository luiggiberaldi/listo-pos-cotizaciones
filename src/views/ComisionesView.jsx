// src/views/ComisionesView.jsx
// Vista de comisiones agrupadas por vendedor
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DollarSign, CheckCircle, Clock, Filter, TrendingUp, FileText, Download, ChevronDown, ChevronUp } from 'lucide-react'
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

  const pendientes = comisiones.filter(c => c.estado === 'pendiente')
  const pagadas = comisiones.filter(c => c.estado === 'pagada')
  const totalPendiente = pendientes.reduce((s, c) => s + Number(c.total_comision || 0), 0)
  const totalPagado = pagadas.reduce((s, c) => s + Number(c.total_comision || 0), 0)
  const totalGeneral = totalPendiente + totalPagado

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg transition-all duration-200">

      {/* Header: avatar + nombre + total */}
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
            {comisiones.length} comisión{comisiones.length !== 1 ? 'es' : ''}
          </p>
        </div>
        <div className="text-right shrink-0 mr-2">
          <p className="text-lg font-black text-slate-800">{fmtUsd(totalGeneral)}</p>
        </div>
        {abierto ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
      </button>

      {/* Mini resumen siempre visible */}
      <div className="grid grid-cols-3 gap-2 px-4 pb-3 -mt-1">
        <div className="bg-slate-50 rounded-xl px-2.5 py-2 border border-slate-100 text-center">
          <p className="text-[10px] text-slate-400 font-medium">Total</p>
          <p className="text-sm font-black text-slate-700">{fmtUsd(totalGeneral)}</p>
        </div>
        <div className="bg-amber-50 rounded-xl px-2.5 py-2 border border-amber-100 text-center">
          <p className="text-[10px] text-amber-500 font-medium">Pendiente</p>
          <p className="text-sm font-black text-amber-600">{fmtUsd(totalPendiente)}</p>
          <p className="text-[9px] text-slate-400">{pendientes.length}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl px-2.5 py-2 border border-emerald-100 text-center">
          <p className="text-[10px] text-emerald-500 font-medium">Pagado</p>
          <p className="text-sm font-black text-emerald-600">{fmtUsd(totalPagado)}</p>
          <p className="text-[9px] text-slate-400">{pagadas.length}</p>
        </div>
      </div>

      {/* Lista expandible de comisiones individuales */}
      {abierto && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2.5">
          {onExportarPDF && (
            <button
              onClick={() => onExportarPDF(vendedor)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors mb-1"
            >
              <Download size={12} />Exportar PDF
            </button>
          )}
          {comisiones.map(c => {
            const esPendiente = c.estado === 'pendiente'
            return (
              <div key={c.id} className="bg-slate-50 rounded-xl border border-slate-100 p-3 hover:bg-slate-100/60 transition-all">
                {/* Row 1: Despacho + estado + fecha */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={13} className="text-slate-400 shrink-0" />
                    <span className="text-xs font-mono text-slate-500">
                      Despacho #{c.despacho?.numero ?? '—'} · Cot. #{c.cotizacion?.numero ?? '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-400">{fmtFecha(c.creado_en)}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      esPendiente
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {esPendiente ? 'Pendiente' : 'Pagada'}
                    </span>
                  </div>
                </div>

                {/* Row 2: Desglose inline */}
                <div className="flex flex-col gap-1.5 text-xs mb-2">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2">
                    <div className="flex-1 bg-white rounded-lg px-2.5 py-1.5 border border-slate-100">
                      <span className="text-slate-400">Cabilla ({c.pct_cabilla}%)</span>
                      <span className="ml-1.5 font-bold text-slate-600">{fmtUsd(c.monto_cabilla)}</span>
                      <span className="ml-1 font-black text-emerald-600">→ {fmtUsd(c.comision_cabilla)}</span>
                    </div>
                    <div className="flex-1 bg-white rounded-lg px-2.5 py-1.5 border border-slate-100">
                      <span className="text-slate-400">Otros ({c.pct_otros}%)</span>
                      <span className="ml-1.5 font-bold text-slate-600">{fmtUsd(c.monto_otros)}</span>
                      <span className="ml-1 font-black text-emerald-600">→ {fmtUsd(c.comision_otros)}</span>
                    </div>
                  </div>
                  {(c.detalle_extras || []).filter(e => Number(e.monto) > 0).map((extra, idx) => (
                    <div key={idx} className="bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100">
                      <span className="text-amber-600">{extra.cat} ({extra.pct}%)</span>
                      <span className="ml-1.5 font-bold text-slate-600">{fmtUsd(extra.monto)}</span>
                      <span className="ml-1 font-black text-emerald-600">→ {fmtUsd(extra.comision)}</span>
                    </div>
                  ))}
                </div>

                {/* Row 3: Total + acción */}
                <div className="flex items-center justify-between">
                  <span className="text-base font-black text-slate-800">{fmtUsd(c.total_comision)}</span>
                  <div className="flex items-center gap-2">
                    {c.estado === 'pagada' && c.pagada_en && (
                      <span className="text-[11px] text-slate-400">
                        Pagada {new Date(c.pagada_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                    {esSupervisor && esPendiente && (
                      <button
                        onClick={() => onMarcarPagada(c)}
                        disabled={marcando}
                        className="flex items-center gap-1 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg transition-all active:scale-[0.98] disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}
                      >
                        <CheckCircle size={11} />Pagada
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
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esAdministracion = perfil?.rol === 'administracion'
  const esPrivilegiado = esSupervisor || esAdministracion

  const [filtroEstado,   setFiltroEstado]   = useState('')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [comisionAPagar, setComisionAPagar] = useState(null)

  const { data: comisiones = [], isLoading } = useComisiones({
    estado:     filtroEstado,
    vendedorId: esPrivilegiado ? filtroVendedor : '',
  })
  const { data: resumen,   isLoading: resumenLoading } = useComisionesResumen()
  const { data: vendedores = [] } = useVendedores()
  const { data: configNeg = {} } = useConfigNegocio()
  const marcar = useMarcarComisionPagada()
  const [exportando, setExportando] = useState(false)

  // Agrupar comisiones por vendedor
  const comisionesPorVendedor = useMemo(() => {
    const mapa = new Map()
    for (const c of comisiones) {
      const vid = c.vendedor_id
      if (!mapa.has(vid)) mapa.set(vid, { vendedor: c.vendedor, items: [] })
      mapa.get(vid).items.push(c)
    }
    return [...mapa.values()]
  }, [comisiones])

  async function exportarPDF(vendedorFiltro = null) {
    setExportando(true)
    try {
      const lista = vendedorFiltro
        ? comisiones.filter(c => c.vendedor_id === vendedorFiltro.id)
        : comisiones
      await generarComisionesPDF({ comisiones: lista, vendedor: vendedorFiltro, config: configNeg })
    } catch (e) { console.error('Error generando PDF:', e) }
    setExportando(false)
  }

  const selectCls = 'text-sm font-medium px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary transition-colors'

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      <PageHeader
        icon={DollarSign}
        title="Comisiones"
        subtitle="Comisiones generadas por despachos entregados"
      />

      {/* Resumen */}
      {resumenLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
                <Skeleton className="h-3 w-2/3 rounded" />
              </div>
              <Skeleton className="h-7 w-1/2 rounded" />
              <Skeleton className="h-2.5 w-1/3 rounded" />
            </div>
          ))}
        </div>
      ) : resumen && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ResumenCard
            icon={TrendingUp}
            label="Total acumulado"
            value={fmtUsd(resumen.total)}
            sub={`${resumen.countPendiente + resumen.countPagado} comisiones`}
            gradient="linear-gradient(135deg, #1B365D 0%, #0d1f3c 100%)"
            border="rgba(255,255,255,0.07)"
          />
          <ResumenCard
            icon={Clock}
            label="Pendiente de pago"
            value={fmtUsd(resumen.pendiente)}
            sub={`${resumen.countPendiente} por pagar`}
            gradient="linear-gradient(135deg, #92400e 0%, #B8860B 100%)"
            border="rgba(255,255,255,0.10)"
          />
          <ResumenCard
            icon={CheckCircle}
            label="Ya pagado"
            value={fmtUsd(resumen.pagado)}
            sub={`${resumen.countPagado} pagadas`}
            gradient="linear-gradient(135deg, #065f46 0%, #047857 100%)"
            border="rgba(255,255,255,0.10)"
          />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wide">
          <Filter size={12} />Filtros
        </div>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className={selectCls}>
          <option value="">Todas</option>
          <option value="pendiente">Pendientes</option>
          <option value="pagada">Pagadas</option>
        </select>
        {esPrivilegiado && (
          <select value={filtroVendedor} onChange={e => setFiltroVendedor(e.target.value)} className={selectCls}>
            <option value="">Todos los vendedores</option>
            {vendedores.map(v => (
              <option key={v.id} value={v.id}>{v.nombre}</option>
            ))}
          </select>
        )}
        {comisiones.length > 0 && (
          <button
            onClick={() => exportarPDF(null)}
            disabled={exportando}
            className="ml-auto flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md"
            style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
          >
            <Download size={14} />
            {exportando ? 'Generando...' : 'Exportar PDF'}
          </button>
        )}
      </div>

      {/* Lista agrupada por vendedor */}
      {isLoading ? (
        <SkeletonComisiones />
      ) : comisiones.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="Sin comisiones"
          description="Las comisiones se generan automáticamente al marcar un despacho como entregado."
          actionLabel="Ir a despachos"
          onAction={() => navigate('/despachos')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {comisionesPorVendedor.map(g => (
            <VendedorCard
              key={g.vendedor?.id || 'unknown'}
              vendedor={g.vendedor}
              comisiones={g.items}
              esSupervisor={esSupervisor}
              onMarcarPagada={(comision) => setComisionAPagar(comision)}
              marcando={marcar.isPending}
              onExportarPDF={exportarPDF}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={!!comisionAPagar}
        onConfirm={() => { marcar.mutate(comisionAPagar.id); setComisionAPagar(null) }}
        onClose={() => setComisionAPagar(null)}
        title="¿Marcar comisión como pagada?"
        message={comisionAPagar
          ? `Se registrará el pago de ${fmtUsd(comisionAPagar.total_comision)} a ${comisionAPagar.vendedor?.nombre ?? 'el vendedor'}. Esta acción no se puede deshacer.`
          : ''}
        confirmText="Sí, marcar como pagada"
        variant="success"
      />
    </div>
  )
}
