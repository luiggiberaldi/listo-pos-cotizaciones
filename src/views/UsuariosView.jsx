// src/views/UsuariosView.jsx
// Acceso exclusivo: supervisor
import { UserCog } from 'lucide-react'

export default function UsuariosView() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-2">
        <UserCog size={28} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-slate-800">Usuarios</h1>
      </div>
      <p className="text-slate-500">Administración de usuarios — próximamente alta, edición y desactivación.</p>
    </div>
  )
}
