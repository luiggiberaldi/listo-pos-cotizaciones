// src/components/reportes/TabTransportistas.jsx
// Pestaña del reporte de transportistas locales: cuánto flete se cobró y cómo se
// reparte entre el chofer (su comisión fuera de Carabobo) y la empresa (el resto).
// Sin columnas de pagado/saldo: el pago al chofer no se gestiona aquí.
import { useState, useMemo } from 'react'
import { Truck, RefreshCw, FileText, DollarSign, Building2, User, ListTree } from 'lucide-react'
import { useReporteTransportistas } from '../../hooks/useTransportistas'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { repartoFlete, periodoAnterior, num } from '../../utils/flotaReporte'
import { cargarReporteFlota, cargarDetalleViajesFlota } from '../../hooks/useVehiculos'
import { showToast } from '../ui/Toast'
import BarraPeriodoReporte from './BarraPeriodoReporte'
import { getDayRange } from '../../utils/dateHelpers'
import SeccionFlotaChoferes from './SeccionFlotaChoferes'
import Skeleton from '../ui/Skeleton'

function fmt(n) {
  const v = Number(n) || 0
  return v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Variantes del PDF (menús "Imprimir PDF ▾" / "Descargar PDF ▾")
const OPCIONES_REPORTE = [
  { id: 'resumido', label: 'resumido', icon: FileText, ayuda: 'Totales, fletes por chofer y por camión (1–2 páginas)' },
  { id: 'detallado', label: 'detallado', icon: ListTree, ayuda: 'Además destinos, choferes y viaje por viaje' },
]

export default function TabTransportistas() {
  const [exportando, setExportando] = useState(false)
  // Mismo arranque que las demás pestañas de Reportes: el día de hoy.
  const [rango, setRango] = useState(() => { const hoy = getDayRange(0); return { from: hoy.from, to: hoy.to } })
  const { data: items = [], isLoading, isError, refetch } = useReporteTransportistas({
    desde: rango.from || null,
    hasta: rango.to   || null,
  })
  const { data: configNegocio } = useConfigNegocio()

  // Choferes dados de baja sin despachos en el período no aportan nada al reporte.
  const filas = useMemo(() => (Array.isArray(items) ? items : [])
    .filter(t => t.activo !== false || Number(t.despachos) > 0), [items])

  const totales = useMemo(() => filas.reduce((acc, t) => {
    const r = repartoFlete(t)
    return { total: acc.total + r.total, chofer: acc.chofer + r.chofer, empresa: acc.empresa + r.empresa }
  }, { total: 0, chofer: 0, empresa: 0 }), [filas])

  // Botón "Reporte": un solo PDF, resumido o detallado, para descargar o imprimir.
  async function generarReporte(modo, accion) {
    const action = accion === 'imprimir' ? 'print' : 'download'
    setExportando(true)
    try {
      const desde = rango.from || null
      const hasta = rango.to || null
      const anterior = periodoAnterior(desde, hasta)
      const detallado = modo === 'detallado'
      const [flota, flotaAnterior] = await Promise.all([
        cargarReporteFlota({ desde, hasta }),
        anterior ? cargarReporteFlota(anterior) : Promise.resolve(null),
      ])
      const [detalle, detalleSinCamion] = detallado
        ? await Promise.all([
          cargarDetalleViajesFlota({ desde, hasta }),
          num(flota.sinCamion?.viajes) > 0 ? cargarDetalleViajesFlota({ desde, hasta, sinCamion: true }) : Promise.resolve([]),
        ])
        : [[], []]
      const { generarFlotaChoferesPDF } = await import('../../services/pdf/flotaChoferesPDF')
      await generarFlotaChoferesPDF({
        modo, action, desde, hasta,
        tablaChoferes: filas,
        porVehiculo: flota.porVehiculo,
        porChofer: flota.porChofer.filter(c => c.activo !== false || num(c.total_viajes) > 0),
        sinCamion: flota.sinCamion,
        anterior: flotaAnterior ? flotaAnterior.porVehiculo : null,
        detalle, detalleSinCamion,
        config: configNegocio ?? {},
      })
    } catch (e) {
      console.error('[TabTransportistas] reporte PDF error:', e)
      showToast.error('No se pudo generar el reporte')
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Barra común de Reportes: período + Imprimir/Descargar PDF */}
      <BarraPeriodoReporte
        titulo="Periodo de despachos"
        rango={rango}
        onCambiarRango={setRango}
        opciones={OPCIONES_REPORTE}
        onExportar={generarReporte}
        exportando={exportando}
        deshabilitado={isLoading}
        acciones={(
          <button onClick={() => refetch()} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 mr-auto" title="Recargar">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        )}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Truck}      label="Choferes locales"  value={filas.length}               color="indigo" />
        <KpiCard icon={DollarSign} label="Total de fletes"   value={`$${fmt(totales.total)}`}   color="slate" />
        <KpiCard icon={User}       label="Para los choferes" value={`$${fmt(totales.chofer)}`}  color="amber" />
        <KpiCard icon={Building2}  label="Para la empresa"   value={`$${fmt(totales.empresa)}`} color="green" />
      </div>


      {/* Tabla */}
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Error al cargar el reporte. <button onClick={() => refetch()} className="underline font-bold">Reintentar</button>
        </div>
      ) : filas.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">No hay transportistas locales en el sistema</div>
      ) : (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Chofer</th>
                <th className="text-right px-3 py-2">Despachos</th>
                <th className="text-right px-3 py-2">Total fletes</th>
                <th className="text-right px-3 py-2">Para el chofer</th>
                <th className="text-right px-3 py-2">Para la empresa</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(t => {
                const r = repartoFlete(t)
                return (
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
                      {Number(t.despachos_nomina) > 0 && (
                        <span className="block text-[10px] text-slate-400">
                          {t.despachos_nomina} en Carabobo (${fmt(t.flete_nomina_usd)}): el chofer cobra por nómina
                        </span>
                      )}
                    </td>
                    <td className="text-right px-3 py-2 text-slate-600">{t.despachos}</td>
                    <td className="text-right px-3 py-2 font-semibold text-slate-800">${fmt(r.total)}</td>
                    <td className="text-right px-3 py-2 text-amber-700">${fmt(r.chofer)}</td>
                    <td className="text-right px-3 py-2 font-black text-emerald-700">${fmt(r.empresa)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-slate-50 text-xs font-bold text-slate-700">
              <tr className="border-t border-slate-200">
                <td className="px-3 py-2">Total</td>
                <td className="text-right px-3 py-2">{filas.reduce((n, t) => n + (Number(t.despachos) || 0), 0)}</td>
                <td className="text-right px-3 py-2">${fmt(totales.total)}</td>
                <td className="text-right px-3 py-2">${fmt(totales.chofer)}</td>
                <td className="text-right px-3 py-2">${fmt(totales.empresa)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Fase 4 del plan de flota: productividad por vehículo y por chofer local */}
      <SeccionFlotaChoferes rango={rango} />
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
