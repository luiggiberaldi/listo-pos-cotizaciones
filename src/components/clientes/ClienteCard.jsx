// src/components/clientes/ClienteCard.jsx
// Tarjeta de cliente para el listado
// Props adicionales si el viewer es supervisor: botón reasignar
import { Phone, Mail, MapPin, Hash, Tag, Pencil, UserMinus, ArrowRightLeft } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'

// ─── Dato de contacto con icono ───────────────────────────────────────────────
function Contacto({ icono: Icono, valor }) {
  if (!valor) return null
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <Icono size={11} className="shrink-0 text-slate-400" />
      <span className="truncate">{valor}</span>
    </div>
  )
}

const TIPO_LABELS = {
  natural:  'Natural',
  juridico: 'Jurídico',
}

const TIPO_COLORS = {
  natural:  'bg-slate-50 text-slate-600 border-slate-200',
  juridico: 'bg-violet-50 text-violet-700 border-violet-200',
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ClienteCard({ cliente, onEditar, onDesactivar, onReasignar }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esPropio = cliente.vendedor_id === perfil?.id
  const vendedorColor = cliente.vendedor?.color || null

  return (
    <div className={`group bg-white rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col ${
      esPropio ? 'border-slate-200 hover:border-sky-200 hover:shadow-lg hover:shadow-sky-50' : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
    }`}
      style={vendedorColor ? { borderLeftWidth: '4px', borderLeftColor: vendedorColor } : undefined}>

      {/* ── Cabecera: nombre + tipo ── */}
      <div className="px-4 pt-4 pb-2">
        <h3 className="font-bold text-slate-800 text-sm leading-tight truncate">
          {cliente.nombre}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          {cliente.rif_cedula && (
            <span className="flex items-center gap-1 text-xs text-slate-400 font-mono">
              <Hash size={10} />
              {cliente.rif_cedula}
            </span>
          )}
          {cliente.tipo_cliente && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TIPO_COLORS[cliente.tipo_cliente] || TIPO_COLORS.natural}`}>
              <Tag size={9} />
              {TIPO_LABELS[cliente.tipo_cliente] || cliente.tipo_cliente}
            </span>
          )}
        </div>
      </div>

      {/* ── Datos de contacto ── */}
      <div className="px-4 pb-3 space-y-1.5">
        <Contacto icono={Phone} valor={cliente.telefono} />
        <Contacto icono={Mail}  valor={cliente.email} />
        <Contacto icono={MapPin} valor={cliente.direccion} />
      </div>

      {/* ── Vendedor asignado (visible para todos) ── */}
      {cliente.vendedor && (
        <div className="mx-4 mb-3 flex items-center justify-between">
          <span className="text-xs text-slate-400">Vendedor</span>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5"
            style={vendedorColor
              ? { backgroundColor: vendedorColor + '18', color: vendedorColor, border: `1px solid ${vendedorColor}30` }
              : { backgroundColor: '#f1f5f9', color: '#475569' }
            }>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: vendedorColor || '#94a3b8' }} />
            {cliente.vendedor.nombre}
            {esPropio && <span className="text-[9px] opacity-60">(tú)</span>}
          </span>
        </div>
      )}

      {/* ── Nota reasignación ── */}
      {cliente.ultima_reasig_en && (
        <div className="mx-4 mb-3 text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-100">
          Reasignado: {new Date(cliente.ultima_reasig_en).toLocaleDateString('es-VE')}
        </div>
      )}

      {/* ── Acciones (barra inferior) ── */}
      <div className="mt-auto border-t border-slate-100 px-3 py-2 flex items-center gap-1">
        <button onClick={() => onEditar(cliente)} title="Editar cliente"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
          <Pencil size={13} />
          Editar
        </button>
        {esSupervisor && (
          <button onClick={() => onReasignar(cliente)} title="Reasignar cliente"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition-colors">
            <ArrowRightLeft size={13} />
            Reasignar
          </button>
        )}
        <button onClick={() => onDesactivar(cliente)} title="Desactivar cliente"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors ml-auto">
          <UserMinus size={13} />
        </button>
      </div>
    </div>
  )
}
