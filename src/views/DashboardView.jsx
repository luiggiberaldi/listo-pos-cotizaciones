// src/views/DashboardView.jsx
import { LayoutDashboard } from 'lucide-react'

export default function DashboardView() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-2">
        <LayoutDashboard size={28} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-slate-800">Inicio</h1>
      </div>
      <p className="text-slate-500">Panel principal — próximamente resumen de actividad.</p>
    </div>
  )
}
