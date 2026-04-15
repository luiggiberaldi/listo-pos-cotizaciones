// src/components/cotizaciones/EstadoBadge.jsx
const ESTILOS = {
  borrador:   'bg-slate-100 text-slate-600 border-slate-200',
  enviada:    'bg-blue-50 text-blue-700 border-blue-200',
  aceptada:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  rechazada:  'bg-red-50 text-red-600 border-red-200',
  vencida:    'bg-orange-50 text-orange-600 border-orange-200',
  anulada:    'bg-slate-100 text-slate-400 border-slate-200 line-through',
  // Estados de despacho
  pendiente:  'bg-amber-50 text-amber-700 border-amber-200',
  despachada: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  entregada:  'bg-teal-50 text-teal-700 border-teal-200',
}

const ETIQUETAS = {
  borrador:   'Borrador',
  enviada:    'Enviada',
  aceptada:   'Aceptada',
  rechazada:  'Rechazada',
  vencida:    'Vencida',
  anulada:    'Anulada',
  // Estados de despacho
  pendiente:  'Pendiente',
  despachada: 'Despachada',
  entregada:  'Entregada',
}

export default function EstadoBadge({ estado }) {
  return (
    <span className={`inline-flex items-center text-sm font-semibold px-2.5 py-1 rounded-full border ${ESTILOS[estado] ?? ESTILOS.borrador}`}>
      {ETIQUETAS[estado] ?? estado}
    </span>
  )
}
