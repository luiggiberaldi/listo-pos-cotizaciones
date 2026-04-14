// src/views/TransportistasView.jsx
// Gestión de transportistas — solo supervisores pueden crear/editar/desactivar
import { useState } from 'react'
import { Truck, Plus, Pencil, Ban, RefreshCw, MapPin, Phone, DollarSign } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import {
  useTransportistas,
  useCrearTransportista,
  useActualizarTransportista,
  useDesactivarTransportista,
} from '../hooks/useTransportistas'
import ConfirmModal from '../components/ui/ConfirmModal'
import Skeleton     from '../components/ui/Skeleton'
import EmptyState   from '../components/ui/EmptyState'

// ─── Formulario ───────────────────────────────────────────────────────────────
function TransportistaForm({ inicial = {}, onGuardar, onCancelar, cargando }) {
  const [campos, setCampos] = useState({
    nombre:         inicial.nombre         ?? '',
    rif:            inicial.rif            ?? '',
    telefono:       inicial.telefono       ?? '',
    zona_cobertura: inicial.zona_cobertura ?? '',
    tarifa_base:    inicial.tarifa_base    ?? '',
  })
  const [error, setError] = useState('')

  function cambiar(campo, valor) {
    setCampos(prev => ({ ...prev, [campo]: valor }))
    setError('')
  }

  function submit(e) {
    e.preventDefault()
    if (!campos.nombre.trim()) { setError('El nombre es obligatorio'); return }
    onGuardar(campos)
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400'

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Nombre *</label>
          <input value={campos.nombre} onChange={e => cambiar('nombre', e.target.value)}
            placeholder="Nombre del transportista" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">RIF</label>
          <input value={campos.rif} onChange={e => cambiar('rif', e.target.value)}
            placeholder="J-00000000-0" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Teléfono</label>
          <input value={campos.telefono} onChange={e => cambiar('telefono', e.target.value)}
            placeholder="0414-000-0000" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Zona de cobertura</label>
          <input value={campos.zona_cobertura} onChange={e => cambiar('zona_cobertura', e.target.value)}
            placeholder="Ej: Caracas y Miranda" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Tarifa base (USD)</label>
          <input type="number" min="0" step="0.01"
            value={campos.tarifa_base} onChange={e => cambiar('tarifa_base', e.target.value)}
            placeholder="0.00" className={inputCls} disabled={cargando} />
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-colors disabled:opacity-50">
          {cargando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

// ─── Modal crear/editar ───────────────────────────────────────────────────────
function TransportistaModal({ transportista = null, onClose }) {
  const crear     = useCrearTransportista()
  const actualizar = useActualizarTransportista()
  const esEdicion  = !!transportista
  const [error, setError] = useState('')

  async function guardar(campos) {
    setError('')
    try {
      if (esEdicion) {
        await actualizar.mutateAsync({ id: transportista.id, campos })
      } else {
        await crear.mutateAsync(campos)
      }
      onClose()
    } catch (e) {
      setError(e.message ?? 'Error al guardar')
    }
  }

  const cargando = crear.isPending || actualizar.isPending

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary-light rounded-xl flex items-center justify-center">
            <Truck size={18} className="text-primary" />
          </div>
          <h3 className="font-bold text-slate-800 text-lg">
            {esEdicion ? 'Editar transportista' : 'Nuevo transportista'}
          </h3>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <TransportistaForm
          inicial={transportista ?? {}}
          onGuardar={guardar}
          onCancelar={onClose}
          cargando={cargando}
        />
      </div>
    </div>
  )
}

// ─── Tarjeta ──────────────────────────────────────────────────────────────────
function TransportistaCard({ transportista, esSupervisor, onEditar, onDesactivar }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 hover:border-primary-light hover:shadow-md transition-all p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-primary-light rounded-xl flex items-center justify-center shrink-0">
            <Truck size={16} className="text-primary" />
          </div>
          <div>
            <p className="font-bold text-slate-800 text-sm leading-tight">{transportista.nombre}</p>
            {transportista.rif && (
              <p className="text-xs text-slate-400 font-mono">{transportista.rif}</p>
            )}
          </div>
        </div>

        {esSupervisor && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onEditar(transportista)} title="Editar"
              className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-light transition-colors">
              <Pencil size={14} />
            </button>
            <button onClick={() => onDesactivar(transportista)} title="Desactivar"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <Ban size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {transportista.telefono && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Phone size={11} className="text-slate-400 shrink-0" />
            <span>{transportista.telefono}</span>
          </div>
        )}
        {transportista.zona_cobertura && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <MapPin size={11} className="text-slate-400 shrink-0" />
            <span>{transportista.zona_cobertura}</span>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs text-slate-400">Tarifa base</span>
        <div className="flex items-center gap-1">
          <DollarSign size={11} className="text-slate-400" />
          <span className="font-bold text-slate-800 text-sm">
            {Number(transportista.tarifa_base || 0).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}

function SkeletonTransportistas() {
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
export default function TransportistasView() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  const [modalAbierto,          setModalAbierto]          = useState(false)
  const [editando,              setEditando]              = useState(null)
  const [desactivandoTransp,    setDesactivandoTransp]    = useState(null)

  const { data: transportistas = [], isLoading, isError, refetch } =
    useTransportistas({ soloActivos: true })
  const desactivar = useDesactivarTransportista()

  function abrirNuevo() { setEditando(null); setModalAbierto(true) }
  function abrirEditar(t) { setEditando(t); setModalAbierto(true) }
  function cerrarModal() { setModalAbierto(false); setEditando(null) }

  async function confirmarDesactivar() {
    if (!desactivandoTransp) return
    try {
      await desactivar.mutateAsync(desactivandoTransp.id)
    } finally {
      setDesactivandoTransp(null)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-screen-xl">

      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-light rounded-xl flex items-center justify-center">
            <Truck size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Transportistas</h1>
            <p className="text-sm text-slate-500">
              {isLoading ? 'Cargando...' : `${transportistas.length} activo${transportistas.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => refetch()}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          {esSupervisor && (
            <button onClick={abrirNuevo}
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors shadow-sm">
              <Plus size={16} />
              Nuevo transportista
            </button>
          )}
        </div>
      </div>

      {/* Contenido */}
      {isLoading ? (
        <SkeletonTransportistas />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar transportistas</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : transportistas.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No hay transportistas registrados"
          description={esSupervisor ? 'Agrega el primer transportista.' : 'El supervisor aún no ha registrado transportistas.'}
          actionLabel={esSupervisor ? 'Nuevo transportista' : undefined}
          onAction={esSupervisor ? abrirNuevo : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {transportistas.map(t => (
            <TransportistaCard
              key={t.id}
              transportista={t}
              esSupervisor={esSupervisor}
              onEditar={abrirEditar}
              onDesactivar={setDesactivandoTransp}
            />
          ))}
        </div>
      )}

      {/* Modal crear/editar */}
      {modalAbierto && (
        <TransportistaModal
          transportista={editando}
          onClose={cerrarModal}
        />
      )}

      {/* Confirm desactivar */}
      <ConfirmModal
        isOpen={!!desactivandoTransp}
        onClose={() => setDesactivandoTransp(null)}
        onConfirm={confirmarDesactivar}
        title="¿Desactivar transportista?"
        message={`"${desactivandoTransp?.nombre}" dejará de aparecer en nuevas cotizaciones.\nEsta acción se puede revertir manualmente desde la base de datos.`}
        confirmText="Sí, desactivar"
        variant="danger"
      />
    </div>
  )
}
