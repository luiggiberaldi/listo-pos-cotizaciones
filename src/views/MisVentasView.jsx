// src/views/MisVentasView.jsx
// "Mis ventas": el vendedor ve a detalle lo que vendió en un rango de fechas (despachos aprobados con
// artículos, cliente y montos), y lo descarga en PDF, lo imprime o lo comparte por WhatsApp.
// Los datos los filtra el servidor por el operador de la sesión (/api/reportes/mis-ventas).
import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BarChart3, ChevronDown, ChevronRight, Download, Loader2, MessageCircle, Printer, Search } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { authFetch } from '../services/authFetch'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { getCorteSemanalRange } from '../utils/dateHelpers'
import { fmtUsd } from '../utils/format'
import { compartirPorWhatsApp } from '../utils/whatsapp'
import PageHeader from '../components/ui/PageHeader'
import DateRangeSelector from '../components/reportes/DateRangeSelector'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'
import { showToast } from '../components/ui/Toast'

const ESTADOS = { despachada: 'Despachada', entregada: 'Entregada' }
const pad = v => String(v ?? '').padStart(5, '0')
const fmtNum = v => Number(v || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 })
const fmtFecha = iso => new Date(iso).toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDia = ymd => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}` }
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const fmtDiaSemana = ymd => `${DIAS[new Date(`${ymd}T12:00:00Z`).getUTCDay()]} ${fmtDia(ymd)}`

function Kpi({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-800">{value}</p>
    </div>
  )
}

function Despacho({ d, conComision }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button type="button" onClick={() => setAbierto(v => !v)} className="flex w-full items-start gap-2 px-3 py-3 text-left hover:bg-slate-50">
        {abierto ? <ChevronDown size={16} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={16} className="mt-0.5 shrink-0 text-slate-400" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800">
            DES-{pad(d.numero)}{d.cotizacion ? <span className="font-semibold text-slate-500"> · COT-{pad(d.cotizacion)}</span> : null}
          </p>
          <p className="truncate text-xs text-slate-600">{d.cliente}{d.clienteRif ? ` (${d.clienteRif})` : ''}</p>
          <p className="text-[11px] text-slate-400">
            {fmtFecha(d.fecha)} · {ESTADOS[d.estado] || d.estado} · {d.formasPago.length ? d.formasPago.join(', ') : 'Sin especificar'}
            {d.tieneDevoluciones ? ' · Con devoluciones' : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-black text-slate-800">{fmtUsd(d.totalUsd)}</p>
          {conComision && d.comisionUsd ? <p className="text-[11px] font-semibold text-emerald-600">Comisión {fmtUsd(d.comisionUsd)}</p> : null}
        </div>
      </button>
      {abierto && (
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-400">
                <th className="py-1 pr-2 font-semibold">Código</th>
                <th className="py-1 pr-2 font-semibold">Artículo</th>
                <th className="py-1 pr-2 text-right font-semibold">Cant.</th>
                <th className="py-1 pr-2 font-semibold">Und.</th>
                <th className="py-1 pr-2 text-right font-semibold">Precio</th>
                <th className="py-1 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.articulos.map((a, i) => (
                <tr key={i} className="border-t border-slate-100 text-slate-700">
                  <td className="py-1 pr-2 text-slate-500">{a.codigo}</td>
                  <td className="py-1 pr-2">{a.nombre}</td>
                  <td className="py-1 pr-2 text-right">{fmtNum(a.cantidad)}</td>
                  <td className="py-1 pr-2">{a.unidad}</td>
                  <td className="py-1 pr-2 text-right">{fmtUsd(a.precioUnitUsd)}</td>
                  <td className="py-1 text-right font-semibold">{fmtUsd(a.totalUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-right text-[11px] text-slate-500">
            Artículos {fmtUsd(d.subtotalArticulosUsd)}
            {d.descuentoUsd ? ` · Descuento -${fmtUsd(d.descuentoUsd)}` : ''}
            {d.fleteUsd ? ` · Flete ${fmtUsd(d.fleteUsd)}` : ''}
            {' · '}<span className="font-bold text-slate-700">Total {fmtUsd(d.totalUsd)}</span>
          </p>
        </div>
      )}
    </div>
  )
}

export default function MisVentasView() {
  const perfil = useAuthStore(s => s.perfil)
  const { data: config = {} } = useConfigNegocio()
  const [rango, setRango] = useState(() => getCorteSemanalRange(0))
  const [busqueda, setBusqueda] = useState('')
  const [generando, setGenerando] = useState(null)

  const { data, isLoading, isError, error, isPlaceholderData } = useQuery({
    queryKey: ['mis-ventas', perfil?.id, rango.from, rango.to],
    enabled: Boolean(perfil?.id && rango?.from && rango?.to),
    staleTime: 60_000,
    // Al cambiar de período se sigue viendo lo anterior (atenuado) mientras llega lo nuevo, en vez de quedar en blanco.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await authFetch(`/api/reportes/mis-ventas?desde=${rango.from}&hasta=${rango.to}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'No se pudo cargar el reporte')
      return body
    },
  })

  const conComision = data?.resumen?.comisionUsd !== null && data?.resumen?.comisionUsd !== undefined
  const despachosVisibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!data || !q) return data?.despachos ?? []
    return data.despachos.filter(d => `${d.cliente} ${d.clienteRif}`.toLowerCase().includes(q))
  }, [data, busqueda])

  async function exportar(accion) {
    if (!data) return
    setGenerando(accion)
    try {
      const { generarMisVentasPDF } = await import('../services/pdf/misVentasPDF')
      const { blob, filename } = generarMisVentasPDF({ reporte: data, config })
      if (accion === 'whatsapp') {
        const mensaje = `Reporte de ventas de ${data.vendedor.nombre} del ${fmtDia(data.periodo.desde)} al ${fmtDia(data.periodo.hasta)}: ${data.resumen.despachos} despachos por ${fmtUsd(data.resumen.totalUsd)}.`
        const res = await compartirPorWhatsApp({ pdfBlob: blob, pdfFilename: filename, telefono: null, mensaje })
        if (res?.method === 'wa_link_desktop') showToast('PDF descargado: adjúntalo en el chat de WhatsApp', 'info', 5000)
      } else if (accion === 'imprimir') {
        const url = URL.createObjectURL(blob)
        const iframe = document.createElement('iframe')
        iframe.style.cssText = 'position:fixed;width:0;height:0;border:none'
        iframe.src = url
        document.body.appendChild(iframe)
        iframe.onload = () => {
          try { iframe.contentWindow.print() } catch { window.open(url) }
          setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url) }, 60000)
        }
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      }
    } catch (e) {
      console.error('[MIS_VENTAS] PDF:', e)
      showToast('No se pudo generar el PDF', 'error')
    } finally {
      setGenerando(null)
    }
  }

  const sinDatos = !data?.despachos?.length
  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-5 lg:p-6">
      <PageHeader icon={BarChart3} title="Mis ventas" subtitle="Todo lo que vendiste, a detalle, en el período que elijas"
        action={
          <div className="flex gap-2">
            <button type="button" onClick={() => exportar('pdf')} disabled={!data || sinDatos || isPlaceholderData || generando !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">
              {generando === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Descargar PDF
            </button>
            <button type="button" onClick={() => exportar('imprimir')} disabled={!data || sinDatos || isPlaceholderData || generando !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">
              {generando === 'imprimir' ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Imprimir
            </button>
            <button type="button" onClick={() => exportar('whatsapp')} disabled={!data || sinDatos || isPlaceholderData || generando !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {generando === 'whatsapp' ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />} Enviar por WhatsApp
            </button>
          </div>
        } />

      <DateRangeSelector value={rango} onChange={setRango} />
      {rango?.from && rango?.to && (
        <p className="-mt-1 px-1 text-xs font-semibold text-slate-500" data-testid="mis-ventas-periodo">
          Período mostrado: <span className="text-slate-800">{rango.from === rango.to ? fmtDiaSemana(rango.from) : `${fmtDiaSemana(rango.from)} al ${fmtDiaSemana(rango.to)}`}</span>
        </p>
      )}

      {isLoading && <Skeleton className="h-40 w-full rounded-xl" />}
      {isPlaceholderData && (
        <p className="flex items-center gap-2 px-1 text-xs font-semibold text-slate-500" role="status"><Loader2 size={13} className="animate-spin" /> Actualizando…</p>
      )}
      {isError && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error?.message || 'No se pudo cargar el reporte'}</p>}

      {data && (
        <div className={`space-y-4 transition-opacity ${isPlaceholderData ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className={`grid grid-cols-2 gap-3 ${conComision ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
            <Kpi label="Total vendido" value={fmtUsd(data.resumen.totalUsd)} />
            <Kpi label="Despachos" value={data.resumen.despachos} />
            <Kpi label="Clientes" value={data.resumen.clientes} />
            <Kpi label="Unidades" value={fmtNum(data.resumen.unidades)} />
            {conComision && <Kpi label="Comisión" value={fmtUsd(data.resumen.comisionUsd)} />}
          </div>

          {sinDatos ? (
            <EmptyState icon={BarChart3} title="Sin ventas en este período" description={`No tienes despachos aprobados o entregados del ${fmtDia(data.periodo.desde)} al ${fmtDia(data.periodo.hasta)}.`} />
          ) : (
            <>
              <section className="rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-sm font-black text-slate-800">Detalle de ventas ({despachosVisibles.length})</h3>
                  <label className="relative block sm:w-64">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar cliente"
                      className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-xs" />
                  </label>
                </div>
                {despachosVisibles.map(d => <Despacho key={d.id} d={d} conComision={conComision} />)}
                {!despachosVisibles.length && <p className="p-4 text-sm text-slate-500">Ningún despacho coincide con la búsqueda.</p>}
              </section>

              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
                <h3 className="mb-2 text-sm font-black text-slate-800">Resumen por artículo</h3>
                <table className="w-full min-w-[480px] text-xs">
                  <thead><tr className="text-left text-[11px] text-slate-400">
                    <th className="py-1 pr-2 font-semibold">Código</th><th className="py-1 pr-2 font-semibold">Artículo</th>
                    <th className="py-1 pr-2 text-right font-semibold">Cantidad</th><th className="py-1 pr-2 font-semibold">Und.</th>
                    <th className="py-1 pr-2 text-right font-semibold">Despachos</th><th className="py-1 text-right font-semibold">Total</th>
                  </tr></thead>
                  <tbody>{data.porArticulo.map((a, i) => (
                    <tr key={i} className="border-t border-slate-100 text-slate-700">
                      <td className="py-1 pr-2 text-slate-500">{a.codigo}</td><td className="py-1 pr-2">{a.nombre}</td>
                      <td className="py-1 pr-2 text-right">{fmtNum(a.cantidad)}</td><td className="py-1 pr-2">{a.unidad}</td>
                      <td className="py-1 pr-2 text-right">{a.despachos}</td><td className="py-1 text-right font-semibold">{fmtUsd(a.totalUsd)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </section>

              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
                <h3 className="mb-2 text-sm font-black text-slate-800">Resumen por cliente</h3>
                <table className="w-full min-w-[400px] text-xs">
                  <thead><tr className="text-left text-[11px] text-slate-400">
                    <th className="py-1 pr-2 font-semibold">Cliente</th><th className="py-1 pr-2 font-semibold">RIF / Cédula</th>
                    <th className="py-1 pr-2 text-right font-semibold">Despachos</th><th className="py-1 text-right font-semibold">Total</th>
                  </tr></thead>
                  <tbody>{data.porCliente.map((c, i) => (
                    <tr key={i} className="border-t border-slate-100 text-slate-700">
                      <td className="py-1 pr-2">{c.nombre}</td><td className="py-1 pr-2 text-slate-500">{c.rif}</td>
                      <td className="py-1 pr-2 text-right">{c.despachos}</td><td className="py-1 text-right font-semibold">{fmtUsd(c.totalUsd)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  )
}
