// src/views/ClientesView.jsx
import { Users } from 'lucide-react'

export default function ClientesView() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-2">
        <Users size={28} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-slate-800">Clientes</h1>
      </div>
      <p className="text-slate-500">Gestión de clientes — próximamente lista y alta de clientes.</p>
    </div>
  )
}
