// src/views/AuditoriaView.jsx
// Acceso exclusivo: supervisor
import { ClipboardList } from 'lucide-react'

export default function AuditoriaView() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-2">
        <ClipboardList size={28} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-slate-800">Auditoría</h1>
      </div>
      <p className="text-slate-500">Registro de auditoría — próximamente historial de acciones del sistema.</p>
    </div>
  )
}
