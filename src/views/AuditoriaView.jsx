// src/views/AuditoriaView.jsx
// Historial de actividad del sistema — solo supervisor
// Vista mejorada con agrupación por fecha, resumen, búsqueda y filtros rápidos
import { useState, useEffect, useMemo } from 'react'
import {
  ClipboardList, RefreshCw, ChevronLeft, ChevronRight, Filter,
  FileText, Users, Package, UserCog, ArrowRightLeft, Settings,
  Send, Ban, CheckCircle, XCircle, PenLine, PlusCircle, Trash2,
  Eye, GitBranch, Clock, ChevronDown, ChevronUp, DollarSign,
  User, Calendar, Hash, Info, Loader2, Search, TrendingUp,
  Activity, CalendarDays, X, Copy, Check, Printer, Download
} from 'lucide-react'
import { useAuditoria }  from '../hooks/useAuditoria'
import { useUsuarios }   from '../hooks/useUsuarios'
import supabase from '../services/supabase/client'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs, removeAccents } from '../utils/format'
import { useTasaCambio } from '../hooks/useTasaCambio'
import CustomSelect from '../components/ui/CustomSelect'
import Skeleton from '../components/ui/Skeleton'
import PageHeader from '../components/ui/PageHeader'
import { showToast } from '../components/ui/Toast'
import useAuthStore from '../store/useAuthStore'
import { authFetch } from '../services/authFetch'

// ─── Configuración de categorías ────────────────────────────────────────────
const CATEGORIA_CONFIG = {
  cotizacion:     { icon: FileText,       bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200',   dot: 'bg-amber-400',   label: 'Cotización',     color: '#d97706' },
  cliente:        { icon: Users,          bg: 'bg-blue-50',    text: 'text-blue-600',     border: 'border-blue-200',    dot: 'bg-blue-400',    label: 'Cliente',        color: '#2563eb' },
  inventario:     { icon: Package,        bg: 'bg-emerald-50', text: 'text-emerald-600',  border: 'border-emerald-200', dot: 'bg-emerald-400', label: 'Inventario',     color: '#059669' },
  usuario:        { icon: UserCog,        bg: 'bg-purple-50',  text: 'text-purple-600',   border: 'border-purple-200',  dot: 'bg-purple-400',  label: 'Usuario',        color: '#9333ea' },
  reasignacion:   { icon: ArrowRightLeft, bg: 'bg-orange-50',  text: 'text-orange-600',   border: 'border-orange-200',  dot: 'bg-orange-400',  label: 'Reasignación',   color: '#ea580c' },
  configuracion:  { icon: Settings,       bg: 'bg-indigo-50',  text: 'text-indigo-600',   border: 'border-indigo-200',  dot: 'bg-indigo-400',  label: 'Configuración',  color: '#4f46e5' },
  auth:           { icon: Eye,            bg: 'bg-cyan-50',    text: 'text-cyan-600',     border: 'border-cyan-200',    dot: 'bg-cyan-400',    label: 'Autenticación',  color: '#0891b2' },
  sistema:        { icon: Settings,       bg: 'bg-slate-100',  text: 'text-slate-500',    border: 'border-slate-200',   dot: 'bg-slate-400',   label: 'Sistema',        color: '#64748b' },
}

const CATEGORIAS_FILTRO = [
  { valor: '', label: 'Todas las categorías' },
  { valor: 'cotizacion',    label: 'Cotizaciones' },
  { valor: 'cliente',       label: 'Clientes' },
  { valor: 'inventario',    label: 'Inventario' },
  { valor: 'usuario',       label: 'Usuarios' },
  { valor: 'reasignacion',  label: 'Reasignaciones' },
  { valor: 'configuracion', label: 'Configuración' },
  { valor: 'auth',          label: 'Autenticación' },
]

// ─── Mapeo de acciones a texto legible ──────────────────────────────────────
const ACCION_LABEL = {
  CREAR_COTIZACION:     'Creó una cotización',
  ENVIAR_COTIZACION:    'Envió una cotización',
  ANULAR_COTIZACION:    'Anuló una cotización',
  ACEPTAR_COTIZACION:   'Aceptó una cotización',
  RECHAZAR_COTIZACION:  'Rechazó una cotización',
  VERSIONAR_COTIZACION: 'Creó nueva versión de cotización',
  EDITAR_COTIZACION:    'Editó una cotización',
  CREAR_CLIENTE:        'Registró un nuevo cliente',
  EDITAR_CLIENTE:       'Editó datos de un cliente',
  DESACTIVAR_CLIENTE:   'Desactivó un cliente',
  CREAR_PRODUCTO:       'Agregó un nuevo producto',
  EDITAR_PRODUCTO:      'Editó un producto',
  DESACTIVAR_PRODUCTO:  'Desactivó un producto',
  CREAR_USUARIO:        'Creó un nuevo usuario',
  EDITAR_USUARIO:       'Editó un usuario',
  DESACTIVAR_USUARIO:   'Desactivó un usuario',
  REASIGNAR_CLIENTE:    'Reasignó un cliente',
  REASIGNAR_CARTERA:    'Reasignó cartera de clientes',
  LOGIN:                'Inició sesión',
  LOGOUT:               'Cerró sesión',
  CAMBIAR_CONFIG:       'Modificó configuración del negocio',
  PAGAR_COMISION:       'Marcó comisión como pagada',
  CREAR_DESPACHO:       'Creó una nota de despacho',
  ACTUALIZAR_DESPACHO:  'Actualizó estado de despacho',
}

const ACCION_ICON = {
  CREAR_COTIZACION:     PlusCircle,
  ENVIAR_COTIZACION:    Send,
  ANULAR_COTIZACION:    Ban,
  ACEPTAR_COTIZACION:   CheckCircle,
  RECHAZAR_COTIZACION:  XCircle,
  VERSIONAR_COTIZACION: GitBranch,
  EDITAR_COTIZACION:    PenLine,
  CREAR_CLIENTE:        PlusCircle,
  EDITAR_CLIENTE:       PenLine,
  DESACTIVAR_CLIENTE:   Trash2,
  CREAR_PRODUCTO:       PlusCircle,
  EDITAR_PRODUCTO:      PenLine,
  DESACTIVAR_PRODUCTO:  Trash2,
  CREAR_USUARIO:        PlusCircle,
  EDITAR_USUARIO:       PenLine,
  DESACTIVAR_USUARIO:   Trash2,
  REASIGNAR_CLIENTE:    ArrowRightLeft,
  REASIGNAR_CARTERA:    ArrowRightLeft,
  LOGIN:                Eye,
  LOGOUT:               Eye,
  CAMBIAR_CONFIG:       Settings,
  PAGAR_COMISION:       DollarSign,
  CREAR_DESPACHO:       PlusCircle,
  ACTUALIZAR_DESPACHO:  CheckCircle,
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const ROLE_CONFIG = {
  desarrollador:  { label: 'Desarrollador', short: 'DEV', bg: 'bg-purple-100 text-purple-700 border border-purple-200' },
  jefe:           { label: 'Jefe',          short: 'JEFE', bg: 'bg-amber-100 text-amber-700 border border-amber-200' },
  supervisor:     { label: 'Jefe de Ventas',short: 'J.VENTAS', bg: 'bg-sky-100 text-sky-700 border border-sky-200' },
  administracion: { label: 'Administración',short: 'ADMIN', bg: 'bg-blue-100 text-blue-700 border border-blue-200' },
  logistica:      { label: 'Logística',     short: 'LOG', bg: 'bg-slate-100 text-slate-700 border border-slate-200' },
  vendedor:       { label: 'Vendedor',      short: 'VEN', bg: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
}

function getRoleBadge(rol, isShort = false) {
  if (!rol) return null
  const cleanRol = String(rol).toLowerCase()
  const conf = ROLE_CONFIG[cleanRol] || {
    label: rol.toUpperCase(),
    short: rol.substring(0, 3).toUpperCase(),
    bg: 'bg-slate-100 text-slate-700 border border-slate-200'
  }

  return (
    <span className={`${isShort ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'} font-bold rounded-full leading-none shrink-0 ${conf.bg}`}>
      {isShort ? conf.short : conf.label}
    </span>
  )
}

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

  if (diffMin < 1) return 'Ahora'
  if (diffMin < 60) return `${diffMin}m`
  if (diffH < 24) return `${diffH}h`
  if (diffD < 7) return `${diffD}d`

  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
}

function fmtHora(f) {
  if (!f) return ''
  return new Date(f).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}

function getDateGroupLabel(dateStr) {
  const d = new Date(dateStr)
  const hoy = new Date()
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)

  if (d.toDateString() === hoy.toDateString()) return 'Hoy'
  if (d.toDateString() === ayer.toDateString()) return 'Ayer'
  return d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function getDateKey(dateStr) {
  return new Date(dateStr).toDateString()
}

// ─── Renderizar meta data legible ───────────────────────────────────────────
function MetaDisplay({ meta }) {
  if (!meta || typeof meta !== 'object' || Object.keys(meta).length === 0) return null

  const LABEL_MAP = {
    numero: 'Nº', version: 'Versión', estado: 'Estado', total_usd: 'Total USD',
    cliente_nombre: 'Cliente', vendedor_nombre: 'Vendedor', estado_anterior: 'Estado anterior',
    estado_nuevo: 'Nuevo estado', total_comision: 'Comisión', motivo: 'Motivo',
    nombre: 'Nombre', rol: 'Rol', cantidad: 'Cantidad', codigo: 'Código',
    categoria: 'Categoría', precio_usd: 'Precio USD', de_vendedor: 'De vendedor',
    a_vendedor: 'A vendedor', clientes_afectados: 'Clientes afectados',
    cotizacion_id: null, despacho_id: null, vendedor_id: null, producto_id: null, cliente_id: null,
  }

  const entries = Object.entries(meta).filter(([k, v]) => {
    if (LABEL_MAP[k] === null) return false // skip IDs
    if (v === null || v === undefined || v === '') return false
    return true
  })

  if (entries.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {entries.map(([k, v]) => {
        const label = LABEL_MAP[k] || k.replace(/_/g, ' ')
        let display = v
        if (typeof v === 'number' && (k.includes('usd') || k.includes('comision') || k.includes('precio')))
          display = fmtUsd(v)
        else if (typeof v === 'boolean')
          display = v ? 'Sí' : 'No'

        return (
          <span key={k} className="text-xs text-slate-500">
            <span className="text-slate-400 capitalize">{label}:</span>{' '}
            <span className="font-medium text-slate-700">{String(display)}</span>
          </span>
        )
      })}
    </div>
  )
}

// ─── Skeleton ───────────────────────────────────────────────────────────────
function SkeletonAuditoria() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-slate-200 p-3.5 flex gap-3 items-center">
          <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5 rounded" />
            <Skeleton className="h-3 w-3/5 rounded" />
          </div>
          <Skeleton className="h-3 w-12 rounded" />
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
            .select('id, numero, version, estado, total_usd, creado_en, cliente_id, notas_cliente')
            .eq('id', id)
            .single()
          if (e) throw e

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
      <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
        <Loader2 size={12} className="animate-spin" /> Cargando...
      </div>
    )
  }

  if (error || !data) return null

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

  if (data._tipo === 'cotizacion') {
    const numDisplay = `#${data.numero}`

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 font-mono text-xs">{numDisplay}</span>
            <span className={`font-bold px-2 py-0.5 rounded-full text-[10px] ${ESTADO_COLORS[data.estado] ?? 'bg-slate-100 text-slate-500'}`}>
              {ESTADO_LABELS[data.estado] ?? data.estado}
            </span>
          </div>
          <div className="text-right">
            <span className="font-black text-slate-800 text-xs">{fmtUsd(data.total_usd)}</span>
            {tasa > 0 && data.total_usd > 0 && (
              <span className="text-[11px] text-slate-400 ml-1">({fmtBs(usdToBs(data.total_usd, tasa))})</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
          {data._clienteNombre && (
            <span className="flex items-center gap-1">
              <User size={10} className="text-slate-400" />
              {data._clienteNombre}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar size={10} className="text-slate-400" />
            {fmtFecha(data.creado_en)}
          </span>
        </div>
      </div>
    )
  }

  if (data._tipo === 'cliente') {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800 text-xs">{data.nombre}</span>
          {data.rif_cedula && <span className="text-[10px] text-slate-400 font-mono">{data.rif_cedula}</span>}
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${data.activo ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
          {data.activo ? 'Activo' : 'Inactivo'}
        </span>
      </div>
    )
  }

  if (data._tipo === 'producto') {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800 text-xs">{data.nombre}</span>
          {data.codigo && <span className="text-[10px] font-mono bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">{data.codigo}</span>}
        </div>
        <span className="font-bold text-xs text-slate-700">{fmtUsd(data.precio_usd)}</span>
      </div>
    )
  }

  if (data._tipo === 'usuario') {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800 text-xs">{data.nombre}</span>
          {getRoleBadge(data.rol, false)}
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${data.activo ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
          {data.activo ? 'Activo' : 'Inactivo'}
        </span>
      </div>
    )
  }

  return null
}

// ─── Tarjeta de actividad compacta ──────────────────────────────────────────
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
  const tieneMeta = registro.meta && typeof registro.meta === 'object' && Object.keys(registro.meta).length > 0
  const tieneDetalle = tieneEntidad || tieneMeta || registro.descripcion

  return (
    <div className={`bg-white rounded-xl border transition-all duration-200 ${expandido ? 'shadow-md border-slate-300' : 'border-slate-200 hover:border-slate-300'}`}>
      <button
        onClick={() => tieneDetalle && setExpandido(!expandido)}
        className={`w-full flex items-center gap-3 p-3 sm:p-3.5 text-left ${tieneDetalle ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {/* Icono circular con color de categoría */}
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 relative"
          style={{ background: cat.color + '12', color: cat.color }}>
          <CatIcon size={16} />
        </div>

        {/* Contenido principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-slate-800 truncate">{usuario}</span>
            {rol && getRoleBadge(rol, true)}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <AccIcon size={11} className="text-slate-400 shrink-0" />
            <span className="text-xs text-slate-600 truncate">{accionLabel}</span>
          </div>
        </div>

        {/* Hora + indicador */}
        <div className="shrink-0 flex items-center gap-2">
          <div className="text-right">
            <p className="text-xs font-medium text-slate-500">{fmtHora(registro.ts)}</p>
            <p className="text-[10px] text-slate-300 hidden sm:block">{fmtFechaRelativa(registro.ts)}</p>
          </div>
          {tieneDetalle && (
            <div className="w-5 h-5 rounded-md flex items-center justify-center transition-colors"
              style={expandido
                ? { background: cat.color + '15', color: cat.color }
                : { color: '#cbd5e1' }}>
              {expandido ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </div>
          )}
        </div>
      </button>

      {/* Panel expandible */}
      {expandido && (
        <div className="px-3.5 pb-3.5 pt-0 space-y-2.5 animate-fade-in">
          <div className="border-t border-slate-100 pt-2.5 space-y-2.5">

            {/* Descripción */}
            {registro.descripcion && (
              <div className="rounded-lg px-3 py-2 text-xs text-slate-600 leading-relaxed"
                style={{ background: cat.color + '06', border: `1px solid ${cat.color}15` }}>
                {registro.descripcion}
              </div>
            )}

            {/* Meta data */}
            {tieneMeta && (
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <MetaDisplay meta={registro.meta} />
              </div>
            )}

            {/* Detalle de la entidad */}
            {tieneEntidad && (
              <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                <DetalleEntidad tipo={registro.entidad_tipo} id={registro.entidad_id} tasa={tasa} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Resumen cards ──────────────────────────────────────────────────────────
function ResumenCard({ icon: Icon, label, value, gradient, border }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-3.5 flex items-center gap-3"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: 'rgba(255,255,255,0.15)' }}>
        <Icon size={16} className="text-white" />
      </div>
      <div>
        <p className="text-lg font-black leading-tight text-white">{value}</p>
        <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</p>
      </div>
    </div>
  )
}

// ─── Filtros rápidos de fecha ───────────────────────────────────────────────
const FILTROS_FECHA = [
  { id: '', label: 'Todo' },
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
]

// ─── Vista principal ────────────────────────────────────────────────────────
const POR_PAGINA = 50

export default function AuditoriaView() {
  const [pagina,       setPagina]       = useState(0)
  const [usuarioId,    setUsuarioId]    = useState('')
  const [categoria,    setCategoria]    = useState('')
  const [busqueda,     setBusqueda]     = useState('')
  const [filtroFecha,  setFiltroFecha]  = useState('')
  const [copiado,      setCopiado]      = useState(false)

  const perfil = useAuthStore(s => s.perfil)
  const esRolAutorizado = ['jefe', 'administracion', 'supervisor', 'desarrollador'].includes(perfil?.rol)

  // Estados del Buscador de Reportes Especiales
  const [reportTab, setReportTab] = useState('despacho') // 'despacho' | 'cliente'
  const [reportQuery, setReportQuery] = useState('')
  const [clientSearchQuery, setClientSearchQuery] = useState('')
  const [clientSearchResults, setClientSearchResults] = useState([])
  const [loadingReport, setLoadingReport] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportModalData, setReportModalData] = useState(null)

  const { data, isLoading, isError, refetch } = useAuditoria({ pagina, porPagina: POR_PAGINA, usuarioId, categoria })
  const { data: usuarios = [] } = useUsuarios()
  const { tasaEfectiva } = useTasaCambio()

  const handleSearchDespacho = async (numero) => {
    const cleanNum = String(numero).replace(/^(des|dsp)[\.\-\s]*/i, '').replace(/^0+/g, '').trim()
    if (!cleanNum || isNaN(cleanNum)) {
      showToast('Ingresa un número correlativo de despacho válido', 'warning')
      return
    }
    setLoadingReport(true)
    try {
      const { data: despacho, error: dErr } = await supabase
        .from('notas_despacho')
        .select(`
          *,
          cliente:clientes!notas_despacho_cliente_id_fkey(*),
          vendedor:usuarios!notas_despacho_vendedor_id_fkey(*),
          cotizacion:cotizaciones(id, numero, creado_en)
        `)
        .eq('numero', parseInt(cleanNum, 10))
        .maybeSingle()

      if (dErr) throw dErr
      if (!despacho) {
        showToast(`Despacho DES-${cleanNum.padStart(5, '0')} no encontrado`, 'error')
        setLoadingReport(false)
        return
      }

      const { data: items, error: iErr } = await supabase
        .from('notas_despacho_items')
        .select('*')
        .eq('despacho_id', despacho.id)

      if (iErr) throw iErr

      let comisiones = []
      try {
        const comRes = await authFetch(`/api/comisiones/lista?despachoId=${despacho.id}&pageSize=50`)
        if (comRes.ok) {
          const comJson = await comRes.json()
          comisiones = comJson.data || []
        } else {
          const errText = await comRes.text().catch(() => '')
          console.warn('[AuditoriaView] API comisiones respondió con error:', comRes.status, errText)
        }
      } catch (cErr) {
        console.warn('[AuditoriaView] Excepción al consultar comisiones de la API:', cErr)
      }

      // Fallback: si la API no devolvió comisiones, intentar consulta directa a Supabase
      if (comisiones.length === 0) {
        try {
          const { data: comDirect, error: comDirErr } = await supabase
            .from('comisiones')
            .select(`
              id, despachoid, vendedorid, cotizacionid, cuentaid,
              totalcomision, comisioncabilla, comisionotros,
              pctcabilla, pctotros, montopagado,
              comision_liberada, comision_retenida,
              estado, pagadaen, pagadapor, creadoen,
              vendedor:usuarios!comisiones_vendedorid_fkey(id, nombre, rol, color)
            `)
            .eq('despachoid', despacho.id)
          if (!comDirErr && comDirect && comDirect.length > 0) {
            comisiones = comDirect
          } else if (comDirErr) {
            console.warn('[AuditoriaView] Fallback Supabase comisiones error:', comDirErr.message)
          }
        } catch (fbErr) {
          console.warn('[AuditoriaView] Excepción en fallback de comisiones:', fbErr)
        }
      }

      const { data: auditLogs, error: aErr } = await supabase
        .from('auditoria')
        .select('*')
        .eq('entidad_id', despacho.id)
        .order('ts', { ascending: true })

      if (aErr) throw aErr

      setReportModalData({
        type: 'despacho',
        title: `Reporte de Despacho: DES-${String(despacho.numero).padStart(5, '0')}`,
        data: {
          despacho,
          items: items || [],
          comisiones: comisiones || [],
          auditLogs: auditLogs || [],
        }
      })
      setShowReportModal(true)
    } catch (err) {
      console.error(err)
      showToast('Error al consultar despacho: ' + err.message, 'error')
    } finally {
      setLoadingReport(false)
    }
  }

  const handleSearchCliente = async (cliente) => {
    if (!cliente?.id) return
    setLoadingReport(true)
    try {
      const { data: reasignaciones, error: rErr } = await supabase
        .from('reasignaciones_clientes')
        .select(`
          *,
          origen:usuarios!reasignaciones_clientes_vendedor_origen_fkey(nombre),
          destino:usuarios!reasignaciones_clientes_vendedor_destino_fkey(nombre),
          supervisor:usuarios!reasignaciones_clientes_supervisor_id_fkey(nombre)
        `)
        .eq('cliente_id', cliente.id)
        .order('creado_en', { ascending: true })

      if (rErr) throw rErr

      const tStart = new Date(new Date(cliente.creado_en).getTime() - 90000).toISOString()
      const tEnd = new Date(new Date(cliente.creado_en).getTime() + 90000).toISOString()

      const { data: logsCercanos } = await supabase
        .from('auditoria')
        .select('*')
        .gte('ts', tStart)
        .lte('ts', tEnd)
        .order('ts', { ascending: true })

      setReportModalData({
        type: 'cliente',
        title: `Reporte del Cliente: ${cliente.nombre}`,
        data: {
          cliente,
          reasignaciones: reasignaciones || [],
          logsCercanos: logsCercanos || []
        }
      })
      setShowReportModal(true)
      setClientSearchQuery('')
      setClientSearchResults([])
    } catch (err) {
      console.error(err)
      showToast('Error al consultar cliente: ' + err.message, 'error')
    } finally {
      setLoadingReport(false)
    }
  }

  const handleClientInputChange = async (val) => {
    setClientSearchQuery(val)
    if (val.trim().length < 2) {
      setClientSearchResults([])
      return
    }
    try {
      const { data, error } = await supabase
        .from('clientes')
        .select(`
          *,
          vendedor:usuarios!clientes_vendedor_id_fkey(nombre)
        `)
        .or(`nombre.ilike.%${val.trim()}%,codigo_cliente.ilike.%${val.trim()}%,rif_cedula.ilike.%${val.trim()}%`)
        .eq('activo', true)
        .limit(10)
      
      if (!error && data) {
        setClientSearchResults(data)
      }
    } catch (err) {
      console.error(err)
    }
  }

  const renderBuscadorReportes = () => {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-blue-600" />
          <h2 className="text-sm font-bold text-slate-800">Buscador de Historial y Auditoría Cruzada</h2>
        </div>
        <p className="text-xs text-slate-500">
          Consulta al instante el historial completo, comisiones, modificaciones y asignaciones de un despacho o un cliente.
        </p>

        {/* Pestañas */}
        <div className="flex border-b border-slate-100">
          <button
            onClick={() => { setReportTab('despacho'); setReportQuery(''); setClientSearchQuery(''); setClientSearchResults([]) }}
            className={`text-xs font-bold pb-2 px-4 border-b-2 transition-all ${
              reportTab === 'despacho'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Por Despacho (Nº Correlativo)
          </button>
          <button
            onClick={() => { setReportTab('cliente'); setReportQuery(''); setClientSearchQuery(''); setClientSearchResults([]) }}
            className={`text-xs font-bold pb-2 px-4 border-b-2 transition-all ${
              reportTab === 'cliente'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Por Cliente (Nombre / RIF)
          </button>
        </div>

        {/* Área del buscador */}
        {reportTab === 'despacho' ? (
          <form
            onSubmit={(e) => { e.preventDefault(); handleSearchDespacho(reportQuery) }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Ingresa el correlativo de despacho (ej. 1132)..."
                value={reportQuery}
                onChange={e => setReportQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all placeholder:text-slate-400"
              />
            </div>
            <button
              type="submit"
              disabled={loadingReport || !reportQuery.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            >
              {loadingReport ? 'Buscando...' : 'Generar Reporte'}
            </button>
          </form>
        ) : (
          <div className="relative space-y-1">
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Busca el nombre, código o RIF del cliente..."
                value={clientSearchQuery}
                onChange={e => handleClientInputChange(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all placeholder:text-slate-400"
              />
              {loadingReport && (
                <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
              )}
            </div>

            {/* Resultados predictivos */}
            {clientSearchResults.length > 0 && (
              <div className="absolute z-30 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 max-h-60 overflow-y-auto divide-y divide-slate-100">
                {clientSearchResults.map(cli => (
                  <button
                    key={cli.id}
                    onClick={() => handleSearchCliente(cli)}
                    className="w-full px-4 py-2.5 text-left text-xs hover:bg-blue-50 transition-colors flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-slate-800">{cli.nombre}</p>
                      <p className="text-[10px] text-slate-400">{cli.rif_cedula || 'Sin RIF'} | Código: #{cli.codigo_cliente}</p>
                    </div>
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                      Vendedor: {cli.vendedor?.nombre || '—'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderReportModal = () => {
    if (!showReportModal || !reportModalData) return null
    const { type, title, data } = reportModalData

    const printReport = () => {
      const printContent = document.getElementById('report-print-area').innerHTML
      const printWindow = window.open('', '', 'height=800,width=900')
      printWindow.document.write('<html><head><title>' + title + '</title>')
      printWindow.document.write('<style>')
      printWindow.document.write(`
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; color: #1e293b; line-height: 1.5; }
        .header { border-bottom: 2px solid #3b82f6; padding-bottom: 15px; margin-bottom: 25px; }
        .header h1 { margin: 0; font-size: 24px; color: #1e3a8a; }
        .header p { margin: 5px 0 0 0; font-size: 13px; color: #64748b; }
        h2 { font-size: 16px; color: #1e3a8a; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-top: 25px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .field { margin-bottom: 8px; font-size: 13px; }
        .label { color: #64748b; font-weight: 500; display: inline-block; width: 140px; }
        .value { color: #0f172a; font-weight: 600; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; }
        th, td { padding: 10px; text-align: left; font-size: 12px; border-bottom: 1px solid #e2e8f0; }
        th { background-color: #f8fafc; font-weight: bold; color: #475569; border-top: 1px solid #e2e8f0; }
        .badge { padding: 4px 8px; border-radius: 9999px; font-size: 10px; font-weight: bold; display: inline-block; text-transform: uppercase; }
        .badge-success { background-color: #d1fae5; color: #065f46; }
        .badge-warning { background-color: #fef3c7; color: #92400e; }
        .badge-danger { background-color: #fee2e2; color: #991b1b; }
        .badge-info { background-color: #e0f2fe; color: #0369a1; }
        .badge-slate { background-color: #f1f5f9; color: #334155; }
        .timeline { list-style: none; padding: 0; margin: 0; }
        .timeline-item { position: relative; padding-left: 20px; margin-bottom: 12px; font-size: 12px; }
        .timeline-item::before { content: ""; position: absolute; left: 0; top: 5px; width: 8px; height: 8px; border-radius: 50%; background-color: #3b82f6; }
        .timestamp { color: #64748b; font-family: monospace; font-size: 11px; margin-right: 8px; }
        .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #94a3b8; text-align: center; }
      `)
      printWindow.document.write('</style></head><body>')
      printWindow.document.write(printContent)
      printWindow.document.write('</body></html>')
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => {
        printWindow.print()
        printWindow.close()
      }, 300)
    }

    const renderContent = () => {
      if (type === 'despacho') {
        const { despacho, items, comisiones, auditLogs } = data
        let formaPagoText = '—'
        try {
          if (despacho.forma_pago) {
            const parsed = typeof despacho.forma_pago === 'string' ? JSON.parse(despacho.forma_pago) : despacho.forma_pago
            if (Array.isArray(parsed)) {
              formaPagoText = parsed.map(p => `${p.metodo || 'Método'}: ${fmtUsd(p.monto)}`).join(', ')
            } else if (parsed && typeof parsed === 'object') {
              formaPagoText = `${parsed.metodo || 'Método'}: ${fmtUsd(parsed.monto)}`
            }
          }
        } catch {}

        const creacionLog = auditLogs.find(l => l.accion === 'CREAR_DESPACHO')
        const creadoPorStr = creacionLog 
          ? `${creacionLog.usuario_nombre} (${creacionLog.usuario_rol || 'vendedor'}) el ${new Date(creacionLog.ts).toLocaleString('es-VE')}`
          : `Sistema (Vendedor: ${despacho.vendedor?.nombre || '—'})`

        const modLogs = auditLogs.filter(l => l.accion !== 'CREAR_DESPACHO')

        return (
          <div className="space-y-6">
            <div className="flex justify-between border-b border-slate-100 pb-4 flex-wrap gap-4">
              <div>
                <h3 className="text-lg font-black text-slate-800">Nota de Despacho: DES-${String(despacho.numero).padStart(5, '0')}</h3>
                <p className="text-xs text-slate-400 mt-1">Estatus: <span className="font-bold text-slate-600 capitalize">{despacho.estado}</span> | Fecha: {new Date(despacho.creado_en).toLocaleString('es-VE')}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-400 block">Monto Total Despacho</span>
                <span className="text-xl font-black text-slate-800">{fmtUsd(despacho.total_usd)}</span>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Información General</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Cliente:</span><span className="font-bold text-slate-700">{despacho.cliente?.nombre || '—'}</span></p>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">RIF / Cédula:</span><span className="font-bold text-slate-700">{despacho.cliente?.rif_cedula || '—'}</span></p>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Vendedor:</span><span className="font-bold text-slate-700">{despacho.vendedor?.nombre || '—'}</span></p>
                </div>
                <div>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Creado por:</span><span className="font-bold text-slate-700">{creadoPorStr}</span></p>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Aprobado por:</span><span className="font-bold text-slate-700">{despacho.aprobado_por_nombre || '—'}</span></p>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Forma de Pago:</span><span className="font-bold text-slate-700">{formaPagoText}</span></p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Artículos Despachados</h4>
              <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-3 py-2 text-left font-bold text-slate-500">Código</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-500">Descripción</th>
                      <th className="px-3 py-2 text-center font-bold text-slate-500">Cantidad</th>
                      <th className="px-3 py-2 text-right font-bold text-slate-500">Precio Unit.</th>
                      <th className="px-3 py-2 text-right font-bold text-slate-500">Total USD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map(it => (
                      <tr key={it.id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2.5 font-mono text-slate-600">{it.codigo_snap}</td>
                        <td className="px-3 py-2.5 font-bold text-slate-700">{it.nombre_snap}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-700">{it.cantidad}</td>
                        <td className="px-3 py-2.5 text-right text-slate-600">{fmtUsd(it.precio_unit_usd)}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-slate-800">{fmtUsd(it.total_linea_usd)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-bold border-t border-slate-200">
                      <td colSpan="3" className="px-3 py-2"></td>
                      <td className="px-3 py-2 text-right text-slate-500">Flete:</td>
                      <td className="px-3 py-2 text-right text-slate-800">{fmtUsd(despacho.flete_usd || 0)}</td>
                    </tr>
                    <tr className="bg-slate-50 font-black">
                      <td colSpan="3" className="px-3 py-2.5"></td>
                      <td className="px-3 py-2.5 text-right text-slate-800">Total Cobrado:</td>
                      <td className="px-3 py-2.5 text-right text-blue-700 text-sm">{fmtUsd(despacho.total_usd)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Comisiones Generadas</h4>
              {comisiones.length === 0 ? (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5 text-xs text-amber-800 flex items-start gap-2">
                  <DollarSign size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <p>No se encontraron registros de comisión para este despacho. Es posible que el despacho no haya sido aprobado aún o que la comisión esté pendiente de generación.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {comisiones.map(c => {
                    const vendorName = c.vendedor?.nombre || c.vendedorid || '—'
                    const totalCom = Number(c.totalcomision || 0)
                    const cabilla = Number(c.comisioncabilla || 0)
                    const otros = Number(c.comisionotros || 0)
                    const liberada = Number(c.comision_liberada || 0)
                    const retenida = Number(c.comision_retenida || 0)
                    const pagado = Number(c.montopagado || 0)
                    const pctCabilla = Number(c.pctcabilla || 0)
                    const pctOtros = Number(c.pctotros || 0)
                    const estadoLabel = c.estado === 'pagada' ? 'Pagada' : c.estado === 'cta_cobrar' ? 'En Cuenta x Cobrar' : 'Pendiente'
                    const estadoColor = c.estado === 'pagada' ? 'bg-emerald-100 text-emerald-800' : c.estado === 'cta_cobrar' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                    return (
                      <div key={c.id} className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                        {/* Header */}
                        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: c.vendedor?.color ? c.vendedor.color + '22' : '#3b82f622', color: c.vendedor?.color || '#3b82f6' }}>
                              <DollarSign size={13} />
                            </div>
                            <div>
                              <p className="font-bold text-slate-800 text-xs">Comisión de {vendorName}</p>
                              <p className="text-[10px] text-slate-400">Generada: {c.creadoen ? new Date(c.creadoen).toLocaleDateString('es-VE') : '—'}</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${estadoColor}`}>{estadoLabel}</span>
                            {liberada > 0 && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 text-indigo-800">Liberada</span>}
                            {retenida > 0 && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-100 text-rose-800">Retenida</span>}
                          </div>
                        </div>
                        {/* Body: amounts grid */}
                        <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          <div>
                            <p className="text-slate-400 font-medium">Total Comisión</p>
                            <p className="font-black text-slate-800 text-sm">{fmtUsd(totalCom)}</p>
                          </div>
                          <div>
                            <p className="text-slate-400 font-medium">Monto Pagado</p>
                            <p className={`font-black text-sm ${pagado >= totalCom && totalCom > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>{fmtUsd(pagado)}</p>
                          </div>
                          {liberada > 0 && (
                            <div>
                              <p className="text-slate-400 font-medium">Com. Liberada</p>
                              <p className="font-bold text-indigo-600">{fmtUsd(liberada)}</p>
                            </div>
                          )}
                          {retenida > 0 && (
                            <div>
                              <p className="text-slate-400 font-medium">Com. Retenida</p>
                              <p className="font-bold text-rose-600">{fmtUsd(retenida)}</p>
                            </div>
                          )}
                          {cabilla > 0 && (
                            <div>
                              <p className="text-slate-400 font-medium">Cabilla ({pctCabilla}%)</p>
                              <p className="font-bold text-slate-700">{fmtUsd(cabilla)}</p>
                            </div>
                          )}
                          {otros > 0 && (
                            <div>
                              <p className="text-slate-400 font-medium">Otros ({pctOtros}%)</p>
                              <p className="font-bold text-slate-700">{fmtUsd(otros)}</p>
                            </div>
                          )}
                          {c.pagadaen && (
                            <div className="col-span-2">
                              <p className="text-slate-400 font-medium">Fecha de Pago</p>
                              <p className="font-bold text-emerald-700">{new Date(c.pagadaen).toLocaleString('es-VE')}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">Historial de Modificaciones y Trazabilidad</h4>
              {modLogs.length === 0 ? (
                <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-100">No se registran cambios o modificaciones posteriores en la auditoría.</p>
              ) : (
                <div className="space-y-2 border-l-2 border-blue-100 pl-4 ml-2.5">
                  {modLogs.map(log => {
                    const lDate = new Date(log.ts).toLocaleString('es-VE')
                    const lAction = ACCION_LABEL[log.accion] || log.accion.replace(/_/g, ' ')
                    return (
                      <div key={log.id} className="relative text-xs">
                        <div className="absolute -left-[23px] top-1.5 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white" />
                        <span className="text-[10px] font-mono text-slate-400">{lDate}</span>
                        <p className="font-bold text-slate-700 mt-0.5">{log.usuario_nombre} ({log.usuario_rol})</p>
                        <p className="text-slate-600 text-[11px] font-medium">{lAction}</p>
                        {log.descripcion && <p className="text-slate-500 text-[10px] mt-0.5 italic">{log.descripcion}</p>}
                        {log.meta && Object.keys(log.meta).length > 0 && (
                          <div className="mt-1 bg-slate-50 p-1.5 rounded text-[10px]">
                            <MetaDisplay meta={log.meta} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      } else {
        const { cliente, reasignaciones, logsCercanos } = data

        const sellerLogin = logsCercanos.find(l => l.usuario_id === cliente.vendedor_id && l.accion === 'LOGIN_EXITOSO')
        const firstQuote = logsCercanos.find(l => l.accion === 'ENVIAR_COTIZACION' || l.accion === 'CREAR_COTIZACION')
        
        let creatorEstimate = 'Desconocido (Registro Directo)'
        let creatorDetail = 'Registrado directamente en base de datos o sin log de acción'
        if (firstQuote) {
          creatorEstimate = `${firstQuote.usuario_nombre} (${firstQuote.usuario_rol || 'vendedor'})`
          creatorDetail = `Creó el cliente e inició cotización #${firstQuote.meta?.numero || 'S/N'}`
        } else if (sellerLogin) {
          creatorEstimate = `${sellerLogin.usuario_nombre} (${sellerLogin.usuario_rol || 'vendedor'})`
          creatorDetail = `Inició sesión momentos antes y se le asignó automáticamente`
        } else if (logsCercanos.length > 0) {
          const activeUser = logsCercanos[0]
          creatorEstimate = `${activeUser.usuario_nombre} (${activeUser.usuario_rol || 'usuario'})`
          creatorDetail = `Usuario más activo en el sistema a la hora de creación`
        }

        return (
          <div className="space-y-6">
            <div className="flex justify-between border-b border-slate-100 pb-4 flex-wrap gap-4">
              <div>
                <h3 className="text-lg font-black text-slate-800">Ficha del Cliente: {cliente.nombre}</h3>
                <p className="text-xs text-slate-400 mt-1">Código: <span className="font-mono font-bold text-slate-600">#{cliente.codigo_cliente}</span> | RIF: {cliente.rif_cedula || 'Sin RIF'}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-400 block">Deuda Pendiente Actual</span>
                <span className={`text-xl font-black ${cliente.saldo_pendiente > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {fmtUsd(cliente.saldo_pendiente || 0)}
                </span>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Información del Cliente</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Teléfono:</span><span className="font-bold text-slate-700">{cliente.telefono || '—'}</span></p>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Dirección:</span><span className="font-bold text-slate-700">{cliente.direccion || '—'}</span></p>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Localidad:</span><span className="font-bold text-slate-700">{cliente.ciudad ? `${cliente.ciudad}, ${cliente.estado}` : '—'}</span></p>
                </div>
                <div>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Fecha Registro:</span><span className="font-bold text-slate-700">{new Date(cliente.creado_en).toLocaleString('es-VE')}</span></p>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Vendedor Actual:</span><span className="font-bold text-slate-700">{cliente.vendedor?.nombre || '—'}</span></p>
                  <p className="py-1"><span className="text-slate-400 font-medium inline-block w-28">Tipo Cliente:</span><span className="font-bold text-slate-700 capitalize">{cliente.tipo_cliente || 'natural'}</span></p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Trazabilidad y Creación de Cuenta</h4>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-xs space-y-2">
                <p><span className="text-slate-400 font-medium inline-block w-40">Usuario Creador Estimado:</span><span className="font-bold text-slate-800">{creatorEstimate}</span></p>
                <p><span className="text-slate-400 font-medium inline-block w-40">Detalle de Actividad:</span><span className="font-bold text-slate-600">{creatorDetail}</span></p>
                <p className="text-[10px] text-slate-400 italic font-medium">Nota: Estimación realizada cruzando la fecha de creación del cliente con los inicios de sesión y cotizaciones en la base de datos.</p>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Historial de Reasignaciones de Cartera</h4>
              {reasignaciones.length === 0 ? (
                <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 p-4 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle size={14} className="text-emerald-600 shrink-0" />
                  <p className="font-medium"><strong>Sin reasignaciones previas:</strong> Este cliente nunca ha sido transferido. Se mantiene asignado a su vendedor original ({cliente.vendedor?.nombre || 'Edgar Ramírez'}) desde el momento de su creación.</p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-100 rounded-xl">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-3 py-2 text-left font-bold text-slate-500">Fecha</th>
                        <th className="px-3 py-2 text-left font-bold text-slate-500">Vendedor Origen</th>
                        <th className="px-3 py-2 text-left font-bold text-slate-500">Vendedor Destino</th>
                        <th className="px-3 py-2 text-left font-bold text-slate-500">Autorizado Por</th>
                        <th className="px-3 py-2 text-left font-bold text-slate-500">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reasignaciones.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2.5 text-slate-500 font-mono">{new Date(r.creado_en || r.ts).toLocaleDateString('es-VE')}</td>
                          <td className="px-3 py-2.5 text-slate-600 font-medium">{r.origen?.nombre || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-800 font-bold">{r.destino?.nombre || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-600 font-medium">{r.supervisor?.nombre || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-500 italic">{r.motivo || 'Reasignación de cartera'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )
      }
    }

    const renderPrintArea = () => {
      if (type === 'despacho') {
        const { despacho, items, comisiones, auditLogs } = data
        let formaPagoText = '—'
        try {
          if (despacho.forma_pago) {
            const parsed = typeof despacho.forma_pago === 'string' ? JSON.parse(despacho.forma_pago) : despacho.forma_pago
            if (Array.isArray(parsed)) {
              formaPagoText = parsed.map(p => `${p.metodo || 'Método'}: ${fmtUsd(p.monto)}`).join(', ')
            } else if (parsed && typeof parsed === 'object') {
              formaPagoText = `${parsed.metodo || 'Método'}: ${fmtUsd(parsed.monto)}`
            }
          }
        } catch {}

        return (
          <div id="report-print-area" className="hidden">
            <div className="header">
              <h1>Reporte Cruzado de Nota de Despacho</h1>
              <p>Generado automáticamente desde el módulo de Auditoría</p>
            </div>
            
            <h2>Ficha General</h2>
            <div className="grid">
              <div>
                <div className="field"><span className="label">Despacho Nº:</span><span className="value">DES-${String(despacho.numero).padStart(5, '0')}</span></div>
                <div className="field"><span className="label">Estatus:</span><span className="value">{despacho.estado.toUpperCase()}</span></div>
                <div className="field"><span className="label">Fecha Emisión:</span><span className="value">{new Date(despacho.creado_en).toLocaleString('es-VE')}</span></div>
                <div className="field"><span className="label">Aprobado Por:</span><span className="value">{despacho.aprobado_por_nombre || '—'}</span></div>
              </div>
              <div>
                <div className="field"><span className="label">Cliente:</span><span className="value">{despacho.cliente?.nombre || '—'}</span></div>
                <div className="field"><span className="label">RIF / Cédula:</span><span className="value">{despacho.cliente?.rif_cedula || '—'}</span></div>
                <div className="field"><span className="label">Vendedor:</span><span className="value">{despacho.vendedor?.nombre || '—'}</span></div>
                <div className="field"><span className="label">Forma Pago:</span><span className="value">{formaPagoText}</span></div>
              </div>
            </div>

            <h2>Artículos Despachados</h2>
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th style={{textAlign: 'center'}}>Cantidad</th>
                  <th style={{textAlign: 'right'}}>Precio Unit.</th>
                  <th style={{textAlign: 'right'}}>Total USD</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id}>
                    <td>{it.codigo_snap}</td>
                    <td className="font-bold">{it.nombre_snap}</td>
                    <td style={{textAlign: 'center'}} className="font-bold">{it.cantidad}</td>
                    <td style={{textAlign: 'right'}}>{fmtUsd(it.precio_unit_usd)}</td>
                    <td style={{textAlign: 'right'}} className="font-bold">{fmtUsd(it.total_linea_usd)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan="3" style={{border: 'none'}}></td>
                  <td style={{textAlign: 'right', fontWeight: 'bold'}}>Flete:</td>
                  <td style={{textAlign: 'right', fontWeight: 'bold'}}>{fmtUsd(despacho.flete_usd || 0)}</td>
                </tr>
                <tr>
                  <td colSpan="3" style={{border: 'none'}}></td>
                  <td style={{textAlign: 'right', fontWeight: 'bold', fontSize: '13px'}}>Total Cobrado:</td>
                  <td style={{textAlign: 'right', fontWeight: 'bold', color: '#1e3a8a', fontSize: '13px'}}>{fmtUsd(despacho.total_usd)}</td>
                </tr>
              </tbody>
            </table>

            <h2>Comisiones Asociadas</h2>
            {comisiones.length === 0 ? (
              <p style={{fontSize: '12px', color: '#666'}}>No se generaron comisiones de venta para este despacho.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ID Comisión</th>
                    <th>Vendedor</th>
                    <th style={{textAlign: 'right'}}>Total Comisión</th>
                    <th style={{textAlign: 'right'}}>Monto Pagado</th>
                    <th>Estatus Pago</th>
                    <th>Estatus Liberación</th>
                  </tr>
                </thead>
                <tbody>
                  {comisiones.map(c => (
                    <tr key={c.id}>
                      <td style={{fontFamily: 'monospace'}}>{c.id.substring(0,8)}...</td>
                      <td>{despacho.vendedor?.nombre || '—'}</td>
                      <td style={{textAlign: 'right'}} className="font-bold">{fmtUsd(c.totalcomision)}</td>
                      <td style={{textAlign: 'right'}}>{fmtUsd(c.montopagado || 0)}</td>
                      <td><span className="badge badge-slate">{c.estado}</span></td>
                      <td><span className="badge badge-info">{c.comision_liberada > 0 ? 'Liberada' : 'Retenida'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h2>Historial de Auditoría (Trazabilidad)</h2>
            <ul className="timeline">
              {auditLogs.map(log => (
                <li key={log.id} className="timeline-item">
                  <span className="timestamp">{new Date(log.ts).toLocaleString('es-VE')}</span>
                  <strong>{log.usuario_nombre} ({log.usuario_rol})</strong>: {ACCION_LABEL[log.accion] || log.accion.replace(/_/g, ' ')}
                  {log.descripcion && <span style={{display: 'block', fontStyle: 'italic', fontSize: '11px', color: '#666'}}>{log.descripcion}</span>}
                </li>
              ))}
            </ul>

            <div className="footer">
              ListoPOS System — Reporte de Auditoría Cruzada de Despachos.
            </div>
          </div>
        )
      } else {
        const { cliente, reasignaciones } = data
        return (
          <div id="report-print-area" className="hidden">
            <div className="header">
              <h1>Ficha de Auditoría de Cliente</h1>
              <p>Historial completo de asignación de vendedores y control de registro</p>
            </div>

            <h2>Datos Básicos del Cliente</h2>
            <div className="grid">
              <div>
                <div className="field"><span className="label">Cliente:</span><span className="value">{cliente.nombre}</span></div>
                <div className="field"><span className="label">Código Interno:</span><span className="value">#{cliente.codigo_cliente}</span></div>
                <div className="field"><span className="label">RIF / Cédula:</span><span className="value">{cliente.rif_cedula || 'Sin RIF'}</span></div>
                <div className="field"><span className="label">Teléfono:</span><span className="value">{cliente.telefono || '—'}</span></div>
              </div>
              <div>
                <div className="field"><span className="label">Fecha Registro:</span><span className="value">{new Date(cliente.creado_en).toLocaleString('es-VE')}</span></div>
                <div className="field"><span className="label">Vendedor Actual:</span><span className="value">{cliente.vendedor?.nombre || '—'}</span></div>
                <div className="field"><span className="label">Deuda Pendiente:</span><span className="value">{fmtUsd(cliente.saldo_pendiente || 0)}</span></div>
                <div className="field"><span className="label">Estatus Cuenta:</span><span className="value">{cliente.activo ? 'ACTIVA' : 'INACTIVA'}</span></div>
              </div>
            </div>

            <h2>Historial de Reasignaciones de Cartera</h2>
            {reasignaciones.length === 0 ? (
              <p style={{fontSize: '13px', padding: '10px', backgroundColor: '#f0fdf4', color: '#14532d', border: '1px solid #bbf7d0', borderRadius: '6px'}}>
                <strong>Sin reasignaciones previas:</strong> Este cliente nunca ha sido transferido. Se mantiene asignado a su vendedor original ({cliente.vendedor?.nombre || 'Edgar Ramírez'}) desde el momento de su creación.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Vendedor Origen</th>
                    <th>Vendedor Destino</th>
                    <th>Supervisor Autorizante</th>
                    <th>Motivo de Reasignación</th>
                  </tr>
                </thead>
                <tbody>
                  {reasignaciones.map(r => (
                    <tr key={r.id}>
                      <td>{new Date(r.creado_en || r.ts).toLocaleDateString('es-VE')}</td>
                      <td>{r.origen?.nombre || '—'}</td>
                      <td className="font-bold">{r.destino?.nombre || '—'}</td>
                      <td>{r.supervisor?.nombre || '—'}</td>
                      <td style={{fontStyle: 'italic'}}>{r.motivo || 'Reasignación de cartera'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="footer">
              ListoPOS System — Reporte de Auditoría de Cartera de Clientes.
            </div>
          </div>
        )
      }
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-scale-up">
          <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-100 shrink-0">
            <span className="text-sm font-black text-slate-800 font-mono tracking-wide">{title}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={printReport}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all active:scale-95"
              >
                <Printer size={13} />
                <span>Imprimir / PDF</span>
              </button>
              <button
                onClick={() => { setShowReportModal(false); setReportModalData(null) }}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            {renderContent()}
          </div>

          <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0">
            <button
              onClick={() => { setShowReportModal(false); setReportModalData(null) }}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition-all"
            >
              Cerrar
            </button>
          </div>
        </div>

        {renderPrintArea()}
      </div>
    )
  }

  const registros = data?.registros ?? []
  const total     = data?.total ?? 0
  const totalPags = Math.max(1, Math.ceil(total / POR_PAGINA))

  // Filtrar por búsqueda de texto y fecha (client-side sobre la página actual)
  const registrosFiltrados = useMemo(() => {
    let filtered = registros

    // Filtro de búsqueda
    if (busqueda.trim()) {
      const q = removeAccents(busqueda.toLowerCase())
      filtered = filtered.filter(r => {
        const usuario = removeAccents(r.usuario?.nombre ?? r.usuario_nombre ?? '').toLowerCase()
        const accion = removeAccents(ACCION_LABEL[r.accion] ?? r.accion ?? '').toLowerCase()
        const desc = removeAccents(r.descripcion ?? '').toLowerCase()
        return usuario.includes(q) || accion.includes(q) || desc.includes(q)
      })
    }

    // Filtro de fecha
    if (filtroFecha) {
      const ahora = new Date()
      filtered = filtered.filter(r => {
        const d = new Date(r.ts)
        if (filtroFecha === 'hoy') return d.toDateString() === ahora.toDateString()
        if (filtroFecha === 'semana') {
          const inicioSemana = new Date(ahora)
          inicioSemana.setDate(ahora.getDate() - ahora.getDay())
          inicioSemana.setHours(0, 0, 0, 0)
          return d >= inicioSemana
        }
        if (filtroFecha === 'mes') {
          return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear()
        }
        return true
      })
    }

    return filtered
  }, [registros, busqueda, filtroFecha])

  // Agrupar por fecha
  const grupos = useMemo(() => {
    const map = new Map()
    for (const r of registrosFiltrados) {
      const key = getDateKey(r.ts)
      if (!map.has(key)) map.set(key, { label: getDateGroupLabel(r.ts), registros: [] })
      map.get(key).registros.push(r)
    }
    return Array.from(map.values())
  }, [registrosFiltrados])

  // Contar registros de hoy (del total recibido)
  const hoyStr = new Date().toDateString()
  const countHoy = registros.filter(r => new Date(r.ts).toDateString() === hoyStr).length

  function cambiarFiltro(fn) {
    fn()
    setPagina(0)
  }

  const handleCopiarLogs = () => {
    if (registrosFiltrados.length === 0) {
      showToast('No hay registros para copiar', 'warning')
      return
    }

    const texto = registrosFiltrados.map(r => {
      const fecha = new Date(r.ts).toLocaleString('es-VE')
      const usuario = r.usuario?.nombre ?? r.usuario_nombre ?? 'Sistema'
      const rol = r.usuario?.rol ?? r.usuario_rol ?? 'SISTEMA'
      const accion = ACCION_LABEL[r.accion] ?? r.accion?.replace(/_/g, ' ')
      const desc = r.descripcion ? ` - Detalle: ${r.descripcion}` : ''
      const metaStr = r.meta && Object.keys(r.meta).length > 0 ? ` - Meta: ${JSON.stringify(r.meta)}` : ''
      return `[${fecha}] [${rol.toUpperCase()}] ${usuario}: ${accion}${desc}${metaStr}`
    }).join('\n')

    navigator.clipboard.writeText(texto)
      .then(() => {
        setCopiado(true)
        showToast('Logs copiados al portapapeles', 'ok')
        setTimeout(() => setCopiado(false), 2000)
      })
      .catch(() => {
        showToast('Error al copiar logs', 'error')
      })
  }

  const hayFiltros = categoria || usuarioId || busqueda || filtroFecha

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4">

      {/* Encabezado */}
      <PageHeader
        icon={ClipboardList}
        title="Auditoría"
        subtitle={isLoading ? 'Cargando...' : `${total.toLocaleString()} registros de actividad`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={handleCopiarLogs} disabled={isLoading || registrosFiltrados.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none select-none"
              title="Copiar logs al portapapeles">
              {copiado ? <Check size={13} className="text-emerald-600 animate-scale-up" /> : <Copy size={13} className="text-slate-500" />}
              <span>{copiado ? '¡Copiado!' : 'Copiar logs'}</span>
            </button>
            <button onClick={() => refetch()}
              className="p-2 rounded-xl transition-colors text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              title="Actualizar">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {/* Resumen rápido */}
      <div className="grid grid-cols-3 gap-3">
        <ResumenCard
          icon={Activity}
          label="Total registros"
          value={total.toLocaleString()}
          gradient="linear-gradient(135deg, #1B365D 0%, #0d1f3c 100%)"
          border="rgba(255,255,255,0.07)"
        />
        <ResumenCard
          icon={CalendarDays}
          label="Hoy"
          value={countHoy}
          gradient="linear-gradient(135deg, #0891b2 0%, #0e7490 100%)"
          border="rgba(255,255,255,0.10)"
        />
        <ResumenCard
          icon={TrendingUp}
          label="Esta página"
          value={registrosFiltrados.length}
          gradient="linear-gradient(135deg, #059669 0%, #047857 100%)"
          border="rgba(255,255,255,0.10)"
        />
      </div>

      {/* Buscador de Reportes Especiales */}
      {esRolAutorizado && renderBuscadorReportes()}

      {/* Búsqueda + Filtros */}
      <div className="space-y-3">
        {/* Barra de búsqueda */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por usuario, acción o descripción..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-9 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-colors placeholder:text-slate-400"
          />
          {busqueda && (
            <button onClick={() => setBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filtros rápidos de fecha + selectores */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Chips de fecha */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            {FILTROS_FECHA.map(f => (
              <button key={f.id}
                onClick={() => cambiarFiltro(() => setFiltroFecha(f.id))}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-all ${
                  filtroFecha === f.id
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}>
                {f.label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-slate-200 hidden sm:block" />

          {/* Select de categoría */}
          <div className="min-w-[160px]">
            <CustomSelect
              options={CATEGORIAS_FILTRO.map(({ valor, label }) => ({ value: valor, label }))}
              value={categoria}
              onChange={val => cambiarFiltro(() => setCategoria(val))}
              placeholder="Categoría"
              searchable={false}
            />
          </div>

          {/* Select de usuario */}
          <div className="min-w-[160px]">
            <CustomSelect
              options={[
                { value: '', label: 'Todos los usuarios' },
                ...usuarios.map(u => ({ value: u.id, label: u.nombre })),
              ]}
              value={usuarioId}
              onChange={val => cambiarFiltro(() => setUsuarioId(val))}
              placeholder="Usuario"
            />
          </div>

          {hayFiltros && (
            <button onClick={() => { setCategoria(''); setUsuarioId(''); setBusqueda(''); setFiltroFecha(''); setPagina(0) }}
              className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 transition-colors">
              <X size={12} /> Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Timeline agrupado por fecha */}
      {isLoading ? (
        <SkeletonAuditoria />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-700">
          <p className="font-semibold text-sm">Error al cargar registros</p>
          <button onClick={() => refetch()} className="mt-2 text-xs underline">Intentar de nuevo</button>
        </div>
      ) : registrosFiltrados.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400">
          <ClipboardList size={28} className="mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">Sin actividad</p>
          <p className="text-xs mt-1">No hay registros que coincidan con los filtros.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map(grupo => (
            <div key={grupo.label}>
              {/* Separador de fecha */}
              <div className="flex items-center gap-3 mb-2.5">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  {grupo.label}
                </span>
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[10px] text-slate-400 font-medium">
                  {grupo.registros.length} registro{grupo.registros.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Cards del grupo */}
              <div className="space-y-2">
                {grupo.registros.map(r => (
                  <ActividadCard key={r.id} registro={r} tasa={tasaEfectiva} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paginación */}
      {!isLoading && totalPags > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-2.5">
          <span className="text-xs text-slate-500">
            Pág. <strong>{pagina + 1}</strong> / <strong>{totalPags}</strong>
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setPagina(p => p - 1); const main = document.querySelector('main'); if (main) main.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={pagina === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors">
              <ChevronLeft size={12} /> Ant.
            </button>
            <button onClick={() => { setPagina(p => p + 1); const main = document.querySelector('main'); if (main) main.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={pagina >= totalPags - 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors">
              Sig. <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
      {esRolAutorizado && renderReportModal()}
    </div>
  )
}
