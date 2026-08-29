// src/components/reportes/SeccionTransportistasVentas.jsx
// Resumen de fletes, comisión externa y nómina local para el período de ventas seleccionado.
// Se usa dentro de TabVentas para mostrar el impacto del costo de transporte en el período.
import { Truck } from 'lucide-react'
import { useReporteTransportistas } from '../../hooks/useTransportistas'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function SeccionTransportistasVentas({ desde, hasta }) {
  const { data: items = [], isLoading } = useReporteTransportistas({ desde, hasta })

  // Solo mostrar transportistas con movimiento en el período
  const conMovimiento = items.filter(t => t.despachos > 0)

  if (isLoading) return null
  if (conMovimiento.length === 0) return null

  const totFlete  = conMovimiento.reduce((s, t) => s + (t.flete_total_usd || 0), 0)
  const totNeto   = conMovimiento.reduce((s, t) => s + (t.neto_total_usd  || 0), 0)
  const totPagado = conMovimiento.reduce((s, t) => s + (t.pagado_usd      || 0), 0)
  const totSaldo  = conMovimiento.reduce((s, t) => s + (t.saldo_usd       || 0), 0)
  const totNomina = conMovimiento.reduce((s, t) => s + (t.flete_nomina_usd || 0), 0)

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
            Comisión solo por fletes fuera de Carabobo; Carabobo se procesa por nómina
            {(desde || hasta) ? ` seleccionado` : ''}
          </p>
        </div>
      </div>

      {/* KPIs compactos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Flete cobrado',          value: `$${fmt(totFlete)}`,  cls: 'text-slate-800' },
          { label: 'Comisión externa',       value: `$${fmt(totNeto)}`,   cls: 'text-amber-600' },
          { label: 'Comisión liquidada',     value: `$${fmt(totPagado)}`, cls: 'text-green-600' },
          { label: 'Saldo comisión externa', value: `$${fmt(totSaldo)}`,  cls: totSaldo > 0.001 ? 'text-red-500' : 'text-green-600' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-2.5">
            <div className="text-[10px] text-slate-500 font-medium truncate">{k.label}</div>
            <div className={`text-sm font-black mt-0.5 ${k.cls}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Tabla desglose */}
      <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Chofer</th>
              <th className="text-right px-3 py-2 font-semibold">Despachos</th>
              <th className="text-right px-3 py-2 font-semibold">Flete</th>
              <th className="text-right px-3 py-2 font-semibold">Comisión externa</th>
              <th className="text-right px-3 py-2 font-semibold">Liquidado</th>
              <th className="text-right px-3 py-2 font-semibold">Saldo comisión</th>
              <th className="text-right px-3 py-2 font-semibold">Nómina Carabobo</th>
            </tr>
          </thead>
          <tbody>
            {conMovimiento.map(t => (
              <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-3 py-2 font-semibold text-slate-700">{t.nombre}</td>
                <td className="text-right px-3 py-2 text-slate-500">{t.despachos}</td>
                <td className="text-right px-3 py-2 text-slate-600">${fmt(t.flete_total_usd)}</td>
                <td className="text-right px-3 py-2 font-bold text-amber-600">${fmt(t.neto_total_usd)}</td>
                <td className="text-right px-3 py-2 text-green-600">${fmt(t.pagado_usd)}</td>
                <td className={`text-right px-3 py-2 font-black ${t.saldo_usd > 0.001 ? 'text-red-500' : 'text-slate-400'}`}>
                  {t.saldo_usd > 0.001 ? `$${fmt(t.saldo_usd)}` : '—'}
                </td>
                <td className="text-right px-3 py-2 text-slate-500">
                  {t.despachos_nomina > 0 ? `${t.despachos_nomina} · $${fmt(t.flete_nomina_usd)}` : '—'}
                </td>
              </tr>
            ))}
            {/* Totales */}
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td className="px-3 py-2 font-black text-slate-700">Total</td>
              <td className="text-right px-3 py-2 font-bold text-slate-600">
                {conMovimiento.reduce((s, t) => s + t.despachos, 0)}
              </td>
              <td className="text-right px-3 py-2 font-bold text-slate-700">${fmt(totFlete)}</td>
              <td className="text-right px-3 py-2 font-black text-amber-700">${fmt(totNeto)}</td>
              <td className="text-right px-3 py-2 font-bold text-green-700">${fmt(totPagado)}</td>
              <td className={`text-right px-3 py-2 font-black ${totSaldo > 0.001 ? 'text-red-600' : 'text-slate-400'}`}>
                {totSaldo > 0.001 ? `$${fmt(totSaldo)}` : '—'}
              </td>
              <td className="text-right px-3 py-2 font-bold text-slate-500">${fmt(totNomina)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
