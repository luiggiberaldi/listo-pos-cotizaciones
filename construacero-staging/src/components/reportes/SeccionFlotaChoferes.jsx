// src/components/reportes/SeccionFlotaChoferes.jsx
// Fase 4 del plan de flota: Cuadro 1 (productividad por vehículo) y Cuadro 2
// (productividad y liquidación por chofer local), con marca ≈ para viajes
// estimados (raíl R5) y exportación a PDF / Excel. Usa el mismo rango de fechas
// que la pestaña de Transportistas.
import { useState } from 'react'
import { Truck, User, FileText, FileSpreadsheet, RefreshCw } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { useReporteFlota, puedeVerReporteFlota } from '../../hooks/useVehiculos'
import {
  MARCA_ESTIMADO, num, textoViajes, totalesVehiculos, totalesChoferes,
  construirCsvFlota, descargarCsv,
} from '../../utils/flotaReporte'
import Skeleton from '../ui/Skeleton'

function fmt(n) {
  return num(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Viajes({ fila }) {
  const estimados = num(fila.viajes_estimados)
  if (estimados === 0) return <span>{num(fila.total_viajes)}</span>
  return (
    <span title={`${estimados} viaje(s) con camión estimado a partir de la ficha del chofer`}>
      {num(fila.total_viajes)}{' '}
      <span className="text-amber-600 font-bold">({MARCA_ESTIMADO}{estimados})</span>
    </span>
  )
}

export default function SeccionFlotaChoferes({ rango }) {
  const perfil = useAuthStore(s => s.perfil)
  const { data: configNegocio } = useConfigNegocio()
  const desde = rango?.from || null
  const hasta = rango?.to || null
  const { data, isLoading, isError, refetch } = useReporteFlota({ desde, hasta, rol: perfil?.rol })
  const [exportando, setExportando] = useState(false)

  if (!puedeVerReporteFlota(perfil?.rol)) return null

  const porVehiculo = data?.porVehiculo ?? []
  // Choferes dados de baja sin viajes en el período no aportan nada al cuadro.
  const porChofer = (data?.porChofer ?? []).filter(c => c.activo !== false || num(c.total_viajes) > 0)
  const totV = totalesVehiculos(porVehiculo)
  const totC = totalesChoferes(porChofer)
  const hayEstimados = totV.estimados > 0 || porChofer.some(c => num(c.viajes_estimados) > 0)
  const sufijoArchivo = `${desde || 'inicio'}_${hasta || 'hoy'}`

  async function exportarPDF() {
    setExportando(true)
    try {
      const { generarFlotaChoferesPDF } = await import('../../services/pdf/flotaChoferesPDF')
      await generarFlotaChoferesPDF({ porVehiculo, porChofer, desde, hasta, config: configNegocio ?? {}, action: 'download' })
    } catch (e) {
      console.error('[SeccionFlotaChoferes] exportarPDF error:', e)
    } finally {
      setExportando(false)
    }
  }

  function exportarExcel() {
    descargarCsv(`Flota_Choferes_${sufijoArchivo}.csv`, construirCsvFlota({ porVehiculo, porChofer, desde, hasta }))
  }

  return (
    <div className="space-y-4 pt-4 border-t border-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-black text-slate-700 uppercase tracking-wide">Flota propia y choferes locales</h3>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => refetch()} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Recargar">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportarExcel} disabled={isLoading || (porVehiculo.length === 0 && porChofer.length === 0)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold">
            <FileSpreadsheet size={12} /> Excel
          </button>
          <button onClick={exportarPDF} disabled={exportando || isLoading || (porVehiculo.length === 0 && porChofer.length === 0)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold">
            <FileText size={12} /> {exportando ? 'Generando...' : 'PDF'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Error al cargar el reporte de flota. <button onClick={() => refetch()} className="underline font-bold">Reintentar</button>
        </div>
      ) : (
        <>
          {/* Cuadro 1 — Productividad por vehículo */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
              <Truck size={14} className="text-indigo-600" />
              <span className="text-xs font-bold text-slate-600 uppercase">Cuadro 1 · Productividad por vehículo</span>
            </div>
            {porVehiculo.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">No hay vehículos registrados todavía</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Vehículo</th>
                      <th className="text-right px-3 py-2">Viajes</th>
                      <th className="text-right px-3 py-2">Fletes</th>
                      <th className="text-right px-3 py-2">Mercancía movilizada</th>
                      <th className="text-right px-3 py-2">Flete prom./viaje</th>
                      <th className="text-left px-3 py-2">Choferes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porVehiculo.map(v => (
                      <tr key={v.vehiculo_id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                            {v.codigo} · {v.nombre}
                            {v.activo === false && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold uppercase">Inactivo</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500">{v.placa}{num(v.capacidad_kg) > 0 ? ` · ${num(v.capacidad_kg)} kg` : ''}</div>
                        </td>
                        <td className="text-right px-3 py-2 text-slate-600"><Viajes fila={v} /></td>
                        <td className="text-right px-3 py-2 font-semibold text-slate-800">${fmt(v.total_flete_usd)}</td>
                        <td className="text-right px-3 py-2 text-slate-600">${fmt(v.total_mercancia_usd)}</td>
                        <td className="text-right px-3 py-2 text-slate-600">${fmt(v.promedio_flete_viaje_usd)}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {(v.desglose_choferes || []).length === 0 ? '—' : v.desglose_choferes.map(d => (
                            <div key={d.transportista_id || d.chofer_nombre}>{d.chofer_nombre}: {num(d.viajes)} viaje{num(d.viajes) === 1 ? '' : 's'}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 text-xs font-bold text-slate-700">
                    <tr className="border-t border-slate-200">
                      <td className="px-3 py-2">Total</td>
                      <td className="text-right px-3 py-2">{textoViajes({ total_viajes: totV.viajes, viajes_estimados: totV.estimados })}</td>
                      <td className="text-right px-3 py-2">${fmt(totV.flete)}</td>
                      <td className="text-right px-3 py-2">${fmt(totV.mercancia)}</td>
                      <td className="text-right px-3 py-2">${fmt(totV.viajes > 0 ? totV.flete / totV.viajes : 0)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Cuadro 2 — Productividad y liquidación por chofer local */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
              <User size={14} className="text-indigo-600" />
              <span className="text-xs font-bold text-slate-600 uppercase">Cuadro 2 · Productividad y liquidación por chofer local</span>
            </div>
            {porChofer.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">No hay choferes locales registrados</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Chofer</th>
                      <th className="text-right px-3 py-2">Viajes</th>
                      <th className="text-right px-3 py-2">Carabobo / Fuera</th>
                      <th className="text-right px-3 py-2">Fletes</th>
                      <th className="text-right px-3 py-2">Mercancía</th>
                      <th className="text-right px-3 py-2">Comisión generada</th>
                      <th className="text-right px-3 py-2">Pagada</th>
                      <th className="text-right px-3 py-2">Pendiente</th>
                      <th className="text-left px-3 py-2">Vehículos usados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porChofer.map(c => (
                      <tr key={c.transportista_id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                            {c.chofer_nombre}
                            {c.activo === false && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold uppercase">Inactivo</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {c.vehiculo_habitual_nombre ? `Fijo: ${c.vehiculo_habitual_nombre} (${c.vehiculo_habitual_placa || 'S/P'})` : 'Rotativo'}
                          </div>
                        </td>
                        <td className="text-right px-3 py-2 text-slate-600"><Viajes fila={c} /></td>
                        <td className="text-right px-3 py-2 text-slate-600">{num(c.viajes_en_carabobo)} / {num(c.viajes_fuera_carabobo)}</td>
                        <td className="text-right px-3 py-2 font-semibold text-slate-800">${fmt(c.total_flete_usd)}</td>
                        <td className="text-right px-3 py-2 text-slate-600">${fmt(c.total_mercancia_usd)}</td>
                        <td className="text-right px-3 py-2 text-slate-700">${fmt(c.comision_generada_usd)}</td>
                        <td className="text-right px-3 py-2 text-green-600">${fmt(c.comision_pagada_usd)}</td>
                        <td className="text-right px-3 py-2 font-black text-amber-600">${fmt(c.comision_pendiente_usd)}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {(c.desglose_vehiculos || []).length === 0 ? '—' : c.desglose_vehiculos.map(d => (
                            <div key={d.vehiculo_id || 'sin-vehiculo'}>
                              {d.vehiculo_nombre}: {num(d.viajes)} viaje{num(d.viajes) === 1 ? '' : 's'} (${fmt(d.flete_usd)})
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 text-xs font-bold text-slate-700">
                    <tr className="border-t border-slate-200">
                      <td className="px-3 py-2">Total</td>
                      <td className="text-right px-3 py-2">{totC.viajes}</td>
                      <td className="text-right px-3 py-2">{totC.enCarabobo} / {totC.fueraCarabobo}</td>
                      <td className="text-right px-3 py-2">${fmt(totC.flete)}</td>
                      <td className="text-right px-3 py-2">${fmt(totC.mercancia)}</td>
                      <td className="text-right px-3 py-2">${fmt(totC.comisionGenerada)}</td>
                      <td className="text-right px-3 py-2">${fmt(totC.comisionPagada)}</td>
                      <td className="text-right px-3 py-2">${fmt(totC.comisionPendiente)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {hayEstimados && (
            <p className="text-[11px] text-amber-700">
              <span className="font-bold">{MARCA_ESTIMADO}</span> = viajes viejos cuyo camión se estimó con la ficha del chofer
              (no es un dato registrado en el viaje). Mercancía movilizada = total − flete − corte.
            </p>
          )}
        </>
      )}
    </div>
  )
}
