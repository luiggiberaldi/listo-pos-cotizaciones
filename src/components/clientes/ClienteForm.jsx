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

const PREFIJOS_RIF = ['V', 'J', 'E', 'G', 'P']

/** Separa "J-12345678-9" en { prefijo: 'J', numero: '12345678-9' } */
function parsearRif(rif) {
  if (!rif) return { prefijo: 'V', numero: '' }
  const limpio = rif.trim().toUpperCase()
  const match = limpio.match(/^([VJEGP])-?(.*)$/)
  if (match) return { prefijo: match[1], numero: match[2] }
  return { prefijo: 'V', numero: limpio }
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ClienteForm({ cliente = null, onSuccess, onCancel, compact = false }) {
  const esEdicion = !!cliente

  const [campos, setCampos] = useState(VACIO)
  const [rifPrefijo, setRifPrefijo] = useState('V')
  const [errores, setErrores] = useState({})
  const [errorGeneral, setErrorGeneral] = useState('')

  const crearCliente    = useCrearCliente()
  const actualizarCliente = useActualizarCliente()
  const mutation = esEdicion ? actualizarCliente : crearCliente
  const cargando = mutation.isPending

  // Cargar datos del cliente al editar
  useEffect(() => {
    if (cliente) {
      // Normalizar teléfono viejo (0412-1234567, +584121234567, etc.) al nuevo formato (412-1234567)
      let tel = cliente.telefono ?? ''
      if (tel) {
        let limpio = tel.replace(/[\s\-\(\)\.+]/g, '')
        if (limpio.startsWith('58') && limpio.length >= 12) limpio = limpio.slice(2)
        if (limpio.startsWith('0')) limpio = limpio.slice(1)
        limpio = limpio.slice(0, 10)
        if (limpio.length > 3) limpio = limpio.slice(0, 3) + '-' + limpio.slice(3)
        tel = limpio
      }
      // Separar prefijo del RIF/Cédula
      const { prefijo, numero } = parsearRif(cliente.rif_cedula)
      setRifPrefijo(prefijo)
      setCampos({
        nombre:       cliente.nombre       ?? '',
        rif_cedula:   numero,
        telefono:     tel,
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
    if (campos.nombre.trim() && campos.nombre.trim().length < 3) errs.nombre = 'El nombre debe tener al menos 3 caracteres'
    if (!campos.rif_cedula.trim()) {
      errs.rif_cedula = 'El RIF/Cédula es obligatorio para proteger la asignación del cliente'
    } else {
      const nums = campos.rif_cedula.replace(/-/g, '').trim()
      // Debe ser 6-9 dígitos, opcionalmente seguido de guion y dígito verificador
      if (!/^\d{6,9}(-\d)?$/.test(campos.rif_cedula.trim())) {
        errs.rif_cedula = 'Solo números. Ej: 12345678-9 o 12345678'
      }
    }
    if (campos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campos.email.trim())) {
      errs.email = 'Correo inválido'
    }
    if (campos.telefono) {
      const telLimpio = campos.telefono.replace(/[\s\-]/g, '')
      // Debe ser un número móvil venezolano: 4XX seguido de 7 dígitos
      if (!/^4(12|14|16|24|26)\d{7}$/.test(telLimpio)) {
        errs.telefono = 'Debe ser un número móvil válido (412, 414, 416, 424, 426)'
      }
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validar()
    if (Object.keys(errs).length) { setErrores(errs); return }

    // Combinar prefijo + número del RIF
    const camposFinales = {
      ...campos,
      rif_cedula: `${rifPrefijo}-${campos.rif_cedula.trim()}`,
    }

    try {
      let resultado
      if (esEdicion) {
        resultado = await actualizarCliente.mutateAsync({ id: cliente.id, campos: camposFinales })
      } else {
        resultado = await crearCliente.mutateAsync(camposFinales)
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
          onChange={val => { setCampos(prev => ({ ...prev, tipo_cliente: val })); if (val === 'natural' && rifPrefijo === 'J') setRifPrefijo('V'); if (val === 'juridico' && rifPrefijo === 'V') setRifPrefijo('J'); if (errores.tipo_cliente) setErrores(prev => ({ ...prev, tipo_cliente: '' })); if (errorGeneral) setErrorGeneral('') }}
          placeholder="Seleccionar tipo..."
          icon={Tag}
          disabled={cargando}
          searchable={false}
        />
      </Campo>

      {/* RIF / Cédula */}
      <Campo label="RIF / Cédula *" icono={Hash} error={errores.rif_cedula}>
        <div className="flex gap-1.5 mb-2">
          {PREFIJOS_RIF.map(p => (
            <button
              key={p}
              type="button"
              disabled={cargando}
              onClick={() => { setRifPrefijo(p); if (errores.rif_cedula) setErrores(prev => ({ ...prev, rif_cedula: '' })) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                rifPrefijo === p
                  ? 'bg-primary text-white shadow-sm scale-105'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              } disabled:opacity-50`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="relative flex items-center">
          <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-sm font-bold text-slate-600 select-none h-[42px]">
            {rifPrefijo}-
          </span>
          <input
            type="text"
            name="rif_cedula"
            value={campos.rif_cedula}
            onChange={e => {
              // Solo permitir dígitos y guion para dígito verificador
              let val = e.target.value.replace(/[^\d-]/g, '')
              // Máx formato: 123456789-0
              if (val.replace(/-/g, '').length > 10) return
              cambiar({ target: { name: 'rif_cedula', value: val } })
            }}
            placeholder="12345678-9"
            className={`${inputClass} rounded-l-none`}
            disabled={cargando}
            inputMode="numeric"
          />
        </div>
      </Campo>

      {/* Teléfono */}
      <Campo label="Teléfono" icono={Phone} error={errores.telefono}>
        <div className="relative flex">
          <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-sm text-slate-500 select-none">
            +58
          </span>
          <input
            type="tel"
            name="telefono"
            value={campos.telefono}
            onChange={e => {
              let val = e.target.value.replace(/[^\d]/g, '')
              // Si pega número con 58 al inicio, quitarlo
              if (val.startsWith('58') && val.length > 10) val = val.slice(2)
              // Si empieza con 0, quitarlo (ya mostramos +58)
              if (val.startsWith('0')) val = val.slice(1)
              // Máx 10 dígitos (4XX-XXXXXXX)
              val = val.slice(0, 10)
              // Auto-formato: 412-1234567
              if (val.length > 3) val = val.slice(0, 3) + '-' + val.slice(3)
              cambiar({ target: { name: 'telefono', value: val } })
            }}
            placeholder="412-1234567"
            className={`${inputClass} rounded-l-none`}
            disabled={cargando}
          />
        </div>
        <p className="text-[10px] text-slate-400 mt-0.5">Número móvil venezolano para WhatsApp</p>
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
      <div className="flex gap-3 pt-4 pb-4">
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
