// src/components/reportes/SeccionTransportistasVentas.jsx
// Resumen de fletes de choferes locales para el período de ventas seleccionado:
// total de fletes, parte del chofer (su comisión fuera de Carabobo) y parte de
// la empresa (el resto). Mismo criterio que la pestaña Transportistas: sin
// pagado/saldo. Se usa dentro de TabVentas.
import { Truck } from 'lucide-react'
import { useReporteTransportistas } from '../../hooks/useTransportistas'
import { repartoFlete } from '../../utils/flotaReporte'
import TarjetaMovil, { ListaMovil } from './TarjetaMovil'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function SeccionTransportistasVentas({ desde, hasta }) {
  const { data: items = [], isLoading } = useReporteTransportistas({ desde, hasta })

  // Solo mostrar transportistas con movimiento en el período
  const conMovimiento = items.filter(t => t.despachos > 0)

  if (isLoading) return null
  if (conMovimiento.length === 0) return null

  const tot = conMovimiento.reduce((acc, t) => {
    const r = repartoFlete(t)
    return { total: acc.total + r.total, chofer: acc.chofer + r.chofer, empresa: acc.empresa + r.empresa, despachos: acc.despachos + (Number(t.despachos) || 0) }
  }, { total: 0, chofer: 0, empresa: 0, despachos: 0 })

  return (
    <div className="space-y-3 pt-4 border-t border-slate-100">
      {/* Encabezado */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
          <Truck size={14} className="text-amber-700" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-700">Choferes locales</h3>
          <p className="text-[10px] text-slate-400">
            El chofer cobra comisión solo por fletes fuera de Carabobo; en Carabobo cobra por nómina y el flete queda para la empresa
          </p>
        </div>
      </div>

      {/* KPIs compactos */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Total de fletes', value: `$${fmt(tot.total)}`, cls: 'text-slate-800' },
          { label: 'Para los choferes', value: `$${fmt(tot.chofer)}`, cls: 'text-amber-700' },
          { label: 'Para la empresa', value: `$${fmt(tot.empresa)}`, cls: 'text-emerald-700' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-2.5 min-w-0">
            <div className="text-[10px] text-slate-500 font-medium leading-tight">{k.label}</div>
            <div className={`text-sm font-black mt-0.5 ${k.cls}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Celular: un chofer por tarjeta */}
      <div className="sm:hidden bg-white border border-slate-200 rounded-xl">
        <ListaMovil>
          {conMovimiento.map(t => {
            const r = repartoFlete(t)
            return (
              <TarjetaMovil
                key={t.id}
                titulo={t.nombre}
                subtitulo={`${t.despachos} despacho${t.despachos === 1 ? '' : 's'}${t.despachos_nomina > 0 ? ` · ${t.despachos_nomina} en Carabobo (nómina)` : ''}`}
                monto={`$${fmt(r.empresa)}`}
                montoEtiqueta="Para la empresa"
                montoClase="text-emerald-700"
                detalles={[
                  { label: 'Total fletes', valor: `$${fmt(r.total)}` },
                  { label: 'Para el chofer', valor: `$${fmt(r.chofer)}`, clase: 'text-amber-700' },
                ]}
              />
            )
          })}
        </ListaMovil>
      </div>

      {/* Tableta y computadora: tabla */}
      <div className="hidden sm:block overflow-x-auto bg-white border border-slate-200 rounded-xl">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Chofer</th>
              <th className="text-right px-3 py-2 font-semibold">Despachos</th>
              <th className="text-right px-3 py-2 font-semibold">Total fletes</th>
              <th className="text-right px-3 py-2 font-semibold">Para el chofer</th>
              <th className="text-right px-3 py-2 font-semibold">Para la empresa</th>
            </tr>
          </thead>
          <tbody>
            {conMovimiento.map(t => {
              const r = repartoFlete(t)
              return (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-700">{t.nombre}</div>
                    {t.despachos_nomina > 0 && (
                      <div className="text-[10px] text-slate-400">{t.despachos_nomina} en Carabobo (${fmt(t.flete_nomina_usd)}): cobra por nómina</div>
                    )}
                  </td>
                  <td className="text-right px-3 py-2 text-slate-500">{t.despachos}</td>
                  <td className="text-right px-3 py-2 text-slate-700 font-semibold">${fmt(r.total)}</td>
                  <td className="text-right px-3 py-2 text-amber-700">${fmt(r.chofer)}</td>
                  <td className="text-right px-3 py-2 font-black text-emerald-700">${fmt(r.empresa)}</td>
                </tr>
              )
            })}
            {/* Totales */}
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td className="px-3 py-2 font-black text-slate-700">Total</td>
              <td className="text-right px-3 py-2 font-bold text-slate-600">{tot.despachos}</td>
              <td className="text-right px-3 py-2 font-bold text-slate-700">${fmt(tot.total)}</td>
              <td className="text-right px-3 py-2 font-bold text-amber-700">${fmt(tot.chofer)}</td>
              <td className="text-right px-3 py-2 font-black text-emerald-700">${fmt(tot.empresa)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
