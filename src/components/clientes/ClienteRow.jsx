// src/components/clientes/ClienteRow.jsx
// Fila compacta de cliente para vista de lista
import { Phone, Mail, MapPin, Hash, Tag, Pencil, UserMinus, ArrowRightLeft } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'

const TIPO_LABELS = {
  ferreteria:  'Ferretería',
  constructor: 'Constructor',
  particular:  'Particular',
  empresa:     'Empresa',
}

const TIPO_COLORS = {
  ferreteria:  'bg-amber-50 text-amber-700 border-amber-200',
  constructor: 'bg-sky-50 text-sky-700 border-sky-200',
  particular:  'bg-slate-50 text-slate-600 border-slate-200',
  empresa:     'bg-violet-50 text-violet-700 border-violet-200',
}

export default function ClienteRow({ cliente, onEditar, onDesactivar, onReasignar }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return (
    <div className="bg-white rounded-xl border border-slate-200 hover:border-primary-light hover:shadow-sm transition-all px-4 py-3 flex items-center gap-4">

      {/* Info principal */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-slate-800 text-sm truncate">{cliente.nombre}</h3>
          {cliente.rif_cedula && (
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <Hash size={10} />
              {cliente.rif_cedula}
            </span>
          )}
          {cliente.tipo_cliente && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TIPO_COLORS[cliente.tipo_cliente] || TIPO_COLORS.particular}`}>
              <Tag size={9} />
              {TIPO_LABELS[cliente.tipo_cliente] || cliente.tipo_cliente}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 mt-1 flex-wrap">
          {cliente.telefono && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Phone size={11} className="text-slate-400" />
              {cliente.telefono}
            </span>
          )}
          {cliente.email && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Mail size={11} className="text-slate-400" />
              <span className="truncate max-w-[180px]">{cliente.email}</span>
            </span>
          )}
          {cliente.direccion && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <MapPin size={11} className="text-slate-400" />
              <span className="truncate max-w-[200px]">{cliente.direccion}</span>
            </span>
          )}
        </div>
      </div>

      {/* Vendedor (supervisor) */}
      {esSupervisor && cliente.vendedor && (
        <span className="hidden sm:inline text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
          {cliente.vendedor.nombre}
        </span>
      )}

      {/* Acciones */}
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => onEditar(cliente)} title="Editar cliente"
          className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-light transition-colors">
          <Pencil size={15} />
        </button>
        {esSupervisor && (
          <button onClick={() => onReasignar(cliente)} title="Reasignar cliente"
            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-colors">
            <ArrowRightLeft size={15} />
          </button>
        )}
        <button onClick={() => onDesactivar(cliente)} title="Desactivar cliente"
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
          <UserMinus size={15} />
        </button>
      </div>
    </div>
  )
}
