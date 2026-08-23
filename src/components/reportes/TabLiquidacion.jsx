// src/components/reportes/TabLiquidacion.jsx
// Vista de consulta de comisiones generadas; la liquidacion se realiza fuera del sistema.
import { useState } from 'react'
import { DollarSign, Download, ChevronDown, ChevronRight, Filter } from 'lucide-react'
import { useReporteLiquidacion } from '../../hooks/useReporteLiquidacion'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { fmtUsd, fmtFecha } from '../../utils/format'
import Skeleton from '../ui/Skeleton'
import EmptyState from '../ui/EmptyState'

function GeneratedGroup({ group, open, onToggle }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
          <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0" style={{ background: group.color || '#1B365D' }}>
            {(group.asesor || '?')[0].toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block font-bold text-slate-800 truncate">{group.asesor || 'Sin asesor'}</span>
            <span className="block text-[10px] text-slate-400">{group.ventas.length} despachos</span>
          </span>
        </span>
        <span className="text-right shrink-0">
          <span className="block text-[10px] text-slate-400 uppercase font-bold">Generada</span>
          <span className="block text-sm font-black text-emerald-600">{fmtUsd(group.totalGenerado || group.totalComisiones || 0)}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full min-w-[620px] text-xs">
            <thead>
              <tr className="bg-slate-50 text-[10px] text-slate-400 uppercase border-b border-slate-100">
                <th className="px-4 py-2 text-left">Fecha</th>
                <th className="px-4 py-2 text-left">Despacho</th>
                <th className="px-4 py-2 text-left">Cliente</th>
                <th className="px-4 py-2 text-right">Venta neta</th>
                <th className="px-4 py-2 text-right">Comision generada</th>
              </tr>
            </thead>
            <tbody>
              {group.ventas.map((row, index) => (
                <tr key={row.id || index} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 text-slate-500">{fmtFecha(row.entregada_en)}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-600">#{row.numero || '---'}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-700">{row.cliente?.nombre || '---'}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{fmtUsd(row.ventaNeta || 0)}</td>
                  <td className="px-4 py-2.5 text-right font-black text-emerald-600">{fmtUsd(row.comision?.totalcomision || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function TabLiquidacion({ range }) {
  const [openGroups, setOpenGroups] = useState({})
  const [filtroAsesor, setFiltroAsesor] = useState('')
  const { data, isLoading, isError, refetch } = useReporteLiquidacion({
    fechaInicio: range?.from,
    fechaFin: range?.to,
    vendedorId: filtroAsesor || undefined,
  })
  const { data: config = {} } = useConfigNegocio()

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[1, 2, 3].map(item => <Skeleton key={item} className="h-24 rounded-xl" />)}
        </div>
        {[1, 2, 3].map(item => <Skeleton key={item} className="h-16 rounded-xl" />)}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center text-red-700">
        <p className="font-semibold">No se pudo cargar el reporte de comisiones generadas.</p>
        <button type="button" onClick={refetch} className="mt-2 text-sm underline">Intentar de nuevo</button>
      </div>
    )
  }

  if (!data || !data.registros?.length) {
    return <EmptyState icon={DollarSign} title="Sin comisiones generadas" description="No hay despachos entregados en el periodo seleccionado." />
  }

  const groups = (data.porAsesor || []).filter(group => !filtroAsesor || group.vendedor_id === filtroAsesor)
  const totalGenerated = Number(data.kpis?.totalGenerado ?? data.kpis?.totalComisiones ?? 0)
  const totalSales = Number(data.kpis?.totalVentas || 0)
  const sellerOptions = groups.map(group => ({ id: group.vendedor_id, nombre: group.asesor })).filter(item => item.id)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl p-4 bg-slate-900 text-white">
          <p className="text-[10px] uppercase font-bold text-slate-300">Ventas del periodo</p>
          <p className="text-xl font-black mt-1">{fmtUsd(totalSales)}</p>
        </div>
        <div className="rounded-xl p-4 bg-emerald-700 text-white">
          <p className="text-[10px] uppercase font-bold text-emerald-100">Comision generada</p>
          <p className="text-xl font-black mt-1">{fmtUsd(totalGenerated)}</p>
        </div>
        <div className="rounded-xl p-4 bg-amber-700 text-white">
          <p className="text-[10px] uppercase font-bold text-amber-100">Registro</p>
          <p className="text-xl font-black mt-1">Generada</p>
          <p className="text-[10px] text-amber-100 mt-1">La liquidacion se documenta fuera del sistema.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
          <Filter size={14} />
          <select value={filtroAsesor} onChange={event => setFiltroAsesor(event.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700">
            <option value="">Todos los asesores</option>
            {sellerOptions.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
          </select>
        </label>
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500"><Download size={13} /> Exportacion disponible desde Comisiones</span>
      </div>

      <div className="space-y-2">
        {groups.map(group => (
          <GeneratedGroup
            key={group.vendedor_id || group.asesor}
            group={group}
            open={!!openGroups[group.vendedor_id || group.asesor]}
            onToggle={() => setOpenGroups(previous => ({ ...previous, [group.vendedor_id || group.asesor]: !previous[group.vendedor_id || group.asesor] }))}
          />
        ))}
      </div>

      {config?.nombre_negocio && <p className="text-[10px] text-slate-400">{config.nombre_negocio}</p>}
    </div>
  )
}
