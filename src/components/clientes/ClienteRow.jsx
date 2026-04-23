// src/components/clientes/ClienteRow.jsx
// Fila compacta de cliente para vista de lista — barra lateral color vendedor
import { Phone, Mail, MapPin, Hash, Tag, Pencil, UserMinus, ArrowRightLeft, FileText } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'

const TIPO_LABELS = { natural: 'Natural', juridico: 'Jurídico' }
const TIPO_COLORS = {
  natural:  'bg-slate-50 text-slate-600 border-slate-200',
  juridico: 'bg-violet-50 text-violet-700 border-violet-200',
}

export default function ClienteRow({ cliente, onEditar, onDesactivar, onReasignar, onCotizar }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esPropio = cliente.vendedor_id === perfil?.id
  const color = cliente.vendedor?.color || null

  return (
    <div className="bg-white rounded-xl border border-slate-200 hover:shadow-md transition-all overflow-hidden flex items-stretch"
      style={color ? { borderColor: color + '40' } : undefined}>

      {/* Barra lateral de color del vendedor */}
      {color && (
        <div className="w-1 shrink-0 rounded-l-xl" style={{ background: color }} />
      )}

      {/* Info principal */}
      <div className="min-w-0 flex-1 px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-slate-800 text-sm truncate">{cliente.nombre}</h3>
          {cliente.rif_cedula && (
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <Hash size={10} />{cliente.rif_cedula}
            </span>
          )}
          {cliente.tipo_cliente && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TIPO_COLORS[cliente.tipo_cliente] || TIPO_COLORS.natural}`}>
              <Tag size={9} />{TIPO_LABELS[cliente.tipo_cliente] || cliente.tipo_cliente}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 mt-1 flex-wrap">
          {cliente.telefono && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Phone size={11} className="text-slate-400" />{cliente.telefono}
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

      {/* Chip vendedor */}
      {cliente.vendedor && (
        <div className="hidden sm:flex items-center px-3 shrink-0">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5"
            style={color
              ? { backgroundColor: color + '15', color, border: `1px solid ${color}30` }
              : { backgroundColor: '#f1f5f9', color: '#475569' }
            }>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color || '#94a3b8' }} />
            {cliente.vendedor.nombre}
            {esPropio && <span className="text-[9px] opacity-60">(tú)</span>}
          </span>
        </div>
      )}

      {/* Acciones */}
      <div className="flex items-center gap-1 px-2 shrink-0">
        <button onClick={() => onCotizar(cliente)} title="Cotizar"
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-colors">
          <FileText size={13} />
          Cotizar
        </button>
        {(esPropio || esSupervisor) && (
          <button onClick={() => onEditar(cliente)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-light transition-colors">
            <Pencil size={15} />
          </button>
        )}
        {esSupervisor && (
          <button onClick={() => onReasignar(cliente)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-colors">
            <ArrowRightLeft size={15} />
          </button>
        )}
        <button onClick={() => onDesactivar(cliente)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
          <UserMinus size={15} />
        </button>
      </div>
    </div>
  )
}
