// src/components/clientes/ClienteForm.jsx
// Formulario para crear o editar un cliente
// Usado dentro de un Modal — recibe onSuccess para cerrar tras guardar
import { useState, useEffect } from 'react'
import { User, Hash, Phone, Mail, MapPin, StickyNote, Loader2, Tag } from 'lucide-react'
import { useCrearCliente, useActualizarCliente } from '../../hooks/useClientes'
import CustomSelect from '../ui/CustomSelect'

// ─── Campo de formulario reutilizable ─────────────────────────────────────────
function Campo({ label, icono: Icono, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {Icono && <Icono size={14} className="text-slate-400" />}
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

// ─── Estilo base de input ─────────────────────────────────────────────────────
const inputClass = `
  w-full px-3 py-2.5 rounded-xl border text-sm text-slate-800
  bg-slate-50 border-slate-200
  focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary
  placeholder:text-slate-400
  transition-colors
`

// ─── Valores iniciales vacíos ─────────────────────────────────────────────────
const TIPOS_CLIENTE = [
  { valor: 'natural',   label: 'Natural' },
  { valor: 'juridico',  label: 'Jurídico' },
]

const VACIO = {
  nombre:       '',
  rif_cedula:   '',
  telefono:     '',
  email:        '',
  direccion:    '',
  notas:        '',
  tipo_cliente: 'natural',
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ClienteForm({ cliente = null, onSuccess, onCancel, compact = false }) {
  const esEdicion = !!cliente

  const [campos, setCampos] = useState(VACIO)
  const [errores, setErrores] = useState({})
  const [errorGeneral, setErrorGeneral] = useState('')

  const crearCliente    = useCrearCliente()
  const actualizarCliente = useActualizarCliente()
  const mutation = esEdicion ? actualizarCliente : crearCliente
  const cargando = mutation.isPending

  // Cargar datos del cliente al editar
  useEffect(() => {
    if (cliente) {
      setCampos({
        nombre:       cliente.nombre       ?? '',
        rif_cedula:   cliente.rif_cedula   ?? '',
        telefono:     cliente.telefono     ?? '',
        email:        cliente.email        ?? '',
        direccion:    cliente.direccion    ?? '',
        notas:        cliente.notas        ?? '',
        tipo_cliente: cliente.tipo_cliente ?? 'natural',
      })
    }
  }, [cliente])

  function cambiar(e) {
    const { name, value } = e.target
    setCampos(prev => ({ ...prev, [name]: value }))
    // Limpiar error del campo al escribir
    if (errores[name]) setErrores(prev => ({ ...prev, [name]: '' }))
    if (errorGeneral) setErrorGeneral('')
  }

  function validar() {
    const errs = {}
    if (!campos.nombre.trim()) errs.nombre = 'El nombre es obligatorio'
    if (!campos.rif_cedula.trim()) errs.rif_cedula = 'El RIF/Cédula es obligatorio para proteger la asignación del cliente'
    if (campos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campos.email.trim())) {
      errs.email = 'Correo inválido'
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validar()
    if (Object.keys(errs).length) { setErrores(errs); return }

    try {
      let resultado
      if (esEdicion) {
        resultado = await actualizarCliente.mutateAsync({ id: cliente.id, campos })
      } else {
        resultado = await crearCliente.mutateAsync(campos)
      }
      onSuccess?.(resultado)
    } catch (err) {
      setErrorGeneral(err.message ?? 'Ocurrió un error. Intenta de nuevo.')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* Nombre */}
      <Campo label="Nombre *" icono={User} error={errores.nombre}>
        <input
          type="text"
          name="nombre"
          value={campos.nombre}
          onChange={cambiar}
          placeholder="Ej: Juan Pérez / Ferretería Central"
          className={inputClass}
          disabled={cargando}
          autoFocus
        />
      </Campo>

      {/* Tipo de cliente */}
      <Campo label="Tipo de cliente *" icono={Tag} error={errores.tipo_cliente}>
        <CustomSelect
          options={TIPOS_CLIENTE.map(t => ({ value: t.valor, label: t.label }))}
          value={campos.tipo_cliente}
          onChange={val => { setCampos(prev => ({ ...prev, tipo_cliente: val })); if (errores.tipo_cliente) setErrores(prev => ({ ...prev, tipo_cliente: '' })); if (errorGeneral) setErrorGeneral('') }}
          placeholder="Seleccionar tipo..."
          icon={Tag}
          disabled={cargando}
          searchable={false}
        />
      </Campo>

      {/* RIF / Cédula */}
      <Campo label="RIF / Cédula *" icono={Hash} error={errores.rif_cedula}>
        <input
          type="text"
          name="rif_cedula"
          value={campos.rif_cedula}
          onChange={cambiar}
          placeholder="Ej: J-12345678-9"
          className={inputClass}
          disabled={cargando}
        />
      </Campo>

      {/* Teléfono */}
      <Campo label="Teléfono" icono={Phone} error={errores.telefono}>
        <input
          type="tel"
          name="telefono"
          value={campos.telefono}
          onChange={cambiar}
          placeholder="Ej: 0412-1234567"
          className={inputClass}
          disabled={cargando}
        />
      </Campo>

      {/* Email */}
      <Campo label="Correo electrónico" icono={Mail} error={errores.email}>
        <input
          type="email"
          name="email"
          value={campos.email}
          onChange={cambiar}
          placeholder="Ej: cliente@empresa.com"
          className={inputClass}
          disabled={cargando}
        />
      </Campo>

      {/* Dirección */}
      <Campo label="Dirección" icono={MapPin} error={errores.direccion}>
        <input
          type="text"
          name="direccion"
          value={campos.direccion}
          onChange={cambiar}
          placeholder="Ej: Av. Principal, Edif. Torre, Piso 3"
          className={inputClass}
          disabled={cargando}
        />
      </Campo>

      {/* Notas */}
      <Campo label="Notas" icono={StickyNote} error={errores.notas}>
        <textarea
          name="notas"
          value={campos.notas}
          onChange={cambiar}
          rows={3}
          placeholder="Observaciones sobre el cliente..."
          className={`${inputClass} resize-none`}
          disabled={cargando}
        />
      </Campo>

      {/* Error general */}
      {errorGeneral && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {errorGeneral}
        </div>
      )}

      {/* Botones */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={cargando}
          className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={cargando}
          className={`flex-1 py-2.5 px-4 rounded-xl text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
            compact
              ? 'bg-emerald-500 hover:bg-emerald-600'
              : 'bg-primary hover:bg-primary-hover'
          }`}
        >
          {cargando
            ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
            : esEdicion ? 'Guardar cambios' : compact ? 'Crear y seleccionar' : 'Crear cliente'
          }
        </button>
      </div>

    </form>
  )
}
