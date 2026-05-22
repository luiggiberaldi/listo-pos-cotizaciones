import React, { useState } from 'react'
import { Modal } from './Modal'
import { useActualizarSeguimiento, useSeguimiento } from '../../hooks/useSeguimiento'
import { showToast } from './Toast'
import supabase from '../../services/supabase/client'
import FichaClienteModal from '../clientes/FichaClienteModal'
import DetalleModal from './DetalleModal'
import {
  Pin,
  Check,
  Loader2,
  Image as ImageIcon,
  X,
  ExternalLink,
  Calendar,
  MessageSquare,
  AlertCircle,
  FileText,
  CheckCircle2,
  Sparkles,
  ZoomIn,
  Download,
  ChevronRight,
  User
} from 'lucide-react'

export default function SeguimientoFijadoModal({ isOpen, onClose, clienteId, cotizacionId, despachoId, entradas = [] }) {
  const actualizarSeguimiento = useActualizarSeguimiento()
  const [activeImage, setActiveImage] = useState(null)

  // Estados de Modales e Hidratación para Fichas Detalladas
  const [modalRegistro, setModalRegistro] = useState(null)
  const [modalTipo, setModalTipo] = useState('cotizacion')
  const [modalOpen, setModalOpen] = useState(false)
  
  const [modalCliente, setModalCliente] = useState(null)
  const [fichaOpen, setFichaOpen] = useState(false)
  
  const [cargandoModal, setCargandoModal] = useState(false)

  const abrirDetalle = async (id, tipo) => {
    if (cargandoModal) return
    setCargandoModal(true)
    try {
      const table = tipo === 'cotizacion' ? 'cotizaciones' : 'notas_despacho'
      const selectQuery = tipo === 'cotizacion'
        ? '*, vendedor:usuarios(id, nombre, color, rol)'
        : '*, vendedor:usuarios!notas_despacho_vendedor_id_fkey(id, nombre, color, rol)'
      const { data, error } = await supabase
        .from(table)
        .select(selectQuery)
        .eq('id', id)
        .single()
      
      if (error) throw error
      if (data) {
        setModalRegistro(data)
        setModalTipo(tipo)
        setModalOpen(true)
      } else {
        showToast.warning('No se encontró el registro original.')
      }
    } catch (err) {
      console.error('Error al cargar detalle:', err)
      showToast.error('Error al cargar el detalle del registro')
    } finally {
      setCargandoModal(false)
    }
  }

  const abrirFichaCliente = async (id) => {
    if (cargandoModal) return
    setCargandoModal(true)
    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('*, vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre, color, rol)')
        .eq('id', id)
        .single()
      
      if (error) throw error
      if (data) {
        setModalCliente(data)
        setFichaOpen(true)
      } else {
        showToast.warning('No se encontró la ficha de cliente.')
      }
    } catch (err) {
      console.error('Error al cargar ficha de cliente:', err)
      showToast.error('Error al cargar los datos del cliente')
    } finally {
      setCargandoModal(false)
    }
  }

  const handleDownload = async (url) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      const filename = url.substring(url.lastIndexOf('/') + 1).split('?')[0] || 'evidencia.webp'
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
      showToast.success('Imagen descargada con éxito')
    } catch (err) {
      console.error('Error al descargar:', err)
      window.open(url, '_blank')
    }
  }

  // Consultar datos completos y frescos en tiempo real usando el hook useSeguimiento
  // Si tenemos cotizacionId o despachoId, evitamos filtrar por clienteId para que coincida exactamente
  // con la nota asociada al registro y no se filtre si clienteId no está en la nota de la DB.
  const { data: fetchEntradas = [], isLoading: loadingSeguimiento } = useSeguimiento({
    clienteId: cotizacionId || despachoId ? null : clienteId,
    cotizacionId,
    despachoId
  })

  // Usar las entradas completas devueltas por la consulta, o en su defecto las del prop original
  const currentEntradas = fetchEntradas.length > 0 ? fetchEntradas : (entradas || [])

  // Filtrar solo las entradas fijadas
  const pinnedEntradas = currentEntradas.filter(e => e.fijada)

  // Cerrar el modal automáticamente si no quedan seguimientos fijados
  React.useEffect(() => {
    if (isOpen && pinnedEntradas.length === 0 && !loadingSeguimiento) {
      onClose()
    }
  }, [pinnedEntradas.length, isOpen, onClose, loadingSeguimiento])

  const handleAceptar = async (id) => {
    try {
      await actualizarSeguimiento.mutateAsync({
        id,
        fijada: false
      })
      showToast.success('Seguimiento verificado y removido de alertas fijadas')
    } catch (err) {
      console.error('Error al quitar fijado:', err)
      showToast.error(err.message || 'No se pudo quitar el fijado')
    }
  }

  if (!isOpen) return null

  // Configuración de estilos para los tipos de seguimiento
  const TIPO_CONFIG = {
    nota: { label: 'Nota', color: 'bg-slate-100 text-slate-700 border-slate-200/80', icon: MessageSquare },
    incidencia: { label: 'Incidencia', color: 'bg-rose-100/70 text-rose-800 border-rose-200', icon: AlertCircle },
    aclaratoria: { label: 'Aclaratoria', color: 'bg-indigo-100/70 text-indigo-800 border-indigo-200', icon: FileText },
    seguimiento: { label: 'Seguimiento', color: 'bg-sky-100/70 text-sky-800 border-sky-200', icon: CheckCircle2 },
    evidencia: { label: 'Evidencia', color: 'bg-amber-100/70 text-amber-800 border-amber-200', icon: ImageIcon },
    resolucion: { label: 'Resolución', color: 'bg-emerald-100/70 text-emerald-800 border-emerald-200', icon: CheckCircle2 },
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Alertas de Seguimiento Fijadas"
        className="max-w-2xl"
      >
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10 border border-amber-200/60 dark:border-amber-900/30 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
            <Sparkles className="text-amber-500 shrink-0 mt-0.5 animate-pulse" size={18} />
            <div>
              <p className="text-xs font-bold text-amber-900 dark:text-amber-400">Atención Administrativa Requerida</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-550 mt-0.5 leading-relaxed font-medium">
                Las siguientes notas operativas han sido fijadas por el personal de operaciones. Revise los detalles y la evidencia adjunta, y pulse en <strong className="text-amber-800 dark:text-amber-300">Aceptar y Quitar Alerta</strong> para remover la fijación.
              </p>
            </div>
          </div>

          <div className="space-y-6 max-h-[62vh] overflow-y-auto pr-1.5 custom-scrollbar">
            {loadingSeguimiento ? (
              <div className="space-y-4 animate-pulse py-2">
                <div className="bg-slate-100 dark:bg-slate-800 rounded-3xl h-44 w-full" />
                <div className="bg-slate-100 dark:bg-slate-800 rounded-3xl h-44 w-full" />
              </div>
            ) : pinnedEntradas.length === 0 ? (
              <div className="py-12 text-center text-slate-400 dark:text-slate-500 font-medium">
                No hay alertas de seguimiento fijadas sobre este registro.
              </div>
            ) : (
              pinnedEntradas.map((entry) => {
                const userColor = entry.usuario?.color || '#475569'
                const Config = TIPO_CONFIG[entry.tipo] || TIPO_CONFIG.nota
                const Icon = Config.icon
                const hasImages = entry.imagenes && entry.imagenes.length > 0

              return (
                <div
                  key={entry.id}
                  className="bg-slate-50/50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 rounded-[1.5rem] p-5 space-y-4 relative shadow-sm hover:shadow-md hover:border-slate-350 dark:hover:border-slate-700 transition-all duration-300"
                >
                  {/* Cabecera Premium */}
                  <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-200/50 dark:border-slate-850">
                    <div className="flex items-center gap-2.5">
                      {/* Avatar con sombra e iniciales */}
                      <span
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-black shadow-md border-2 border-white dark:border-slate-800 transition-transform hover:scale-105"
                        style={{
                          backgroundColor: userColor,
                          boxShadow: `0 4px 10px ${userColor}33`
                        }}
                      >
                        {entry.usuario?.nombre?.substring(0, 1).toUpperCase() || 'S'}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-slate-800 dark:text-slate-205 leading-none">
                          {entry.usuario?.nombre || 'Sistema'}
                        </span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[9px] font-extrabold bg-slate-200/70 dark:bg-slate-800 text-slate-600 px-1.5 py-0.2 rounded uppercase tracking-wider">
                            {entry.usuario?.rol || 'operador'}
                          </span>
                          <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded border uppercase tracking-wider flex items-center gap-0.5 ${Config.color}`}>
                            <Icon size={9} />
                            {Config.label}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
                      <Calendar size={11} />
                      <span className="text-[10px] font-semibold">
                        {entry.creado_en ? new Date(entry.creado_en).toLocaleString('es-VE', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true
                        }) : ''}
                      </span>
                    </div>
                  </div>

                  {/* Detalle del Contenido */}
                  <div className="space-y-4">
                    {/* Texto con borde lateral del color del creador */}
                    <div
                      className="pl-3.5 border-l-2 rounded-r-lg py-0.5"
                      style={{ borderLeftColor: userColor }}
                    >
                      <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold whitespace-pre-line leading-relaxed">
                        {entry.contenido}
                      </p>
                    </div>

                    {/* Imágenes de Evidencia en Detalle */}
                    {hasImages && (
                      <div className="pt-1">
                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <ImageIcon size={10} /> Evidencia Visual Adjunta
                        </p>
                        
                        {entry.imagenes.length === 1 ? (
                          /* 1 Imagen: Mostrar completa y grande sin deformaciones */
                          <div
                            onClick={() => setActiveImage(entry.imagenes[0])}
                            className="relative rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden cursor-zoom-in hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-2 min-h-[160px] max-h-72"
                          >
                            <img
                              src={entry.imagenes[0]}
                              alt="Evidencia detallada"
                              className="max-h-64 max-w-full object-contain rounded-xl select-none"
                            />
                            <div className="absolute inset-0 bg-black/[0.03] hover:bg-black/10 transition-colors flex items-center justify-center rounded-2xl">
                              <span className="bg-black/70 backdrop-blur-md text-[10px] font-black text-white px-3.5 py-2 rounded-full flex items-center gap-1.5 shadow-lg transform scale-95 hover:scale-100 transition-transform">
                                <ZoomIn size={12} className="text-emerald-400" />
                                Ampliar Evidencia
                              </span>
                            </div>
                          </div>
                        ) : (
                          /* Múltiples Imágenes: Cuadrícula visual premium sin deformaciones */
                          <div className={`grid gap-3 ${entry.imagenes.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                            {entry.imagenes.map((imgUrl, i) => (
                              <div
                                key={i}
                                onClick={() => setActiveImage(imgUrl)}
                                className="relative aspect-video rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden cursor-zoom-in hover:shadow hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-1"
                              >
                                <img
                                  src={imgUrl}
                                  alt={`Evidencia ${i + 1}`}
                                  className="max-w-full max-h-full object-contain rounded-lg"
                                />
                                <div className="absolute inset-0 bg-black/[0.03] hover:bg-black/10 transition-colors flex items-center justify-center rounded-xl">
                                  <span className="bg-black/70 backdrop-blur-md text-[9px] font-black text-white px-2.5 py-1.5 rounded-full flex items-center gap-1 shadow-md">
                                    <ZoomIn size={10} className="text-emerald-400" />
                                    Ampliar
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Fila 3: Entidades Relacionadas (Fichas Detalladas Premium) */}
                  {(entry.cliente_id || entry.cotizacion_id || entry.despacho_id) && (
                    <div className="mt-4 p-4 bg-slate-50/50 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl space-y-3 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-3 rounded bg-indigo-500"></span>
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-450 uppercase tracking-widest">Registros Relacionados</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Ficha Detallada de Cliente */}
                        {entry.cliente && (
                          <div className="bg-white dark:bg-slate-950 border border-slate-150 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between transition-all duration-300 group/client relative overflow-hidden">
                            <div>
                              <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-850 pb-2.5 mb-2.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/35 flex items-center justify-center text-indigo-650 dark:text-indigo-400 shrink-0">
                                    <User size={14} />
                                  </div>
                                  <div className="min-w-0">
                                    <h5 className="text-[11px] font-black text-slate-800 dark:text-slate-205 leading-tight truncate" title={entry.cliente.nombre}>
                                      {entry.cliente.nombre}
                                    </h5>
                                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">Cliente Registrado</span>
                                  </div>
                                </div>
                                {entry.cliente.codigo_cliente && (
                                  <span className="text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded font-mono shrink-0">
                                    {entry.cliente.codigo_cliente}
                                  </span>
                                )}
                              </div>

                              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
                                <div>
                                  <span className="text-slate-400 dark:text-slate-500 font-semibold block leading-none">RIF / Cédula</span>
                                  <span className="text-slate-700 dark:text-slate-300 font-bold mt-1 block">{entry.cliente.rif_cedula || '—'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 dark:text-slate-500 font-semibold block leading-none">Teléfono</span>
                                  <span className="text-slate-700 dark:text-slate-300 font-bold mt-1 block">{entry.cliente.telefono || '—'}</span>
                                </div>
                                <div className="col-span-2">
                                  <span className="text-slate-400 dark:text-slate-500 font-semibold block leading-none">Ubicación</span>
                                  <span className="text-slate-700 dark:text-slate-300 font-bold mt-1 block truncate">
                                    {entry.cliente.ciudad || entry.cliente.estado 
                                      ? `${entry.cliente.ciudad || ''}${entry.cliente.ciudad && entry.cliente.estado ? ', ' : ''}${entry.cliente.estado || ''}`
                                      : entry.cliente.direccion || '—'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 dark:text-slate-500 font-semibold block leading-none">Vendedor</span>
                                  <span className="text-slate-700 dark:text-slate-300 font-bold mt-1 flex items-center gap-1.5">
                                    <span 
                                      className="w-1.5 h-1.5 rounded-full shrink-0" 
                                      style={{ backgroundColor: entry.cliente.vendedor?.color || '#94a3b8' }}
                                    />
                                    <span className="truncate">{entry.cliente.vendedor?.nombre || 'No asignado'}</span>
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 dark:text-slate-500 font-semibold block leading-none">Estado de Cuenta</span>
                                  <span className="mt-1 block">
                                    {Number(entry.cliente.saldo_pendiente || 0) > 0 ? (
                                      <span className="inline-flex text-[9px] font-black text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 px-1.5 py-0.5 rounded">
                                        Deuda: ${Number(entry.cliente.saldo_pendiente).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                      </span>
                                    ) : (
                                      <span className="inline-flex text-[9px] font-black text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-250 dark:border-emerald-900 px-1.5 py-0.5 rounded">
                                        Al día ✓
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => abrirFichaCliente(entry.cliente_id)}
                              className="mt-3.5 w-full flex items-center justify-between text-[10px] font-black text-indigo-650 dark:text-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50 dark:hover:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 hover:border-indigo-200 px-3 py-2 rounded-xl transition-all shadow-sm active:scale-[0.98]"
                            >
                              <span>Ver Ficha de Cliente</span>
                              <ChevronRight size={12} className="text-indigo-500" />
                            </button>
                          </div>
                        )}

                        {/* Ficha Detallada de Despacho */}
                        {entry.despacho && (
                          <div className="bg-white dark:bg-slate-950 border border-slate-150 dark:border-slate-800 hover:border-sky-200 dark:hover:border-sky-800 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between transition-all duration-300 group/dispatch relative overflow-hidden">
                            <div>
                              <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-850 pb-2.5 mb-2.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-7 h-7 rounded-lg bg-sky-50 dark:bg-sky-950/35 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
                                    <ImageIcon size={14} />
                                  </div>
                                  <div className="min-w-0">
                                    <h5 className="text-[11px] font-black text-slate-800 dark:text-slate-205 leading-tight font-mono">
                                      DES-{String(entry.despacho.numero).padStart(5, '0')}
                                    </h5>
                                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">Orden de Despacho</span>
                                  </div>
                                </div>
                                {(() => {
                                  const config = {
                                    pendiente: 'bg-amber-55 dark:bg-amber-950/25 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-900',
                                    despachada: 'bg-blue-50 dark:bg-blue-950/25 text-blue-800 dark:text-blue-400 border-blue-200 dark:border-blue-900',
                                    entregada: 'bg-emerald-50 dark:bg-emerald-950/25 text-emerald-850 dark:text-emerald-400 border-emerald-255 dark:border-emerald-900',
                                    anulada: 'bg-rose-50 dark:bg-rose-950/25 text-rose-800 dark:text-rose-400 border-rose-200 dark:border-rose-900'
                                  }[entry.despacho.estado] || 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'

                                  const label = {
                                    pendiente: 'Pendiente',
                                    despachada: 'En Ruta',
                                    entregada: 'Entregada',
                                    anulada: 'Anulada'
                                  }[entry.despacho.estado] || entry.despacho.estado

                                  return (
                                    <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border uppercase tracking-wider ${config}`}>
                                      {label}
                                    </span>
                                  )
                                })()}
                              </div>

                              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
                                <div>
                                  <span className="text-slate-400 dark:text-slate-500 font-semibold block leading-none">Monto Total</span>
                                  <span className="text-slate-900 dark:text-slate-200 font-black mt-1 block">
                                    ${Number(entry.despacho.total_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 dark:text-slate-500 font-semibold block leading-none">Flete / Corte</span>
                                  <span className="text-slate-700 dark:text-slate-350 font-bold mt-1 block">
                                    F: ${Number(entry.despacho.flete_usd || 0).toFixed(1)} | C: ${Number(entry.despacho.corte_usd || 0).toFixed(1)}
                                  </span>
                                </div>
                                <div className="col-span-2">
                                  <span className="text-slate-400 dark:text-slate-500 font-semibold block leading-none">Forma de Pago</span>
                                  <span className="text-slate-700 dark:text-slate-350 font-bold mt-1 block truncate" title={(() => {
                                    if (!entry.despacho.forma_pago) return 'No especificada'
                                    try {
                                      const parsed = typeof entry.despacho.forma_pago === 'string' 
                                        ? JSON.parse(entry.despacho.forma_pago) 
                                        : entry.despacho.forma_pago
                                      if (Array.isArray(parsed)) {
                                        return parsed.map(f => `${f.metodo}: $${Number(f.monto || 0).toFixed(1)}`).join(' | ')
                                      }
                                    } catch {}
                                    return String(entry.despacho.forma_pago)
                                  })()}>
                                    {(() => {
                                      if (!entry.despacho.forma_pago) return 'No especificada'
                                      try {
                                        const parsed = typeof entry.despacho.forma_pago === 'string' 
                                          ? JSON.parse(entry.despacho.forma_pago) 
                                          : entry.despacho.forma_pago
                                        if (Array.isArray(parsed)) {
                                          return parsed.map(f => `${f.metodo}: $${Number(f.monto || 0).toFixed(0)}`).join(', ')
                                        }
                                      } catch {}
                                      return String(entry.despacho.forma_pago)
                                    })()}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 dark:text-slate-500 font-semibold block leading-none">Vendedor</span>
                                  <span className="text-slate-700 dark:text-slate-350 font-bold mt-1 flex items-center gap-1.5">
                                    <span 
                                      className="w-1.5 h-1.5 rounded-full shrink-0" 
                                      style={{ backgroundColor: entry.despacho.vendedor?.color || '#94a3b8' }}
                                    />
                                    <span className="truncate">{entry.despacho.vendedor?.nombre || '—'}</span>
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 dark:text-slate-500 font-semibold block leading-none">Fecha de Creación</span>
                                  <span className="text-slate-700 dark:text-slate-350 font-bold mt-1 block">
                                    {new Date(entry.despacho.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => abrirDetalle(entry.despacho_id, 'despacho')}
                              className="mt-3.5 w-full flex items-center justify-between text-[10px] font-black text-sky-700 dark:text-sky-400 bg-sky-50/40 dark:bg-sky-950/20 hover:bg-sky-50 dark:hover:bg-sky-950 border border-sky-100 dark:border-sky-900 hover:border-sky-200 px-3 py-2 rounded-xl transition-all shadow-sm active:scale-[0.98]"
                            >
                              <span>Ver Detalle de Despacho</span>
                              <ChevronRight size={12} className="text-sky-655" />
                            </button>
                          </div>
                        )}

                        {/* Ficha de Cotización */}
                        {entry.cotizacion && !entry.despacho && (
                          <div className="bg-white dark:bg-slate-950 border border-slate-150 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between transition-all duration-300 group/cotizacion relative overflow-hidden col-span-1">
                            <div>
                              <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-850 pb-2.5 mb-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/35 flex items-center justify-center text-indigo-750 dark:text-indigo-400">
                                    <FileText size={14} />
                                  </div>
                                  <div>
                                    <h5 className="text-[11px] font-black text-slate-800 dark:text-slate-205 leading-none font-mono">
                                      COT-{String(entry.cotizacion.numero).padStart(5, '0')}
                                    </h5>
                                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">Documento de Cotización</span>
                                  </div>
                                </div>
                              </div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                                Esta novedad está vinculada a una cotización de origen. Pulse el botón inferior para abrir la vista interactiva con el desglose de productos y versiones.
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => abrirDetalle(entry.cotizacion_id, 'cotizacion')}
                              className="mt-3.5 w-full flex items-center justify-between text-[10px] font-black text-indigo-650 dark:text-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50 dark:hover:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 hover:border-indigo-200 px-3 py-2 rounded-xl transition-all shadow-sm active:scale-[0.98]"
                            >
                              <span>Ver Detalle de Cotización</span>
                              <ChevronRight size={12} className="text-indigo-500" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Acciones de Tarjeta: Aceptar (Remover fijado) */}
                  <div className="pt-3 border-t border-slate-200/50 dark:border-slate-850 flex justify-end">
                    <button
                      type="button"
                      disabled={actualizarSeguimiento.isPending}
                      onClick={() => handleAceptar(entry.id)}
                      className="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-black rounded-xl flex items-center gap-2 transition-all duration-200 shadow-md active:scale-[0.98] select-none hover:shadow-slate-850/15"
                    >
                      {actualizarSeguimiento.isPending ? (
                        <>
                          <Loader2 size={13} className="animate-spin" />
                          Procesando...
                        </>
                      ) : (
                        <>
                          <Check size={14} strokeWidth={3} className="text-emerald-400" />
                          Aceptar y Quitar Alerta
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )
            }))}
          </div>

          {/* Footer general del modal */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
            <span>{pinnedEntradas.length} {pinnedEntradas.length === 1 ? 'alerta activa' : 'alertas activas'}</span>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-350 text-xs font-bold rounded-xl transition-colors"
            >
              Cerrar Ventana
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal para Visualización de Imagen en Pantalla Completa Lightbox Premium */}
      {activeImage && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/95 backdrop-blur-md animate-in fade-in duration-300">
          {/* Fondo interactivo */}
          <div className="absolute inset-0" onClick={() => setActiveImage(null)} />

          <div className="relative max-w-4xl w-full rounded-3xl overflow-hidden shadow-2xl border border-slate-900/50 flex flex-col z-10">
            {/* Header lightbox */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900/80 border-b border-slate-800 backdrop-blur">
              <span className="text-xs font-black text-white flex items-center gap-2">
                <ImageIcon size={14} className="text-slate-400" />
                Evidencia en Alta Resolución
              </span>
              <button
                onClick={() => setActiveImage(null)}
                className="p-1.5 rounded-full bg-slate-800 hover:bg-red-500 text-slate-400 hover:text-white transition-all hover:scale-105"
              >
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>

            {/* Imagen Principal */}
            <div className="bg-slate-950 flex items-center justify-center p-2 min-h-[50vh] max-h-[75vh]">
              <img
                src={activeImage}
                alt="Evidencia en tamaño completo"
                className="max-w-full max-h-[75vh] object-contain rounded-xl shadow-inner select-none"
              />
            </div>

            {/* Footer lightbox */}
            <div className="px-5 py-3 bg-slate-900/85 border-t border-slate-800 flex justify-end gap-2.5 backdrop-blur">
              <button
                onClick={() => handleDownload(activeImage)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-xs font-bold rounded-xl text-white transition-all flex items-center gap-1.5 active:scale-95 shadow-md"
              >
                <Download size={13} />
                Descargar Imagen
              </button>
              <a
                href={activeImage}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-slate-800 text-xs font-bold rounded-xl text-slate-200 hover:bg-slate-700 hover:text-white transition-all flex items-center gap-1.5"
              >
                <ExternalLink size={13} />
                Abrir Original
              </a>
              <button
                onClick={() => setActiveImage(null)}
                className="px-4 py-2 bg-white text-xs font-black rounded-xl text-slate-900 hover:bg-slate-100 transition-all active:scale-95"
              >
                Cerrar Vista
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
