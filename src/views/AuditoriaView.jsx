// src/views/AuditoriaView.jsx
// Historial de actividad del sistema — solo supervisor
// Vista estilo timeline para demo
import { useState } from 'react'
import {
  ClipboardList, RefreshCw, ChevronLeft, ChevronRight, Filter,
  FileText, Users, Package, UserCog, ArrowRightLeft, Settings,
  Send, Ban, CheckCircle, XCircle, PenLine, PlusCircle, Trash2,
  Eye, GitBranch, Clock,
} from 'lucide-react'
import { useAuditoria }  from '../hooks/useAuditoria'
import { useUsuarios }   from '../hooks/useUsuarios'
import CustomSelect from '../components/ui/CustomSelect'
import Skeleton from '../components/ui/Skeleton'

// ─── Configuración de categorías ────────────────────────────────────────────
const CATEGORIA_CONFIG = {
  cotizacion:   { icon: FileText,       bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200',   dot: 'bg-amber-400',   label: 'Cotización' },
  cliente:      { icon: Users,          bg: 'bg-blue-50',    text: 'text-blue-600',     border: 'border-blue-200',    dot: 'bg-blue-400',    label: 'Cliente' },
  inventario:   { icon: Package,        bg: 'bg-emerald-50', text: 'text-emerald-600',  border: 'border-emerald-200', dot: 'bg-emerald-400', label: 'Inventario' },
  usuario:      { icon: UserCog,        bg: 'bg-purple-50',  text: 'text-purple-600',   border: 'border-purple-200',  dot: 'bg-purple-400',  label: 'Usuario' },
  reasignacion: { icon: ArrowRightLeft, bg: 'bg-orange-50',  text: 'text-orange-600',   border: 'border-orange-200',  dot: 'bg-orange-400',  label: 'Reasignación' },
  sistema:      { icon: Settings,       bg: 'bg-slate-100',  text: 'text-slate-500',    border: 'border-slate-200',   dot: 'bg-slate-400',   label: 'Sistema' },
}

const CATEGORIAS_FILTRO = [
  { valor: '', label: 'Todas las categorías' },
  { valor: 'cotizacion',   label: 'Cotizaciones' },
  { valor: 'cliente',      label: 'Clientes' },
  { valor: 'inventario',   label: 'Inventario' },
  { valor: 'usuario',      label: 'Usuarios' },
  { valor: 'reasignacion', label: 'Reasignaciones' },
]

// ─── Mapeo de acciones a texto legible ──────────────────────────────────────
const ACCION_LABEL = {
  // Cotizaciones
  CREAR_COTIZACION:   'Creó una cotización',
  ENVIAR_COTIZACION:  'Envió una cotización',
  ANULAR_COTIZACION:  'Anuló una cotización',
  ACEPTAR_COTIZACION: 'Aceptó una cotización',
  RECHAZAR_COTIZACION:'Rechazó una cotización',
  VERSIONAR_COTIZACION:'Creó nueva versión de cotización',
  EDITAR_COTIZACION:  'Editó una cotización',
  // Clientes
  CREAR_CLIENTE:      'Registró un nuevo cliente',
  EDITAR_CLIENTE:     'Editó datos de un cliente',
  DESACTIVAR_CLIENTE: 'Desactivó un cliente',
  // Inventario
  CREAR_PRODUCTO:     'Agregó un nuevo producto',
  EDITAR_PRODUCTO:    'Editó un producto',
  DESACTIVAR_PRODUCTO:'Desactivó un producto',
  // Usuarios
  CREAR_USUARIO:      'Creó un nuevo usuario',
  EDITAR_USUARIO:     'Editó un usuario',
  DESACTIVAR_USUARIO: 'Desactivó un usuario',
  // Reasignación
  REASIGNAR_CLIENTE:  'Reasignó un cliente',
  REASIGNAR_CARTERA:  'Reasignó cartera de clientes',
  // Otros
  LOGIN:              'Inició sesión',
  LOGOUT:             'Cerró sesión',
  CAMBIAR_CONFIG:     'Modificó configuración del negocio',
}

const ACCION_ICON = {
  CREAR_COTIZACION:    PlusCircle,
  ENVIAR_COTIZACION:   Send,
  ANULAR_COTIZACION:   Ban,
  ACEPTAR_COTIZACION:  CheckCircle,
  RECHAZAR_COTIZACION: XCircle,
  VERSIONAR_COTIZACION:GitBranch,
  EDITAR_COTIZACION:   PenLine,
  CREAR_CLIENTE:       PlusCircle,
  EDITAR_CLIENTE:      PenLine,
  DESACTIVAR_CLIENTE:  Trash2,
  CREAR_PRODUCTO:      PlusCircle,
  EDITAR_PRODUCTO:     PenLine,
  DESACTIVAR_PRODUCTO: Trash2,
  CREAR_USUARIO:       PlusCircle,
  EDITAR_USUARIO:      PenLine,
  DESACTIVAR_USUARIO:  Trash2,
  REASIGNAR_CLIENTE:   ArrowRightLeft,
  REASIGNAR_CARTERA:   ArrowRightLeft,
  LOGIN:               Eye,
  LOGOUT:              Eye,
  CAMBIAR_CONFIG:      Settings,
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function getCatKey(cat) {
  return (cat || 'sistema').toLowerCase()
}

function fmtFechaRelativa(f) {
  if (!f) return '—'
  const d = new Date(f)
  const ahora = new Date()
  const diffMs = ahora - d
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'Ahora mismo'
  if (diffMin < 60) return `Hace ${diffMin} min`
  if (diffH < 24) return `Hace ${diffH}h`
  if (diffD < 7) return `Hace ${diffD} día${diffD > 1 ? 's' : ''}`

  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtFechaCompleta(f) {
  if (!f) return ''
  const d = new Date(f)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}

// ─── Skeleton ───────────────────────────────────────────────────────────────
function SkeletonAuditoria() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 flex gap-4 items-start">
          <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5 rounded" />
            <Skeleton className="h-3 w-3/4 rounded" />
          </div>
          <Skeleton className="h-3 w-20 rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── Tarjeta de actividad (timeline item) ───────────────────────────────────
function ActividadCard({ registro }) {
  const catKey = getCatKey(registro.categoria)
  const cat = CATEGORIA_CONFIG[catKey] ?? CATEGORIA_CONFIG.sistema
  const CatIcon = cat.icon
  const AccIcon = ACCION_ICON[registro.accion] ?? Clock
  const accionLabel = ACCION_LABEL[registro.accion] ?? registro.accion?.replace(/_/g, ' ').toLowerCase()
  const usuario = registro.usuario?.nombre ?? registro.usuario_nombre ?? 'Sistema'
  const rol = registro.usuario?.rol ?? registro.usuario_rol

  return (
    <div className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all p-4 flex gap-4 items-start group">

      {/* Icono de categoría */}
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cat.bg} ${cat.text}`}>
        <CatIcon size={18} />
      </div>

      {/* Contenido */}
      <div className="flex-1 min-w-0">
        {/* Acción principal */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-800">{usuario}</span>
          {rol && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              rol === 'supervisor' ? 'bg-sky-100 text-sky-600' : 'bg-emerald-100 text-emerald-600'
            }`}>
              {rol === 'supervisor' ? 'Supervisor' : 'Vendedor'}
            </span>
          )}
        </div>

        {/* Descripción de la acción */}
        <div className="flex items-center gap-1.5 mt-1">
          <AccIcon size={12} className="text-slate-400 shrink-0" />
          <span className="text-sm text-slate-600">{accionLabel}</span>
        </div>

        {/* Descripción adicional si existe */}
        {registro.descripcion && (
          <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">{registro.descripcion}</p>
        )}

        {/* Badges: categoría + entidad */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cat.bg} ${cat.text} ${cat.border}`}>
            {cat.label}
          </span>
          {registro.entidad_tipo && registro.entidad_id && (
            <span className="text-[10px] text-slate-400 font-mono">
              #{registro.entidad_id.slice(0, 8)}
            </span>
          )}
        </div>
      </div>

      {/* Timestamp */}
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium text-slate-400">{fmtFechaRelativa(registro.ts)}</p>
        <p className="text-[10px] text-slate-300 mt-0.5 hidden sm:block">{fmtFechaCompleta(registro.ts)}</p>
      </div>
    </div>
  )
}

// ─── Vista principal ────────────────────────────────────────────────────────
const POR_PAGINA = 30

export default function AuditoriaView() {
  const [pagina,     setPagina]     = useState(0)
  const [usuarioId,  setUsuarioId]  = useState('')
  const [categoria,  setCategoria]  = useState('')

  const { data, isLoading, isError, refetch } = useAuditoria({ pagina, porPagina: POR_PAGINA, usuarioId, categoria })
  const { data: usuarios = [] } = useUsuarios()

  const registros = data?.registros ?? []
  const total     = data?.total ?? 0
  const totalPags = Math.max(1, Math.ceil(total / POR_PAGINA))

  function cambiarFiltro(fn) {
    fn()
    setPagina(0)
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">

      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-light rounded-xl flex items-center justify-center">
            <ClipboardList size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Auditoría</h1>
            <p className="text-sm text-slate-500">
              {isLoading ? 'Cargando...' : `${total.toLocaleString()} registro${total !== 1 ? 's' : ''} de actividad`}
            </p>
          </div>
        </div>
        <button onClick={() => refetch()}
          className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors self-start sm:self-auto">
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <Filter size={14} className="text-slate-400 shrink-0" />
        <div className="min-w-[180px]">
          <CustomSelect
            options={CATEGORIAS_FILTRO.map(({ valor, label }) => ({ value: valor, label }))}
            value={categoria}
            onChange={val => cambiarFiltro(() => setCategoria(val))}
            placeholder="Todas las categorías"
            searchable={false}
          />
        </div>
        <div className="min-w-[180px]">
          <CustomSelect
            options={[
              { value: '', label: 'Todos los usuarios' },
              ...usuarios.map(u => ({ value: u.id, label: u.nombre })),
            ]}
            value={usuarioId}
            onChange={val => cambiarFiltro(() => setUsuarioId(val))}
            placeholder="Todos los usuarios"
          />
        </div>
        {(categoria || usuarioId) && (
          <button onClick={() => { setCategoria(''); setUsuarioId(''); setPagina(0) }}
            className="text-xs text-slate-500 hover:text-slate-800 underline">
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Timeline de actividad */}
      {isLoading ? (
        <SkeletonAuditoria />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar registros</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : registros.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
          <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin actividad registrada</p>
          <p className="text-sm mt-1">No hay registros que coincidan con los filtros.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {registros.map(r => (
            <ActividadCard key={r.id} registro={r} />
          ))}
        </div>
      )}

      {/* Paginación */}
      {!isLoading && totalPags > 1 && (
        <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-200 px-5 py-3">
          <span className="text-sm text-slate-500">
            Página <strong>{pagina + 1}</strong> de <strong>{totalPags}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPagina(p => p - 1)} disabled={pagina === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors">
              <ChevronLeft size={14} /> Anterior
            </button>
            <button onClick={() => setPagina(p => p + 1)} disabled={pagina >= totalPags - 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors">
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
