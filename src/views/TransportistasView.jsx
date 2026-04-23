// src/views/TransportistasView.jsx
// Gestión de transportistas — solo supervisores pueden crear/editar/desactivar
import { useState } from 'react'
import { Truck, Plus, Pencil, Ban, RefreshCw } from 'lucide-react'
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
import PageHeader  from '../components/ui/PageHeader'

// ─── Formulario ───────────────────────────────────────────────────────────────
function TransportistaForm({ inicial = {}, onGuardar, onCancelar, cargando }) {
  const [campos, setCampos] = useState({
    nombre:         inicial.nombre         ?? '',
    rif:            inicial.rif            ?? '',
    telefono:       inicial.telefono       ?? '',  // repurposed as "color"
    zona_cobertura: inicial.zona_cobertura ?? '',  // repurposed as "placa"
    vehiculo:       inicial.vehiculo       ?? '',
    placa_chuto:    inicial.placa_chuto    ?? '',
    placa_batea:    inicial.placa_batea    ?? '',
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
          <label className="text-sm font-medium text-slate-700">Cédula / RIF</label>
          <input value={campos.rif} onChange={e => cambiar('rif', e.target.value)}
            placeholder="V-00000000 / J-00000000-0" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Color</label>
          <input value={campos.telefono} onChange={e => cambiar('telefono', e.target.value)}
            placeholder="Ej: Rojo, Blanco" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Vehículo</label>
          <input value={campos.vehiculo} onChange={e => cambiar('vehiculo', e.target.value)}
            placeholder="Ej: Mack Granite 2020" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Placa</label>
          <input value={campos.zona_cobertura} onChange={e => cambiar('zona_cobertura', e.target.value)}
            placeholder="Ej: AB123CD" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Placa chuto</label>
          <input value={campos.placa_chuto} onChange={e => cambiar('placa_chuto', e.target.value)}
            placeholder="Ej: AB123CD" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Placa batea</label>
          <input value={campos.placa_batea} onChange={e => cambiar('placa_batea', e.target.value)}
            placeholder="Ej: XY456ZW" className={inputCls} disabled={cargando} />
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
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6 space-y-5">
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

// ─── Color determinista por nombre ────────────────────────────────────────────
const PALETA_TRANSP = [
  '#1B365D', '#065f46', '#7c3aed', '#be185d',
  '#0f766e', '#b45309', '#1d4ed8', '#92400e',
  '#0e7490', '#4f46e5', '#15803d', '#9a3412',
]
function colorTransportista(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff
  return PALETA_TRANSP[h % PALETA_TRANSP.length]
}

// ─── Tarjeta ──────────────────────────────────────────────────────────────────
function TransportistaCard({ transportista, esSupervisor, onEditar, onDesactivar }) {
  const color = colorTransportista(transportista.nombre)

  return (
    <div className="bg-white rounded-2xl border overflow-hidden flex flex-col hover:shadow-lg transition-all duration-200"
      style={{ borderColor: color + '30', boxShadow: `0 1px 3px ${color}10` }}>

      {/* ── Strip superior con color ── */}
      <div className="relative h-20 shrink-0 flex flex-col items-center justify-center gap-1"
        style={{ background: `linear-gradient(135deg, ${color}ee 0%, ${color}99 100%)` }}>
        {/* Dot pattern */}
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
        {/* Ícono camión */}
        <div className="relative z-10 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.4)', backdropFilter: 'blur(4px)' }}>
          <Truck size={20} color="white" />
        </div>
      </div>

      {/* ── Nombre + RIF ── */}
      <div className="px-4 pt-3 pb-1 text-center">
        <p className="font-black text-slate-800 text-sm leading-tight truncate">{transportista.nombre}</p>
        {transportista.rif && (
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">{transportista.rif}</p>
        )}
      </div>

      {/* ── Detalles ── */}
      <div className="px-4 pb-3 mt-1 space-y-1.5">
        {transportista.telefono && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-medium text-slate-400">Color:</span>
            <span>{transportista.telefono}</span>
          </div>
        )}
        {transportista.vehiculo && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Truck size={11} className="text-slate-400 shrink-0" />
            <span>{transportista.vehiculo}</span>
          </div>
        )}
        {(transportista.zona_cobertura || transportista.placa_chuto || transportista.placa_batea) && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
            {transportista.zona_cobertura && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{transportista.zona_cobertura}</span>}
            {transportista.placa_chuto && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">Chuto: {transportista.placa_chuto}</span>}
            {transportista.placa_batea && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">Batea: {transportista.placa_batea}</span>}
          </div>
        )}
      </div>

      {/* ── Acciones (solo supervisor) ── */}
      {esSupervisor && (
        <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-1">
          <button onClick={() => onEditar(transportista)} title="Editar"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
            <Pencil size={13} />
            Editar
          </button>
          <button onClick={() => onDesactivar(transportista)} title="Desactivar"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors ml-auto">
            <Ban size={13} />
            Eliminar
          </button>
        </div>
      )}
    </div>
  )
}

function SkeletonTransportistas() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
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
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* Encabezado */}
      <PageHeader
        icon={Truck}
        title="Transportistas"
        subtitle={isLoading ? 'Cargando...' : `${transportistas.length} activo${transportistas.length !== 1 ? 's' : ''}`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 rounded-xl transition-colors text-slate-400 hover:text-slate-700 hover:bg-slate-100">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            {esSupervisor && (
              <button onClick={abrirNuevo} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                <Plus size={16} />Nuevo transportista
              </button>
            )}
          </div>
        }
      />

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
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
