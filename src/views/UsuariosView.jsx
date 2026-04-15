// src/views/UsuariosView.jsx
// Gestión de usuarios — solo supervisores
// Estilo: Listo POS Lite (sky/teal, avatares con inicial, Crown para supervisor)
import { useState } from 'react'
import { UserCog, Plus, Pencil, UserCheck, UserX, RefreshCw, Crown, Eye, EyeOff, Trash2 } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import CustomSelect from '../components/ui/CustomSelect'
import {
  useUsuarios,
  useCrearUsuario,
  useActualizarUsuario,
  useCambiarActivoUsuario,
  useEliminarUsuario,
} from '../hooks/useUsuarios'
import ConfirmModal from '../components/ui/ConfirmModal'
import Skeleton    from '../components/ui/Skeleton'
import EmptyState  from '../components/ui/EmptyState'

const ROL_CONFIG = {
  supervisor: {
    label:    'Supervisor',
    gradient: 'from-sky-500 to-teal-400',
    bg:       'bg-sky-50',
    text:     'text-sky-700',
    border:   'border-sky-200',
  },
  vendedor: {
    label:    'Vendedor',
    gradient: 'from-emerald-500 to-teal-500',
    bg:       'bg-emerald-50',
    text:     'text-emerald-700',
    border:   'border-emerald-200',
  },
}

// Colores predefinidos para vendedores
const COLORES_VENDEDOR = [
  '#EF4444', // rojo
  '#F97316', // naranja
  '#F59E0B', // ámbar
  '#84CC16', // lima
  '#22C55E', // verde
  '#14B8A6', // teal
  '#06B6D4', // cyan
  '#3B82F6', // azul
  '#6366F1', // indigo
  '#8B5CF6', // violeta
  '#D946EF', // fucsia
  '#EC4899', // rosa
]

// ─── Formulario crear usuario ─────────────────────────────────────────────────
function FormCrear({ onGuardar, onCancelar, cargando }) {
  const [campos, setCampos] = useState({ nombre: '', password: '', rol: 'vendedor', color: COLORES_VENDEDOR[0] })
  const [mostrarPass, setMostrarPass] = useState(false)
  const [error, setError] = useState('')

  function cambiar(k, v) { setCampos(p => ({ ...p, [k]: v })); setError('') }

  // Generar email interno a partir del nombre
  function generarEmail(nombre) {
    const slug = nombre.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
    return slug ? `${slug}.${Date.now()}@listo.internal` : ''
  }

  function submit(e) {
    e.preventDefault()
    if (!campos.nombre.trim())                   { setError('El nombre es obligatorio'); return }
    if (!/^\d{6}$/.test(campos.password))        { setError('El PIN debe ser exactamente 6 dígitos numéricos'); return }
    const email = generarEmail(campos.nombre)
    onGuardar({ ...campos, email, color: campos.rol === 'vendedor' ? campos.color : null })
  }

  const inputCls = `
    w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl
    text-sm font-medium text-slate-800 placeholder:text-slate-400
    focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all
  `

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* Nombre */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-xs font-bold">N</div>
        <input value={campos.nombre} onChange={e => cambiar('nombre', e.target.value)}
          placeholder="Nombre completo" className={inputCls} disabled={cargando} autoFocus />
      </div>
      {/* Contraseña */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-xs font-bold">#</div>
        <input type={mostrarPass ? 'text' : 'password'} value={campos.password}
          onChange={e => cambiar('password', e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="PIN de 6 dígitos (solo números)"
          inputMode="numeric"
          className={`${inputCls} pr-11`} disabled={cargando} />
        <button type="button" onClick={() => setMostrarPass(p => !p)}
          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-sky-500 transition-colors">
          {mostrarPass ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {/* Rol */}
      <CustomSelect
        options={[
          { value: 'vendedor', label: 'Vendedor' },
          { value: 'supervisor', label: 'Supervisor' },
        ]}
        value={campos.rol}
        onChange={val => cambiar('rol', val)}
        placeholder="Seleccionar rol..."
        disabled={cargando}
        searchable={false}
      />

      {/* Color del vendedor */}
      {campos.rol === 'vendedor' && (
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-500 ml-1">Color del vendedor</label>
          <div className="flex flex-wrap gap-2">
            {COLORES_VENDEDOR.map(c => (
              <button key={c} type="button" onClick={() => cambiar('color', c)}
                className={`w-8 h-8 rounded-lg transition-all ${campos.color === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-105'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500 font-bold ml-1">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-5 py-2 rounded-xl text-white text-sm font-black transition-all shadow-lg shadow-sky-500/20 active:scale-[0.98] disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #0EA5E9, #5EEAD4)' }}>
          {cargando ? 'Creando...' : 'Crear usuario'}
        </button>
      </div>
    </form>
  )
}

// ─── Formulario editar usuario ────────────────────────────────────────────────
function FormEditar({ usuario, onGuardar, onCancelar, cargando }) {
  const [campos, setCampos] = useState({ nombre: usuario.nombre, rol: usuario.rol, pin: '', color: usuario.color || COLORES_VENDEDOR[0] })
  const [mostrarPin, setMostrarPin] = useState(false)
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!campos.nombre.trim()) { setError('El nombre es obligatorio'); return }
    if (campos.pin && !/^\d{6}$/.test(campos.pin)) {
      setError('El PIN debe ser exactamente 6 dígitos numéricos')
      return
    }
    onGuardar({ nombre: campos.nombre, rol: campos.rol, pin: campos.pin || undefined, color: campos.rol === 'vendedor' ? campos.color : null })
  }

  const inputCls = `
    w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl
    text-sm font-medium text-slate-800
    focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all
  `

  return (
    <form onSubmit={submit} className="space-y-3">
      <input value={campos.nombre} onChange={e => setCampos(p => ({ ...p, nombre: e.target.value }))}
        className={inputCls} placeholder="Nombre completo" disabled={cargando} />
      <CustomSelect
        options={[
          { value: 'vendedor', label: 'Vendedor' },
          { value: 'supervisor', label: 'Supervisor' },
        ]}
        value={campos.rol}
        onChange={val => setCampos(p => ({ ...p, rol: val }))}
        placeholder="Seleccionar rol..."
        disabled={cargando}
        searchable={false}
      />

      {/* Color del vendedor */}
      {campos.rol === 'vendedor' && (
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-500 ml-1">Color del vendedor</label>
          <div className="flex flex-wrap gap-2">
            {COLORES_VENDEDOR.map(c => (
              <button key={c} type="button" onClick={() => setCampos(p => ({ ...p, color: c }))}
                className={`w-8 h-8 rounded-lg transition-all ${campos.color === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-105'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
      )}

      {/* PIN opcional */}
      <div className="relative">
        <input
          type={mostrarPin ? 'text' : 'password'}
          value={campos.pin}
          onChange={e => setCampos(p => ({ ...p, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
          className={`${inputCls} pr-11`}
          placeholder="Nuevo PIN (dejar vacío para no cambiar)"
          inputMode="numeric"
          disabled={cargando}
        />
        <button type="button" onClick={() => setMostrarPin(p => !p)}
          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-sky-500 transition-colors">
          {mostrarPin ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {campos.pin.length > 0 && campos.pin.length < 6 && (
        <p className="text-sm text-slate-500 ml-1">{6 - campos.pin.length} dígitos restantes</p>
      )}

      {error && <p className="text-xs text-red-500 font-bold ml-1">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-5 py-2 rounded-xl text-white text-sm font-black transition-all shadow-lg shadow-sky-500/20 active:scale-[0.98] disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #0EA5E9, #5EEAD4)' }}>
          {cargando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

// ─── Modal crear/editar ───────────────────────────────────────────────────────
function UsuarioModal({ usuario = null, onClose }) {
  const crear      = useCrearUsuario()
  const actualizar = useActualizarUsuario()
  const esEdicion  = !!usuario
  const [err, setErr] = useState('')

  async function guardar(campos) {
    setErr('')
    try {
      if (esEdicion) await actualizar.mutateAsync({ id: usuario.id, ...campos })
      else           await crear.mutateAsync(campos)
      onClose()
    } catch (e) {
      setErr(e.message === 'NO_SERVICE_KEY'
        ? 'Falta VITE_SUPABASE_SERVICE_KEY en el .env para crear usuarios'
        : (e.message ?? 'Error al guardar'))
    }
  }

  const cargando = crear.isPending || actualizar.isPending

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 w-full max-w-md p-7 space-y-5 relative overflow-hidden">

        {/* Destellos decorativos */}
        <div className="absolute top-0 right-0 -mr-10 -mt-10 w-32 h-32 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(125,211,252,0.2)' }} />
        <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-32 h-32 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(94,234,212,0.15)' }} />

        <div className="relative z-10">
          <h3 className="font-black text-slate-800 text-lg mb-5">
            {esEdicion ? 'Editar usuario' : 'Nuevo usuario'}
          </h3>

          {err && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700 font-medium mb-4">
              {err}
            </div>
          )}

          {esEdicion
            ? <FormEditar usuario={usuario} onGuardar={guardar} onCancelar={onClose} cargando={cargando} />
            : <FormCrear  onGuardar={guardar} onCancelar={onClose} cargando={cargando} />
          }
        </div>
      </div>
    </div>
  )
}

// ─── Tarjeta de usuario ───────────────────────────────────────────────────────
function UsuarioCard({ usuario, propio, onEditar, onCambiarActivo, onEliminar }) {
  const conf = ROL_CONFIG[usuario.rol] ?? ROL_CONFIG.vendedor
  const esSupervisor = usuario.rol === 'supervisor'
  const vendedorColor = usuario.color || null

  return (
    <div className={`bg-white rounded-2xl border transition-all p-4 flex flex-col gap-3 ${
      usuario.activo
        ? `${conf.border} hover:shadow-md`
        : 'border-slate-100 opacity-60'
    }`}
      style={vendedorColor && usuario.activo ? { borderLeftWidth: '4px', borderLeftColor: vendedorColor } : undefined}>
      <div className="flex items-center gap-3">
        {/* Avatar con inicial */}
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm relative ${!vendedorColor ? `bg-gradient-to-br ${conf.gradient}` : ''}`}
          style={vendedorColor ? { background: `linear-gradient(135deg, ${vendedorColor}, ${vendedorColor}99)` } : undefined}>
          <span className="text-white font-black text-xl">
            {(usuario.nombre || 'U')[0].toUpperCase()}
          </span>
          {esSupervisor && (
            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
              <Crown size={13} className="text-yellow-400 fill-yellow-400 drop-shadow-sm" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-black text-slate-800 truncate">{usuario.nombre}</p>
            {propio && (
              <span className="text-xs font-black uppercase tracking-wider bg-sky-100 text-sky-500 px-1.5 py-0.5 rounded-full shrink-0">Tú</span>
            )}
          </div>
          <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${conf.bg} ${conf.text}`}>
            {conf.label}
          </span>
        </div>

        {!propio && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onEditar(usuario)} title="Editar"
              className="px-2.5 py-2 rounded-lg text-slate-500 hover:text-sky-500 hover:bg-sky-50 transition-colors flex items-center gap-1 text-sm">
              <Pencil size={14} />
              <span>Editar</span>
            </button>
            <button
              onClick={() => onCambiarActivo(usuario, !usuario.activo)}
              title={usuario.activo ? 'Desactivar' : 'Activar'}
              className={`px-2.5 py-2 rounded-lg transition-colors flex items-center gap-1 text-sm ${
                usuario.activo
                  ? 'text-slate-500 hover:text-primary hover:bg-primary-light'
                  : 'text-slate-500 hover:text-emerald-500 hover:bg-emerald-50'
              }`}>
              {usuario.activo ? <UserX size={14} /> : <UserCheck size={14} />}
              <span>{usuario.activo ? 'Desactivar' : 'Activar'}</span>
            </button>
            <button onClick={() => onEliminar(usuario)} title="Eliminar"
              className="px-2.5 py-2 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50 transition-colors flex items-center gap-1 text-sm">
              <Trash2 size={14} />
              <span>Eliminar</span>
            </button>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
          usuario.activo ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
        }`}>
          {usuario.activo ? 'Activo' : 'Inactivo'}
        </span>
        <span className="text-sm text-slate-500">
          {new Date(usuario.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      </div>
    </div>
  )
}

function SkeletonUsuarios() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex gap-3">
            <Skeleton className="h-12 w-12 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
            </div>
          </div>
          <div className="pt-2 border-t border-slate-100">
            <Skeleton className="h-4 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function UsuariosView() {
  const { perfil } = useAuthStore()
  const [modalAbierto,  setModalAbierto]  = useState(false)
  const [editando,      setEditando]      = useState(null)
  const [confirmCambio, setConfirmCambio] = useState(null)
  const [confirmBorrar, setConfirmBorrar] = useState(null)

  const { data: usuarios = [], isLoading, isError, refetch } = useUsuarios()
  const cambiarActivo = useCambiarActivoUsuario()
  const eliminar      = useEliminarUsuario()

  function abrirNuevo()   { setEditando(null); setModalAbierto(true) }
  function abrirEditar(u) { setEditando(u);    setModalAbierto(true) }
  function cerrarModal()  { setModalAbierto(false); setEditando(null) }

  async function confirmarCambioActivo() {
    if (!confirmCambio) return
    try {
      await cambiarActivo.mutateAsync({ id: confirmCambio.usuario.id, activo: confirmCambio.activo })
    } finally {
      setConfirmCambio(null)
    }
  }

  async function confirmarBorrar() {
    if (!confirmBorrar) return
    try {
      await eliminar.mutateAsync({ id: confirmBorrar.id })
    } finally {
      setConfirmBorrar(null)
    }
  }

  const activos   = usuarios.filter(u => u.activo)
  const inactivos = usuarios.filter(u => !u.activo)

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">

      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-sky-500 to-teal-400 shadow-sm">
            <UserCog size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800">Usuarios</h1>
            <p className="text-sm text-slate-500">
              {isLoading
                ? 'Cargando...'
                : `${activos.length} activo${activos.length !== 1 ? 's' : ''}${inactivos.length > 0 ? ` · ${inactivos.length} inactivo${inactivos.length !== 1 ? 's' : ''}` : ''}`
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button onClick={abrirNuevo}
            className="flex items-center gap-2 text-white font-black text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-sky-500/20 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #0EA5E9, #5EEAD4)' }}>
            <Plus size={16} />
            Nuevo usuario
          </button>
        </div>
      </div>

      {/* Contenido */}
      {isLoading ? (
        <SkeletonUsuarios />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center text-red-700">
          <p className="font-bold">Error al cargar usuarios</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : usuarios.length === 0 ? (
        <EmptyState icon={UserCog} title="No hay usuarios" description="Crea el primer usuario del sistema." actionLabel="Nuevo usuario" onAction={abrirNuevo} />
      ) : (
        <div className="space-y-6">
          {activos.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-black text-slate-500 uppercase tracking-widest">Activos</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {activos.map(u => (
                  <UsuarioCard key={u.id} usuario={u}
                    propio={u.id === perfil?.id}
                    onEditar={abrirEditar}
                    onCambiarActivo={(usuario, activo) => setConfirmCambio({ usuario, activo })}
                    onEliminar={setConfirmBorrar}
                  />
                ))}
              </div>
            </div>
          )}

          {inactivos.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-black text-slate-500 uppercase tracking-widest">Inactivos</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {inactivos.map(u => (
                  <UsuarioCard key={u.id} usuario={u}
                    propio={u.id === perfil?.id}
                    onEditar={abrirEditar}
                    onCambiarActivo={(usuario, activo) => setConfirmCambio({ usuario, activo })}
                    onEliminar={setConfirmBorrar}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {modalAbierto && <UsuarioModal usuario={editando} onClose={cerrarModal} />}

      <ConfirmModal
        isOpen={!!confirmCambio}
        onClose={() => setConfirmCambio(null)}
        onConfirm={confirmarCambioActivo}
        title={confirmCambio?.activo ? '¿Activar usuario?' : '¿Desactivar usuario?'}
        message={confirmCambio?.activo
          ? `"${confirmCambio?.usuario?.nombre}" podrá volver a iniciar sesión.`
          : `"${confirmCambio?.usuario?.nombre}" no podrá iniciar sesión.\nSus datos y cotizaciones se conservan.`}
        confirmText={confirmCambio?.activo ? 'Sí, activar' : 'Sí, desactivar'}
        variant={confirmCambio?.activo ? 'default' : 'danger'}
      />

      <ConfirmModal
        isOpen={!!confirmBorrar}
        onClose={() => setConfirmBorrar(null)}
        onConfirm={confirmarBorrar}
        title="¿Eliminar usuario?"
        message={`"${confirmBorrar?.nombre}" será eliminado permanentemente.\nEsta acción no se puede deshacer.`}
        confirmText="Sí, eliminar"
        variant="danger"
      />
    </div>
  )
}
