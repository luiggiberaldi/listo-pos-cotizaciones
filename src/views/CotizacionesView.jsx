// src/views/CotizacionesView.jsx
import { FileText } from 'lucide-react'

export default function CotizacionesView() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-2">
        <FileText size={28} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-slate-800">Cotizaciones</h1>
      </div>
      <p className="text-slate-500">Gestión de cotizaciones — próximamente lista, creación y PDF.</p>
    </div>
  )
}
