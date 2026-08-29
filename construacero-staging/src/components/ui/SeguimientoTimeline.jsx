import { useState, useRef } from 'react'
import { MessageSquare, AlertCircle, FileText, Image as ImageIcon, Pin, CheckCircle2, User, Send, Trash2, Camera, Loader2, X, AlertTriangle, Pencil, Download, ChevronRight } from 'lucide-react'
import { useSeguimiento, useCrearSeguimiento, useActualizarSeguimiento, useBorrarSeguimiento } from '../../hooks/useSeguimiento'
import { comprimirImagen, subirImagenSeguimiento } from '../../utils/imageCompress'
import supabase from '../../services/supabase/client'
import useAuthStore from '../../store/useAuthStore'
import { showToast } from './Toast'
import ConfirmModal from './ConfirmModal'
import FichaClienteModal from '../clientes/FichaClienteModal'
import DetalleModal from './DetalleModal'


export default function SeguimientoTimeline({ clienteId, cotizacionId, despachoId }) {
  const { data: entradas = [], isLoading } = useSeguimiento({ clienteId, cotizacionId, despachoId })
  const crearEntrada = useCrearSeguimiento()
  const actualizarEntrada = useActualizarSeguimiento()
  const borrarEntrada = useBorrarSeguimiento()
  const { perfil } = useAuthStore()

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

  const [tipo, setTipo] = useState('nota')
  const [prioridad, setPrioridad] = useState('informativa')
  const [contenido, setContenido] = useState('')
  const [fijada, setFijada] = useState(true)
  const [imgFiles, setImgFiles] = useState([])
  const [subiendoImg, setSubiendoImg] = useState(false)
  const [subiendoImgEdit, setSubiendoImgEdit] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [editImages, setEditImages] = useState([])
  const [activeImage, setActiveImage] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const fileInputRef = useRef(null)

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
    } catch (err) {
      console.error('Error al descargar:', err)
      window.open(url, '_blank')
    }
  }

  const esPrivilegiado = ['supervisor', 'administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)

  // Colores y badges
  const TIPO_CONFIG = {
    nota: { label: 'Nota', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: MessageSquare },
    incidencia: { label: 'Incidencia', color: 'bg-rose-50 text-rose-700 border-rose-200', icon: AlertCircle },
    aclaratoria: { label: 'Aclaratoria', color: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: FileText },
    seguimiento: { label: 'Seguimiento', color: 'bg-sky-50 text-sky-700 border-sky-200', icon: CheckCircle2 },
    evidencia: { label: 'Evidencia', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: ImageIcon },
    resolucion: { label: 'Resolución', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  }

  const PRIORIDAD_CONFIG = {
    informativa: { label: 'Informativa', badge: 'bg-slate-100 text-slate-600 border border-slate-200' },
    pendiente: { label: 'Pendiente', badge: 'bg-amber-100 text-amber-800 border border-amber-200' },
    resuelta: { label: 'Resuelta', badge: 'bg-emerald-100 text-emerald-800 border border-emerald-200' },
    urgente: { label: 'Urgente', badge: 'bg-rose-100 text-rose-800 border border-rose-200 animate-pulse' },
  }

  async function handleAgregarEntrada(e) {
    e.preventDefault()
    if (!contenido.trim() || subiendoImg) return

    setSubiendoImg(true)
    try {
      const urls = []
      // Comprimir y subir imágenes
      for (const file of imgFiles) {
        const compressed = await comprimirImagen(file, { maxSize: 400, quality: 0.6 })
        const uniqueName = `${crypto.randomUUID()}`
        const url = await subirImagenSeguimiento(supabase, uniqueName, compressed.blob)
        urls.push(url)
      }

      await crearEntrada.mutateAsync({
        cliente_id: clienteId,
        cotizacion_id: cotizacionId,
        despacho_id: despachoId,
        tipo,
        prioridad,
        contenido: contenido.trim(),
        imagenes: urls,
        fijada
      })

      showToast.success('Entrada registrada en el historial')
      // Resetear
      setContenido('')
      setFijada(true)
      setImgFiles([])
      setTipo('nota')
      setPrioridad('informativa')
    } catch (err) {
      console.error('Error al crear nota:', err)
      showToast.error(err.message || 'Error al guardar la entrada')
    } finally {
      setSubiendoImg(false)
    }
  }

  function handleFileChange(e) {
    if (e.target.files) {
      const files = Array.from(e.target.files)
      if (files.length + imgFiles.length > 3) {
        showToast.warning('Máximo 3 imágenes de evidencia')
        e.target.value = ''
        return
      }
      setImgFiles(prev => [...prev, ...files])
      e.target.value = ''
    }
  }

  function quitarFile(idx) {
    setImgFiles(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleEditFileChange(e) {
    if (e.target.files) {
      const files = Array.from(e.target.files)
      if (files.length + editImages.length > 3) {
        showToast.warning('Máximo 3 imágenes de evidencia en total')
        e.target.value = ''
        return
      }
      
      setSubiendoImgEdit(true)
      try {
        const urls = [...editImages]
        for (const file of files) {
          const compressed = await comprimirImagen(file, { maxSize: 400, quality: 0.6 })
          const uniqueName = `${crypto.randomUUID()}`
          const url = await subirImagenSeguimiento(supabase, uniqueName, compressed.blob)
          urls.push(url)
        }
        setEditImages(urls)
        showToast.success('Evidencia fotográfica cargada correctamente')
      } catch (err) {
        console.error('Error al subir imagen en edición:', err)
        showToast.error('Error al subir e integrar la imagen')
      } finally {
        setSubiendoImgEdit(false)
        e.target.value = ''
      }
    }
  }

  function toggleFijar(entrada) {
    actualizarEntrada.mutate({
      id: entrada.id,
      fijada: !entrada.fijada
    })
  }

  function toggleResuelta(entrada) {
    const nuevaPrioridad = entrada.prioridad === 'resuelta' ? 'pendiente' : 'resuelta'
    const nuevoTipo = nuevaPrioridad === 'resuelta' ? 'resolucion' : entrada.tipo
    actualizarEntrada.mutate({
      id: entrada.id,
      prioridad: nuevaPrioridad,
      tipo: nuevoTipo
    })
  }

  async function handleGuardarEdicion(id) {
    if (!editContent.trim()) return
    try {
      await actualizarEntrada.mutateAsync({
        id,
        contenido: editContent.trim(),
        imagenes: editImages
      })
      setEditingId(null)
      showToast.success('Cambios guardados correctamente')
    } catch (err) {
      console.error('Error al editar nota:', err)
      showToast.error(err.message || 'Error al guardar la edición')
    }
  }

  return (
    <div className="space-y-4">
      {/* Resumen / Alertas arriba */}
      {entradas.some(e => e.prioridad === 'urgente' || e.prioridad === 'pendiente') && (
        <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-3.5 flex items-start gap-3 shadow-sm transition-all duration-300">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5 animate-bounce" size={18} />
          <div>
            <p className="text-xs font-bold text-red-800">Alertas operativas activas</p>
            <p className="text-[11px] text-red-700 mt-0.5 leading-relaxed">
              Existen <span className="font-bold">{entradas.filter(e => e.prioridad === 'urgente').length}</span> incidentes urgentes y <span className="font-bold">{entradas.filter(e => e.prioridad === 'pendiente').length}</span> seguimientos pendientes sobre este registro.
            </p>
          </div>
        </div>
      )}

      {/* Formulario de entrada rápida */}
      <form onSubmit={handleAgregarEntrada} className="bg-white border border-slate-200/80 rounded-2xl p-4 space-y-4 shadow-sm hover:shadow-md transition-shadow duration-300">
        <div className="flex flex-wrap gap-2 items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-bold text-slate-700 tracking-wide">Nueva Entrada de Seguimiento</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFijada(!fijada)}
              className={`p-1.5 rounded-lg border transition-all duration-200 ${fijada ? 'bg-amber-50 border-amber-300 text-amber-600 shadow-sm' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
              title={fijada ? "Desfijar de la parte superior" : "Fijar en la parte superior"}
            >
              <Pin size={14} className={fijada ? 'fill-amber-500' : ''} />
            </button>
          </div>
        </div>

        {/* Tipos y Prioridades */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Tipo de entrada</label>
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none transition-all cursor-pointer font-medium text-slate-700"
            >
              <option value="nota">Nota informativa</option>
              <option value="incidencia">Incidencia / Problema</option>
              <option value="aclaratoria">Aclaratoria</option>
              <option value="seguimiento">Seguimiento</option>
              <option value="evidencia">Evidencia visual</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Prioridad / Estado</label>
            <select
              value={prioridad}
              onChange={e => setPrioridad(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none transition-all cursor-pointer font-medium text-slate-700"
            >
              <option value="informativa">Informativa (Normal)</option>
              <option value="pendiente">Pendiente (Requiere acción)</option>
              <option value="urgente">Urgente (Bloqueante)</option>
            </select>
          </div>
        </div>

        {/* Texto de la nota */}
        <div className="relative">
          <textarea
            value={contenido}
            onChange={e => setContenido(e.target.value)}
            placeholder="Escribe una observación, acuerdo o incidente relevante..."
            rows={3}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 pr-10 focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none placeholder-slate-400 text-slate-700 resize-none transition-all"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute right-3 bottom-3 p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-200/50 transition-colors"
            title="Adjuntar evidencia fotográfica"
            disabled={subiendoImg}
          >
            <Camera size={16} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            multiple
            className="hidden"
          />
        </div>

        {/* Listado de adjuntos listos para subir */}
        {imgFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2 bg-slate-50 border border-slate-100 rounded-xl">
            {imgFiles.map((file, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 bg-white border border-slate-200/80 pl-2 pr-1.5 py-1 rounded-lg text-[10px] font-semibold text-slate-600 shadow-sm">
                <ImageIcon size={11} className="text-slate-400" />
                <span className="truncate max-w-[120px]">{file.name}</span>
                <button
                  type="button"
                  onClick={() => quitarFile(i)}
                  className="h-4 w-4 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-red-500 transition-colors text-[12px] font-bold"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={!contenido.trim() || subiendoImg}
          className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white disabled:opacity-50 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all duration-200 shadow-sm active:scale-[0.98]"
        >
          {subiendoImg ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Procesando y subiendo archivos...
            </>
          ) : (
            <>
              <Send size={14} />
              Registrar Novedad
            </>
          )}
        </button>
      </form>

      {/* Timeline de Novedades */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-slate-400 bg-white rounded-2xl border border-slate-100">
          <Loader2 size={20} className="animate-spin mr-2.5 text-primary" />
          <span className="text-xs font-medium">Cargando historial operativo...</span>
        </div>
      ) : entradas.length === 0 ? (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl py-8 px-4 text-center">
          <MessageSquare className="mx-auto text-slate-300 mb-2" size={24} />
          <p className="text-xs text-slate-400 font-medium">Sin novedades operativas registradas aún.</p>
        </div>
      ) : (
        <div className="relative border-l-2 border-slate-100 pl-5 ml-3.5 space-y-4 pt-1">
          {entradas.map(entry => {
            const Config = TIPO_CONFIG[entry.tipo] || TIPO_CONFIG.nota
            const Pri = PRIORIDAD_CONFIG[entry.prioridad] || PRIORIDAD_CONFIG.informativa
            const Icon = Config.icon
            const userColor = entry.usuario?.color || '#64748b'

            return (
              <div key={entry.id} className="relative group transition-all duration-200">
                {/* Icono del Timeline */}
                <span className={`absolute -left-[31px] top-1.5 w-6 h-6 rounded-full border-2 border-white flex items-center justify-center shadow-sm text-xs ${Config.color} transition-transform group-hover:scale-110`}>
                  <Icon size={12} />
                </span>

                <div className={`p-4 rounded-2xl border transition-all duration-300 ${entry.fijada ? 'bg-amber-50/20 border-amber-200 shadow-sm' : 'bg-white border-slate-100 hover:border-slate-200/80 hover:shadow-sm'}`}>
                  {/* Fila superior: Tipo, Autor, Fecha */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${Config.color}`}>
                        {Config.label}
                      </span>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${Pri.badge}`}>
                        {Pri.label}
                      </span>
                      {entry.fijada && (
                        <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200/60 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                          <Pin size={9} className="fill-amber-500" /> FIJADO
                        </span>
                      )}
                    </div>

                    {/* Acciones */}
                    <div className="flex items-center gap-1">
                      {entry.usuario_id === perfil?.id && (
                        <button
                          onClick={() => { setEditingId(entry.id); setEditContent(entry.contenido); setEditImages(entry.imagenes || []); }}
                          className="p-1.5 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-indigo-600 transition-colors"
                          title="Editar contenido"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                      {entry.usuario_id === perfil?.id && (
                        <button
                          onClick={() => toggleFijar(entry)}
                          className={`p-1.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-400 ${entry.fijada ? 'text-amber-500 hover:text-amber-600' : 'hover:text-amber-500'}`}
                          title={entry.fijada ? "Desfijar de arriba" : "Fijar arriba"}
                        >
                          <Pin size={12} className={entry.fijada ? 'fill-amber-500' : ''} />
                        </button>
                      )}
                      {(entry.prioridad === 'pendiente' || entry.prioridad === 'resuelta' || entry.prioridad === 'urgente') && entry.usuario_id === perfil?.id && (
                        <button
                          onClick={() => toggleResuelta(entry)}
                          className={`p-1.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-400 ${entry.prioridad === 'resuelta' ? 'text-emerald-500 hover:text-emerald-600' : 'hover:text-emerald-500'}`}
                          title={entry.prioridad === 'resuelta' ? 'Marcar como pendiente' : 'Marcar como resuelta'}
                        >
                          <CheckCircle2 size={12} className={entry.prioridad === 'resuelta' ? 'fill-emerald-50 text-emerald-500' : ''} />
                        </button>
                      )}
                      {entry.usuario_id === perfil?.id && (
                        <button
                          onClick={() => setConfirmDeleteId(entry.id)}
                          className="p-1.5 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-rose-600 transition-colors"
                          title="Eliminar registro"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Contenido de la nota */}
                  {editingId === entry.id ? (
                    <div className="mt-2.5 space-y-2">
                      <div className="relative">
                        <textarea
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 pr-10 focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none placeholder-slate-400 text-slate-700 resize-none transition-all"
                          rows={3}
                          disabled={subiendoImgEdit}
                        />
                        <input
                          type="file"
                          id={`edit-file-input-${entry.id}`}
                          onChange={handleEditFileChange}
                          accept="image/*"
                          multiple
                          className="hidden"
                        />
                      </div>
                      
                      {/* Imágenes adjuntas en edición */}
                      {editImages.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {editImages.map((imgUrl, i) => (
                            <div key={i} className="relative w-14 h-14">
                              <div className="w-full h-full rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                                <img src={imgUrl} alt="Evidencia en edición" className="w-full h-full object-cover" />
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditImages(prev => prev.filter((_, idx) => idx !== i))}
                                className="absolute -top-1.5 -right-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-full p-1 shadow-md hover:scale-110 active:scale-95 transition-all flex items-center justify-center cursor-pointer z-10"
                                title="Eliminar imagen"
                                style={{ width: '18px', height: '18px', fontSize: '9px', fontWeight: 'bold' }}
                                disabled={subiendoImgEdit}
                              >
                                <X size={10} strokeWidth={3} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
 
                      <div className="flex flex-wrap gap-2 justify-between items-center mt-3 pt-2 border-t border-slate-100/50">
                        {/* Botón premium para adjuntar imágenes */}
                        <button
                          type="button"
                          onClick={() => document.getElementById(`edit-file-input-${entry.id}`)?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-600 hover:text-slate-800 rounded-xl text-[10px] font-bold border border-slate-200/60 transition-all duration-200 disabled:opacity-50"
                          disabled={subiendoImgEdit}
                          title="Añadir evidencia o soporte fotográfico"
                        >
                          {subiendoImgEdit ? (
                            <Loader2 size={12} className="animate-spin text-primary" />
                          ) : (
                            <Camera size={12} />
                          )}
                          <span>{subiendoImgEdit ? 'Subiendo...' : 'Adjuntar Imagen'}</span>
                        </button>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-bold transition-all disabled:opacity-50"
                            disabled={subiendoImgEdit}
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGuardarEdicion(entry.id)}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-[10px] font-bold transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-sm active:scale-[0.98]"
                            disabled={!editContent.trim() || subiendoImgEdit}
                          >
                            {subiendoImgEdit ? (
                              <>
                                <Loader2 size={11} className="animate-spin" />
                                Subiendo...
                              </>
                            ) : (
                              'Guardar'
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-slate-700 mt-2.5 whitespace-pre-line leading-relaxed font-medium">
                        {entry.contenido}
                      </p>
                      {/* Imágenes de soporte */}
                      {entry.imagenes && entry.imagenes.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {entry.imagenes.map((imgUrl, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setActiveImage(imgUrl)}
                              className="w-14 h-14 rounded-xl border border-slate-200/80 overflow-hidden bg-slate-50 flex items-center justify-center hover:opacity-90 hover:scale-105 transition-all shadow-sm active:scale-95 cursor-pointer"
                            >
                              <img src={imgUrl} alt="Evidencia de soporte" className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* Fila 3: Entidades Relacionadas (Fichas Detalladas Premium) */}
                  {(entry.cliente_id || entry.cotizacion_id || entry.despacho_id) && (
                    <div className="mt-4 p-4 bg-slate-50/50 border border-slate-200/50 rounded-2xl space-y-3 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-3 rounded bg-indigo-500"></span>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Registros Relacionados</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Ficha Detallada de Cliente */}
                        {entry.cliente && (
                          <div className="bg-white border border-slate-150 hover:border-indigo-200 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between transition-all duration-300 group/client relative overflow-hidden">
                            <div>
                              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5 mb-2.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-650 shrink-0">
                                    <User size={14} />
                                  </div>
                                  <div className="min-w-0">
                                    <h5 className="text-[11px] font-black text-slate-800 leading-tight truncate" title={entry.cliente.nombre}>
                                      {entry.cliente.nombre}
                                    </h5>
                                    <span className="text-[9px] font-bold text-slate-400">Cliente Registrado</span>
                                  </div>
                                </div>
                                {entry.cliente.codigo_cliente && (
                                  <span className="text-[9px] font-bold bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-mono shrink-0">
                                    {entry.cliente.codigo_cliente}
                                  </span>
                                )}
                              </div>

                              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
                                <div>
                                  <span className="text-slate-400 font-semibold block leading-none">RIF / Cédula</span>
                                  <span className="text-slate-700 font-bold mt-1 block">{entry.cliente.rif_cedula || '—'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-semibold block leading-none">Teléfono</span>
                                  <span className="text-slate-700 font-bold mt-1 block">{entry.cliente.telefono || '—'}</span>
                                </div>
                                <div className="col-span-2">
                                  <span className="text-slate-400 font-semibold block leading-none">Ubicación</span>
                                  <span className="text-slate-700 font-bold mt-1 block truncate">
                                    {entry.cliente.ciudad || entry.cliente.estado 
                                      ? `${entry.cliente.ciudad || ''}${entry.cliente.ciudad && entry.cliente.estado ? ', ' : ''}${entry.cliente.estado || ''}`
                                      : entry.cliente.direccion || '—'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-semibold block leading-none">Vendedor</span>
                                  <span className="text-slate-700 font-bold mt-1 flex items-center gap-1.5">
                                    <span 
                                      className="w-1.5 h-1.5 rounded-full shrink-0" 
                                      style={{ backgroundColor: entry.cliente.vendedor?.color || '#94a3b8' }}
                                    />
                                    <span className="truncate">{entry.cliente.vendedor?.nombre || 'No asignado'}</span>
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-semibold block leading-none">Estado de Cuenta</span>
                                  <span className="mt-1 block">
                                    {Number(entry.cliente.saldo_pendiente || 0) > 0 ? (
                                      <span className="inline-flex text-[9px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                        Deuda: ${Number(entry.cliente.saldo_pendiente).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                      </span>
                                    ) : (
                                      <span className="inline-flex text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-250 px-1.5 py-0.5 rounded">
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
                              className="mt-3.5 w-full flex items-center justify-between text-[10px] font-black text-indigo-650 bg-indigo-50/40 hover:bg-indigo-50 border border-indigo-100 hover:border-indigo-200 px-3 py-2 rounded-xl transition-all shadow-sm active:scale-[0.98]"
                            >
                              <span>Ver Ficha de Cliente</span>
                              <ChevronRight size={12} className="text-indigo-500" />
                            </button>
                          </div>
                        )}

                        {/* Ficha Detallada de Despacho */}
                        {entry.despacho && (
                          <div className="bg-white border border-slate-150 hover:border-sky-200 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between transition-all duration-300 group/dispatch relative overflow-hidden">
                            <div>
                              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5 mb-2.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-7 h-7 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600 shrink-0">
                                    <ImageIcon size={14} />
                                  </div>
                                  <div className="min-w-0">
                                    <h5 className="text-[11px] font-black text-slate-800 leading-tight font-mono">
                                      DES-{String(entry.despacho.numero).padStart(5, '0')}
                                    </h5>
                                    <span className="text-[9px] font-bold text-slate-400">Orden de Despacho</span>
                                  </div>
                                </div>
                                {(() => {
                                  const config = {
                                    pendiente: 'bg-amber-55 text-amber-800 border-amber-200',
                                    despachada: 'bg-blue-50 text-blue-800 border-blue-200',
                                    entregada: 'bg-emerald-50 text-emerald-850 border-emerald-250',
                                    anulada: 'bg-rose-50 text-rose-800 border-rose-200'
                                  }[entry.despacho.estado] || 'bg-slate-50 text-slate-700 border-slate-200'

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
                                  <span className="text-slate-400 font-semibold block leading-none">Monto Total</span>
                                  <span className="text-slate-900 font-black mt-1 block">
                                    ${Number(entry.despacho.total_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-semibold block leading-none">Flete / Corte</span>
                                  <span className="text-slate-700 font-bold mt-1 block">
                                    F: ${Number(entry.despacho.flete_usd || 0).toFixed(1)} | C: ${Number(entry.despacho.corte_usd || 0).toFixed(1)}
                                  </span>
                                </div>
                                <div className="col-span-2">
                                  <span className="text-slate-400 font-semibold block leading-none">Forma de Pago</span>
                                  <span className="text-slate-700 font-bold mt-1 block truncate" title={(() => {
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
                                  <span className="text-slate-400 font-semibold block leading-none">Vendedor</span>
                                  <span className="text-slate-700 font-bold mt-1 flex items-center gap-1.5">
                                    <span 
                                      className="w-1.5 h-1.5 rounded-full shrink-0" 
                                      style={{ backgroundColor: entry.despacho.vendedor?.color || '#94a3b8' }}
                                    />
                                    <span className="truncate">{entry.despacho.vendedor?.nombre || '—'}</span>
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-semibold block leading-none">Fecha de Creación</span>
                                  <span className="text-slate-700 font-bold mt-1 block">
                                    {new Date(entry.despacho.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => abrirDetalle(entry.despacho_id, 'despacho')}
                              className="mt-3.5 w-full flex items-center justify-between text-[10px] font-black text-sky-700 bg-sky-50/40 hover:bg-sky-50 border border-sky-100 hover:border-sky-200 px-3 py-2 rounded-xl transition-all shadow-sm active:scale-[0.98]"
                            >
                              <span>Ver Detalle de Despacho</span>
                              <ChevronRight size={12} className="text-sky-655" />
                            </button>
                          </div>
                        )}

                        {/* Ficha de Cotización */}
                        {entry.cotizacion && !entry.despacho && (
                          <div className="bg-white border border-slate-150 hover:border-indigo-200 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between transition-all duration-300 group/cotizacion relative overflow-hidden col-span-1">
                            <div>
                              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5 mb-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-750">
                                    <FileText size={14} />
                                  </div>
                                  <div>
                                    <h5 className="text-[11px] font-black text-slate-800 leading-none font-mono">
                                      COT-{String(entry.cotizacion.numero).padStart(5, '0')}
                                    </h5>
                                    <span className="text-[9px] font-bold text-slate-400">Documento de Cotización</span>
                                  </div>
                                </div>
                              </div>
                              <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                                Esta novedad está vinculada a una cotización de origen. Pulse el botón inferior para abrir la vista interactiva con el desglose de productos y versiones.
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => abrirDetalle(entry.cotizacion_id, 'cotizacion')}
                              className="mt-3.5 w-full flex items-center justify-between text-[10px] font-black text-indigo-650 bg-indigo-50/40 hover:bg-indigo-50 border border-indigo-100 hover:border-indigo-200 px-3 py-2 rounded-xl transition-all shadow-sm active:scale-[0.98]"
                            >
                              <span>Ver Detalle de Cotización</span>
                              <ChevronRight size={12} className="text-indigo-500" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Footer de la nota: Creador y timestamp */}
                  <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] text-white font-bold" style={{ backgroundColor: userColor }}>
                        {entry.usuario?.nombre?.substring(0, 1).toUpperCase() || 'S'}
                      </span>
                      <span className="font-semibold" style={{ color: userColor }}>
                        {entry.usuario?.nombre || 'Sistema'}
                      </span>
                      <span className="opacity-65 bg-slate-100 px-1 py-0.2 rounded text-[9px] uppercase tracking-wide">
                        {entry.usuario?.rol || 'sistema'}
                      </span>
                    </span>
                    <span className="font-medium text-slate-400/80">
                      {new Date(entry.creado_en).toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Overlay para ver imagen a pantalla completa (Premium) */}
      {activeImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
          <div className="relative max-w-3xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl border border-slate-100 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <ImageIcon size={14} className="text-slate-500" />
                Evidencia Adjunta
              </span>
              <button
                onClick={() => setActiveImage(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="bg-slate-950 flex items-center justify-center max-h-[70vh] p-2">
              <img src={activeImage} alt="Evidencia ampliada" className="max-w-full max-h-[70vh] object-contain rounded" />
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <a
                href={activeImage}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-1.5 bg-white border border-slate-200 text-xs font-bold rounded-lg text-slate-700 hover:bg-slate-50 transition-all flex items-center gap-1"
              >
                Abrir en pestaña nueva
              </a>
              <button
                type="button"
                onClick={() => handleDownload(activeImage)}
                className="px-3.5 py-1.5 bg-white border border-slate-200 text-xs font-bold rounded-lg text-indigo-600 hover:bg-indigo-800 hover:bg-slate-50 transition-all flex items-center gap-1"
              >
                <Download size={12} />
                Descargar Imagen
              </button>
              <button
                onClick={() => setActiveImage(null)}
                className="px-3.5 py-1.5 bg-slate-800 text-xs font-bold rounded-lg text-white hover:bg-slate-900 transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Confirmación de Eliminación Profesional */}
      <ConfirmModal
        isOpen={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={async () => {
          if (confirmDeleteId) {
            await borrarEntrada.mutateAsync(confirmDeleteId)
            showToast.success('Entrada eliminada del historial')
          }
        }}
        title="¿Eliminar registro?"
        message="¿Seguro que deseas eliminar esta entrada del historial operativo? Esta acción no se puede deshacer."
        confirmText="Eliminar"
        cancelText="Cancelar"
        variant="danger"
      />

      {/* ── Modales Compartidos e Hidratados del Módulo ── */}
      {modalOpen && modalRegistro && (
        <DetalleModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setModalRegistro(null); }}
          tipo={modalTipo}
          registro={modalRegistro}
        />
      )}

      {fichaOpen && modalCliente && (
        <FichaClienteModal
          cliente={modalCliente}
          isOpen={fichaOpen}
          onClose={() => { setFichaOpen(false); setModalCliente(null); }}
        />
      )}

      {/* Loader de Hidratación Premium */}
      {cargandoModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white px-6 py-5 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
            <Loader2 className="animate-spin text-indigo-650" size={20} />
            <span className="text-xs font-bold text-slate-700">Obteniendo ficha detallada...</span>
          </div>
        </div>
      )}
    </div>
  )
}
