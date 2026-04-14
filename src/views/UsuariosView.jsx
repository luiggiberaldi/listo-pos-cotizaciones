// src/views/UsuariosView.jsx
// Gestión de usuarios — solo supervisores
import { useState } from 'react'
import { UserCog, Plus, Pencil, UserCheck, UserX, RefreshCw, ShieldCheck, User, Eye, EyeOff } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import {
  useUsuarios,
  useCrearUsuario,
  useActualizarUsuario,
  useCambiarActivoUsuario,
} from '../hooks/useUsuarios'
import { hasAdminKey } from '../services/supabase/adminClient'
import ConfirmModal from '../components/ui/ConfirmModal'
import Skeleton     from '../components/ui/Skeleton'
import EmptyState   from '../components/ui/EmptyState'

// ─── Formulario crear usuario ─────────────────────────────────────────────────
function FormCrear({ onGuardar, onCancelar, cargando }) {
  const [campos, setCampos] = useState({ email: '', nombre: '', password: '', rol: 'vendedor' })
  const [mostrarPass, setMostrarPass] = useState(false)
  const [error, setError] = useState('')

  function cambiar(k, v) { setCampos(p => ({ ...p, [k]: v })); setError('') }

  function submit(e) {
    e.preventDefault()
    if (!campos.email.trim())   { setError('El email es obligatorio'); return }
    if (!campos.nombre.trim())  { setError('El nombre es obligatorio'); return }
    if (campos.password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres'); return }
    onGuardar(campos)
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 placeholder:text-slate-400'

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Nombre completo *</label>
          <input value={campos.nombre} onChange={e => cambiar('nombre', e.target.value)}
            placeholder="Ej: María González" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Email *</label>
          <input type="email" value={campos.email} onChange={e => cambiar('email', e.target.value)}
            placeholder="vendedor@empresa.com" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Contraseña inicial *</label>
          <div className="relative">
            <input type={mostrarPass ? 'text' : 'password'}
              value={campos.password} onChange={e => cambiar('password', e.target.value)}
              placeholder="Mínimo 8 caracteres" className={`${inputCls} pr-10`} disabled={cargando} />
            <button type="button" onClick={() => setMostrarPass(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              {mostrarPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Rol</label>
          <select value={campos.rol} onChange={e => cambiar('rol', e.target.value)}
            className={inputCls} disabled={cargando}>
            <option value="vendedor">Vendedor</option>
            <option value="supervisor">Supervisor</option>
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
          {cargando ? 'Creando...' : 'Crear usuario'}
        </button>
      </div>
    </form>
  )
}

// ─── Formulario editar usuario ────────────────────────────────────────────────
function FormEditar({ usuario, onGuardar, onCancelar, cargando }) {
  const [campos, setCampos] = useState({ nombre: usuario.nombre, rol: usuario.rol })
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!campos.nombre.trim()) { setError('El nombre es obligatorio'); return }
    onGuardar(campos)
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400'

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Nombre</label>
          <input value={campos.nombre} onChange={e => setCampos(p => ({ ...p, nombre: e.target.value }))}
            className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Rol</label>
          <select value={campos.rol} onChange={e => setCampos(p => ({ ...p, rol: e.target.value }))}
            className={inputCls} disabled={cargando}>
            <option value="vendedor">Vendedor</option>
            <option value="supervisor">Supervisor</option>
          </select>
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50">
          {cargando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

// ─── Modal crear/editar ───────────────────────────────────────────────────────
function UsuarioModal({ usuario = null, onClose, errorExterno }) {
  const crear     = useCrearUsuario()
  const actualizar = useActualizarUsuario()
  const esEdicion  = !!usuario
  const [err, setErr] = useState('')

  async function guardar(campos) {
    setErr('')
    try {
      if (esEdicion) {
        await actualizar.mutateAsync({ id: usuario.id, ...campos })
      } else {
        await crear.mutateAsync(campos)
      }
      onClose()
    } catch (e) {
      setErr(e.message === 'NO_SERVICE_KEY'
        ? 'Falta VITE_SUPABASE_SERVICE_KEY en el .env para crear usuarios'
        : (e.message ?? 'Error al guardar'))
    }
  }

  const cargando = crear.isPending || actualizar.isPending

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
            <UserCog size={18} className="text-amber-600" />
          </div>
          <h3 className="font-bold text-slate-800 text-lg">
            {esEdicion ? 'Editar usuario' : 'Nuevo usuario'}
          </h3>
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        {esEdicion
          ? <FormEditar usuario={usuario} onGuardar={guardar} onCancelar={onClose} cargando={cargando} />
          : <FormCrear  onGuardar={guardar} onCancelar={onClose} cargando={cargando} />
        }
      </div>
    </div>
  )
}

// ─── Tarjeta de usuario ───────────────────────────────────────────────────────
function UsuarioCard({ usuario, propio, onEditar, onCambiarActivo }) {
  const esSupervisor = usuario.rol === 'supervisor'
  return (
    <div className={`bg-white rounded-2xl border transition-all p-4 flex flex-col gap-3 ${
      usuario.activo
        ? 'border-slate-200 hover:border-amber-200 hover:shadow-md'
        : 'border-slate-100 opacity-60'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
            esSupervisor ? 'bg-amber-100' : 'bg-slate-100'
          }`}>
            {esSupervisor
              ? <ShieldCheck size={16} className="text-amber-600" />
              : <User size={16} className="text-slate-500" />
            }
          </div>
          <div>
            <p className="font-bold text-slate-800 text-sm leading-tight">{usuario.nombre}</p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              esSupervisor
                ? 'bg-amber-50 text-amber-700'
                : 'bg-slate-100 text-slate-600'
            }`}>
              {esSupervisor ? 'Supervisor' : 'Vendedor'}
            </span>
          </div>
        </div>

        {!propio && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onEditar(usuario)} title="Editar"
              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors">
              <Pencil size={14} />
            </button>
            <button
              onClick={() => onCambiarActivo(usuario, !usuario.activo)}
              title={usuario.activo ? 'Desactivar' : 'Activar'}
              className={`p-1.5 rounded-lg transition-colors ${
                usuario.activo
                  ? 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                  : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50'
              }`}>
              {usuario.activo ? <UserX size={14} /> : <UserCheck size={14} />}
            </button>
          </div>
        )}
        {propio && (
          <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">Tú</span>
        )}
      </div>

      <div className="text-xs text-slate-500 truncate">{usuario.email}</div>

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          usuario.activo
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-slate-100 text-slate-400'
        }`}>
          {usuario.activo ? 'Activo' : 'Inactivo'}
        </span>
        <span className="text-xs text-slate-400">
          {new Date(usuario.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      </div>
    </div>
  )
}

function SkeletonUsuarios() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex gap-2.5">
            <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
            </div>
          </div>
          <Skeleton className="h-3 w-3/4 rounded" />
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
  const [modalAbierto,       setModalAbierto]       = useState(false)
  const [editando,           setEditando]           = useState(null)
  const [confirmCambio,      setConfirmCambio]      = useState(null) // { usuario, activo }

  const { data: usuarios = [], isLoading, isError, refetch } = useUsuarios()
  const cambiarActivo = useCambiarActivoUsuario()

  function abrirNuevo()   { setEditando(null); setModalAbierto(true) }
  function abrirEditar(u) { setEditando(u);    setModalAbierto(true) }
  function cerrarModal()  { setModalAbierto(false); setEditando(null) }

  async function confirmarCambioActivo() {
    if (!confirmCambio) return
    await cambiarActivo.mutateAsync({ id: confirmCambio.usuario.id, activo: confirmCambio.activo })
    setConfirmCambio(null)
  }

  // Separar activos e inactivos
  const activos   = usuarios.filter(u => u.activo)
  const inactivos = usuarios.filter(u => !u.activo)

  return (
    <div className="p-6 space-y-6 max-w-screen-xl">

      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
            <UserCog size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Usuarios</h1>
            <p className="text-sm text-slate-500">
              {isLoading ? 'Cargando...' : `${activos.length} activo${activos.length !== 1 ? 's' : ''}${inactivos.length > 0 ? ` · ${inactivos.length} inactivo${inactivos.length !== 1 ? 's' : ''}` : ''}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button onClick={abrirNuevo}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors shadow-sm">
            <Plus size={16} />
            Nuevo usuario
          </button>
        </div>
      </div>

      {/* Aviso si falta service key */}
      {!hasAdminKey && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-800">
          <strong>Para crear usuarios</strong> agrega <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_SERVICE_KEY</code> en el archivo <code className="bg-amber-100 px-1 rounded">.env</code> con el service role key de tu proyecto Supabase. Los usuarios existentes se pueden editar normalmente.
        </div>
      )}

      {/* Contenido */}
      {isLoading ? (
        <SkeletonUsuarios />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar usuarios</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : usuarios.length === 0 ? (
        <EmptyState icon={UserCog} title="No hay usuarios" description="Crea el primer usuario del sistema." actionLabel="Nuevo usuario" onAction={abrirNuevo} />
      ) : (
        <div className="space-y-6">
          {/* Activos */}
          <div className="space-y-3">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Activos</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {activos.map(u => (
                <UsuarioCard key={u.id} usuario={u}
                  propio={u.id === perfil?.id}
                  onEditar={abrirEditar}
                  onCambiarActivo={(usuario, activo) => setConfirmCambio({ usuario, activo })}
                />
              ))}
            </div>
          </div>

          {/* Inactivos */}
          {inactivos.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Inactivos</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {inactivos.map(u => (
                  <UsuarioCard key={u.id} usuario={u}
                    propio={u.id === perfil?.id}
                    onEditar={abrirEditar}
                    onCambiarActivo={(usuario, activo) => setConfirmCambio({ usuario, activo })}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modalAbierto && <UsuarioModal usuario={editando} onClose={cerrarModal} />}

      {/* Confirm cambio activo */}
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
    </div>
  )
}
