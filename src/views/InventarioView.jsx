// src/views/InventarioView.jsx
import { Package } from 'lucide-react'

export default function InventarioView() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-2">
        <Package size={28} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-slate-800">Inventario</h1>
      </div>
      <p className="text-slate-500">Gestión de productos — próximamente catálogo y precios.</p>
    </div>
  )
}
