// src/components/cotizaciones/EstadoBadge.jsx
const ESTILOS = {
  borrador:  'bg-slate-100 text-slate-600 border-slate-200',
  enviada:   'bg-blue-50 text-blue-700 border-blue-200',
  aceptada:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  rechazada: 'bg-red-50 text-red-600 border-red-200',
  vencida:   'bg-orange-50 text-orange-600 border-orange-200',
  anulada:   'bg-slate-100 text-slate-400 border-slate-200 line-through',
}

const ETIQUETAS = {
  borrador:  'Borrador',
  enviada:   'Enviada',
  aceptada:  'Aceptada',
  rechazada: 'Rechazada',
  vencida:   'Vencida',
  anulada:   'Anulada',
}

export default function EstadoBadge({ estado }) {
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full border ${ESTILOS[estado] ?? ESTILOS.borrador}`}>
      {ETIQUETAS[estado] ?? estado}
    </span>
  )
}
