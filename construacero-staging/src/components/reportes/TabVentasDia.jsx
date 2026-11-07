// src/components/reportes/TabVentasDia.jsx
// Pestaña "Ventas del día" (solo Logística): la hoja "Ventas generales diarias" que se le deja a
// Administración los sábados, llenada por el sistema. Logística revisa, cuenta el efectivo y la
// imprime / descarga / manda por WhatsApp.
import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, Download, Loader2, MessageCircle, Printer } from 'lucide-react'
import { authFetch } from '../../services/authFetch'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { getDayRange } from '../../utils/dateHelpers'
import { compartirPorWhatsApp } from '../../utils/whatsapp'
import { COLUMNAS_PAGO, montoFila, subtotalMostrado } from '../../utils/ventasDia'
import Skeleton from '../ui/Skeleton'
import { showToast } from '../ui/Toast'

const fmt = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const pad = v => String(v ?? '').padStart(5, '0')
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const fmtFechaLarga = ymd => {
  const [y, m, d] = ymd.split('-')
  return `${DIAS[new Date(`${ymd}T12:00:00Z`).getUTCDay()]} ${d}/${m}/${y}`
}

function Linea({ label, valor, fuerte = false }) {
  return (
    <div className={`flex justify-between gap-4 py-1 ${fuerte ? 'border-t border-slate-300 pt-2 text-base font-black text-slate-900' : 'text-sm text-slate-700'}`}>
      <span>{label}</span><span className="tabular-nums">{valor}</span>
    </div>
  )
}

export default function TabVentasDia() {
  const { data: config = {} } = useConfigNegocio()
  // Misma tasa que usa el resto del sistema (USDT o manual, según Configuración), no la BCV.
  const { tasaEfectiva } = useTasaCambio()
  const [fecha, setFecha] = useState(() => getDayRange(0).from)
  const [tasaEditada, setTasaEditada] = useState('')
  const [generando, setGenerando] = useState(null)

  const tasaSistema = Number(tasaEfectiva) || 0
  const tasa = tasaEditada !== '' ? Number(tasaEditada) || 0 : tasaSistema

  const { data, isLoading, isError, error, isPlaceholderData } = useQuery({
    queryKey: ['ventas-dia', fecha],
    enabled: Boolean(fecha),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await authFetch(`/api/reportes/ventas-dia?fecha=${fecha}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'No se pudo cargar el reporte')
      return body
    },
  })

  const columnas = useMemo(() => COLUMNAS_PAGO.filter(c => data?.columnasUsadas?.includes(c.id)), [data])
  const sinDatos = !data?.filas?.length

  async function exportar(accion) {
    if (!data) return
    if (!(tasa > 0) && columnas.some(c => c.bs && data.columnasUsadas.includes(c.id))) { showToast('Escribe la tasa del día antes de generar la hoja', 'warning'); return }
    setGenerando(accion)
    try {
      const { generarVentasDiaPDF } = await import('../../services/pdf/ventasDiaPDF')
      const { blob, filename } = generarVentasDiaPDF({ reporte: data, tasa, config })
      if (accion === 'whatsapp') {
        const mensaje = `Ventas del ${fmtFechaLarga(data.fecha)}: ${data.resumen.notas} notas, total vendido $${fmt(data.resumen.totalVendidoUsd)} (cobrado $${fmt(data.resumen.cobradoUsd)}, por cobrar $${fmt(data.resumen.porCobrarUsd)}).`
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
      console.error('[VENTAS_DIA] PDF:', e)
      showToast('No se pudo generar el PDF', 'error')
    } finally {
      setGenerando(null)
    }
  }

  const boton = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50'
  const deshabilitado = !data || sinDatos || isPlaceholderData || generando !== null

  return (
    <div className="space-y-4" data-testid="ventas-dia">
      {/* Controles */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
          <span className="flex items-center gap-1"><CalendarDays size={12} /> Día</span>
          <input type="date" value={fecha} onChange={e => e.target.value && setFecha(e.target.value)} data-testid="ventas-dia-fecha"
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-semibold text-slate-800" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
          <span>Tasa del día (Bs por $)</span>
          <input type="number" min="0" step="0.01" inputMode="decimal" value={tasaEditada} onChange={e => setTasaEditada(e.target.value)}
            placeholder={tasaSistema ? fmt(tasaSistema) : 'Escribe la tasa'} data-testid="ventas-dia-tasa"
            className="w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-semibold text-slate-800" />
        </label>
        <p className="pb-2 text-[11px] text-slate-500">
          {tasaEditada !== '' ? 'Usando la tasa que escribiste.' : tasaSistema ? 'Usando la tasa del sistema. Puedes cambiarla.' : 'No hay tasa: escríbela.'}
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => exportar('imprimir')} disabled={deshabilitado} className={`${boton} border border-slate-200 bg-white text-slate-700`}>
            {generando === 'imprimir' ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Imprimir
          </button>
          <button type="button" onClick={() => exportar('pdf')} disabled={deshabilitado} className={`${boton} border border-slate-200 bg-white text-slate-700`}>
            {generando === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Descargar PDF
          </button>
          <button type="button" onClick={() => exportar('whatsapp')} disabled={deshabilitado} className={`${boton} bg-emerald-600 text-white`}>
            {generando === 'whatsapp' ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />} Enviar por WhatsApp
          </button>
        </div>
      </div>

      {isLoading && <Skeleton className="h-48 w-full rounded-xl" />}
      {isError && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error?.message || 'No se pudo cargar el reporte'}</p>}

      {data && (
        <div className={`space-y-4 transition-opacity ${isPlaceholderData ? 'pointer-events-none opacity-50' : ''}`}>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-black uppercase tracking-wide text-slate-800">Ventas generales del día</h2>
              <span className="text-xs font-semibold text-slate-500">{fmtFechaLarga(data.fecha)} · Tasa {tasa > 0 ? fmt(tasa) : '—'} Bs/$</span>
            </div>

            {sinDatos ? (
              <p className="py-6 text-center text-sm text-slate-500">No hay notas creadas este día.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs" data-testid="ventas-dia-tabla">
                  <thead>
                    <tr className="border-b border-slate-300 text-left text-[10px] uppercase text-slate-500">
                      <th className="py-1.5 pr-2">#</th>
                      <th className="py-1.5 pr-2">Cliente</th>
                      <th className="py-1.5 pr-2">Nota N°</th>
                      {columnas.map(c => <th key={c.id} className="py-1.5 pr-2 text-right">{c.label}</th>)}
                      <th className="py-1.5 pr-2 text-right">Total $</th>
                      <th className="py-1.5">Ref. / avisos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.filas.map(f => (
                      <tr key={f.id} className={`border-b border-slate-100 ${f.avisos.length ? 'bg-amber-50' : ''}`}>
                        <td className="py-1.5 pr-2 text-slate-400">{f.item}</td>
                        <td className="py-1.5 pr-2 font-semibold text-slate-800">{f.cliente}</td>
                        <td className="py-1.5 pr-2 tabular-nums">{pad(f.numero)}</td>
                        {columnas.map(c => (
                          <td key={c.id} className="py-1.5 pr-2 text-right tabular-nums">{f.montos[c.id] ? fmt(montoFila(f, c.id, tasa)) : <span className="text-slate-300">0,00</span>}</td>
                        ))}
                        <td className="py-1.5 pr-2 text-right font-bold tabular-nums">{fmt(f.totalUsd)}</td>
                        <td className="py-1.5 text-[11px]">
                          {f.referencias.length > 0 && <div className="text-slate-600">Ref. {f.referencias.join(', ')}</div>}
                          {f.otrosDetalle.length > 0 && <div className="text-slate-500">{f.otrosDetalle.join(', ')}</div>}
                          {f.avisos.map(a => <div key={a} className="flex items-center gap-1 font-semibold text-amber-700"><AlertTriangle size={11} /> {a}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 font-black text-slate-800">
                      <td colSpan={3} className="py-1.5 pr-2">SUBTOTALES</td>
                      {columnas.map(c => <td key={c.id} className="py-1.5 pr-2 text-right tabular-nums">{fmt(subtotalMostrado(data, c.id, tasa))}</td>)}
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(data.resumen.totalVendidoUsd)}</td>
                      <td />
                    </tr>
                    {columnas.some(c => c.bs) && (
                      <tr className="text-[11px] font-semibold text-slate-500">
                        <td colSpan={3} className="py-1 pr-2">En dólares</td>
                        {columnas.map(c => <td key={c.id} className="py-1 pr-2 text-right tabular-nums">{fmt(data.totales[c.id])}</td>)}
                        <td colSpan={2} />
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div>
            <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="ventas-dia-resumen">
              <h3 className="mb-1 text-xs font-black uppercase text-slate-500">Resumen</h3>
              <Linea label="Dinero que entró (cobrado)" valor={`$${fmt(data.resumen.cobradoUsd)}`} />
              <Linea label="Quedó por cobrar (crédito o al entregar)" valor={`$${fmt(data.resumen.porCobrarUsd)}`} />
              {data.resumen.otrosUsd !== 0 && <Linea label="Otros (cruce, donación…)" valor={`$${fmt(data.resumen.otrosUsd)}`} />}
              <Linea label="TOTAL VENDIDO" valor={`$${fmt(data.resumen.totalVendidoUsd)}`} fuerte />
            </div>
          </div>

          {data.faltantes.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid="ventas-dia-faltantes">
              <h3 className="mb-1 flex items-center gap-1 text-xs font-black uppercase text-amber-800"><AlertTriangle size={13} /> Notas que no aparecen en esta hoja</h3>
              <ul className="grid gap-x-4 text-sm text-amber-900 sm:grid-cols-2">
                {data.faltantes.map(f => <li key={f.numero}><span className="font-bold tabular-nums">{pad(f.numero)}</span> — {f.motivo}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
