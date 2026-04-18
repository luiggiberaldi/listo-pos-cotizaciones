// src/views/AuditoriaView.jsx
// Historial de actividad del sistema — solo supervisor
// Vista estilo timeline con detalle expandible
import { useState, useEffect } from 'react'
import {
  ClipboardList, RefreshCw, ChevronLeft, ChevronRight, Filter,
  FileText, Users, Package, UserCog, ArrowRightLeft, Settings,
  Send, Ban, CheckCircle, XCircle, PenLine, PlusCircle, Trash2,
  Eye, GitBranch, Clock, ChevronDown, ChevronUp, DollarSign,
  User, Calendar, Hash, Info, Loader2,
} from 'lucide-react'
import { useAuditoria }  from '../hooks/useAuditoria'
import { useUsuarios }   from '../hooks/useUsuarios'
import supabase from '../services/supabase/client'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../utils/format'
import { useTasaCambio } from '../hooks/useTasaCambio'
import CustomSelect from '../components/ui/CustomSelect'
import Skeleton from '../components/ui/Skeleton'
import PageHeader from '../components/ui/PageHeader'

// ─── Configuración de categorías ────────────────────────────────────────────
const CATEGORIA_CONFIG = {
  cotizacion:   { icon: FileText,       bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200',   dot: 'bg-amber-400',   label: 'Cotización',   color: '#d97706' },
  cliente:      { icon: Users,          bg: 'bg-blue-50',    text: 'text-blue-600',     border: 'border-blue-200',    dot: 'bg-blue-400',    label: 'Cliente',      color: '#2563eb' },
  inventario:   { icon: Package,        bg: 'bg-emerald-50', text: 'text-emerald-600',  border: 'border-emerald-200', dot: 'bg-emerald-400', label: 'Inventario',   color: '#059669' },
  usuario:      { icon: UserCog,        bg: 'bg-purple-50',  text: 'text-purple-600',   border: 'border-purple-200',  dot: 'bg-purple-400',  label: 'Usuario',      color: '#9333ea' },
  reasignacion: { icon: ArrowRightLeft, bg: 'bg-orange-50',  text: 'text-orange-600',   border: 'border-orange-200',  dot: 'bg-orange-400',  label: 'Reasignación', color: '#ea580c' },
  sistema:      { icon: Settings,       bg: 'bg-slate-100',  text: 'text-slate-500',    border: 'border-slate-200',   dot: 'bg-slate-400',   label: 'Sistema',      color: '#64748b' },
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

// ─── Detalle de entidad (se muestra al expandir) ────────────────────────────
function DetalleEntidad({ tipo, id, tasa = 0 }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!tipo || !id) { setLoading(false); return }

    async function cargar() {
      try {
        let result = null

        if (tipo === 'cotizacion') {
          const { data: cot, error: e } = await supabase
            .from('cotizaciones')
            .select('id, numero, version, estado, total_usd, creado_en, valida_hasta, cliente_id, notas_cliente')
            .eq('id', id)
            .single()
          if (e) throw e

          // Cargar cliente
          let clienteNombre = null
          if (cot.cliente_id) {
            const { data: cli } = await supabase.from('clientes').select('nombre').eq('id', cot.cliente_id).single()
            clienteNombre = cli?.nombre
          }
          result = { ...cot, _tipo: 'cotizacion', _clienteNombre: clienteNombre }

        } else if (tipo === 'cliente') {
          const { data: cli, error: e } = await supabase
            .from('clientes')
            .select('id, nombre, rif_cedula, telefono, tipo_cliente, activo')
            .eq('id', id)
            .single()
          if (e) throw e
          result = { ...cli, _tipo: 'cliente' }

        } else if (tipo === 'producto') {
          const { data: prod, error: e } = await supabase
            .from('productos')
            .select('id, nombre, codigo, precio_usd, categoria, activo')
            .eq('id', id)
            .single()
          if (e) throw e
          result = { ...prod, _tipo: 'producto' }

        } else if (tipo === 'usuario') {
          const { data: usr, error: e } = await supabase
            .from('usuarios')
            .select('id, nombre, rol, activo')
            .eq('id', id)
            .single()
          if (e) throw e
          result = { ...usr, _tipo: 'usuario' }
        }

        setData(result)
      } catch (err) {
        setError('No se pudo cargar el detalle')
      } finally {
        setLoading(false)
      }
    }
    cargar()
  }, [tipo, id])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
        <Loader2 size={12} className="animate-spin" /> Cargando detalle...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-xs text-slate-400 py-2 flex items-center gap-1.5">
        <Info size={12} />
        {error || 'Sin datos adicionales para esta entidad'}
      </div>
    )
  }

  const ESTADO_COLORS = {
    borrador:  'bg-slate-100 text-slate-600',
    enviada:   'bg-blue-50 text-blue-700',
    aceptada:  'bg-emerald-50 text-emerald-700',
    rechazada: 'bg-red-50 text-red-700',
    vencida:   'bg-orange-50 text-orange-700',
    anulada:   'bg-slate-100 text-slate-400',
  }

  const ESTADO_LABELS = {
    borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada',
    rechazada: 'Rechazada', vencida: 'Vencida', anulada: 'Anulada',
  }

  // ── Render por tipo ──
  if (data._tipo === 'cotizacion') {
    const numDisplay = data.version > 1
      ? `COT-${String(data.numero).padStart(5, '0')} Rev.${data.version}`
      : `COT-${String(data.numero).padStart(5, '0')}`

    return (
      <div className="space-y-3">
        {/* Fila principal: número + estado + total */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <span className="font-bold text-slate-800 font-mono text-sm">{numDisplay}</span>
            <span className={`font-bold px-2 py-0.5 rounded-full text-[10px] ${ESTADO_COLORS[data.estado] ?? 'bg-slate-100 text-slate-500'}`}>
              {ESTADO_LABELS[data.estado] ?? data.estado}
            </span>
          </div>
          <div className="text-right">
            <span className="font-black text-slate-800 text-sm">{fmtUsd(data.total_usd)}</span>
            {tasa > 0 && data.total_usd > 0 && (
              <span className="text-[11px] text-slate-400 ml-1.5">({fmtBs(usdToBs(data.total_usd, tasa))})</span>
            )}
          </div>
        </div>

        {/* Detalles secundarios */}
        <div className="flex items-center gap-4 flex-wrap text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <User size={11} className="text-slate-400" />
            {data._clienteNombre ?? 'Sin cliente'}
          </span>
          <span className="flex items-center gap-1">
            <Calendar size={11} className="text-slate-400" />
            {fmtFecha(data.creado_en)}
          </span>
          {data.valida_hasta && (
            <span className="flex items-center gap-1">
              <Clock size={11} className="text-slate-400" />
              Válida hasta {fmtFecha(data.valida_hasta)}
            </span>
          )}
        </div>

        {data.notas_cliente && (
          <p className="text-xs text-slate-500 italic border-l-2 border-slate-200 pl-2">{data.notas_cliente}</p>
        )}
      </div>
    )
  }

  if (data._tipo === 'cliente') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="font-bold text-slate-800 text-sm">{data.nombre}</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${data.activo ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
            {data.activo ? 'Activo' : 'Inactivo'}
          </span>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-xs text-slate-500">
          {data.rif_cedula && (
            <span className="flex items-center gap-1">
              <Hash size={11} className="text-slate-400" />
              {data.rif_cedula}
            </span>
          )}
          {data.tipo_cliente && (
            <span className="flex items-center gap-1 capitalize">
              <Info size={11} className="text-slate-400" />
              {data.tipo_cliente}
            </span>
          )}
          {data.telefono && (
            <span className="flex items-center gap-1">
              <User size={11} className="text-slate-400" />
              {data.telefono}
            </span>
          )}
        </div>
      </div>
    )
  }

  if (data._tipo === 'producto') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 text-sm">{data.nombre}</span>
            {data.codigo && <span className="text-[10px] font-mono bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">{data.codigo}</span>}
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${data.activo ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
            {data.activo ? 'Activo' : 'Inactivo'}
          </span>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <DollarSign size={11} className="text-slate-400" />
            <strong className="text-slate-700">{fmtUsd(data.precio_usd)}</strong>
            {tasa > 0 && data.precio_usd > 0 && (
              <span className="text-slate-400">({fmtBs(usdToBs(data.precio_usd, tasa))})</span>
            )}
          </span>
          {data.categoria && (
            <span className="flex items-center gap-1">
              <Package size={11} className="text-slate-400" />
              {data.categoria}
            </span>
          )}
        </div>
      </div>
    )
  }

  if (data._tipo === 'usuario') {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800 text-sm">{data.nombre}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            data.rol === 'supervisor' ? 'bg-sky-100 text-sky-600' : 'bg-emerald-100 text-emerald-600'
          }`}>
            {data.rol === 'supervisor' ? 'Supervisor' : 'Vendedor'}
          </span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${data.activo ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
          {data.activo ? 'Activo' : 'Inactivo'}
        </span>
      </div>
    )
  }

  return null
}

// ─── Tarjeta de actividad (timeline item) — expandible ──────────────────────
function ActividadCard({ registro, tasa }) {
  const [expandido, setExpandido] = useState(false)

  const catKey = getCatKey(registro.categoria)
  const cat = CATEGORIA_CONFIG[catKey] ?? CATEGORIA_CONFIG.sistema
  const CatIcon = cat.icon
  const AccIcon = ACCION_ICON[registro.accion] ?? Clock
  const accionLabel = ACCION_LABEL[registro.accion] ?? registro.accion?.replace(/_/g, ' ').toLowerCase()
  const usuario = registro.usuario?.nombre ?? registro.usuario_nombre ?? 'Sistema'
  const rol = registro.usuario?.rol ?? registro.usuario_rol
  const tieneEntidad = registro.entidad_tipo && registro.entidad_id

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden transition-all flex items-stretch ${expandido ? 'shadow-md' : 'hover:shadow-sm'}`}
      style={{ borderColor: expandido ? cat.color + '50' : undefined }}>

      {/* Barra lateral de color */}
      <div className="w-1 shrink-0" style={{ background: cat.color }} />

      <div className="flex-1 min-w-0">
        {/* Contenido principal (siempre visible) */}
        <button
          onClick={() => setExpandido(!expandido)}
          className="w-full p-4 flex gap-4 items-start text-left"
        >
          {/* Icono de categoría */}
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: cat.color + '15', color: cat.color }}>
            <CatIcon size={18} />
          </div>

          {/* Contenido */}
          <div className="flex-1 min-w-0">
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

            <div className="flex items-center gap-1.5 mt-1">
              <AccIcon size={12} className="text-slate-400 shrink-0" />
              <span className="text-sm text-slate-600">{accionLabel}</span>
            </div>

            {registro.descripcion && (
              <p className="text-xs text-slate-400 mt-1.5 line-clamp-1">{registro.descripcion}</p>
            )}

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
                style={{ background: cat.color + '12', color: cat.color, borderColor: cat.color + '30' }}>
                {cat.label}
              </span>
              {tieneEntidad && (
                <span className="text-[10px] text-slate-400 font-mono">
                  #{registro.entidad_id.slice(0, 8)}
                </span>
              )}
            </div>
          </div>

          {/* Timestamp + flecha */}
          <div className="shrink-0 text-right flex flex-col items-end gap-2">
            <div>
              <p className="text-xs font-medium text-slate-400">{fmtFechaRelativa(registro.ts)}</p>
              <p className="text-[10px] text-slate-300 mt-0.5 hidden sm:block">{fmtFechaCompleta(registro.ts)}</p>
            </div>
            <div className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors"
              style={expandido
                ? { background: cat.color + '15', color: cat.color }
                : { background: '#f1f5f9', color: '#94a3b8' }}>
              {expandido ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </div>
        </button>

        {/* Panel expandible */}
        {expandido && (
          <div className="px-4 pb-4 pt-0 border-t border-slate-100 animate-fade-in">
            <div className="mt-3 space-y-3">

              {/* Descripción completa si existe */}
              {registro.descripcion && (
                <div className="rounded-xl px-3.5 py-2.5"
                  style={{ background: cat.color + '08', border: `1px solid ${cat.color}20` }}>
                  <p className="text-xs text-slate-600 leading-relaxed">{registro.descripcion}</p>
                </div>
              )}

              {/* Detalle de la entidad referenciada */}
              {tieneEntidad && (
                <div className="bg-slate-50 rounded-xl p-3.5">
                  <DetalleEntidad tipo={registro.entidad_tipo} id={registro.entidad_id} tasa={tasa} />
                </div>
              )}

              {!tieneEntidad && !registro.descripcion && (
                <div className="bg-slate-50 rounded-xl px-3.5 py-2.5">
                  <p className="text-xs text-slate-400 italic">No hay datos adicionales para esta acción.</p>
                </div>
              )}
            </div>
          </div>
        )}
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
  const { tasaEfectiva } = useTasaCambio()

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
      <PageHeader
        icon={ClipboardList}
        title="Auditoría"
        subtitle={isLoading ? 'Cargando...' : `${total.toLocaleString()} registro${total !== 1 ? 's' : ''} de actividad`}
        action={
          <button onClick={() => refetch()} className="p-2 rounded-xl transition-colors text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        }
      />

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
            <ActividadCard key={r.id} registro={r} tasa={tasaEfectiva} />
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
