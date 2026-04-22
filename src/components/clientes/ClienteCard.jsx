// src/components/clientes/ClienteCard.jsx
// Tarjeta de cliente — color header strip del vendedor asignado
import { Phone, Mail, MapPin, Hash, Tag, Pencil, UserMinus, ArrowRightLeft, FileText } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'

function Contacto({ icono: Icono, valor }) {
  if (!valor) return null
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <Icono size={11} className="shrink-0 text-slate-400" />
      <span className="truncate">{valor}</span>
    </div>
  )
}

const TIPO_LABELS = { natural: 'Natural', juridico: 'Jurídico' }

// Genera iniciales del nombre (máx 2 caracteres)
function getIniciales(nombre = '') {
  const parts = nombre.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return nombre.slice(0, 2).toUpperCase()
}

export default function ClienteCard({ cliente, onEditar, onDesactivar, onReasignar, onCotizar }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esPropio     = cliente.vendedor_id === perfil?.id
  const color        = cliente.vendedor?.color || '#64748b'

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col"
      style={{ '--card-color': color }}>

      {/* ── Header strip con color del vendedor ── */}
      <div className="relative h-16 shrink-0 flex items-end px-4 pb-2"
        style={{
          background: `linear-gradient(135deg, ${color}ee 0%, ${color}99 100%)`,
        }}>
        {/* Patrón de puntos sutil */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />

        {/* Avatar con inicial */}
        <div className="relative z-10 w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
          style={{
            background: 'rgba(255,255,255,0.25)',
            border: '2px solid rgba(255,255,255,0.5)',
            color: 'white',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(4px)',
          }}>
          {getIniciales(cliente.nombre)}
        </div>

        {/* Chip tipo cliente en la esquina */}
        {cliente.tipo_cliente && (
          <span className="relative z-10 ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.25)', color: 'white', border: '1px solid rgba(255,255,255,0.4)' }}>
            {TIPO_LABELS[cliente.tipo_cliente] || cliente.tipo_cliente}
          </span>
        )}
      </div>

      {/* ── Nombre + RIF ── */}
      <div className="px-4 pt-3 pb-1">
        <h3 className="font-bold text-slate-800 text-sm leading-tight truncate">{cliente.nombre}</h3>
        {cliente.rif_cedula && (
          <span className="flex items-center gap-1 text-xs text-slate-400 font-mono mt-0.5">
            <Hash size={10} />
            {cliente.rif_cedula}
          </span>
        )}
      </div>

      {/* ── Contacto ── */}
      <div className="px-4 pb-3 space-y-1.5 mt-1">
        <Contacto icono={Phone} valor={cliente.telefono} />
        <Contacto icono={Mail}  valor={cliente.email} />
        <Contacto icono={MapPin} valor={cliente.direccion} />
      </div>

      {/* ── Vendedor chip ── */}
      {cliente.vendedor && (
        <div className="mx-4 mb-3 flex items-center justify-between">
          <span className="text-xs text-slate-400">Vendedor</span>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5"
            style={{
              backgroundColor: color + '15',
              color: color,
              border: `1px solid ${color}30`,
            }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            {cliente.vendedor.nombre}
            {esPropio && <span className="text-[9px] opacity-60 ml-0.5">(tú)</span>}
          </span>
        </div>
      )}

      {/* ── Nota reasignación ── */}
      {cliente.ultima_reasig_en && (
        <div className="mx-4 mb-3 text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-100">
          Reasignado: {new Date(cliente.ultima_reasig_en).toLocaleDateString('es-VE')}
        </div>
      )}

      {/* ── Acciones ── */}
      <div className="mt-auto border-t border-slate-100 px-3 py-2 flex items-center gap-1">
        <button onClick={() => onCotizar(cliente)} title="Cotizar con este cliente"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-colors">
          <FileText size={13} />
          Cotizar
        </button>
        <button onClick={() => onEditar(cliente)} title="Editar cliente"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
          <Pencil size={13} />
          Editar
        </button>
        {esSupervisor && (
          <button onClick={() => onReasignar(cliente)} title="Reasignar cliente"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            <ArrowRightLeft size={13} />
            Reasignar
          </button>
        )}
        <button onClick={() => onDesactivar(cliente)} title="Desactivar cliente"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors ml-auto">
          <UserMinus size={13} />
        </button>
      </div>
    </div>
  )
}
