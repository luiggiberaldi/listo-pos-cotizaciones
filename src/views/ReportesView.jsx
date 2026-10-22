// src/views/ReportesView.jsx
// Vista profesional de reportes administrativos con tabs
import { useState, useMemo, useCallback } from 'react'
import {
  BarChart3, CreditCard, RefreshCw, Download,
  FileText, DollarSign, AlertTriangle,
  Clock, Users, Percent, ArrowUpCircle, ArrowDownCircle, Loader2, Briefcase,
  ChevronDown, ChevronLeft, ChevronRight, Globe, UserCheck, Printer, CheckCircle, Truck
} from 'lucide-react'
import { useReporteVentas } from '../hooks/useReporteVentas'
import { useReporteExternos } from '../hooks/useReporteExternos'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { useComisiones, useComisionesResumen } from '../hooks/useComisiones'

import { useResumenCxC } from '../hooks/useCuentasCobrar'
import { useReportePeriodoCxC } from '../hooks/useReportePeriodoCxC'
import { useProveedores } from '../hooks/useProveedores'
import { getDayRange, getCorteSemanalRange, getMonthRange } from '../utils/dateHelpers'
import { fmtUsd, fmtBs } from '../utils/format'
import { rankEntities } from '../utils/entitySearch'
import useAuthStore from '../store/useAuthStore'
import Skeleton from '../components/ui/Skeleton'
import { useTasaCambio } from '../hooks/useTasaCambio'
import EmptyState from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import DateRangeSelector from '../components/reportes/DateRangeSelector'
import { showToast } from '../components/ui/Toast'
import CustomSelect from '../components/ui/CustomSelect'
import KpiCards from '../components/reportes/KpiCards'
import TablaVendedores from '../components/reportes/TablaVendedores'
import TablaProductos from '../components/reportes/TablaProductos'
import TablaClientes from '../components/reportes/TablaClientes'
import TabTransportistas from '../components/reportes/TabTransportistas'
import SeccionTransportistasVentas from '../components/reportes/SeccionTransportistasVentas'
import ModalDetalleVendedor from '../components/reportes/ModalDetalleVendedor'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { countUniqueDispatches } from '../utils/comisionUtils'

// Helper para formatear forma_pago_abono (que puede venir como JSON array o string)
const round2 = value => Math.round((Number(value) || 0) * 100) / 100

function prepararComisionParaPDF(evento, cotizacion = null, vendedorFallback = null) {
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

function formatMetodoPago(val, fallback = '—') {
  if (!val) return fallback
  try {
    if (Array.isArray(val)) {
      const parts = val.map(p => p.metodo || p.metodo_pago || p.formaPago).filter(Boolean)
      return parts.length > 0 ? parts.join(', ') : fallback
    }
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          const parts = parsed.map(p => p.metodo || p.metodo_pago || p.formaPago).filter(Boolean)
          return parts.length > 0 ? parts.join(', ') : fallback
        } else if (parsed && typeof parsed === 'object') {
          return parsed.metodo || parsed.metodo_pago || parsed.formaPago || fallback
        }
      }
      return val || fallback
    }
  } catch (e) {
    // Ignore and fallback
  }
  return String(val) || fallback
}


// ─── Tabs Definition ──────────────────────────────────────────────────────
const TABS = [
  { id: 'comisiones', label: 'Comisiones', short: 'Comis.', icon: Percent },
  { id: 'credito', label: 'Crédito', short: 'Créd.', icon: CreditCard },
  { id: 'ventas', label: 'Ventas', short: 'Ventas', icon: BarChart3 },
  { id: 'transportistas', label: 'Transportistas', short: 'Transp.', icon: Truck,
    roles: ['administracion', 'desarrollador', 'logistica', 'jefe'] },
  { id: 'externos', label: 'Artículos Externos', short: 'Extern.', icon: Globe },
]

// ─── Skeleton ──────────────────────────────────────────────────────────────
function SkeletonReporte() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-2xl p-4 bg-slate-200/50 space-y-3">
            <Skeleton className="h-4 w-2/3 rounded" />
            <Skeleton className="h-8 w-1/2 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <Skeleton className="h-4 w-1/3 rounded" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )
}

// ─── KPI Card (reusable) ──────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, gradient, border, light = false }) {
  if (light) {
    return (
      <div className="relative overflow-hidden rounded-xl sm:rounded-2xl p-2.5 sm:p-3 md:p-4 flex flex-col gap-1 sm:gap-2 min-w-0 bg-white border border-slate-200"
        style={{ boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
        <div className="flex items-start gap-1.5 relative z-10 min-w-0">
          <div className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center shrink-0 bg-slate-100">
            <Icon size={12} className="text-slate-600 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] sm:text-xs font-medium leading-tight truncate text-slate-500">{label}</p>
          </div>
        </div>
        <p className="text-base sm:text-xl md:text-2xl font-black leading-tight text-slate-900 relative z-10 truncate">{value}</p>
        {sub && <p className="text-[11px] sm:text-xs relative z-10 truncate text-slate-400">{sub}</p>}
      </div>
    )
  }
  return (
    <div className="relative overflow-hidden rounded-xl sm:rounded-2xl p-2.5 sm:p-3 md:p-4 flex flex-col gap-1 sm:gap-2 min-w-0"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
      <div className="absolute -bottom-4 -right-4 w-16 sm:w-20 h-16 sm:h-20 rounded-full pointer-events-none"
        style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-start gap-1.5 relative z-10 min-w-0">
        <div className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={12} className="text-white sm:w-3.5 sm:h-3.5 md:w-4 md:h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] sm:text-xs font-medium leading-tight truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</p>
        </div>
      </div>
      <p className="text-base sm:text-xl md:text-2xl font-black leading-tight text-white relative z-10 truncate">{value}</p>
      {sub && <p className="text-[11px] sm:text-xs relative z-10 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{sub}</p>}
    </div>
  )
}

// ─── Forma de Pago Section ────────────────────────────────────────────────
function FormaPagoSection({ data = [], kpis, cxcData }) {
  if (data.length === 0) return null
  const total = data.reduce((s, fp) => s + fp.totalUsd, 0)

  const fpCxc = data.find(fp => fp.formaPago === 'Cta por cobrar')
  const fpCod = data.find(fp => fp.formaPago === 'Cobro a destino')
  const totalCxc = cxcData?.kpis?.totalDeuda !== undefined
    ? cxcData.kpis.totalDeuda
    : ((fpCxc ? fpCxc.totalUsd : 0) + (fpCod ? fpCod.totalUsd : 0))

  const fpDonacion = data.find(fp => fp.formaPago === 'Donación')
  const totalDonacion = fpDonacion ? fpDonacion.totalUsd : 0
  const totalSaldoFavor = data.filter(fp => fp.formaPago === 'Saldo a favor').reduce((s, fp) => s + fp.totalUsd, 0)
  const totalDeducciones = totalCxc + totalSaldoFavor
  const recaudacionDineroFresco = Math.max(0, total - totalDeducciones)
  const COLORS = {
    'Efectivo $': '#10b981',
    'Efectivo Bs': '#22c55e',
    'Zelle': '#3b82f6',
    'Transf. / Pago Móvil': '#14b8a6',
    'USDT': '#f59e0b',
    'Punto de Venta': '#06b6d4',
    'Cruce': '#ec4899',
    'Donación': '#a855f7',
    'Préstamo': '#eab308',
    'Prestamo': '#eab308',
    'Cta por cobrar': '#ef4444',
    'Saldo a favor': '#059669',
    'Sin especificar': '#94a3b8'
  }

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <CreditCard size={14} className="text-slate-500 sm:w-4 sm:h-4" />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">Formas de pago</h3>
      </div>
      <div className="p-3 sm:p-4 space-y-2.5 sm:space-y-3">
        {data.map(fp => {
          const pct = total > 0 ? (Math.max(0, fp.totalUsd) / total) * 100 : 0
          const color = COLORS[fp.formaPago] || '#64748b'
          return (
            <div key={fp.formaPago} className="space-y-1">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm shrink-0" style={{ background: color }} />
                  <span className="font-semibold text-slate-700 truncate">{fp.formaPago}</span>
                  <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold shrink-0">{fp.count}</span>
                </div>
                <div className="flex flex-col items-end shrink-0">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <span className="text-[10px] sm:text-xs text-slate-400">{pct.toFixed(0)}%</span>
                    <span className="font-bold text-slate-800 text-xs sm:text-sm">{fmtUsd(fp.totalUsd)}</span>
                  </div>
                  {['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago) && (
                    <span className="text-[9.5px] sm:text-[10px] text-indigo-600 font-semibold mt-0.5">
                      {fmtBs(fp.pagos?.reduce((s, p) => s + (Number(p.montoBs) || 0), 0) || 0)}
                    </span>
                  )}
                </div>
              </div>
              <div className="h-2 sm:h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
              </div>
              {Array.isArray(fp.pagos) && fp.pagos.length > 0 && (
                <div className="pl-4 pt-1 space-y-0.5">
                  {fp.pagos.map((p, pIdx) => (
                    <div key={pIdx} className="flex justify-between text-[9px] sm:text-[10px] text-slate-500 font-medium bg-slate-50/50 hover:bg-slate-50 px-1.5 py-0.5 rounded border border-transparent hover:border-slate-100">
                      <span className="truncate max-w-[200px] sm:max-w-[280px]">
                        {p.es_reembolso ? (
                          <span className="text-rose-600 font-bold">
                            [REEMBOLSO] {p.descripcion} · {p.cliente}
                          </span>
                        ) : (
                          `Doc #${p.numero || 'S/N'}${p.referencia ? ` · Ref: ${p.referencia}` : ''} · ${p.cliente}`
                        )}
                      </span>
                      <span className={`font-bold shrink-0 ${p.es_reembolso ? 'text-rose-600' : 'text-slate-700'}`}>
                        {p.es_reembolso ? '-' : ''}{fmtUsd(Math.abs(p.monto))}
                        {!p.es_reembolso && ['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago) && p.montoBs && (
                          <span className="text-[8.5px] text-indigo-600 font-semibold ml-1.5" title={`Tasa: ${p.tasa} Bs.`}>
                            ({fmtBs(p.montoBs)})
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Fila de Total */}
        <div className="pt-2.5 border-t border-slate-200 mt-2 space-y-2">
          <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-slate-800">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-extrabold">TOTAL RECAUDADO</span>
              <span className="text-[10px] sm:text-xs text-slate-500 font-bold">({data.reduce((s, fp) => s + (fp.count || 0), 0)} desp.)</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-[10px] sm:text-xs text-slate-500">100%</span>
              <span className="font-black text-slate-900 text-xs sm:text-sm">{fmtUsd(total)}</span>
            </div>
          </div>

          {/* Desglose por Monedas solicitado */}
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 space-y-1.5">
            <div className="flex justify-between items-center text-[10px] sm:text-xs text-slate-600 font-semibold">
              <span>Total en Divisas (Efectivo $, Zelle, USDT)</span>
              <span className="font-bold text-slate-800">
                {fmtUsd(data.filter(fp => ['Efectivo $', 'Zelle', 'USDT'].includes(fp.formaPago)).reduce((s, fp) => s + fp.totalUsd, 0))}
              </span>
            </div>
            <div className="flex justify-between items-center text-[10px] sm:text-xs text-indigo-600 font-semibold">
              <span>Total en Bolívares (Efectivo Bs, Transf, P. Venta)</span>
              <span className="font-bold text-indigo-700">
                {fmtBs(
                  data
                    .filter(fp => ['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago))
                    .reduce((s, fp) => s + (fp.pagos?.reduce((sum, p) => sum + (Number(p.montoBs) || 0), 0) || 0), 0)
                )}
              </span>
            </div>
            {totalSaldoFavor > 0 && (
              <div className="flex justify-between items-center text-[10px] sm:text-xs text-emerald-600 font-semibold border-t border-slate-200/40 pt-1">
                <span>Consumo de Saldo a Favor (Pasivo preexistente)</span>
                <span className="font-bold text-emerald-700">
                  {fmtUsd(totalSaldoFavor)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Desglose explicativo */}
        {kpis && (
          <div className="mt-3 pt-3 border-t border-dashed border-slate-200 space-y-1.5 text-[10px] sm:text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl">
            <p className="font-extrabold text-slate-700 uppercase tracking-wider text-[8px] sm:text-[9px] mb-1">
              Desglose de la Diferencia (Recaudación vs Ventas Netas):
            </p>
            <div className="flex justify-between items-center">
              <span>Ventas Netas (Mercancía)</span>
              <span className="font-bold text-slate-700">{fmtUsd(kpis.totalVentas)}</span>
            </div>
            {kpis.totalFlete > 0 && (
              <div className="flex justify-between items-center">
                <span>Fletes / Envío Cobrado</span>
                <span className="font-bold text-emerald-600">+{fmtUsd(kpis.totalFlete)}</span>
              </div>
            )}
            {kpis.totalDevoluciones > 0 && (
              <div className="flex justify-between items-center">
                <span>Devolución de Saldo a Favor</span>
                <span className="font-bold text-rose-600">-{fmtUsd(kpis.totalDevoluciones)}</span>
              </div>
            )}
            <div className="border-t border-slate-200 pt-1 mt-1 flex justify-between items-center font-black text-slate-800 text-[11px] sm:text-xs">
              <span>Total Recaudado</span>
              <span>{fmtUsd(total)}</span>
            </div>

            {(totalCxc > 0 || totalSaldoFavor > 0) && (
              <div className="pt-1.5 border-t border-slate-200/60 mt-1.5 space-y-1.5">
                {totalCxc > 0 && (
                  <div className="flex justify-between items-center text-slate-500">
                    <span>CxC y COD Pendientes</span>
                    <span className="font-bold text-red-500">-{fmtUsd(totalCxc)}</span>
                  </div>
                )}
                {totalSaldoFavor > 0 && (
                  <div className="flex justify-between items-center text-slate-500">
                    <span>Ventas con Saldo a Favor (Pasivo consumido)</span>
                    <span className="font-bold text-emerald-600">-{fmtUsd(totalSaldoFavor)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center font-extrabold text-slate-800 bg-slate-200/40 p-1.5 rounded-lg text-[10.5px] sm:text-[11.5px]">
                  <span>Caja Real (Dinero Fresco Líquido Ingresado)</span>
                  <span className="font-black text-slate-900">{fmtUsd(recaudacionDineroFresco)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Estado Badge ─────────────────────────────────────────────────────────
const ESTADO_STYLES = {
  borrador: 'bg-slate-100 text-slate-600',
  enviada: 'bg-blue-100 text-blue-700',
  aceptada: 'bg-emerald-100 text-emerald-700',
  rechazada: 'bg-red-100 text-red-700',
  vencida: 'bg-amber-100 text-amber-700',
  anulada: 'bg-gray-100 text-gray-500',
  pendiente: 'bg-amber-100 text-amber-700',
  despachada: 'bg-blue-100 text-blue-700',
  entregada: 'bg-emerald-100 text-emerald-700',
  pagada: 'bg-emerald-100 text-emerald-700',
}

// ─── Tabla genérica admin ─────────────────────────────────────────────────
function AdminTable({ icon: Icon, iconColor, title, headers, rows, emptyText }) {
  if (rows.length === 0) return null
  const visibleHeaders = headers.filter(h => !h.hidden)
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon size={14} className={`${iconColor} sm:w-4 sm:h-4`} />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-[10px] sm:text-xs text-slate-400 uppercase border-b border-slate-100">
              {visibleHeaders.map((h, i) => (
                <th key={i} className={`px-2 sm:px-4 py-2 font-semibold ${h.align || 'text-left'}`}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                {row.filter(cell => !cell.hidden).map((cell, j) => (
                  <td key={j} className={`px-2 sm:px-4 py-2 sm:py-2.5 ${cell.className || ''}`}>{cell.content}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Bar section ──────────────────────────────────────────────────────────
function BarSection({ icon: Icon, iconColor, title, data, labelKey, countKey, countSuffix, valueKey }) {
  if (!data || data.length === 0) return null
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0)

  const ESTADO_BAR_COLORS = {
    borrador: '#94a3b8', enviada: '#3b82f6', aceptada: '#10b981',
    rechazada: '#ef4444', vencida: '#f59e0b', anulada: '#6b7280',
    pendiente: '#f59e0b', despachada: '#3b82f6', entregada: '#10b981',
  }

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon size={14} className={`${iconColor} sm:w-4 sm:h-4`} />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">{title}</h3>
      </div>
      <div className="p-3 sm:p-4 space-y-2.5 sm:space-y-3">
        {data.filter(d => d[countKey] > 0).map((d, i) => {
          const pct = total > 0 ? (d[valueKey] / total) * 100 : 0
          const color = ESTADO_BAR_COLORS[d[labelKey]] || '#64748b'
          const label = d[labelKey].charAt(0).toUpperCase() + d[labelKey].slice(1)
          return (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm shrink-0" style={{ background: color }} />
                  <span className="font-semibold text-slate-700 truncate">{label}</span>
                  <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold shrink-0">{d[countKey]} {countSuffix}</span>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <span className="text-[10px] sm:text-xs text-slate-400">{pct.toFixed(0)}%</span>
                  <span className="font-bold text-slate-800 text-xs sm:text-sm">{fmtUsd(d[valueKey])}</span>
                </div>
              </div>
              <div className="h-2 sm:h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(pct, 1)}%`, background: color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Aging Table ──────────────────────────────────────────────────────────
function AgingSection({ title, data, countLabel }) {
  if (!data || data.every(a => a.count === 0)) return null
  const agingColors = ['text-emerald-600', 'text-amber-600', 'text-amber-600', 'text-red-600']
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <Clock size={14} className="text-amber-500 sm:w-4 sm:h-4" />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-[10px] sm:text-xs text-slate-400 uppercase border-b border-slate-100">
              <th className="text-left px-2 sm:px-4 py-2 font-semibold">Rango</th>
              <th className="text-center px-2 sm:px-4 py-2 font-semibold">{countLabel}</th>
              <th className="text-right px-2 sm:px-4 py-2 font-semibold">Monto USD</th>
            </tr>
          </thead>
          <tbody>
            {data.filter(a => a.count > 0).map((a, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="px-2 sm:px-4 py-2 font-medium text-slate-700">{a.rango}</td>
                <td className="px-2 sm:px-4 py-2 text-center text-slate-600">{a.count}</td>
                <td className={`px-2 sm:px-4 py-2 text-right font-bold ${agingColors[i] || 'text-slate-800'}`}>{fmtUsd(a.totalUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper to filter sales report data for PDF generation
function filtrarReporteVentas(reporte, tipoFiltro) {
  if (tipoFiltro === 'todos') return reporte

  const esExterno = (v) => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)

  // 1. Filtrar porVendedor
  const filteredPorVendedor = (reporte.porVendedor || []).filter(v => {
    const check = esExterno(v)
    return tipoFiltro === 'externos' ? check : !check
  })

  const sellerIds = new Set(filteredPorVendedor.map(v => v.id))

  // 2. Filtrar despachos
  const filteredDespachos = (reporte.despachos || []).filter(d => {
    const vid = d.asesor_id || 'unassigned'
    return sellerIds.has(vid)
  })

  // 3. Recalcular KPIs
  const totalVentas = filteredDespachos.reduce((s, d) => s + Number(d.venta_neta_usd || 0), 0)
  const totalFlete = filteredDespachos.reduce((s, d) => s + Number(d.flete_usd || 0), 0)
  const totalDescuentos = filteredDespachos.reduce((s, d) => s + Number(d.descuento_usd || 0), 0)
  const numDespachos = filteredDespachos.length
  const ticketPromedio = numDespachos > 0 ? totalVentas / numDespachos : 0

  const totalComisiones = filteredPorVendedor.reduce((s, v) => s + Number(v.comision || 0), 0)
  const comisionesPagadas = 0
  const comisionesPendientes = totalComisiones
  const comisionCabilla2 = filteredPorVendedor.reduce((s, v) => s + Number(v.comisionCabilla2 || 0), 0)
  const comisionCabilla3 = filteredPorVendedor.reduce((s, v) => s + Number(v.comisionCabilla3 || 0), 0)
  const comisionOtros = filteredPorVendedor.reduce((s, v) => s + Number(v.comisionOtros || 0), 0)

  // 4. Recalcular Formas de Pago
  const formaPagoMap = {}
  filteredDespachos.forEach(d => {
    const formas = Array.isArray(d.forma_pago) ? d.forma_pago : []
    const tasaDespacho = Number(d.tasa)
    const tasaValida = tasaDespacho > 0 ? tasaDespacho : null

    if (formas.length === 0) {
      const fallback = 'Pendiente'
      if (!formaPagoMap[fallback]) formaPagoMap[fallback] = { formaPago: fallback, count: 0, totalUsd: 0, pagos: [] }
      formaPagoMap[fallback].count++
      formaPagoMap[fallback].totalUsd += Number(d.venta_neta_usd || 0)
      formaPagoMap[fallback].pagos.push({
        cliente: d.cliente_nombre || 'Sin cliente',
        numero: d.despacho_numero || d.despacho_id?.slice(0, 8),
        monto: Number(d.venta_neta_usd || 0),
        tasa: tasaValida,
        montoBs: tasaValida ? Number(d.venta_neta_usd || 0) * tasaValida : null,
        referencia: null,
        es_prestamo_puro: d.es_prestamo_puro,
        es_prestamo_mixto: d.es_prestamo_mixto
      })
    } else {
      formas.forEach(f => {
        const nombre = f.metodo || 'Sin especificar'
        const monto = Number(f.monto) || 0
        if (!formaPagoMap[nombre]) formaPagoMap[nombre] = { formaPago: nombre, count: 0, totalUsd: 0, pagos: [] }
        formaPagoMap[nombre].count++
        formaPagoMap[nombre].totalUsd += monto
        formaPagoMap[nombre].pagos.push({
          cliente: d.cliente_nombre || 'Sin cliente',
          numero: d.despacho_numero || d.despacho_id?.slice(0, 8),
          monto: monto,
          tasa: tasaValida,
          montoBs: tasaValida ? monto * tasaValida : null,
          referencia: f.referencia || null,
          es_prestamo_puro: d.es_prestamo_puro,
          es_prestamo_mixto: d.es_prestamo_mixto
        })
      })
    }
  })
  const porFormaPago = Object.values(formaPagoMap).sort((a, b) => b.totalUsd - a.totalUsd)

  return {
    ...reporte,
    kpis: {
      totalVentas,
      totalFlete,
      totalDescuentos,
      numDespachos,
      ticketPromedio,
      totalComisiones,
      comisionesPagadas,
      comisionesPendientes,
      comisionCabilla2,
      comisionCabilla3,
      comisionOtros,
      prevTotalVentas: 0,
      prevNumDespachos: 0,
      prevTicketPromedio: 0,
      prevTotalComisiones: 0,
    },
    porVendedor: filteredPorVendedor,
    porFormaPago,
    despachos: filteredDespachos,
  }
}

// ─── Tab Ventas ───────────────────────────────────────────────────────────────
function TabVentas({ configNeg }) {
  const { perfil } = useAuthStore()
  const esAdministracion = perfil?.rol === 'administracion'
  const [rango, setRango] = useState(() => {
    const actual = getDayRange(0)
    const anterior = getDayRange(-1)
    return { from: actual.from, to: actual.to, prevFrom: anterior.from, prevTo: anterior.to }
  })
  const [exportando, setExportando] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)

  const { data: reporte, isLoading, isError, refetch } = useReporteVentas({
    from: rango.from,
    to: rango.to,
    prevFrom: rango.prevFrom,
    prevTo: rango.prevTo,
  })

  const { data: cxcData } = useResumenCxC(rango)

  async function exportarPDF(tipoFiltro = 'todos', accion = 'descargar') {
    if (!reporte) return
    setExportando(true)
    try {
      const { generarReporteVentasPDF } = await import('../services/pdf/comisionesPDF')
      
      const reporteFiltrado = filtrarReporteVentas(reporte, tipoFiltro)

      const reportePDF = {
        ...reporteFiltrado,
        tipoFiltro,
        porVendedor: (reporteFiltrado.porVendedor || []).map(v => ({
          ...v,
          vendedor: v.nombre,
          vendedorColor: v.color,
          codigo: v.codigo,
          count: v.despachos,
        })),
        porCliente: (reporteFiltrado.porCliente || []).map(c => ({
          ...c,
          cliente: c.nombre,
          count: c.despachos,
        })),
      }
      await generarReporteVentasPDF({ 
        reporte: reportePDF, 
        rango, 
        config: configNeg, 
        action: accion === 'imprimir' ? 'print' : 'download',
        cxcData
      })
    } catch (e) {
      console.error('Error generando reporte de ventas:', e)
    } finally {
      setExportando(false)
    }
  }

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />
  if (!reporte) return null

  const { kpis, porVendedor, porCliente, porProducto, porCategoria, porFormaPago, despachos, devoluciones = [] } = reporte
  const rangoLabel = `${new Date(`${rango.from}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })} - ${new Date(`${rango.to}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}`

  const METODO_PAGOS_STYLES = {
    'Efectivo $': 'bg-emerald-50 text-emerald-700 border-emerald-100',
    'Efectivo Bs': 'bg-green-50 text-green-700 border-green-100',
    'Zelle': 'bg-blue-50 text-blue-700 border-blue-100',
    'Transf. / Pago Móvil': 'bg-teal-50 text-teal-700 border-teal-100',
    'USDT': 'bg-amber-50 text-amber-700 border-amber-100',
    'Punto de Venta': 'bg-cyan-50 text-cyan-700 border-cyan-100',
    'Cruce': 'bg-pink-50 text-pink-700 border-pink-100',
    'Donación': 'bg-purple-50 text-purple-700 border-purple-100',
    'Préstamo': 'bg-amber-50 text-amber-700 border-amber-100',
    'Prestamo': 'bg-amber-50 text-amber-700 border-amber-100',
    'Cta por cobrar': 'bg-red-50 text-red-700 border-red-100',
    'Saldo a Favor': 'bg-emerald-50 text-emerald-700 border-emerald-100',
    'Sin especificar': 'bg-slate-50 text-slate-600 border-slate-100',
  }

  const ESTADO_STYLES = {
    despachada: 'bg-blue-100 text-blue-700',
    entregada: 'bg-emerald-100 text-emerald-700',
    pagada: 'bg-emerald-100 text-emerald-700',
    pendiente: 'bg-amber-100 text-amber-700',
  }

  return (
    <div className="space-y-4">
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-6">
          <div className="w-full">
            <div className="flex items-center gap-2 ml-1 mb-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Periodo de ventas</label>
              <span className="hidden sm:inline-flex text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                {rangoLabel}
              </span>
            </div>
            <DateRangeSelector value={rango} onChange={setRango} ocultarPresets={esAdministracion ? ['thisMonth', 'lastMonth'] : undefined} />
          </div>
          
          <div className="flex justify-end items-center gap-3 border-t border-slate-50 pt-4 relative">
            
            {/* BOTÓN IMPRIMIR PDF */}
            <div className="relative">
              <button
                onClick={() => setShowPrintMenu(!showPrintMenu)}
                disabled={exportando || !despachos.length}
                className="flex items-center gap-2 text-xs font-black px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm"
              >
                <Printer size={13} className="text-slate-500" />
                {exportando ? 'Generando...' : 'Imprimir PDF'}
                <ChevronDown size={13} className={`transition-transform duration-200 ${showPrintMenu ? 'rotate-180' : ''}`} />
              </button>

              {showPrintMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowPrintMenu(false)} />
                  <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    <button
                      onClick={() => {
                        setShowPrintMenu(false)
                        exportarPDF('todos', 'imprimir')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                    >
                      <FileText size={14} className="text-slate-400" />
                      Imprimir PDF Completo
                    </button>
                    <button
                      onClick={() => {
                        setShowPrintMenu(false)
                        exportarPDF('internos', 'imprimir')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors border-t border-slate-50"
                    >
                      <UserCheck size={14} className="text-indigo-500" />
                      Imprimir Solo Internos
                    </button>
                    <button
                      onClick={() => {
                        setShowPrintMenu(false)
                        exportarPDF('externos', 'imprimir')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors border-t border-slate-50"
                    >
                      <Globe size={14} className="text-amber-500" />
                      Imprimir Solo Externos
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* BOTÓN DESCARGAR PDF */}
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={exportando || !despachos.length}
                className="flex items-center gap-2 text-xs font-black px-5 py-2.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-indigo-100/40"
                style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
              >
                <Download size={13} />
                {exportando ? 'Generando...' : 'Descargar PDF'}
                <ChevronDown size={13} className={`transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
              </button>

              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                  <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    <button
                      onClick={() => {
                        setShowExportMenu(false)
                        exportarPDF('todos', 'descargar')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                    >
                      <FileText size={14} className="text-slate-400" />
                      Descargar PDF Completo
                    </button>
                    <button
                      onClick={() => {
                        setShowExportMenu(false)
                        exportarPDF('internos', 'descargar')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors border-t border-slate-50"
                    >
                      <UserCheck size={14} className="text-indigo-500" />
                      Descargar Solo Internos
                    </button>
                    <button
                      onClick={() => {
                        setShowExportMenu(false)
                        exportarPDF('externos', 'descargar')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors border-t border-slate-50"
                    >
                      <Globe size={14} className="text-amber-500" />
                      Descargar Solo Externos
                    </button>
                  </div>
                </>
              )}
            </div>

          </div>
        </div>
      </div>

      {despachos.length === 0 ? (
        <EmptyState icon={BarChart3} title="Sin ventas procesadas" description="No hay despachos aprobados o entregados en el periodo seleccionado." />
      ) : (
        <>
          <KpiCards kpis={kpis} />

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] gap-4">
            <TablaVendedores data={porVendedor} />
            <FormaPagoSection data={porFormaPago} kpis={kpis} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <TablaProductos porProducto={porProducto} porCategoria={porCategoria} />
            <TablaClientes data={porCliente} />
          </div>

          {/* Tabla de Despachos Premium */}
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-3 sm:px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-slate-500" />
                <h3 className="text-sm font-black text-slate-800">Últimos despachos procesados</h3>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="text-[10px] sm:text-xs text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                    <th className="px-3 py-2.5 font-semibold text-center w-12">#</th>
                    <th className="px-3 py-2.5 font-semibold text-center w-24">Estado</th>
                    <th className="px-3 py-2.5 font-semibold text-left">Cliente</th>
                    <th className="px-3 py-2.5 font-semibold text-left">Asesor</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Fecha</th>
                    <th className="px-3 py-2.5 font-semibold text-left">Forma de Pago</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Total USD</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Total Bs</th>
                  </tr>
                </thead>
                <tbody>
                  {despachos.slice(0, 15).map((d, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex flex-col items-center gap-0.5 justify-center">
                          <span className="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-md font-mono font-bold text-[11px]">
                            {d.despacho_numero || '—'}
                          </span>
                          {d.es_prestamo_puro && (
                            <span className="text-[8px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded uppercase tracking-wide leading-none">
                              Préstamo
                            </span>
                          )}
                          {d.es_prestamo_mixto && (
                            <span className="text-[8px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-1 py-0.2 rounded uppercase tracking-wide leading-none">
                              Mixto
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold ${ESTADO_STYLES[d.estado] || 'bg-slate-100 text-slate-600'}`}>
                          {d.estado === 'despachada' ? 'Aprobada' : d.estado === 'entregada' ? 'Entregada' : d.estado}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-slate-800 truncate max-w-[150px]">
                        {d.cliente_nombre || 'Sin cliente'}
                        {d.cliente_tipo_cliente === 'personal' && (
                          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 rounded">
                            Personal
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: d.asesor_color || '#64748b' }} />
                          <span className="font-semibold text-slate-600 truncate max-w-[100px]">{d.asesor_nombre || 'Sin asesor'}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center font-medium text-slate-500">
                        {d.fecha ? new Date(d.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {Array.isArray(d.forma_pago) && d.forma_pago.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {d.forma_pago.map((fp, idx) => {
                              const tasa = Number(d.tasa)
                              const montoBs = tasa > 0 ? Number(fp.monto) * tasa : null
                              return (
                                <span key={idx} className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide border ${METODO_PAGOS_STYLES[fp.metodo] || METODO_PAGOS_STYLES['Sin especificar']}`}>
                                  {fp.metodo}: ${Number(fp.monto).toLocaleString('es-VE', { maximumFractionDigits: 2 })}{fp.referencia ? ` (Ref: ${fp.referencia})` : ''}
                                  {['Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.metodo) && montoBs !== null && (
                                    <span className="opacity-80 font-bold ml-1">
                                      (Bs {montoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                    </span>
                                  )}
                                </span>
                              )
                            })}
                          </div>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-400">Pendiente</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-black text-slate-800">
                        {fmtUsd(d.venta_neta_usd)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-indigo-600 text-xs">
                        {fmtBs(d.total_bs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Resumen de totales inferior */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-3 sm:gap-4 text-xs font-semibold text-slate-500 shadow-inner">
              <div className="flex items-center gap-1.5">
                <span>Total procesados:</span>
                <span className="px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-700 font-bold">{despachos.length}</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-slate-300 hidden sm:block" />
              <div className="flex items-center gap-1.5">
                <span>Aprobados:</span>
                <span className="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 font-bold">
                  {despachos.filter(d => d.estado === 'despachada').length}
                </span>
              </div>
              <div className="w-1 h-1 rounded-full bg-slate-300 hidden sm:block" />
              <div className="flex items-center gap-1.5">
                <span>Entregados:</span>
                <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 font-bold">
                  {despachos.filter(d => d.estado === 'entregada').length}
                </span>
              </div>
              <div className="flex items-center gap-1.5 sm:ml-auto mt-1 sm:mt-0">
                <span className="uppercase tracking-wider text-[10px] font-bold text-slate-400">Facturado Neto:</span>
                <span className="text-sm font-black text-slate-800">{fmtUsd(kpis.totalVentas)}</span>
              </div>
            </div>
          </div>

          {/* Tabla de Devoluciones de Saldo a Favor */}
          {devoluciones.length > 0 && (
            <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-3 sm:px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowUpCircle size={16} className="text-rose-500 shrink-0" />
                  <h3 className="text-sm font-black text-slate-800">Devoluciones de Saldo a Favor (Reembolsos a Clientes)</h3>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="text-[10px] sm:text-xs text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                      <th className="px-3 py-2.5 font-semibold text-left">Cliente</th>
                      <th className="px-3 py-2.5 font-semibold text-left">Asesor</th>
                      <th className="px-3 py-2.5 font-semibold text-center">Fecha</th>
                      <th className="px-3 py-2.5 font-semibold text-left">Forma de Pago</th>
                      <th className="px-3 py-2.5 font-semibold text-left">Referencia</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Monto Devuelto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devoluciones.map((dev, i) => (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                        <td className="px-3 py-2.5 font-bold text-slate-800 truncate max-w-[180px]">
                          {dev.cliente_nombre || 'Sin cliente'}
                          {dev.cliente_tipo_cliente === 'personal' && (
                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 rounded">
                              Personal
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: dev.vendedor_color || '#64748b' }} />
                            <span className="font-semibold text-slate-600 truncate max-w-[120px]">{dev.vendedor_nombre}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center font-medium text-slate-500">
                          {dev.creado_en ? new Date(dev.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide border ${METODO_PAGOS_STYLES[dev.forma_pago_abono] || 'bg-slate-50 text-slate-600 border-slate-100'}`}>
                            {dev.forma_pago_abono || 'Sin especificar'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-500 truncate max-w-[150px]">
                          {dev.referencia || dev.descripcion || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-black text-rose-600">
                          -{fmtUsd(dev.monto_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Transportistas locales: flete + comisiones en el período ──────── */}
      <SeccionTransportistasVentas
        desde={rango.from || null}
        hasta={rango.to   || null}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: COMISIONES
// ═══════════════════════════════════════════════════════════════════════════
function TabComisiones({ configNeg }) {
  const { perfil } = useAuthStore()
  const esAdmin = perfil?.rol === 'administracion' || perfil?.rol === 'jefe' || perfil?.rol === 'desarrollador'
  const [rango, setRango] = useState(() => {
    const r = getCorteSemanalRange(0)
    return { from: r.from, to: r.to }
  })
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [formatoReporte, setFormatoReporte] = useState('detallado') // 'detallado', 'resumido'
  const { tasaEuro, tasaUsdt } = useTasaCambio()
  const [tipoTasaComision, setTipoTasaComision] = useState('euro') // 'euro' | 'usdt'
  const tasaSeleccionadaInfo = tipoTasaComision === 'usdt' ? tasaUsdt : tasaEuro
  const tasaSeleccionada = tasaSeleccionadaInfo?.precio || 0
  const tipoTasaLabel = tipoTasaComision === 'usdt' ? 'USDT' : 'Euro BCV'
  const tasaDisponible = Number(tasaSeleccionada) > 0
  const [exportando, setExportando] = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  // ajustesManuales: { [vendedorId]: { cxc: string, descuentoCarro: string } }
  const [ajustesManuales, setAjustesManuales] = useState({})

  const [vendedorSeleccionado, setVendedorSeleccionado] = useState(null)

  const setAjuste = (vId, campo, valor) => {
    setAjustesManuales(prev => ({
      ...prev,
      [vId]: { ...(prev[vId] || { cxc: '', descuentoCarro: '' }), [campo]: valor }
    }))
  }

  const { data: comisionesRes, isLoading: comisionesLoading, isError, refetch } = useComisiones({
    vendedorId: filtroVendedor,
    desde: rango.from,
    hasta: rango.to,
    pageSize: 1000
  })
  const comisiones = comisionesRes?.data ?? []

  // Segunda llamada SIN filtro de vendedor, solo para construir el dropdown
  // de forma que siempre muestre los vendedores con comisiones en el rango
  const { data: comisionesDropdownRes } = useComisiones({
    desde: rango.from,
    hasta: rango.to,
    pageSize: 2000
  })
  const comisionesParaDropdown = comisionesDropdownRes?.data ?? []

  const { data: resumen, isLoading: resumenLoading } = useComisionesResumen({
    vendedorId: filtroVendedor,
    desde: rango.from,
    hasta: rango.to
  })

  // Agrupar por vendedor para la vista Maestro (Resumen)
  const vendedoresAgrupados = useMemo(() => {
    const map = {}
    const UUID_HUERFANO = '00000000-0000-0000-0000-000000000000'
    comisiones.forEach(c => {
      const vId = c.vendedor?.id || UUID_HUERFANO
      if (!map[vId]) {
        map[vId] = {
          id: vId,
          nombre: c.vendedor?.nombre || 'Sin Asignar',
          color: c.vendedor?.color || '#cbd5e1',
          markup_pct: c.vendedor?.markup_pct ?? null,
          es_externo: !!c.vendedor?.es_externo,
          rol: c.vendedor?.rol,
          totalUsd: 0,
          totalBs: 0,
          cantidad: 0,
          rows: []
        }
      }
      // La comisión se suma por fila, pero el indicador cuenta despachos únicos.
      const m = Number(c.totalcomision || 0)
      map[vId].totalUsd += m
      map[vId].rows.push(c)
    })
    return Object.values(map)
      .map(v => {
        const totalUsd = round2(v.totalUsd)
        const totalBs = round2(totalUsd * Number(tasaSeleccionada || 0))
        return {
          ...v,
          totalUsd,
          totalBs,
          cantidad: countUniqueDispatches(v.rows),
          rows: undefined,
        }
      })
      .filter(v => v.rol !== 'desarrollador' && v.rol !== 'administracion' && v.rol !== 'logistica')
      .sort((a, b) => b.totalUsd - a.totalUsd)
  }, [comisiones, tasaSeleccionada])

  // Obtener lista única de vendedores para el select (desde el dataset sin filtro de vendedor)
  const vendedoresDisponibles = useMemo(() => {
    if (!esAdmin) return []
    const map = {}
    const UUID_HUERFANO = '00000000-0000-0000-0000-000000000000'
    comisionesParaDropdown.forEach(c => {
      const vId = c.vendedor?.id || UUID_HUERFANO
      const rol = c.vendedor?.rol
      if (rol === 'desarrollador' || rol === 'administracion' || rol === 'logistica') return
      if (!map[vId]) {
        map[vId] = { id: vId, nombre: c.vendedor?.nombre || 'Sin Asignar' }
      }
    })
    return Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [comisionesParaDropdown, esAdmin])

  async function exportarPDF(tipoFiltro = 'todos', accion = 'descargar') {
    if (!tasaDisponible) {
      alert(`No hay una tasa ${tipoTasaLabel} disponible para generar el PDF.`)
      return
    }
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesGeneradasPDF')

      const params = new URLSearchParams()
      params.set('vista', 'eventos')
      params.set('page', '1')
      // El Worker admite hasta 1000 filas; debe cubrir el lote completo de staging.
      params.set('pageSize', '1000')
      if (rango.from) params.set('desde', rango.from)
      if (rango.to) params.set('hasta', rango.to)
      if (filtroVendedor) params.set('vendedorId', filtroVendedor)

      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const resJson = await res.json()
      const rawEvents = resJson.data || []

      if (!rawEvents || rawEvents.length === 0) {
        alert(`🔍 SIN DATOS: No hay liberaciones de comisiones entre ${rango.from} y ${rango.to}.`)
        return
      }

      let filteredEvents = rawEvents

      if (tipoFiltro === 'internos') {
        filteredEvents = rawEvents.filter(r => {
          const v = r.vendedor || r.comisiones?.vendedor
          const esExterno = !!v?.es_externo || (v?.markup_pct != null && Number(v.markup_pct) > 0)
          return !esExterno
        })
      } else if (tipoFiltro === 'externos') {
        filteredEvents = rawEvents.filter(r => {
          const v = r.vendedor || r.comisiones?.vendedor
          const esExterno = !!v?.es_externo || (v?.markup_pct != null && Number(v.markup_pct) > 0)
          return esExterno
        })
      }

      if (filteredEvents.length === 0) {
        alert(`🔍 SIN DATOS: No hay comisiones registradas para el grupo de vendedores seleccionado en este rango.`);
        return;
      }

      // Fetch cotizaciones
      const cotizacionIds = [...new Set(filteredEvents.map(r => r.comisiones?.cotizacionid).filter(Boolean))]
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

      const vendedorInfo = filtroVendedor
        ? vendedoresAgrupados.find(v => v.id === filtroVendedor)
        : null

      const comisionesParaPDF = filteredEvents.map(r => prepararComisionParaPDF(
        r,
        r.comisiones?.cotizacion || cotizacionesMap[r.comisiones?.cotizacionid],
        vendedorInfo,
      ));

      await generarComisionesPDF({
        comisiones: comisionesParaPDF,
        vendedor: vendedorInfo ? { nombre: vendedorInfo.nombre, color: vendedorInfo.color, markup_pct: vendedorInfo.markup_pct, es_externo: vendedorInfo.es_externo } : null,
        tipoVendedor: tipoFiltro === 'todos' ? null : tipoFiltro,
        rango,
        config: configNeg ?? {},
        action: accion === 'imprimir' ? 'print' : 'download',
        formato: formatoReporte,
        tasaEuro: tasaSeleccionada,
        tasaAplicada: tasaSeleccionada,
        tipoTasa: tipoTasaLabel,
        tasaFuente: tasaSeleccionadaInfo?.fuente,
        tasaActualizadaEn: tasaSeleccionadaInfo?.ultimaActualizacion,
        ajustesManuales,
        modoCorteSemanal: formatoReporte === 'detallado'
      })
    } catch (e) {
      console.error('Error generando PDF general:', e)
      alert('❌ Error al generar reporte general: ' + e.message)
    } finally {
      setExportando(false)
    }
  }

  async function exportarIndividualPDF(vendedor) {
    if (!tasaDisponible) {
      alert(`No hay una tasa ${tipoTasaLabel} disponible para generar el PDF.`)
      return
    }
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesGeneradasPDF')

      // Usar el Worker, igual que el reporte general, para respetar el tenant
      // y el rol de la sesión. La consulta directa desde el navegador queda
      // sometida a RLS y puede ocultar eventos válidos en staging.
      const params = new URLSearchParams()
      params.set('vista', 'eventos')
      params.set('page', '1')
      // El Worker admite hasta 1000 filas; debe cubrir el lote completo de staging.
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

      // Fetch cotizaciones
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
        vendedor,
      ));

      await generarComisionesPDF({
        comisiones: comisionesParaPDF,
        vendedor: { nombre: vendedor.nombre, color: vendedor.color, markup_pct: vendedor.markup_pct, es_externo: vendedor.es_externo },
        rango,
        config: configNeg ?? {},
        formato: formatoReporte,
        tasaEuro: tasaSeleccionada,
        tasaAplicada: tasaSeleccionada,
        tipoTasa: tipoTasaLabel,
        tasaFuente: tasaSeleccionadaInfo?.fuente,
        tasaActualizadaEn: tasaSeleccionadaInfo?.ultimaActualizacion,
        ajustesManuales,
        modoCorteSemanal: formatoReporte === 'detallado'
      })
    } catch (e) {
      console.error('Error generating PDF individual:', e)
      alert('❌ Error al generar PDF de ' + vendedor.nombre + ': ' + e.message)
    } finally {
      setExportando(false)
    }
  }


  // El bloque de KPIs ya no usa stats locales sino useComisionesResumen (resumen)

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-3.5">
          {/* Fila Superior: Periodo (con mucho espacio) */}
          <div className="w-full">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Rango de Periodo</label>
            <DateRangeSelector value={rango} onChange={setRango} />
          </div>

          {/* Fila Inferior: Otros Filtros y Acciones */}
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-50 pt-3 w-full justify-between">
            {/* Grupo de Filtros */}
            <div className="flex flex-wrap items-end gap-3">
              {esAdmin && (
                <div className="w-52">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Vendedor</label>
                  <CustomSelect
                    options={[
                      { value: '', label: 'Todos los Asesores' },
                      ...vendedoresDisponibles.map(v => ({ value: v.id, label: v.nombre }))
                    ]}
                    value={filtroVendedor}
                    onChange={setFiltroVendedor}
                    placeholder="Todos los Asesores"
                  />
                </div>
              )}

              <div className="w-44">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Formato Reporte</label>
                <div className="flex p-0.5 bg-slate-100/80 rounded-xl h-9">
                  <button
                    type="button"
                    onClick={() => setFormatoReporte('detallado')}
                    className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${formatoReporte === 'detallado' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >Detallado</button>
                  <button
                    type="button"
                    onClick={() => setFormatoReporte('resumido')}
                    className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${formatoReporte === 'resumido' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >Resumido</button>
                </div>
              </div>
            </div>

            {/* Grupo de Acciones y Selector de Tasa Euro / USDT */}
            <div className="flex flex-wrap items-center gap-2.5 ml-auto shrink-0 self-end">
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

              <div className="flex items-center gap-1.5 relative shrink-0">
                {/* BOTÓN IMPRIMIR PDF */}
                <div className="relative">
                  {filtroVendedor ? (
                    <button
                      onClick={() => exportarPDF('todos', 'imprimir')}
                      disabled={exportando || comisiones.length === 0 || !tasaDisponible}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm h-9"
                    >
                      <Printer size={12} className="text-slate-500" />
                      <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Imprimir PDF'}</span>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setShowPrintMenu(!showPrintMenu)}
                        disabled={exportando || comisiones.length === 0 || !tasaDisponible}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm h-9"
                      >
                        <Printer size={12} className="text-slate-500" />
                        <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Imprimir PDF'}</span>
                        <ChevronDown size={12} className={`transition-transform duration-200 ${showPrintMenu ? 'rotate-180' : ''}`} />
                      </button>

                      {showPrintMenu && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowPrintMenu(false)} />
                          <div className="absolute right-0 mt-1 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
<button
  onClick={() => {
    setShowPrintMenu(false)
    exportarPDF('todos', 'imprimir')
  }}
  className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
>
  <FileText size={13} className="text-slate-400" />
  Imprimir PDF Completo
</button>
<button
  onClick={() => {
    setShowPrintMenu(false)
    exportarPDF('internos', 'imprimir')
  }}
  className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
>
  <UserCheck size={13} className="text-indigo-500" />
  Imprimir Solo Internos
</button>
<button
  onClick={() => {
    setShowPrintMenu(false)
    exportarPDF('externos', 'imprimir')
  }}
  className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
>
  <Globe size={13} className="text-amber-500" />
  Imprimir Solo Externos
</button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* BOTÓN DESCARGAR PDF */}
                <div className="relative">
                  {filtroVendedor ? (
                    <button
                      onClick={() => exportarPDF('todos', 'descargar')}
                      disabled={exportando || comisiones.length === 0 || !tasaDisponible}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md h-9"
                      style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
                    >
                      <Download size={12} />
                      <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Descargar PDF'}</span>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        disabled={exportando || comisiones.length === 0 || !tasaDisponible}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md h-9"
                        style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
                      >
                        <Download size={12} />
                        <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Descargar PDF'}</span>
                        <ChevronDown size={12} className={`transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
                      </button>

                      {showExportMenu && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                          <div className="absolute right-0 mt-1 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
<button
  onClick={() => {
    setShowExportMenu(false)
    exportarPDF('todos', 'descargar')
  }}
  className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
>
  <FileText size={13} className="text-slate-400" />
  Descargar PDF Completo
</button>
<button
  onClick={() => {
    setShowExportMenu(false)
    exportarPDF('internos', 'descargar')
  }}
  className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
>
  <UserCheck size={13} className="text-indigo-500" />
  Descargar Solo Internos
</button>
<button
  onClick={() => {
    setShowExportMenu(false)
    exportarPDF('externos', 'descargar')
  }}
  className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
>
  <Globe size={13} className="text-amber-500" />
  Descargar Solo Externos
</button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Panel de Ajustes Manuales para Reporte Resumido */}
      {formatoReporte === 'resumido' && !comisionesLoading && !isError && vendedoresAgrupados.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <span className="text-base">✏️</span>
            <div>
              <p className="text-xs font-black text-amber-800 uppercase tracking-wide">Ajustes Manuales — Reporte Resumido</p>
              <p className="text-[10px] text-amber-600 font-medium">Ingresa los montos de Comisión CxC y Descuento Carro por vendedor antes de generar el PDF.</p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {vendedoresAgrupados.map(v => {
              const aj = ajustesManuales[v.id] || { cxc: '', descuentoCarro: '' }
              const comisionGen = v.totalUsd || 0
              const cxcVal = Number(aj.cxc) || 0
              const descVal = Number(aj.descuentoCarro) || 0
              const totalPagar = comisionGen + cxcVal - descVal
              const tasa = Number(tasaSeleccionada || 0)
              return (
                <div key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  {/* Nombre vendedor */}
                  <div className="flex items-center gap-2 w-40 shrink-0">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: v.color }}>
                      {v.nombre.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-bold text-slate-800 truncate">{v.nombre}</span>
                  </div>
                  {/* Comisión periodo (solo lectura) */}
                  <div className="flex flex-col items-start">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wide mb-0.5">Comisión Periodo</label>
                    <span className="text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">${comisionGen.toFixed(2)}</span>
                  </div>
                  {/* CxC input */}
                  <div className="flex flex-col items-start">
                    <label className="text-[9px] font-black text-amber-600 uppercase tracking-wide mb-0.5">Comisión CxC ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={aj.cxc}
                      onChange={e => setAjuste(v.id, 'cxc', e.target.value)}
                      className="w-28 h-8 px-2 text-xs font-bold border border-amber-200 bg-amber-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 text-amber-800 placeholder-amber-300"
                    />
                  </div>
                  {/* Descuento Carro input */}
                  <div className="flex flex-col items-start">
                    <label className="text-[9px] font-black text-red-600 uppercase tracking-wide mb-0.5">Descuento Carro ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={aj.descuentoCarro}
                      onChange={e => setAjuste(v.id, 'descuentoCarro', e.target.value)}
                      className="w-28 h-8 px-2 text-xs font-bold border border-red-200 bg-red-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 text-red-800 placeholder-red-300"
                    />
                  </div>
                  {/* Total a pagar calculado */}
                  <div className="flex flex-col items-start ml-auto">
                    <label className="text-[9px] font-black text-indigo-500 uppercase tracking-wide mb-0.5">Total a Pagar</label>
                    <span className="text-sm font-black text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1">${totalPagar.toFixed(2)}</span>
                  </div>
                  {tasa > 0 && (
                    <div className="flex flex-col items-start">
                      <label className="text-[9px] font-black text-emerald-600 uppercase tracking-wide mb-0.5">Total en Bs ({tipoTasaLabel})</label>
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">Bs {(totalPagar * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {comisionesLoading || resumenLoading ? (
        <SkeletonReporte />
      ) : isError ? (
        <ErrorMsg onRetry={refetch} />
      ) : (
        <>
          {/* KPIs (Fuente de verdad SQL) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <KpiCard icon={DollarSign} label="Comisión generada" value={fmtUsd(resumen?.totalAcumulado || 0)}
              sub={`${resumen?.totalDespachos || 0} despachos únicos`}
              gradient="linear-gradient(135deg, #1e293b, #0f172a)" border="rgba(255,255,255,0.05)" />
            <KpiCard icon={Percent} label="Comisión CxC manual" value="Se registra aparte"
              sub="No se calcula en el sistema"
              gradient="linear-gradient(135deg, #92400e, #78350f)" border="rgba(255,255,255,0.05)" />
            <KpiCard icon={ArrowUpCircle} label="Estado" value="Generada"
              sub="Sin flujo de pago interno"
              gradient="linear-gradient(135deg, #065f46, #064e3b)" border="rgba(255,255,255,0.05)" />
          </div>

          {/* Tarjetas de Vendedores (Resumen Separado) */}
          {(() => {
            const vendedoresInternos = vendedoresAgrupados.filter(v => !(v.es_externo || v.markup_pct > 0))
            const vendedoresExternos = vendedoresAgrupados.filter(v => !!v.es_externo || v.markup_pct > 0)
            return (
              <div className="space-y-6">
                {/* 1. ASESORES INTERNOS */}
                {vendedoresInternos.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-1">
                      <Users size={16} className="text-slate-500" />
                      <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendedores Internos ({vendedoresInternos.length})</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {vendedoresInternos.map(v => (
                        <div
                          key={v.id}
                          onClick={() => setVendedorSeleccionado(v)}
                          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-400 hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col gap-3 group"
                        >
                          <div className="flex items-center gap-3">
<div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-inner" style={{ backgroundColor: v.color }}>
  {v.nombre.charAt(0).toUpperCase()}
</div>
<div className="flex-1 min-w-0">
  <h4 className="font-bold text-slate-800 truncate group-hover:text-indigo-600 transition-colors">{v.nombre}</h4>
  <p className="text-xs text-slate-500 font-medium">{v.cantidad} despachos únicos</p>
</div>
<button
  onClick={(e) => { e.stopPropagation(); exportarIndividualPDF(v); }}
  title="Descargar reporte individual"
  className="p-2 bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-xl border border-slate-100 hover:border-indigo-200 transition-all active:scale-95 duration-200"
>
  <Download size={14} />
</button>
                          </div>

                          <div className="grid grid-cols-2 gap-2 mt-2">
<div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
  <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Total USD</p>
  <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
</div>
<div className="bg-emerald-50/50 rounded-xl p-2.5 text-center border border-emerald-100/50">
  <p className="text-[10px] text-emerald-600/70 font-bold uppercase mb-0.5">Generada</p>
  <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
</div>
                          </div>

                          <div className="flex justify-between items-center px-1 pt-1">
<span className="text-[10px] font-bold text-slate-400 uppercase">Equiv. Bs</span>
<span className="text-xs font-bold text-indigo-600">{fmtBs(v.totalBs)}</span>
                          </div>



    


                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. VENDEDORES EXTERNOS */}
                {vendedoresExternos.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center gap-2 px-1">
                      <Briefcase size={16} className="text-amber-600 animate-pulse" />
                      <h4 className="text-xs font-black text-amber-700 uppercase tracking-wider">Vendedores Externos ({vendedoresExternos.length})</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {vendedoresExternos.map(v => (
                        <div
                          key={v.id}
                          onClick={() => setVendedorSeleccionado(v)}
                          className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm cursor-pointer hover:border-amber-400 hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col gap-3 group bg-amber-50/5"
                        >
                          <div className="flex items-center gap-3">
<div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-inner" style={{ backgroundColor: '#D97706' }}>
  {v.nombre.charAt(0).toUpperCase()}
</div>
<div className="flex-1 min-w-0">
  <h4 className="font-bold text-slate-800 truncate group-hover:text-amber-600 transition-colors">{v.nombre}</h4>
  <div className="flex flex-col gap-0.5 mt-0.5">
    <span className="text-xs text-slate-500 font-medium">{v.cantidad} despachos únicos</span>
    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded px-1.5 py-0.5 w-fit">
      💼 Externo (+{v.markup_pct}%)
    </span>
  </div>
</div>
<button
  onClick={(e) => { e.stopPropagation(); exportarIndividualPDF(v); }}
  title="Descargar reporte individual"
  className="p-2 bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-700 rounded-xl border border-amber-100 hover:border-amber-200 transition-all active:scale-95 duration-200"
>
  <Download size={14} />
</button>
                          </div>

                          <div className="grid grid-cols-2 gap-2 mt-2">
<div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
  <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Total USD</p>
  <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
</div>
<div className="bg-emerald-50/50 rounded-xl p-2.5 text-center border border-emerald-100/50">
  <p className="text-[10px] text-emerald-600/70 font-bold uppercase mb-0.5">Generada</p>
  <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
</div>
                          </div>

                          <div className="flex justify-between items-center px-1 pt-1">
<span className="text-[10px] font-bold text-slate-400 uppercase">Equiv. Bs</span>
<span className="text-xs font-bold text-indigo-600">{fmtBs(v.totalBs)}</span>
                          </div>



    


                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          <ModalDetalleVendedor
            isOpen={!!vendedorSeleccionado}
            onClose={() => setVendedorSeleccionado(null)}
            vendedor={vendedorSeleccionado}
            rango={rango}
            configNeg={configNeg}
            ajustesManuales={ajustesManuales}
          />

          {comisiones.length === 0 && (
            <EmptyState icon={Percent} title="Sin comisiones" description="No hay comisiones en el periodo seleccionado." />
          )}
        </>
      )}
    </div>
  )
}

// ─── Shared Components ────────────────────────────────────────────────────
function ExportButton({ onClick, loading, disabled }) {
  return (
    <button onClick={onClick} disabled={loading || disabled}
      className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-sm font-bold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md"
      style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}>
      <Download size={12} className="sm:w-3.5 sm:h-3.5" />
      {loading ? 'Generando...' : 'Descargar PDF'}
    </button>
  )
}

function ErrorMsg({ onRetry }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
      <p className="font-semibold">Error al cargar el reporte</p>
      <button onClick={onRetry} className="mt-3 text-sm underline">Intentar de nuevo</button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: CRÉDITO
// ═══════════════════════════════════════════════════════════════════════════

// Colores de riesgo por días sin pago
function riesgoCliente(dias) {
  if (dias <= 30) return { label: 'Al día', color: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700', bar: '#10b981' }
  if (dias <= 60) return { label: 'Moderado', color: '#f59e0b', bg: 'bg-amber-50', text: 'text-amber-700', bar: '#f59e0b' }
  if (dias <= 90) return { label: 'Alto', color: '#ef4444', bg: 'bg-red-50', text: 'text-red-700', bar: '#ef4444' }
  return { label: 'Crítico', color: '#7c3aed', bg: 'bg-purple-50', text: 'text-purple-700', bar: '#7c3aed' }
}

// Aging mejorado con barras visuales
function AgingBars({ aging }) {
  const maxUsd = Math.max(...aging.map(a => a.totalUsd), 1)
  const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#7c3aed']
  const totalUsd = aging.reduce((s, a) => s + a.totalUsd, 0)

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-slate-500" />
          <h3 className="text-xs sm:text-sm font-black text-slate-800">Antigüedad de deuda</h3>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">Total: ${totalUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div className="p-4 space-y-4">
        {aging.map((a, i) => {
          const pct = maxUsd > 0 ? (a.totalUsd / maxUsd) * 100 : 0
          const pctTotal = totalUsd > 0 ? (a.totalUsd / totalUsd) * 100 : 0
          return (
            <div key={a.rango} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i] }} />
                  <span className="text-xs font-semibold text-slate-700">{a.rango}</span>
                  <span className="text-[10px] text-slate-400 font-medium">{a.count} cargo{a.count !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-slate-400">{pctTotal.toFixed(0)}%</span>
                  <span className="text-xs font-bold text-slate-800">
                    ${a.totalUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, background: COLORS[i] }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function paginarReporte(items, pagina, porPagina) {
  const totalPaginas = Math.max(1, Math.ceil(items.length / porPagina))
  const paginaSegura = Math.min(Math.max(1, pagina), totalPaginas)
  return items.slice((paginaSegura - 1) * porPagina, paginaSegura * porPagina)
}

function PaginacionReporte({ pagina, totalItems, porPagina, onCambiar }) {
  if (totalItems === 0) return null
  const totalPaginas = Math.max(1, Math.ceil(totalItems / porPagina))
  const paginaSegura = Math.min(Math.max(1, pagina), totalPaginas)
  const desde = (paginaSegura - 1) * porPagina + 1
  const hasta = Math.min(paginaSegura * porPagina, totalItems)

  return (
    <div aria-live="polite" className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
      <span className="text-[11px] text-slate-500">Mostrando {desde}–{hasta} de {totalItems}</span>
      {totalPaginas > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Página anterior" onClick={() => onCambiar(Math.max(1, paginaSegura - 1))} disabled={paginaSegura <= 1}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-24 text-center text-xs font-semibold text-slate-600">Página {paginaSegura} de {totalPaginas}</span>
          <button type="button" aria-label="Página siguiente" onClick={() => onCambiar(Math.min(totalPaginas, paginaSegura + 1))} disabled={paginaSegura >= totalPaginas}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

function TabCredito() {
  const [rango, setRango] = useState(() => {
    const month = getMonthRange()
    return { from: month.from, to: month.to }
  })
  // El reporte del período (KPIs de saldo inicial/cargos/abonos, cuadre de
  // movimientos y movimientos del rango) lo construye el módulo probado
  // cxcPeriodReport.js a través de useReportePeriodoCxC.
  const { data: cxcData, isLoading: cxcLoading, isError: cxcError, refetch: refetchCxc } = useReportePeriodoCxC(rango)
  const { data: proveedores = [], isLoading: provLoading, isError: provError, refetch: refetchProv } = useProveedores()

  const [vistaCredito, setVistaCredito] = useState('resumen')
  const [busquedaAlertas, setBusquedaAlertas] = useState('')
  const [busquedaClientes, setBusquedaClientes] = useState('')
  const [busquedaMovimientos, setBusquedaMovimientos] = useState('')
  const [busquedaProveedores, setBusquedaProveedores] = useState('')
  const [paginaClientes, setPaginaClientes] = useState(1)
  const [paginaAlertas, setPaginaAlertas] = useState(1)
  const [paginaMovimientos, setPaginaMovimientos] = useState(1)
  const [paginaProveedores, setPaginaProveedores] = useState(1)
  const [sortBy, setSortBy] = useState('saldo') // 'saldo' | 'dias' | 'diasRestantes'
  const [sortDir, setSortDir] = useState('desc')
  const porPagina = 20
  const { perfil } = useAuthStore()
  const esAdmin = perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador' || perfil?.rol === 'jefe'

  const [exportandoCxC, setExportandoCxC] = useState(false)
  const [tipoReporteCxC, setTipoReporteCxC] = useState('detallado')
  const { data: configNeg = {} } = useConfigNegocio()

  const isLoading = cxcLoading || provLoading
  const isError = cxcError || provError

  const refetch = () => {
    refetchCxc()
    refetchProv()
  }

  async function exportarCxCPDF(accion = 'descargar') {
    const ventanaImpresion = accion === 'imprimir' ? window.open('', '_blank') : null
    if (accion === 'imprimir' && !ventanaImpresion) {
      showToast('Permite las ventanas emergentes para imprimir el PDF.', 'warning')
      return
    }

    setExportandoCxC(true)
    try {
      const { generarReporteCxCPDF } = await import('../services/pdf/cxcPDF')
      await generarReporteCxCPDF({
        data: cxcData,
        config: configNeg,
        action: accion === 'imprimir' ? 'print' : 'download',
        tipo: tipoReporteCxC,
        rango,
        printWindow: ventanaImpresion,
      })
      if (accion === 'descargar') showToast('Reporte CxC descargado.', 'success')
    } catch (e) {
      ventanaImpresion?.close()
      console.error('Error generando reporte de CxC:', e)
      showToast('No se pudo generar el reporte de CxC.', 'error')
    } finally {
      setExportandoCxC(false)
    }
  }

  function toggleSort(col) {
    setPaginaClientes(1)
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir(col === 'diasRestantes' ? 'asc' : 'desc') }
  }

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />

  // Normalizar datos de CxC
  const kpis = cxcData?.kpis || { totalDeuda: 0, numClientesConDeuda: 0, promedioDeuda: 0, diasMasAntiguo: 0, numCargos: 0 }
  const clientesConDeuda = cxcData?.clientesConDeuda || []
  const aging = cxcData?.aging || []
  const alertasVencimiento = cxcData?.alertasVencimiento || []
  const movimientosPeriodo = cxcData?.movimientosDelPeriodo || []

  // Calcular métricas de CxP (Proveedores)
  const proveedoresConDeuda = proveedores.filter(p => Number(p.saldo_pendiente || 0) > 0)
  const totalCxC = Number(kpis.totalDeuda || 0)
  const totalCxP = proveedores.reduce((sum, p) => sum + (p.activo ? Number(p.saldo_pendiente || 0) : 0), 0)
  const actividadCxC = movimientosPeriodo.length > 0
  const balanceNeto = totalCxC - totalCxP

  const clientesOrdenados = [...clientesConDeuda].sort((a, b) => {
    let va, vb
    if (sortBy === 'saldo') {
      va = Number(a.saldo_pendiente)
      vb = Number(b.saldo_pendiente)
    } else if (sortBy === 'diasRestantes') {
      va = a.diasRestantes !== null ? a.diasRestantes : (sortDir === 'desc' ? -99999 : 99999)
      vb = b.diasRestantes !== null ? b.diasRestantes : (sortDir === 'desc' ? -99999 : 99999)
    } else {
      va = a.diasSinPago ?? 0
      vb = b.diasSinPago ?? 0
    }
    return sortDir === 'desc' ? vb - va : va - vb
  })

  const proveedoresOrdenados = [...proveedoresConDeuda].sort((a, b) => {
    const sa = Number(a.saldo_pendiente)
    const sb = Number(b.saldo_pendiente)
    return sb - sa // Mayor deuda primero
  })
  const alertaVencidasOrdenadas = [...alertasVencimiento].sort((a, b) => Number(a.diasRestantes) - Number(b.diasRestantes))
  const alertasFiltradas = alertaVencidasOrdenadas.filter(alerta =>
    `${alerta.cliente_nombre || ''} ${alerta.metodo_pago || ''}`.toLowerCase().includes(busquedaAlertas.trim().toLowerCase())
  )
  const clientesFiltrados = clientesOrdenados.filter(cliente =>
    `${cliente.nombre || ''} ${cliente.rif_cedula || ''} ${cliente.vendedor?.nombre || ''}`.toLowerCase().includes(busquedaClientes.trim().toLowerCase())
  )
  const movimientosFiltrados = movimientosPeriodo.filter(movimiento =>
    `${movimiento.cliente?.nombre || ''} ${movimiento.descripcion || ''} ${movimiento.referencia || ''} ${movimiento.tipo || ''} ${movimiento.metodo_pago || ''} ${JSON.stringify(movimiento.forma_pago_abono || '')}`.toLowerCase().includes(busquedaMovimientos.trim().toLowerCase())
  )
  const proveedoresFiltrados = proveedoresOrdenados.filter(proveedor =>
    `${proveedor.nombre || ''} ${proveedor.rif_cedula || ''} ${proveedor.telefono || ''} ${proveedor.email || ''}`.toLowerCase().includes(busquedaProveedores.trim().toLowerCase())
  )
  const clientesPaginados = paginarReporte(clientesFiltrados, paginaClientes, porPagina)
  const alertasPaginadas = paginarReporte(alertasFiltradas, paginaAlertas, porPagina)
  const movimientosPaginados = paginarReporte(movimientosFiltrados, paginaMovimientos, porPagina)
  const proveedoresPaginados = paginarReporte(proveedoresFiltrados, paginaProveedores, porPagina)
  const maxSaldo = clientesConDeuda.reduce((max, cliente) => Math.max(max, Number(cliente.saldo_pendiente) || 0), 1)

  const SortBtn = ({ col, label }) => (
    <button
      onClick={() => toggleSort(col)}
      className={`flex items-center gap-0.5 hover:text-slate-700 transition-colors ${sortBy === col ? 'text-slate-800 font-black' : 'text-slate-400 font-semibold'}`}
    >
      {label}
      <span className="text-[9px] ml-0.5">{sortBy === col ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
    </button>
  )
  const rangoLabel = `${new Date(`${rango.from}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })} - ${new Date(`${rango.to}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}`

  return (
    <div className="space-y-4">
      {/* Selector de Rango de Fecha para Cobranza/Abonos */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-6">
          <div className="w-full">
            <div className="flex items-center gap-2 ml-1 mb-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Período del reporte CxC (corte y movimientos)</label>
              <span className="hidden sm:inline-flex text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                {rangoLabel}
              </span>
            </div>
            <DateRangeSelector value={rango} onChange={nuevoRango => {
              setRango(nuevoRango)
              setPaginaAlertas(1)
              setPaginaClientes(1)
              setPaginaMovimientos(1)
              setPaginaProveedores(1)
            }} envolverPresets />
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-30 -mx-1 space-y-2 bg-white/95 pb-1 backdrop-blur sm:mx-0">
      {/* Acciones principales accesibles sin bajar hasta las tablas */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-3">        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Reporte CxC</span>

          <span className="text-[10px] font-semibold text-slate-400">{rangoLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="formato-reporte-cxc">Formato del reporte</label>
          <select id="formato-reporte-cxc" aria-label="Formato de reporte CxC" value={tipoReporteCxC} onChange={event => setTipoReporteCxC(event.target.value)} disabled={exportandoCxC} className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 sm:flex-none">
            <option value="resumen">Resumen PDF</option>
            <option value="detallado">Detallado PDF</option>
          </select>
          <button type="button" aria-label="Imprimir reporte CxC" onClick={() => exportarCxCPDF('imprimir')} disabled={exportandoCxC || (!clientesConDeuda.length && !actividadCxC)}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 sm:flex-none">
            {exportandoCxC ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} Imprimir
          </button>
          <button type="button" aria-label="Descargar reporte CxC" onClick={() => exportarCxCPDF('descargar')} disabled={exportandoCxC || (!clientesConDeuda.length && !actividadCxC)}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 sm:flex-none">
            {exportandoCxC ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {exportandoCxC ? 'Generando…' : 'Descargar'}
          </button>
        </div>
      </div>

      <nav aria-label="Secciones del reporte de crédito" className="-mx-1 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1 sm:mx-0">
        {[
          { id: 'resumen', label: 'Resumen' },
          ...(esAdmin ? [{ id: 'alertas', label: `Alertas (${alertasVencimiento.length})` }] : []),
          { id: 'clientes', label: `Clientes (${clientesConDeuda.length})` },
          { id: 'movimientos', label: `Movimientos (${movimientosPeriodo.length})` },
          { id: 'cxp', label: `Proveedores (${proveedoresConDeuda.length})` },
        ].map(seccion => (
          <button key={seccion.id} type="button" onClick={() => setVistaCredito(seccion.id)} aria-current={vistaCredito === seccion.id ? 'page' : undefined}
            className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-bold transition-colors ${vistaCredito === seccion.id ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700'}`}>
            {seccion.label}
          </button>
        ))}
      </nav>
      </div>

      {vistaCredito === 'alertas' && esAdmin && (
        <section aria-labelledby="alertas-cxc-titulo" className="overflow-hidden rounded-xl border border-orange-200 bg-orange-50">
          <div className="flex flex-col gap-3 border-b border-orange-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="shrink-0 text-orange-600" size={18} />
              <h2 id="alertas-cxc-titulo" className="text-sm font-bold text-orange-900">Alertas de vencimiento</h2>
              <span className="rounded-full bg-orange-200 px-2 py-0.5 text-[10px] font-bold text-orange-800">{alertasFiltradas.length} / {alertasVencimiento.length}</span>
            </div>              <input type="search" aria-label="Buscar alertas por cliente" placeholder="Buscar cliente…" value={busquedaAlertas}
                onChange={event => { setBusquedaAlertas(event.target.value); setPaginaAlertas(1) }}
                onKeyDown={event => { if (event.key === 'Enter') setPaginaAlertas(1) }}
                className="min-h-10 w-full rounded-lg border border-orange-200 bg-white px-3 text-sm sm:max-w-xs" />

          </div>            <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">

            {alertasPaginadas.map(alerta => (
              <div key={alerta.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-orange-100 bg-white p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="truncate text-xs font-bold text-slate-800">{alerta.cliente_nombre}</div>
                    {alerta.metodo_pago === 'cod' && <span className="shrink-0 rounded border border-blue-200 bg-blue-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-blue-800">COD</span>}
                  </div>
                  <div className="text-[10px] text-slate-500">Cargo: {new Date(alerta.creado_en).toLocaleDateString()}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-black text-orange-600">{fmtUsd(alerta.saldo_usd)}</div>
                  <div className="text-[10px] font-semibold text-orange-500">{alerta.diasRestantes < 0 ? `Vencido hace ${Math.abs(alerta.diasRestantes)} días` : alerta.diasRestantes === 0 ? 'Vence hoy' : `Vence en ${alerta.diasRestantes} días`}</div>
                </div>
              </div>
            ))}
            {alertasFiltradas.length === 0 && <p className="col-span-full p-6 text-center text-sm text-slate-500">No hay alertas que coincidan con la búsqueda.</p>}
          </div>
          <PaginacionReporte pagina={paginaAlertas} totalItems={alertasFiltradas.length} porPagina={porPagina} onCambiar={setPaginaAlertas} />
        </section>
      )}

      {vistaCredito === 'resumen' && esAdmin && alertasVencimiento.length > 0 && (
        <button type="button" onClick={() => { setPaginaAlertas(1); setVistaCredito('alertas') }} className="flex w-full items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-left hover:bg-orange-100">
          <span className="flex min-w-0 items-center gap-2"><AlertTriangle size={17} className="shrink-0 text-orange-600" /><span className="truncate text-xs font-bold text-orange-900">{alertasVencimiento.length} alertas de vencimiento · {alertasVencimiento.filter(alerta => alerta.diasRestantes < 0).length} vencidas</span></span>
          <span className="shrink-0 text-xs font-bold text-orange-800">Ver alertas →</span>
        </button>
      )}

      {/* Resumen CxC para las fechas seleccionadas */}
      {vistaCredito === 'resumen' && <>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard icon={DollarSign} label="Saldo inicial (deuda)" value={fmtUsd(kpis.saldoInicial || 0)} sub={`Neto: ${fmtUsd(kpis.saldoInicialNeto || 0)}`} gradient="linear-gradient(135deg, #1e3a5f, #1B365D)" border="rgba(255,255,255,0.07)" />
        <KpiCard icon={ArrowUpCircle} label="Cargos del período" value={fmtUsd(kpis.totalCargos || 0)} sub="Crédito generado en el rango" gradient="linear-gradient(135deg, #b45309, #92400e)" border="rgba(255,255,255,0.10)" />
        <KpiCard icon={ArrowDownCircle} label="Abonos aplicados" value={fmtUsd(kpis.totalAbonos || 0)} sub={`Saldo a favor/cruces: ${fmtUsd(kpis.totalAbonosSaldoFavor || 0)}`} gradient="linear-gradient(135deg, #047857, #065f46)" border="rgba(255,255,255,0.10)" />
        <KpiCard icon={CheckCircle} label="Cobros en dinero" value={fmtUsd(kpis.totalCobrado || 0)} sub="Excluye cruces internos y devoluciones" gradient="linear-gradient(135deg, #059669, #047857)" border="rgba(255,255,255,0.10)" />
        <KpiCard icon={CreditCard} label="CxC al cierre" value={fmtUsd(totalCxC)} sub={`${kpis.numClientesConDeuda || 0} clientes con deuda`} gradient="linear-gradient(135deg, #991b1b, #b91c1c)" border="rgba(255,255,255,0.10)" />
          <KpiCard icon={DollarSign} label="Saldo a favor actual" value={fmtUsd(kpis.totalSaldoFavorClientes || 0)} sub="Saldo disponible hoy, no al corte" light />
        </div>

        <AgingBars aging={aging} />

        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-950">
        <div className="font-black uppercase tracking-wide text-[10px] text-indigo-700">Cuadre de movimientos · ${rangoLabel}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
          <span>Neto inicial {fmtUsd(kpis.saldoInicialNeto || 0)}</span><span>+</span>
          <span>cargos {fmtUsd(kpis.totalCargos || 0)}</span><span>−</span>
          <span>abonos {fmtUsd(kpis.totalAbonos || 0)}</span><span>=</span>
          <span>neto al cierre {fmtUsd(kpis.saldoFinalNeto || 0)}</span>
            {kpis.saldoActualComparado ? (
            <span className={`ml-auto font-black ${Math.abs(Number(kpis.diferenciaSaldoActual || 0)) < 0.01 ? 'text-emerald-700' : 'text-red-700'}`}>
              {Math.abs(Number(kpis.diferenciaSaldoActual || 0)) < 0.01 ? 'Saldo actual coincide' : `Revisar saldo: ${fmtUsd(kpis.diferenciaSaldoActual)} · ${kpis.clientesConDiferenciaSaldoActual || 0} clientes`}
            </span>
          ) : <span className="ml-auto font-black text-amber-800">Cuadre matemático; ledger no validado</span>}
        </div>
        {kpis.totalAbonosAjuste > 0 && <div className="mt-1 text-[10px] text-indigo-700">Incluye {fmtUsd(kpis.totalAbonosAjuste)} de abonos por devolución/ajustes, separados de los cobros monetarios.</div>}
        {kpis.totalAbonosSinClasificar > 0 && <div className="mt-1 text-[10px] font-bold text-red-700">Revisar {fmtUsd(kpis.totalAbonosSinClasificar)} en abonos sin método o con desglose incompleto; no se cuentan como dinero cobrado.</div>}
        {cxcData?.revisionesSaldoActual?.length > 0 && (
          <details className="mt-2 rounded-lg border border-red-200 bg-white p-2 text-[10px] text-red-800">
            <summary className="cursor-pointer font-bold">Ver diferencias por cliente ({cxcData.revisionesSaldoActual.length})</summary>
            <ul className="mt-1 space-y-1">
              {cxcData.revisionesSaldoActual.map(cliente => <li key={cliente.id}>{cliente.nombre}: ledger {fmtUsd(cliente.saldoLedger)} · saldo actual {fmtUsd(cliente.saldoAlmacenado)} · diferencia {fmtUsd(cliente.diferencia)}</li>)}
            </ul>
          </details>
        )}
        <div className="mt-1 text-[10px] text-indigo-700">El saldo a favor mostrado es el disponible actual; CxP corresponde al saldo actual de proveedores y no se recorta al rango.</div>
        </div>
      </>}

      {vistaCredito === 'clientes' && (
        <>
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-red-500" />
                <h2 className="text-sm font-black text-slate-800">Clientes con saldo pendiente</h2>
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">{clientesFiltrados.length} / {clientesConDeuda.length}</span>
              </div>
              <div className="flex w-full flex-col gap-2 sm:max-w-xl sm:flex-row">
                <input type="search" aria-label="Buscar clientes por nombre, RIF o vendedor" placeholder="Buscar cliente, RIF o vendedor…" value={busquedaClientes}
                  onChange={event => { setBusquedaClientes(event.target.value); setPaginaClientes(1) }}
                  className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                <label className="sr-only" htmlFor="orden-clientes-cxc">Ordenar clientes</label>
                <select id="orden-clientes-cxc" value={sortBy} onChange={event => { const col = event.target.value; setSortBy(col); setSortDir(col === 'diasRestantes' ? 'asc' : 'desc'); setPaginaClientes(1) }}
                  className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 sm:w-44">
                  <option value="saldo">Mayor saldo</option>
                  <option value="dias">Más antigüedad</option>
                  <option value="diasRestantes">Próximo vencimiento</option>
                </select>
              </div>
            </div>
            <div className="grid gap-2 p-3 lg:hidden">
              {clientesFiltrados.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No se encontraron clientes con ese filtro.</p> : clientesPaginados.map(cliente => {
                const dias = cliente.diasSinPago ?? 0
                const riesgo = riesgoCliente(dias)
                return <article key={cliente.id} className="rounded-xl border border-slate-100 p-3">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-bold text-slate-800">{cliente.nombre}</p><p className="text-[10px] text-slate-400">{cliente.rif_cedula || 'Sin RIF'}{cliente.vendedor?.nombre ? ` · ${cliente.vendedor.nombre}` : ''}</p></div><strong className="shrink-0 text-sm text-red-600">{fmtUsd(cliente.saldo_pendiente)}</strong></div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${riesgo.bg} ${riesgo.text}`}>{riesgo.label} · {dias}d</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">{cliente.diasRestantes === null ? 'Sin vencimiento' : cliente.diasRestantes < 0 ? `Vencido ${Math.abs(cliente.diasRestantes)}d` : cliente.diasRestantes === 0 ? 'Vence hoy' : `${cliente.diasRestantes}d restantes`}</span></div>
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2 text-[10px]"><span className="text-slate-500">Inicial<strong className="block text-slate-700">{fmtUsd(cliente.saldo_inicial || 0)}</strong></span><span className="text-amber-700">Cargos<strong className="block">{fmtUsd(cliente.monto_otorgado || 0)}</strong></span><span className="text-emerald-700">Abonos<strong className="block">{fmtUsd(cliente.total_abonado_periodo || 0)}</strong></span></div>
                </article>
              })}
            </div>
              <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1050px] text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                    <th className="px-4 py-2.5 text-left font-semibold">Cliente</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Vendedor</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Riesgo</th>
                    <th className="px-3 py-2.5 text-center">
                      <SortBtn col="dias" label="Antigüedad" />
                    </th>
                    <th className="px-3 py-2.5 text-center">
                      <SortBtn col="diasRestantes" label="Días Restantes" />
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">Saldo inicial</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-amber-700">Cargos período</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-emerald-700">Abonos período</th>
                    <th className="px-3 py-2.5 text-right"><SortBtn col="saldo" label="Saldo al cierre" /></th>
                  </tr>
                </thead>
                <tbody>
                  {clientesFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-xs font-medium text-slate-400">
                        No hay clientes con saldo pendiente al cierre de este período o no coinciden con la búsqueda.
                      </td>
                    </tr>
                  ) : clientesPaginados.map((c, i) => {
                    const saldo = Number(c.saldo_pendiente)
                    const dias = c.diasSinPago ?? 0
                    const riesgo = riesgoCliente(dias)
                    const barPct = Math.min((saldo / maxSaldo) * 100, 100)

                    return (
                      <tr key={c.id} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/20'}`}>
                        {/* Cliente */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-bold text-slate-800 leading-tight">{c.nombre}</p>
                            {c.cargosActivos && c.cargosActivos.some(car => car.metodo_pago === 'cod') && (
                              <span className="bg-blue-100 text-blue-800 text-[8px] font-black px-1.5 py-0.5 rounded border border-blue-200 shrink-0">
                                COD
                              </span>
                            )}
                          </div>
                          {c.rif_cedula && <p className="text-[10px] text-slate-400 font-mono mt-0.5">{c.rif_cedula}</p>}
                          {/* Mini barra de saldo relativo */}
                          <div className="mt-1.5 h-1 rounded-full bg-slate-100 w-24 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: riesgo.bar }} />
                          </div>
                        </td>
                        {/* Vendedor */}
                        <td className="px-3 py-3">
                          {c.vendedor ? (
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.vendedor.color || '#64748b' }} />
                              <span className="text-slate-600 font-medium">{c.vendedor.nombre}</span>
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        {/* Riesgo badge */}
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${riesgo.bg} ${riesgo.text}`}>
                            {riesgo.label}
                          </span>
                        </td>
                        {/* Antigüedad */}
                        <td className="px-3 py-3 text-center">
                          <span className={`font-black text-sm ${dias > 60 ? 'text-red-600' : dias > 30 ? 'text-amber-600' : 'text-slate-600'}`}>
                            {dias}d
                          </span>
                        </td>
                        {/* Días Restantes */}
                        <td className="px-3 py-3 text-center">
                          {c.diasRestantes === null ? (
<span className="text-slate-300">—</span>
                          ) : c.diasRestantes < 0 ? (
                            <span className="inline-flex px-2 py-1 rounded-full text-[10px] font-black bg-red-100 text-red-700">
                              Vencido ({Math.abs(c.diasRestantes)}d)
                            </span>
                          ) : c.diasRestantes === 0 ? (
                            <span className="inline-flex px-2 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">
                              Vence hoy
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                              {c.diasRestantes}d restantes
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-600">{fmtUsd(c.saldo_inicial || 0)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-amber-700">{fmtUsd(c.monto_otorgado || 0)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-emerald-700">{fmtUsd(c.total_abonado_periodo || 0)}</td>
                        {/* Saldo */}
                        <td className="px-3 py-3 text-right">
                          <span className={`font-black text-sm ${saldo > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
{fmtUsd(saldo)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <PaginacionReporte pagina={paginaClientes} totalItems={clientesFiltrados.length} porPagina={porPagina} onCambiar={setPaginaClientes} />
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">{kpis.numClientesConDeuda || 0} cliente{(kpis.numClientesConDeuda || 0) !== 1 ? 's' : ''} con deuda al cierre · {kpis.numClientesConActividad || 0} con saldo o movimientos</span>
                <div className="flex flex-wrap gap-3">
                  <span className="text-xs font-bold text-amber-700">Cargos: {fmtUsd(kpis.totalCargos || 0)}</span>
                  <span className="text-xs font-bold text-emerald-700">Abonos: {fmtUsd(kpis.totalAbonos || 0)}</span>
                  <span className="text-xs font-bold text-emerald-600">Cobrado: {fmtUsd(kpis.totalCobrado || 0)}</span>
                  <span className="text-xs font-black text-red-600">CxC al cierre: {fmtUsd(totalCxC)}</span>
                </div>
              </div>
            </div>
          </section>
        </>
      )}


      {/* Actividad conciliada del período */}
      {vistaCredito === 'movimientos' && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <DollarSign size={14} className="text-emerald-500" />
              <h2 className="text-sm font-black text-slate-800">Actividad CxC del período</h2>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">{movimientosFiltrados.length}</span>
            </div>
            <input type="search" aria-label="Buscar movimientos CxC" placeholder="Buscar cliente, referencia o descripción…" value={busquedaMovimientos}
              onChange={event => { setBusquedaMovimientos(event.target.value); setPaginaMovimientos(1) }}
              className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm sm:max-w-sm" />
          </div>
          {movimientosFiltrados.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No hay movimientos para mostrar con este filtro.</p> : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[850px] text-xs">
                  <thead><tr className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase text-slate-400">
                    <th className="px-4 py-2.5 text-left font-semibold">Fecha</th><th className="px-3 py-2.5 text-left font-semibold">Cliente</th><th className="px-3 py-2.5 text-center font-semibold">Movimiento</th><th className="px-3 py-2.5 text-center font-semibold">Método</th><th className="px-3 py-2.5 text-left font-semibold">Ref / Descripción</th><th className="px-3 py-2.5 text-center font-semibold">Despacho</th><th className="px-4 py-2.5 text-right font-semibold">Monto USD</th>
                  </tr></thead>
                  <tbody>{movimientosPaginados.map(movimiento => {
                    const numDes = movimiento.despacho?.numero ? `DES-${String(movimiento.despacho.numero).padStart(5, '0')}` : (movimiento.despacho?.cotizacion?.numero ? `COT-${String(movimiento.despacho.cotizacion.numero).padStart(5, '0')}` : '—')
                    return <tr key={movimiento.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{new Date(movimiento.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td className="px-3 py-2.5 font-bold text-slate-700">{movimiento.cliente?.nombre || 'Desconocido'}</td><td className={`px-3 py-2.5 text-center font-bold ${movimiento.tipo === 'cargo' ? 'text-amber-700' : 'text-emerald-700'}`}>{movimiento.tipo === 'cargo' ? 'Cargo' : 'Abono'}</td><td className="px-3 py-2.5 text-center font-semibold text-slate-600">{movimiento.tipo === 'abono' ? formatMetodoPago(movimiento.forma_pago_abono || movimiento.metodo_pago) : (movimiento.metodo_pago === 'cod' ? 'COD' : 'Crédito')}</td><td className="max-w-xs truncate px-3 py-2.5 italic text-slate-500" title={movimiento.descripcion}>{movimiento.referencia ? `Ref: ${movimiento.referencia} · ` : ''}{movimiento.descripcion || 'Sin descripción'}</td><td className="px-3 py-2.5 text-center">{numDes}</td><td className={`px-4 py-2.5 text-right font-black ${movimiento.tipo === 'cargo' ? 'text-amber-700' : 'text-emerald-700'}`}>{movimiento.tipo === 'cargo' ? '+' : '−'}{fmtUsd(movimiento.monto_usd)}</td>
                    </tr>
                  })}</tbody>
                </table>
              </div>
              <div className="grid gap-2 p-3 lg:hidden">{movimientosPaginados.map(movimiento => (
                <article key={movimiento.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{movimiento.cliente?.nombre || 'Desconocido'}</p><p className="text-[11px] text-slate-500">{new Date(movimiento.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}</p></div><span className={`shrink-0 text-sm font-black ${movimiento.tipo === 'cargo' ? 'text-amber-700' : 'text-emerald-700'}`}>{movimiento.tipo === 'cargo' ? '+' : '−'}{fmtUsd(movimiento.monto_usd)}</span></div>
                  <div className="mt-2 flex flex-wrap gap-1.5"><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-600">{movimiento.tipo === 'cargo' ? 'Cargo' : 'Abono'}</span><span className="rounded-full bg-white px-2 py-1 text-[10px] text-slate-600">{movimiento.tipo === 'abono' ? formatMetodoPago(movimiento.forma_pago_abono || movimiento.metodo_pago) : (movimiento.metodo_pago === 'cod' ? 'COD' : 'Crédito')}</span></div>
                  {(movimiento.referencia || movimiento.descripcion) && <p className="mt-2 break-words text-xs text-slate-600">{movimiento.referencia ? `Ref: ${movimiento.referencia} · ` : ''}{movimiento.descripcion || 'Sin descripción'}</p>}
                </article>
              ))}</div>
              <PaginacionReporte pagina={paginaMovimientos} totalItems={movimientosFiltrados.length} porPagina={porPagina} onCambiar={setPaginaMovimientos} />
            </>
          )}
        </section>
      )}

      {/*
            <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden shadow-sm mt-4">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign size={14} className="text-emerald-500" />
                  <h3 className="text-xs sm:text-sm font-black text-slate-800">
                    Actividad CxC ({rango.from === rango.to ? "del Día" : "del Período"})
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold">{movimientosPeriodo.length}</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                      <th className="px-4 py-2.5 text-left font-semibold">Fecha</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Movimiento</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Método</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Ref / Descripción</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Despacho</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Monto USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientosPeriodo.map((a) => {
                      const numDes = a.despacho?.numero 
                        ? `DES-${String(a.despacho.numero).padStart(5, '0')}` 
                        : (a.despacho?.cotizacion?.numero 
                            ? `COT-${String(a.despacho.cotizacion.numero).padStart(5, '0')}` 
                            : '—')

                      return (
                        <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-2.5 text-slate-500 font-medium">
                            {new Date(a.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-3 py-2.5 font-bold text-slate-700">
                            {a.cliente?.nombre || 'Desconocido'}
                          </td>
                          <td className={`px-3 py-2.5 text-center font-bold ${a.tipo === 'cargo' ? 'text-amber-700' : 'text-emerald-700'}`}>{a.tipo === 'cargo' ? 'Cargo' : 'Abono'}</td>
                          <td className="px-3 py-2.5 text-center font-semibold text-slate-600">{a.tipo === 'abono' ? formatMetodoPago(a.forma_pago_abono || a.metodo_pago) : (a.metodo_pago === 'cod' ? 'COD' : 'Crédito')}</td>
                          <td className="px-3 py-2.5 text-slate-500 italic max-w-xs truncate" title={a.descripcion}>
                            {a.referencia ? `Ref: ${a.referencia} · ` : ''}{a.descripcion || 'Sin descripción'}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {numDes !== '—' ? (
                              <span className="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-mono font-bold text-[10px]">
                                {numDes}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className={`px-4 py-2.5 text-right font-black text-sm ${a.tipo === 'cargo' ? 'text-amber-700' : 'text-emerald-700'}`}>
                            {a.tipo === 'cargo' ? '+' : '−'}{fmtUsd(a.monto_usd)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
      */}
      {vistaCredito === 'cxp' && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Briefcase size={14} className="text-purple-500" />
              <h2 className="text-sm font-black text-slate-800">Proveedores con saldo pendiente (CxP)</h2>
              <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-600">{proveedoresFiltrados.length} / {proveedoresConDeuda.length}</span>
            </div>
            <input type="search" aria-label="Buscar proveedores por nombre, RIF, correo o teléfono" placeholder="Buscar proveedor…" value={busquedaProveedores}
              onChange={event => { setBusquedaProveedores(event.target.value); setPaginaProveedores(1) }}
              className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm sm:max-w-sm" />
          </div>
          <div className="grid gap-2 p-3 lg:hidden">
            {proveedoresFiltrados.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No hay proveedores con saldo para este filtro.</p> : proveedoresPaginados.map(proveedor => (
              <article key={proveedor.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3">
                <div className="min-w-0"><p className="break-words text-sm font-bold text-slate-800">{proveedor.nombre}</p><p className="text-[10px] text-slate-500">{proveedor.tipo_proveedor || 'Proveedor'}{proveedor.rif_cedula ? ` · ${proveedor.rif_cedula}` : ''}</p><p className="mt-1 break-all text-[10px] text-slate-500">{[proveedor.telefono, proveedor.email].filter(Boolean).join(' · ') || 'Sin contacto'}</p></div>
                <strong className="shrink-0 text-sm text-purple-600">{fmtUsd(proveedor.saldo_pendiente)}</strong>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[760px] text-xs">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-2.5 text-left font-semibold">Proveedor</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Tipo</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Contacto</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Ubicación</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Saldo USD (CxP)</th>
                </tr>
              </thead>
              <tbody>
                {proveedoresFiltrados.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No hay proveedores con saldo para este filtro.</td></tr>
                ) : proveedoresPaginados.map((p, i) => {
                  const saldo = Number(p.saldo_pendiente)
                  return (
                    <tr key={p.id} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/20'}`}>
                      {/* Proveedor */}
                      <td className="px-4 py-3 font-bold text-slate-800">
                        <p>{p.nombre}</p>
                        {p.rif_cedula && <p className="text-[10px] text-slate-400 font-mono mt-0.5">{p.rif_cedula}</p>}
                      </td>
                      {/* Tipo */}
                      <td className="px-3 py-3 capitalize text-slate-600 font-medium">
                        {p.tipo_proveedor}
                      </td>
                      {/* Contacto */}
                      <td className="px-3 py-3 text-slate-500">
                        {p.telefono && <p>{p.telefono}</p>}
                        {p.email && <p className="text-[10px]">{p.email}</p>}
                      </td>
                      {/* Ubicación */}
                      <td className="px-3 py-3 text-slate-500">
                        {p.ciudad ? `${p.ciudad}, ${p.estado}` : '—'}
                      </td>
                      {/* Saldo */}
                      <td className="px-4 py-3 text-right">
                        <span className="font-black text-purple-600 text-sm">
                          {fmtUsd(saldo)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <PaginacionReporte pagina={paginaProveedores} totalItems={proveedoresFiltrados.length} porPagina={porPagina} onCambiar={setPaginaProveedores} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
            <span className="text-[10px] text-slate-500">{proveedoresConDeuda.length} proveedor{proveedoresConDeuda.length !== 1 ? 'es' : ''} con saldo pendiente</span>
            <span className="text-xs font-black text-purple-600">Total por pagar: {fmtUsd(totalCxP)}</span>
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Tab Artículos Externos ──────────────────────────────────────────────────
function TabArticulosExternos({ configNeg }) {
  const [rango, setRango] = useState(() => {
    const actual = getDayRange(0)
    const anterior = getDayRange(-1)
    return { from: actual.from, to: actual.to, prevFrom: anterior.from, prevTo: anterior.to }
  })
  const [exportando, setExportando] = useState(false)
  const [filtroAsesor, setFiltroAsesor] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const { data: items = [], isLoading, isError, refetch } = useReporteExternos({
    from: rango.from,
    to: rango.to
  })

  const asesores = useMemo(() => {
    const map = {}
    items.forEach(item => {
      if (item.asesor_nombre) {
        map[item.asesor_nombre] = { nombre: item.asesor_nombre, color: item.asesor_color }
      }
    })
    return Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [items])

  const itemsFiltrados = useMemo(() => {
    const porAsesor = items.filter(item => !filtroAsesor || item.asesor_nombre === filtroAsesor)
    if (!busqueda.trim()) return porAsesor

    return rankEntities(porAsesor, busqueda, [
      { key: 'articulo_nombre', weight: 10 },
      { key: 'articulo_codigo', weight: 9 },
      { key: 'cliente_nombre', weight: 8 },
      { key: 'cliente_rif', weight: 8 },
      { key: 'despacho_numero', weight: 7 },
    ])
  }, [items, filtroAsesor, busqueda])

  const kpis = useMemo(() => {
    const totalVentas = itemsFiltrados.reduce((sum, item) => sum + Number(item.total_usd || 0), 0)
    const cantidadTotal = itemsFiltrados.reduce((sum, item) => sum + Number(item.cantidad || 0), 0)
    const pedidosUnicos = new Set(itemsFiltrados.map(item => item.despacho_id)).size
    const clientesUnicos = new Set(itemsFiltrados.map(item => item.cliente_rif)).size

    return {
      totalVentas,
      cantidadTotal,
      pedidosUnicos,
      clientesUnicos
    }
  }, [itemsFiltrados])

  const exportarPDF = async (accion = 'descargar') => {
    if (!itemsFiltrados.length) return
    setExportando(true)
    try {
      const { generarArticulosExternosPDF } = await import('../services/pdf/articulosExternosPDF')
      await generarArticulosExternosPDF({
        items: itemsFiltrados,
        rango,
        kpis,
        config: configNeg,
        action: accion === 'imprimir' ? 'print' : 'download'
      })
    } catch (e) {
      console.error('Error generando PDF de artículos externos:', e)
    } finally {
      setExportando(false)
    }
  }
  const rangoLabel = `${new Date(`${rango.from}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })} - ${new Date(`${rango.to}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}`

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-3.5">
          {/* Fila Superior: Periodo (con mucho espacio) */}
          <div className="w-full">
            <div className="flex items-center gap-2 ml-1 mb-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Periodo</label>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                {rangoLabel}
              </span>
            </div>
            <DateRangeSelector value={rango} onChange={setRango} />
          </div>

          {/* Fila Inferior: Otros Filtros y Acciones */}
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-50 pt-3 w-full justify-between">
            {/* Grupo de Filtros */}
            <div className="flex flex-wrap items-end gap-3">
              {/* Selector de Asesor */}
              <div className="w-52">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Asesor (Vendedor)</label>
                <select
                  value={filtroAsesor}
                  onChange={e => setFiltroAsesor(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 text-xs font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none bg-slate-50/50 appearance-none cursor-pointer hover:border-indigo-300 transition-all"
                >
                  <option value="">Todos los asesores</option>
                  {asesores.map(a => (
                    <option key={a.nombre} value={a.nombre}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Búsqueda */}
              <div className="w-60">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Buscar</label>
                <input
                  type="text"
                  placeholder="Buscar por artículo o cliente..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 text-xs font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none bg-slate-50/50 hover:border-indigo-300 transition-all placeholder:text-slate-400"
                />
              </div>
            </div>

            {/* Grupo de Acciones */}
            <div className="flex items-center gap-1.5 ml-auto shrink-0 self-end">
              <button
                onClick={() => exportarPDF('imprimir')}
                disabled={exportando || !itemsFiltrados.length}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm h-9"
              >
                <Printer size={12} className="text-slate-500" />
                <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Imprimir PDF'}</span>
              </button>

              <button
                onClick={() => exportarPDF('descargar')}
                disabled={exportando || !itemsFiltrados.length}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md h-9"
                style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
              >
                <Download size={12} />
                <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Descargar PDF'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          icon={DollarSign}
          label="Total Ventas Externas"
          value={fmtUsd(kpis.totalVentas)}
          gradient="linear-gradient(135deg, #1B365D, #0d1f3c)"
          border="rgba(255,255,255,0.05)"
        />
        <KpiCard
          icon={Briefcase}
          label="Cant. Total Vendida"
          value={Number(kpis.cantidadTotal).toFixed(0)}
          sub="Unidades vendidas"
          gradient="linear-gradient(135deg, #1e293b, #0f172a)"
          border="rgba(255,255,255,0.05)"
        />
        <KpiCard
          icon={FileText}
          label="Pedidos Afectados"
          value={String(kpis.pedidosUnicos)}
          sub="Despachos únicos"
          gradient="linear-gradient(135deg, #0369a1, #0c4a6e)"
          border="rgba(255,255,255,0.05)"
        />
        <KpiCard
          icon={Users}
          label="Clientes Compradores"
          value={String(kpis.clientesUnicos)}
          sub="Clientes distintos"
          gradient="linear-gradient(135deg, #0d5c3a, #064026)"
          border="rgba(255,255,255,0.05)"
        />
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Fecha</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Despacho</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Código</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Artículo</th>
                <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-wider">Cant.</th>
                <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-wider">P. Unit. ($)</th>
                <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-wider">Total ($)</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Cliente</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Asesor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {itemsFiltrados.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-4 py-8 text-center text-slate-400 font-medium">
                    No se encontraron artículos externos vendidos en el periodo seleccionado.
                  </td>
                </tr>
              ) : (
                itemsFiltrados.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600 font-semibold">
                      {new Date(item.fecha).toLocaleDateString('es-VE')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-bold text-slate-900">
                      #{item.despacho_numero}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-medium">
                      {item.articulo_codigo || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-semibold">
                      {item.articulo_nombre}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-600">
                      {Number(item.cantidad || 0) % 1 === 0 ? Number(item.cantidad || 0).toFixed(0) : Number(item.cantidad || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-500">
                      {fmtUsd(item.precio_unit_usd)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-950">
                      {fmtUsd(item.total_usd)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{item.cliente_nombre}</div>
                      <div className="text-[10px] text-slate-400 font-bold">{item.cliente_rif}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.asesor_color }} />
                        <span className="font-bold text-slate-700">{item.asesor_nombre}</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════
export default function ReportesView() {
  const [activeTab, setActiveTab] = useState('comisiones')
  const { data: configNeg = {} } = useConfigNegocio()
  const perfil = useAuthStore(s => s.perfil)

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* ── Header compacto mobile ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 pb-2 sm:pb-4" style={{ borderBottom: '1px solid #e2e8f0' }}>
        <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="w-1 self-stretch rounded-full shrink-0 hidden sm:block"
            style={{ background: 'linear-gradient(180deg, #B8860B 0%, #1B365D 100%)', minHeight: '36px' }} />
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08) 0%, rgba(184,134,11,0.08) 100%)', border: '1px solid rgba(27,54,93,0.12)' }}>
            <BarChart3 size={16} style={{ color: '#1B365D' }} className="sm:w-[18px] sm:h-[18px]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-black text-slate-800 leading-tight tracking-tight">Reportes</h1>
            <p className="text-[10px] sm:text-xs font-medium text-slate-400 mt-0.5 truncate">
              Reportes Administrativos
            </p>
          </div>
        </div>
        <button onClick={() => window.location.reload()}
          className="p-1.5 sm:p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg sm:rounded-xl transition-colors shrink-0">
          <RefreshCw size={14} className="sm:w-4 sm:h-4" />
        </button>
      </div>

      {/* ── Tabs scrollable ────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-hide">
        {TABS.filter(t => !t.roles || t.roles.includes(perfil?.rol)).map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all border shrink-0 ${isActive
                  ? 'bg-primary text-white border-primary shadow-md'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}>
              <Icon size={12} className="sm:w-3.5 sm:h-3.5" />
              <span className="sm:hidden">{tab.short}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
       {activeTab === 'comisiones' && <TabComisiones configNeg={configNeg} />}
       {activeTab === 'credito' && <TabCredito />}
       {activeTab === 'ventas' && <TabVentas configNeg={configNeg} />}
       {activeTab === 'transportistas' && <TabTransportistas />}
       {activeTab === 'externos' && <TabArticulosExternos configNeg={configNeg} />}
    </div>
  )
}
