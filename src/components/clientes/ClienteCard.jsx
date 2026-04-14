// src/components/clientes/ClienteCard.jsx
// Tarjeta de cliente para el listado
// Props adicionales si el viewer es supervisor: botón reasignar
import { Phone, Mail, MapPin, Hash, Tag, Pencil, UserMinus, ArrowRightLeft } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'

// ─── Dato de contacto con icono ───────────────────────────────────────────────
function Contacto({ icono: Icono, valor }) {
  if (!valor) return null
  return (
    <div className="flex items-center gap-1.5 text-sm text-slate-500">
      <Icono size={13} className="shrink-0 text-slate-400" />
      <span className="truncate">{valor}</span>
    </div>
  )
}

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

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ClienteCard({ cliente, onEditar, onDesactivar, onReasignar }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return (
    <div className="bg-white rounded-2xl border border-slate-200 hover:border-primary-light hover:shadow-md transition-all p-4 flex flex-col gap-3">

      {/* Cabecera: nombre + acciones */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold text-slate-800 text-base leading-tight truncate">
            {cliente.nombre}
          </h3>
          {cliente.rif_cedula && (
            <div className="flex items-center gap-1 mt-0.5">
              <Hash size={11} className="text-slate-400" />
              <span className="text-xs text-slate-400">{cliente.rif_cedula}</span>
            </div>
          )}
          {cliente.tipo_cliente && (
            <span className={`inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TIPO_COLORS[cliente.tipo_cliente] || TIPO_COLORS.particular}`}>
              <Tag size={10} />
              {TIPO_LABELS[cliente.tipo_cliente] || cliente.tipo_cliente}
            </span>
          )}
        </div>

        {/* Botones de acción */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onEditar(cliente)}
            title="Editar cliente"
            className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-light transition-colors"
          >
            <Pencil size={16} />
          </button>

          {/* Reasignar: solo supervisor */}
          {esSupervisor && (
            <button
              onClick={() => onReasignar(cliente)}
              title="Reasignar cliente"
              className="p-2 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-colors"
            >
              <ArrowRightLeft size={16} />
            </button>
          )}

          <button
            onClick={() => onDesactivar(cliente)}
            title="Desactivar cliente"
            className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <UserMinus size={16} />
          </button>
        </div>
      </div>

      {/* Datos de contacto */}
      <div className="space-y-1">
        <Contacto icono={Phone} valor={cliente.telefono} />
        <Contacto icono={Mail}  valor={cliente.email} />
        <Contacto icono={MapPin} valor={cliente.direccion} />
      </div>

      {/* Footer: vendedor asignado (solo visible para supervisor) */}
      {esSupervisor && cliente.vendedor && (
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-400">Vendedor</span>
          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
            {cliente.vendedor.nombre}
          </span>
        </div>
      )}

      {/* Nota si fue reasignado */}
      {cliente.ultima_reasig_en && (
        <div className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-100">
          Reasignado: {new Date(cliente.ultima_reasig_en).toLocaleDateString('es-VE')}
        </div>
      )}
    </div>
  )
}
