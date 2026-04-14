// src/views/TransportistasView.jsx
import { Truck } from 'lucide-react'

export default function TransportistasView() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-2">
        <Truck size={28} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-slate-800">Transportistas</h1>
      </div>
      <p className="text-slate-500">Gestión de transportistas — próximamente lista y tarifas.</p>
    </div>
  )
}
