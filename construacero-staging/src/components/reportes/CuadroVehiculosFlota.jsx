// src/components/reportes/CuadroVehiculosFlota.jsx
// Cuadro 1 del reporte de flota, detallado por camión (migración 286):
//  - resumen del período con comparación contra el período anterior (▲▼);
//  - por camión: viajes y % del total, días trabajados, fletes y su reparto
//    (empresa / choferes), destinos, último viaje y chofer;
//  - al abrir un camión, el detalle viaje por viaje;
//  - aviso de viajes de choferes locales sin camión registrado.
import { Fragment, useState } from 'react'
import { Truck, ChevronDown, ChevronRight, AlertTriangle, Building2, Route } from 'lucide-react'
import { useDetalleViajesFlota } from '../../hooks/useVehiculos'
import {
  num, totalesVehiculos, variacion, porcentaje, diasDelPeriodo, textoDestinos, MARCA_ESTIMADO,
} from '../../utils/flotaReporte'
import { nombreVehiculo } from '../../utils/vehiculoImpreso'
import TarjetaMovil from './TarjetaMovil'

function fmt(n) {
  return num(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fechaCorta(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', timeZone: 'America/Caracas' })
}

function Variacion({ actual, anterior, hayAnterior }) {
  if (!hayAnterior) return null
  const v = variacion(actual, anterior)
  const color = v.signo === 'sube' || v.signo === 'nuevo' ? 'text-emerald-600' : v.signo === 'baja' ? 'text-red-600' : 'text-slate-400'
  return <span className={`text-[10px] font-bold ${color}`} title="Comparado con el período anterior de la misma duración">{v.texto}</span>
}

function Resumen({ titulo, valor, actual, anterior, hayAnterior, icon: Icon }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
        <Icon size={13} className="text-slate-400" /> {titulo}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-base font-black text-slate-800">{valor}</span>
        <Variacion actual={actual} anterior={anterior} hayAnterior={hayAnterior} />
      </div>
    </div>
  )
}

function TablaViajes({ viajes = [], isLoading, mostrarCamion = false }) {
  if (isLoading) return <p className="text-xs text-slate-400 py-2">Cargando viajes...</p>
  if (viajes.length === 0) return <p className="text-xs text-slate-400 py-2">Sin viajes en el período.</p>
  return (
    <>
    <div className="sm:hidden space-y-2">
      {viajes.map(v => (
        <TarjetaMovil
          key={v.despacho_id}
          titulo={`DES-${String(v.numero).padStart(5, '0')}${v.vehiculo_origen === 'backfill' ? ` ${MARCA_ESTIMADO}` : ''}`}
          subtitulo={`${fechaCorta(v.fecha)} · ${v.cliente_nombre || '—'}`}
          monto={`$${fmt(v.empresa_usd)}`}
          montoEtiqueta="Empresa"
          montoClase="text-emerald-700"
          detalles={[
            { label: 'Destino', valor: [v.ciudad, v.estado_destino].filter(Boolean).join(', ') || '—' },
            { label: 'Chofer', valor: v.chofer_nombre || '—' },
            mostrarCamion ? { label: 'Camión', valor: v.vehiculo_codigo || 'Sin camión' } : null,
            { label: 'Flete', valor: `$${fmt(v.flete_usd)}` },
            { label: 'Para el chofer', valor: `$${fmt(v.chofer_usd)}`, clase: 'text-amber-700' },
          ]}
        />
      ))}
    </div>
    <div className="hidden sm:block overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-slate-400 uppercase text-[10px]">
          <tr>
            <th className="text-left px-2 py-1">Fecha</th>
            <th className="text-left px-2 py-1">Despacho</th>
            <th className="text-left px-2 py-1">Cliente</th>
            <th className="text-left px-2 py-1">Destino</th>
            <th className="text-left px-2 py-1">Chofer</th>
            {mostrarCamion && <th className="text-left px-2 py-1">Camión</th>}
            <th className="text-right px-2 py-1">Flete</th>
            <th className="text-right px-2 py-1">Chofer</th>
            <th className="text-right px-2 py-1">Empresa</th>
            <th className="text-right px-2 py-1">Mercancía</th>
          </tr>
        </thead>
        <tbody>
          {viajes.map(v => (
            <tr key={v.despacho_id} className="border-t border-slate-100">
              <td className="px-2 py-1 text-slate-500 whitespace-nowrap">{fechaCorta(v.fecha)}</td>
              <td className="px-2 py-1 font-mono text-slate-600 whitespace-nowrap">
                DES-{String(v.numero).padStart(5, '0')}
                {v.vehiculo_origen === 'backfill' && <span className="ml-1 text-amber-600 font-bold" title="Camión estimado por la ficha del chofer">{MARCA_ESTIMADO}</span>}
              </td>
              <td className="px-2 py-1 text-slate-700 truncate max-w-[10rem]" title={v.cliente_nombre || ''}>{v.cliente_nombre || '—'}</td>
              <td className="px-2 py-1 text-slate-500 truncate max-w-[10rem]">{[v.ciudad, v.estado_destino].filter(Boolean).join(', ') || '—'}</td>
              <td className="px-2 py-1 text-slate-600 truncate max-w-[8rem]">{v.chofer_nombre || '—'}</td>
              {mostrarCamion && <td className="px-2 py-1 text-slate-500">{v.vehiculo_codigo || 'Sin camión'}</td>}
              <td className="px-2 py-1 text-right text-slate-700">${fmt(v.flete_usd)}</td>
              <td className="px-2 py-1 text-right text-amber-700">${fmt(v.chofer_usd)}</td>
              <td className="px-2 py-1 text-right font-semibold text-emerald-700">${fmt(v.empresa_usd)}</td>
              <td className="px-2 py-1 text-right text-slate-500">${fmt(v.mercancia_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}

function DetalleCamion({ vehiculo, desde, hasta, rol }) {
  const { data: viajes = [], isLoading } = useDetalleViajesFlota({ desde, hasta, vehiculoId: vehiculo.vehiculo_id, rol })
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
      <div className="space-y-1.5 text-slate-600">
        <p><span className="text-slate-400">Placas:</span> {vehiculo.placa}{vehiculo.placa_batea ? ` · batea ${vehiculo.placa_batea}` : ''}</p>
        {vehiculo.modelo && <p><span className="text-slate-400">Modelo:</span> {vehiculo.modelo}</p>}
        <p><span className="text-slate-400">Mercancía movilizada:</span> ${fmt(vehiculo.total_mercancia_usd)}</p>
        <p><span className="text-slate-400">Flete promedio por viaje:</span> ${fmt(vehiculo.promedio_flete_viaje_usd)}</p>
        <p><span className="text-slate-400">Carabobo / fuera:</span> {num(vehiculo.viajes_en_carabobo)} / {num(vehiculo.viajes_fuera_carabobo)}</p>
        <p><span className="text-slate-400">Destinos más frecuentes:</span> {textoDestinos(vehiculo.destinos_top) || '—'}</p>
        <p>
          <span className="text-slate-400">Choferes:</span>{' '}
          {(vehiculo.desglose_choferes || []).map(d => `${d.chofer_nombre}: ${num(d.viajes)}`).join(' / ') || '—'}
        </p>
      </div>
      <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-2">
        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Viaje por viaje</p>
        <TablaViajes viajes={viajes} isLoading={isLoading} />
      </div>
    </div>
  )
}

export default function CuadroVehiculosFlota({ porVehiculo = [], anterior = null, sinCamion = null, desde, hasta, rol }) {
  const [abierto, setAbierto] = useState(null)
  const [verSinCamion, setVerSinCamion] = useState(false)
  const { data: viajesSinCamion = [], isLoading: cargandoSinCamion } = useDetalleViajesFlota({
    desde, hasta, sinCamion: true, rol, enabled: verSinCamion,
  })

  const tot = totalesVehiculos(porVehiculo)
  const totEmpresa = porVehiculo.reduce((s, v) => s + num(v.empresa_usd), 0)
  const totChoferes = porVehiculo.reduce((s, v) => s + num(v.comision_choferes_usd), 0)
  const hayAnterior = Array.isArray(anterior)
  const totAnt = hayAnterior ? totalesVehiculos(anterior) : null
  const empresaAnt = hayAnterior ? anterior.reduce((s, v) => s + num(v.empresa_usd), 0) : 0
  const anteriorPorId = Object.fromEntries((anterior || []).map(v => [v.vehiculo_id, v]))
  const diasPeriodo = diasDelPeriodo(desde, hasta)
  const masActivo = porVehiculo.find(v => num(v.total_viajes) > 0)

  return (
    <div className="space-y-3">
      {/* Resumen del período */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Resumen icon={Route} titulo="Viajes de la flota" valor={tot.viajes} actual={tot.viajes} anterior={totAnt?.viajes} hayAnterior={hayAnterior} />
        <Resumen icon={Truck} titulo="Fletes cobrados" valor={`$${fmt(tot.flete)}`} actual={tot.flete} anterior={totAnt?.flete} hayAnterior={hayAnterior} />
        <Resumen icon={Building2} titulo="Para la empresa" valor={`$${fmt(totEmpresa)}`} actual={totEmpresa} anterior={empresaAnt} hayAnterior={hayAnterior} />
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-[11px] text-slate-500 font-medium">Camión más activo</div>
          <div className="text-sm font-black text-slate-800 mt-1 truncate">
            {masActivo ? `${nombreVehiculo(masActivo)} · ${num(masActivo.total_viajes)} viaje${num(masActivo.total_viajes) === 1 ? '' : 's'}` : '—'}
          </div>
        </div>
      </div>
      {!hayAnterior && (
        <p className="text-[11px] text-slate-400">Elige un rango de fechas para comparar con el período anterior (▲▼).</p>
      )}

      {/* Viajes sin camión registrado */}
      {num(sinCamion?.viajes) > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-800">
            <AlertTriangle size={14} />
            <span className="font-semibold">
              {num(sinCamion.viajes)} viaje{num(sinCamion.viajes) === 1 ? '' : 's'} de choferes locales salieron sin camión registrado
              (${fmt(sinCamion.flete_usd)} en fletes): no cuentan en este cuadro.
            </span>
            <button onClick={() => setVerSinCamion(v => !v)} className="ml-auto underline font-bold">
              {verSinCamion ? 'Ocultar' : 'Ver cuáles'}
            </button>
          </div>
          {verSinCamion && <TablaViajes viajes={viajesSinCamion} isLoading={cargandoSinCamion} />}
        </div>
      )}

      {/* Cuadro por camión */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
          <Truck size={14} className="text-indigo-600" />
          <span className="text-xs font-bold text-slate-600 uppercase">Cuadro 1 · Productividad por vehículo</span>
          <span className="ml-auto text-[10px] text-slate-400">Toca un camión para ver sus viajes</span>
        </div>
        {porVehiculo.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">No hay vehículos registrados todavía</div>
        ) : (
          <>
          {/* Celular: un camión por tarjeta; al tocarla se abre su detalle */}
          <div className="sm:hidden space-y-2 p-2">
            {porVehiculo.map(v => {
              const estaAbierto = abierto === v.vehiculo_id
              const ant = anteriorPorId[v.vehiculo_id]
              return (
                <TarjetaMovil
                  key={v.vehiculo_id}
                  onClick={() => setAbierto(estaAbierto ? null : v.vehiculo_id)}
                  abierto={estaAbierto}
                  titulo={nombreVehiculo(v)}
                  insignia={v.activo === false ? <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold uppercase">Inactivo</span> : null}
                  subtitulo={`${v.placa}${v.placa_batea ? ` · batea ${v.placa_batea}` : ''}`}
                  monto={`${num(v.total_viajes)} viaje${num(v.total_viajes) === 1 ? '' : 's'}`}
                  montoEtiqueta={`${porcentaje(v.total_viajes, tot.viajes)}% del total`}
                  detalles={[
                    { label: 'Días trabajados', valor: `${num(v.dias_trabajados)}${diasPeriodo ? ` de ${diasPeriodo}` : ''}` },
                    hayAnterior ? { label: 'Vs. anterior', valor: <Variacion actual={v.total_viajes} anterior={ant?.total_viajes} hayAnterior={hayAnterior} /> } : null,
                    { label: 'Fletes', valor: `$${fmt(v.total_flete_usd)}` },
                    { label: 'Para la empresa', valor: `$${fmt(v.empresa_usd)}`, clase: 'text-emerald-700' },
                    { label: 'Último viaje', valor: v.ultimo_viaje_en ? `${fechaCorta(v.ultimo_viaje_en)} · ${v.ultimo_chofer_nombre || '—'}` : 'Sin viajes', ancho: true },
                  ]}
                >
                  {estaAbierto ? <DetalleCamion vehiculo={v} desde={desde} hasta={hasta} rol={rol} /> : null}
                </TarjetaMovil>
              )
            })}
            <div className="px-2 pt-1 text-xs font-bold text-slate-700 flex justify-between">
              <span>Total · {tot.viajes} viajes</span>
              <span className="text-emerald-700">${fmt(totEmpresa)} empresa</span>
            </div>
          </div>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Vehículo</th>
                  <th className="text-right px-3 py-2">Viajes</th>
                  <th className="text-right px-3 py-2">Días trabajados</th>
                  <th className="text-right px-3 py-2">Fletes</th>
                  <th className="text-right px-3 py-2">Para choferes</th>
                  <th className="text-right px-3 py-2">Para la empresa</th>
                  <th className="text-left px-3 py-2">Último viaje</th>
                </tr>
              </thead>
              <tbody>
                {porVehiculo.map(v => {
                  const estaAbierto = abierto === v.vehiculo_id
                  const ant = anteriorPorId[v.vehiculo_id]
                  return (
                    <Fragment key={v.vehiculo_id}>
                      <tr
                        className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${estaAbierto ? 'bg-slate-50' : ''}`}
                        onClick={() => setAbierto(estaAbierto ? null : v.vehiculo_id)}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                            {estaAbierto ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                            {nombreVehiculo(v)}
                            {v.activo === false && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold uppercase">Inactivo</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 pl-5">
                            {v.placa}{v.placa_batea ? ` · batea ${v.placa_batea}` : ''}{num(v.capacidad_kg) > 0 ? ` · ${num(v.capacidad_kg).toLocaleString('es-VE')} kg` : ''}
                          </div>
                        </td>
                        <td className="text-right px-3 py-2 text-slate-700">
                          <span className="font-bold">{num(v.total_viajes)}</span>
                          {num(v.viajes_estimados) > 0 && <span className="text-amber-600 text-[10px] font-bold"> ({MARCA_ESTIMADO}{num(v.viajes_estimados)})</span>}
                          <div className="text-[10px] text-slate-400">
                            {porcentaje(v.total_viajes, tot.viajes)}% del total{' '}
                            <Variacion actual={v.total_viajes} anterior={ant?.total_viajes} hayAnterior={hayAnterior} />
                          </div>
                        </td>
                        <td className="text-right px-3 py-2 text-slate-600">
                          {num(v.dias_trabajados)}{diasPeriodo ? <span className="text-slate-400"> de {diasPeriodo}</span> : ''}
                        </td>
                        <td className="text-right px-3 py-2 font-semibold text-slate-800">${fmt(v.total_flete_usd)}</td>
                        <td className="text-right px-3 py-2 text-amber-700">${fmt(v.comision_choferes_usd)}</td>
                        <td className="text-right px-3 py-2 font-black text-emerald-700">${fmt(v.empresa_usd)}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {v.ultimo_viaje_en ? `${fechaCorta(v.ultimo_viaje_en)} · ${v.ultimo_chofer_nombre || '—'}` : 'Sin viajes'}
                        </td>
                      </tr>
                      {estaAbierto && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={7} className="px-3 py-3">
                            <DetalleCamion vehiculo={v} desde={desde} hasta={hasta} rol={rol} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-50 text-xs font-bold text-slate-700">
                <tr className="border-t border-slate-200">
                  <td className="px-3 py-2">Total ({porVehiculo.length} vehículos)</td>
                  <td className="text-right px-3 py-2">{tot.viajes}</td>
                  <td className="text-right px-3 py-2">—</td>
                  <td className="text-right px-3 py-2">${fmt(tot.flete)}</td>
                  <td className="text-right px-3 py-2">${fmt(totChoferes)}</td>
                  <td className="text-right px-3 py-2">${fmt(totEmpresa)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  )
}
