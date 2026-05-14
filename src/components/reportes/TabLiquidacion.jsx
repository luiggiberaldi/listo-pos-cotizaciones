// src/components/reportes/TabLiquidacion.jsx
// Liquidación 2.0 — Vista unificada de Ventas + Comisiones sincronizada con el backend atómico
import { useState, useMemo } from 'react'
import {
  DollarSign, Percent, AlertTriangle, CreditCard,
  Download, ChevronDown, ChevronRight,
  CheckCircle, Clock, Filter,
} from 'lucide-react'
import { useReporteLiquidacion } from '../../hooks/useReporteLiquidacion'
import { useMarcarComisionPagada, useComisiones, useComisionesResumen } from '../../hooks/useComisiones'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { fmtUsd } from '../../utils/format'
import Skeleton from '../ui/Skeleton'
import EmptyState from '../ui/EmptyState'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtFecha(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtPago(pago) {
  if (!pago) return '—'
  try {
    const parsed = typeof pago === 'string' ? JSON.parse(pago) : pago
    if (Array.isArray(parsed)) {
      return parsed.map(p => {
        const metodo = p.metodo || p.method || ''
        const monto  = p.monto  || p.amount || 0
        return monto > 0 ? `${metodo}: $${Number(monto).toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : metodo
      }).filter(Boolean).join(' · ') || '—'
    }
    if (typeof parsed === 'string') return parsed
  } catch { /* Ignorar */ }
  return String(pago)
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, gradient, border }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-3 sm:p-4 flex flex-col gap-1.5 min-w-0"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.10)' }}>
      <div className="absolute -bottom-4 -right-4 w-16 h-16 rounded-full pointer-events-none"
        style={{ background: 'rgba(255,255,255,0.06)' }} />
      <div className="flex items-center gap-2 relative z-10">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={14} className="text-white" />
        </div>
        <p className="text-[11px] font-medium leading-tight" style={{ color: 'rgba(255,255,255,0.65)' }}>{label}</p>
      </div>
      <p className="text-xl sm:text-2xl font-black leading-tight text-white relative z-10 truncate">{value}</p>
      {sub && <p className="text-[11px] relative z-10" style={{ color: 'rgba(255,255,255,0.45)' }}>{sub}</p>}
    </div>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
function SkeletonLiquidacion() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <Skeleton className="h-4 w-1/3 rounded" />
        {[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    </div>
  )
}

// ─── Grupo por asesor ─────────────────────────────────────────────────────────
function AsesorGroup({ grupo, comisionesDB, marcarPagada, defaultOpen = false }) {
  const [expandido, setExpandido] = useState(defaultOpen)
  const [pagando, setPagando] = useState({ actual: 0, total: 0 })
  const loadingPago = marcarPagada.isPending || pagando.total > 0

  // Buscar comisiones reales en la BD usando vendedor_id (sin depender de nombres)
  // Nota: Filtramos solo las que tienen saldo pendiente real.
  const comisionesAsesor = useMemo(() => {
    const vid = grupo.vendedor_id
    if (!vid || !comisionesDB) return []
    return comisionesDB.filter(c => 
      c.vendedor_id === vid && 
      c.estado !== 'pagada' &&
      Math.max(0, Number(c.comision_liberada || 0) - Number(c.comision_pagada_monto || 0)) > 0
    )
  }, [comisionesDB, grupo.vendedor_id])

  const totalSaldoPendiente = useMemo(() => 
    comisionesAsesor.reduce((s, c) => s + Math.max(0, Number(c.comision_liberada || 0) - Number(c.comision_pagada_monto || 0)), 0),
    [comisionesAsesor]
  )

  async function handlePagar() {
    if (!comisionesAsesor.length) return
    setPagando({ actual: 0, total: comisionesAsesor.length })
    
    try {
      let count = 0
      for (const com of comisionesAsesor) {
        await marcarPagada.mutateAsync(com.id)
        count++
        setPagando(v => ({ ...v, actual: count }))
      }
    } finally {
      setPagando({ actual: 0, total: 0 })
    }
  }

  return (
    <div className="rounded-xl border overflow-hidden transition-all duration-200"
      style={{ borderColor: totalSaldoPendiente === 0 ? '#bbf7d0' : '#e2e8f0' }}>

      {/* Cabecera */}
      <div
        className="flex items-center justify-between px-3 sm:px-4 py-3 cursor-pointer select-none"
        style={{ background: totalSaldoPendiente === 0 ? 'linear-gradient(135deg,#f0fdf4,#dcfce7)' : 'linear-gradient(135deg,#f8fafc,#f1f5f9)' }}
        onClick={() => setExpandido(v => !v)}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="shrink-0 text-slate-400">
            {expandido ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-bold text-white text-sm"
            style={{ background: grupo.color || '#1B365D' }}>
            {(grupo.asesor || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-800 text-sm truncate">{grupo.asesor}</p>
            <p className="text-[10px] text-slate-500">{grupo.items.length} ventas registradas</p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-5 shrink-0">
          <div className="hidden sm:flex items-center gap-4 text-xs text-right">
            <div>
              <p className="text-slate-400 text-[10px]">Ventas</p>
              <p className="font-bold text-slate-800">{fmtUsd(grupo.totalVentas)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-[10px]">Pendiente Real</p>
              <p className={`font-black ${totalSaldoPendiente > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {fmtUsd(totalSaldoPendiente)}
              </p>
            </div>
          </div>

          {totalSaldoPendiente > 0 ? (
            <button
              onClick={e => { e.stopPropagation(); handlePagar() }}
              disabled={loadingPago}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition-all active:scale-95 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#065f46,#047857)' }}>
              {loadingPago ? (
                <>
                  <Clock size={11} className="animate-spin" />
                  {pagando.total > 0 ? `Pagando ${pagando.actual}/${pagando.total}...` : 'Procesando...'}
                </>
              ) : (
                <>
                  <CheckCircle size={11} />
                  Pagar {fmtUsd(totalSaldoPendiente)}
                </>
              )}
            </button>
          ) : (
            <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">
              <CheckCircle size={12} /> Al día
            </span>
          )}
        </div>
      </div>

      {/* Tabla */}
      {expandido && (
        <div className="overflow-x-auto bg-white">
          <table className="w-full text-xs min-w-[600px]">
            <thead className="sticky top-0 z-10">
              <tr className="text-[10px] text-slate-400 uppercase border-b border-slate-100 bg-slate-50/80">
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Despacho</th>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-right px-3 py-2">Monto Venta</th>
                <th className="text-right px-3 py-2">Total Comisión</th>
                <th className="text-right px-3 py-2">Pagado</th>
                <th className="text-right px-3 py-2">Pendiente</th>
                <th className="text-center px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {grupo.ventas.map((r, i) => {
                const com = r.comision || {}
                const pend = Math.max(0, Number(com.comision_liberada || 0) - Number(com.comision_pagada_monto || 0))
                const pag = Number(com.comision_pagada_monto || 0)
                
                return (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmtFecha(r.entregada_en)}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 text-[11px]">#{r.numero}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-800 truncate max-w-[120px]">{r.cliente?.nombre || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-slate-700">{fmtUsd(r.ventaNeta)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-slate-800">{fmtUsd(com.totalcomision || 0)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-600 font-bold">{fmtUsd(pag)}</td>
                    <td className="px-3 py-2.5 text-right text-amber-600 font-black">{fmtUsd(pend)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        com.estado === 'pagada' ? 'bg-emerald-100 text-emerald-700' :
                        com.estado === 'pago_parcial' ? 'bg-indigo-100 text-indigo-700' :
                        com.estado === 'retenida' ? 'bg-slate-100 text-slate-500' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {com.estado === 'pagada' ? 'Pagada' : 
                         com.estado === 'pago_parcial' ? 'Parcial' : 
                         com.estado === 'retenida' ? 'Retenida' : 'Pendiente'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function TabLiquidacion({ range }) {
  const [expandirTodos, setExpandirTodos] = useState(false)
  const [filtroAsesor, setFiltroAsesor] = useState('')
  const [exportando, setExportando] = useState(false)

  // 1. Reporte de ventas (para la tabla detallada)
  const { data, isLoading, isError, refetch } = useReporteLiquidacion({
    fechaInicio: range.from,
    fechaFin: range.to,
    vendedorId: filtroAsesor || undefined,
  })

  // 2. Resumen SQL (Fuente de verdad para los KPIs)
  const { data: sqlResumen, isLoading: kpisLoading } = useComisionesResumen({
    desde:      range.from,
    hasta:      range.to,
    vendedorId: filtroAsesor || '',
    estado:     '' 
  })

  // 3. Cargar comisiones (Lote amplio para permitir pagos de un asesor)
  const { data: comRes } = useComisiones({
    desde:      range.from,
    hasta:      range.to,
    vendedorId: filtroAsesor || '',
    pageSize:   1000 // Cargamos un lote grande para asegurar que el botón "Pagar" vea todo lo del asesor
  })
  const comisionesDB = comRes?.data || []

  const marcarPagada = useMarcarComisionPagada()
  const { data: config = {} } = useConfigNegocio()

  async function handleExportar() {
    if (!data?.registros?.length) return
    setExportando(true)
    try { 
      const { generarLiquidacionPDF } = await import('../../services/pdf/liquidacionPDF.js')
      await generarLiquidacionPDF({ data, range, config }) 
    }
    catch (e) { console.error('[Export PDF]', e) }
    finally { setExportando(false) }
  }

  if (isLoading || kpisLoading) return <SkeletonLiquidacion />
  if (isError) return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
      <p className="font-semibold">Error al cargar el reporte</p>
      <button onClick={refetch} className="mt-3 text-sm underline">Intentar de nuevo</button>
    </div>
  )
  if (!data || data.registros.length === 0) {
    return <EmptyState icon={DollarSign} title="Sin movimientos" description="No hay ventas entregadas para este período." />
  }

  const { porAsesor, asesores } = data

  return (
    <div className="space-y-4">
      {/* KPIs Sincronizados con SQL */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={DollarSign} label="Total Ventas"
          value={fmtUsd(data.kpis.totalVentas)}
          gradient="linear-gradient(135deg,#1e293b,#0f172a)" border="rgba(255,255,255,0.05)" />
        <KpiCard icon={Percent} label="Comisión Total"
          value={fmtUsd(sqlResumen?.total || 0)}
          gradient="linear-gradient(135deg,#1B365D,#0d1f3c)" border="rgba(255,255,255,0.05)" />
        <KpiCard icon={AlertTriangle} label="Por Pagar"
          value={fmtUsd(sqlResumen?.pendiente || 0)}
          sub="Basado en liberación"
          gradient="linear-gradient(135deg,#92400e,#78350f)" border="rgba(255,255,255,0.05)" />
        <KpiCard icon={CheckCircle} label="Liquidado"
          value={fmtUsd(sqlResumen?.pagado || 0)}
          gradient="linear-gradient(135deg,#065f46,#064e3b)" border="rgba(255,255,255,0.05)" />
      </div>

      {/* Herramientas */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-slate-400 shrink-0" />
          <select value={filtroAsesor} onChange={e => setFiltroAsesor(e.target.value)} className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 outline-none">
            <option value="">Todos los asesores</option>
            {porAsesor.map(g => <option key={g.vendedor_id} value={g.vendedor_id}>{g.asesor}</option>)}
          </select>
          <button onClick={() => setExpandirTodos(v => !v)} className="text-xs font-bold text-slate-500 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors">
            {expandirTodos ? 'Colapsar todo' : 'Expandir todo'}
          </button>
        </div>
        <button onClick={handleExportar} disabled={exportando} className="flex items-center gap-1.5 text-xs font-black px-5 py-2.5 rounded-xl text-white shadow-lg active:scale-95 disabled:opacity-60 transition-all" style={{ background: 'linear-gradient(135deg,#10b981,#047857)' }}>
          <Download size={14} /> {exportando ? '...' : 'EXPORTAR PDF'}
        </button>
      </div>

      <div className="space-y-2">
        {porAsesor.map(grupo => (
          <AsesorGroup key={grupo.asesor} grupo={grupo} comisionesDB={comisionesDB} marcarPagada={marcarPagada} defaultOpen={expandirTodos} />
        ))}
      </div>
    </div>
  )
}
