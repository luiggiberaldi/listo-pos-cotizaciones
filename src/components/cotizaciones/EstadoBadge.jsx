// src/components/cotizaciones/EstadoBadge.jsx
import { getDespachoLabel, getCotizacionLabel } from '../../utils/estadoLabels'

const ESTILOS = {
  borrador:   'bg-slate-100 text-slate-600 border-slate-200',
  enviada:    'bg-blue-50 text-blue-700 border-blue-200',
  aceptada:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  rechazada:  'bg-orange-50 text-orange-600 border-orange-200',
  vencida:    'bg-amber-50 text-amber-700 border-amber-200',
  anulada:    'bg-orange-50 text-orange-600 border-orange-200',
  // Estados de despacho
  pendiente:  'bg-amber-50 text-amber-700 border-amber-200',
  despachada: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  entregada:  'bg-teal-50 text-teal-700 border-teal-200',
}

const ESTADOS_DESPACHO = ['pendiente', 'despachada', 'entregada', 'anulada']

export default function EstadoBadge({ estado, rol }) {
  const esDespacho = ESTADOS_DESPACHO.includes(estado)
  const label = esDespacho && rol ? getDespachoLabel(estado, rol) : (esDespacho ? getDespachoLabel(estado) : getCotizacionLabel(estado))

  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full border ${ESTILOS[estado] ?? ESTILOS.borrador}`}>
      {label}
    </span>
  )
}
