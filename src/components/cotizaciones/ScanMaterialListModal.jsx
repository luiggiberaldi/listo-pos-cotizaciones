// src/components/cotizaciones/ScanMaterialListModal.jsx
// Modal para escanear listas de materiales (foto) o pegar texto (WhatsApp) - 100% CLIENT SIDE OCR & MATCHING
import { useState, useRef, useEffect, useMemo } from 'react'
import { X, Camera, Image as ImageIcon, Loader2, AlertCircle, Check, Search, Package, MessageSquareText, ClipboardPaste, AlertTriangle, Info, Clipboard } from 'lucide-react'
import { comprimirParaOCR } from '../../utils/imageToBase64'
import { useInventario } from '../../hooks/useInventario'
import { smartSearchProductos, canonicalizeOcr, findBestFuzzyCodeMatch, parsearLineaCompletaInteligente, preprocesarImagenCanvas } from '../../utils/smartSearch'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import ProductoAutocomplete from './ProductoAutocomplete'
import { showToast } from '../ui/Toast'

const PROCESSING_STEPS = [
  { icon: '🔍', text: 'Preprocesando y binarizando imagen...' },
  { icon: '🧠', text: 'Cargando motor OCR spa...' },
  { icon: '📝', text: 'Leyendo líneas de materiales...' },
  { icon: '📦', text: 'Emparejando difuso contra catálogo...' },
]

export default function ScanMaterialListModal({ open, onClose, onBulkAdd, tasa = 0 }) {
  const [phase, setPhase] = useState('capture') // capture | paste | processing | results
  const [rawAiText, setRawAiText] = useState('')
  const [preview, setPreview] = useState(null)
  const [pasteText, setPasteText] = useState('')
  const [items, setItems] = useState([])
  const [debugLog, setDebugLog] = useState('')
  const [debugCopied, setDebugCopied] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileRef = useRef(null)

  // Cargar catálogo de productos localmente para el matching
  const { data: catalogoRes } = useInventario({ pageSize: 1500 })
  const productos = useMemo(() => catalogoRes?.productos ?? catalogoRes ?? [], [catalogoRes])

  // Cicla los pasos descriptivos mientras procesa
  useEffect(() => {
    if (phase !== 'processing') { setStepIdx(0); return }
    const interval = setInterval(() => {
      setStepIdx(prev => (prev + 1) % PROCESSING_STEPS.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [phase])

  // Carga dinámica de Tesseract
  useEffect(() => {
    if (open && !window.Tesseract) {
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/tesseract.js@5.0.3/dist/tesseract.min.js'
      script.async = true
      script.onload = () => {
        console.log('Tesseract.js cargado localmente para Cotizaciones')
      }
      script.onerror = () => {
        showToast('Error cargando motor OCR local.', 'error')
      }
      document.body.appendChild(script)
      return () => {
        const s = document.querySelector('script[src*="tesseract"]')
        if (s) document.body.removeChild(s)
      }
    }
  }, [open])

  if (!open) return null

  // --- Lógica del Parser Local ---
  function parseAndMatchTextLocal(rawText) {
    if (!rawText.trim()) {
      setItems([])
      setPhase('results')
      return
    }

    setRawAiText(rawText)
    const lineas = rawText.split('\n')
    const parsedItems = []

    lineas.forEach(linea => {
      const parsed = parsearLineaCompletaInteligente(linea)
      if (!parsed) return

      // Buscar matching en el catálogo de productos
      let match = null
      let matches = []
      let searchMethod = 'Ninguno'

      // 1. Intentar por código
      if (parsed.codigo) {
        match = findBestFuzzyCodeMatch(parsed.codigo, productos)
        if (match) {
          matches = [match]
          searchMethod = `Código Fuzzy (Buscando "${parsed.codigo}")`
        }
      }

      // 2. Si no hay match por código, buscar por nombre inteligente
      if (!match && parsed.nombre) {
        // Coincidencia exacta de nombre
        match = productos.find(p => p.nombre?.toUpperCase() === parsed.nombre.toUpperCase())
        if (match) {
          matches = [match]
          searchMethod = `Nombre Exacto (Buscando "${parsed.nombre}")`
        } else {
          // Búsqueda inteligente difusa
          const results = smartSearchProductos(productos, parsed.nombre)
          if (results.length > 0) {
            matches = results.slice(0, 3)
            match = matches[0]
            searchMethod = `Búsqueda Difusa (Buscando "${parsed.nombre}")`
          }
        }
      }

      parsedItems.push({
        descripcionOriginal: parsed.nombre || linea.trim(),
        rawLinea: linea,
        cantidad: parsed.cantidad || 1,
        cantidadEdit: parsed.cantidad || 1,
        checked: !!match,
        confianza: match ? (parsed.codigo && match.codigo === parsed.codigo ? 1.0 : 0.8) : 0.2,
        matches: matches,
        selectedMatch: match,
        searchMethod: searchMethod,
        showAutocomplete: false
      })
    })

    // Debug logs
    const logLines = []
    logLines.push(`=== LOCAL SCAN DEBUG LOG ===`)
    logLines.push(`Timestamp: ${new Date().toISOString()}`)
    logLines.push(`Líneas procesadas: ${lineas.length}`)
    logLines.push(`Ítems extraídos: ${parsedItems.length}`)
    logLines.push(`-----------------------------------`)
    parsedItems.forEach((it, i) => {
      logLines.push(`LÍNEA [${i+1}]: "${it.rawLinea}"`)
      logLines.push(`  -> Extraído: Cantidad=${it.cantidad}, Nombre="${it.descripcionOriginal}"`)
      if (it.selectedMatch) {
        logLines.push(`  -> Mapeado vía: ${it.searchMethod}`)
        logLines.push(`  -> Producto Seleccionado: [${it.selectedMatch.codigo}] ${it.selectedMatch.nombre} ($${it.selectedMatch.precio_usd || 0})`)
        if (it.matches.length > 1) {
          logLines.push(`  -> Alternativas encontradas:`)
          it.matches.forEach((alt, idx) => {
            logLines.push(`     [Alt ${idx+1}] [${alt.codigo}] ${alt.nombre} (Score: ${alt._score || 'Exacto'}, Stock: ${alt.stock_actual || 0})`)
          })
        }
      } else {
        logLines.push(`  -> Mapeado vía: NINGUNO (No se encontraron coincidencias automáticas)`)
      }
      logLines.push(`-----------------------------------`)
    })
    logLines.push(`=== FIN DEBUG ===`)
    setDebugLog(logLines.join('\n'))

    setItems(parsedItems)
    setPhase('results')
  }

  function handleCopyLogs() {
    if (!debugLog) return
    navigator.clipboard.writeText(debugLog)
      .then(() => {
        setDebugCopied(true)
        showToast('Logs de búsqueda copiados al portapapeles', 'success')
        setTimeout(() => setDebugCopied(false), 3000)
      })
      .catch(err => {
        console.error('Error al copiar logs:', err)
        showToast('No se pudieron copiar los logs', 'error')
      })
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    setPreview(previewUrl)
    setPhase('processing')
    setLoading(true)
    setError(null)
    setUploadProgress(0)

    // Cargar Tesseract.js si falta
    if (!window.Tesseract) {
      let reintentos = 0
      while (!window.Tesseract && reintentos < 30) {
        await new Promise(r => setTimeout(r, 200))
        reintentos++
      }
      if (!window.Tesseract) {
        setError('No se pudo inicializar el motor de escaneo OCR local.')
        setPhase('capture')
        setLoading(false)
        return
      }
    }

    try {
      // 1. Bradley-Roth adaptive thresholding on canvas
      setUploadProgress(10)
      const canvasMejorado = await preprocesarImagenCanvas(previewUrl)
      
      // 2. Ejecutar OCR local
      setUploadProgress(30)
      const response = await window.Tesseract.recognize(
        canvasMejorado,
        'spa',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              setUploadProgress(Math.round(30 + m.progress * 70))
            }
          }
        }
      )

      const extractedText = response?.data?.text || ''
      parseAndMatchTextLocal(extractedText)
    } catch (err) {
      console.error(err)
      setError(`Error durante el escaneo local: ${err.message}`)
      setPhase('capture')
    } finally {
      setLoading(false)
      URL.revokeObjectURL(previewUrl)
    }
  }

  function handlePasteSubmit() {
    if (!pasteText.trim()) return
    setPhase('processing')
    setLoading(true)
    setError(null)
    try {
      parseAndMatchTextLocal(pasteText)
    } catch (err) {
      setError(err.message)
      setPhase('paste')
    } finally {
      setLoading(false)
    }
  }

  function handleRetry() {
    setPhase('capture')
    setPreview(null)
    setPasteText('')
    setItems([])
    setRawAiText('')
    setDebugLog('')
    setDebugCopied(false)
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function toggleItem(idx) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it))
  }

  function handleCantidadChange(idx, val) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidadEdit: val } : it))
  }

  function handleSelectMatch(idx, match) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, selectedMatch: match } : it))
  }

  function handleSelectFromAutocomplete(idx, match) {
    setItems(prev => prev.map((it, i) => i === idx ? { 
      ...it, 
      selectedMatch: match, 
      matches: [match, ...(it.matches || []).filter(m => m.id !== match.id)].slice(0, 3),
      showAutocomplete: false,
      checked: true 
    } : it))
  }

  // Define toggleAutocomplete function
  function toggleAutocomplete(idx) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, showAutocomplete: !it.showAutocomplete } : it))
  }

  function handleConfirm() {
    const toAdd = items
      .filter(it => it.checked && it.selectedMatch)
      .map(it => ({
        producto: it.selectedMatch,
        cantidad: typeof it.cantidadEdit === 'number' && it.cantidadEdit > 0 ? it.cantidadEdit : 1,
      }))
    onBulkAdd(toAdd)
    handleClose()
  }

  function handleClose() {
    setPhase('capture')
    setPreview(null)
    setPasteText('')
    setItems([])
    setRawAiText('')
    setDebugLog('')
    setDebugCopied(false)
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
    onClose()
  }

  const checkedCount = items.filter(it => it.checked && it.selectedMatch).length

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="border-b border-slate-200 px-4 sm:px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Camera className="text-primary" size={20} />
            <h3 className="font-bold text-slate-800 text-sm sm:text-base">
              Importar Lista de Materiales (100% Local)
            </h3>
          </div>
          <button onClick={handleClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0 space-y-4">
          
          {/* FASE 1: Selección / Carga */}
          {phase === 'capture' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Botón Cámara / Archivo */}
                <label className="border-2 border-dashed border-slate-200 hover:border-primary bg-slate-50 hover:bg-primary/5 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 group h-48">
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
                  <Camera size={36} className="text-slate-400 group-hover:text-primary mb-3 transition-colors" />
                  <span className="text-sm font-bold text-slate-700 group-hover:text-primary transition-colors">Tomar Foto o Subir</span>
                  <span className="text-xs text-slate-400 mt-1">Saca una foto a tu lista escrita</span>
                </label>

                {/* Botón Texto / Copiar-Pegar */}
                <button onClick={() => setPhase('paste')}
                  className="border-2 border-dashed border-slate-200 hover:border-primary bg-slate-50 hover:bg-primary/5 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 group h-48">
                  <ClipboardPaste size={36} className="text-slate-400 group-hover:text-primary mb-3 transition-colors" />
                  <span className="text-sm font-bold text-slate-700 group-hover:text-primary transition-colors">Pegar Texto Libre</span>
                  <span className="text-xs text-slate-400 mt-1">Pega un mensaje de WhatsApp</span>
                </button>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-start gap-2.5">
                <Info className="text-slate-400 shrink-0 mt-0.5" size={16} />
                <div className="text-xs text-slate-500 leading-normal">
                  <p className="font-bold text-slate-600 mb-0.5">Escaneo Inteligente Local Privado</p>
                  El escaneo y reconocimiento ocurren en tu dispositivo. Tu cámara no transmite imágenes a ningún servidor externo, garantizando rapidez inmediata y privacidad.
                </div>
              </div>
            </div>
          )}

          {/* FASE 1.5: Pegar texto libre */}
          {phase === 'paste' && (
            <div className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs font-bold flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pega tu lista aquí:</label>
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="Ejemplo:&#10;10 cabillas de 1/2 lisa&#10;5 codos de pvc de 1/2&#10;3 perfiles en C"
                  className="w-full h-44 px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary font-semibold"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPhase('capture')}
                  className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 font-medium">
                  Atrás
                </button>
                <button onClick={handlePasteSubmit} disabled={!pasteText.trim()}
                  className="px-5 py-2 bg-primary text-white text-sm font-bold rounded-xl hover:opacity-90 disabled:opacity-40 transition-opacity">
                  Procesar Texto
                </button>
              </div>
            </div>
          )}

          {/* FASE 2: Procesamiento */}
          {phase === 'processing' && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative">
                <Loader2 className="animate-spin text-primary" size={48} />
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-primary">
                  {uploadProgress}%
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-700">
                  {PROCESSING_STEPS[stepIdx]?.text || 'Procesando...'}
                </p>
                <div className="flex gap-1.5 justify-center mt-1">
                  {PROCESSING_STEPS.map((_, i) => (
                    <div key={i}
                      className="h-1 rounded-full transition-all duration-500"
                      style={{ width: i === stepIdx ? 20 : 6, background: i === stepIdx ? 'var(--color-primary, #1B365D)' : '#cbd5e1' }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FASE 3: Resultados */}
          {phase === 'results' && (
            <div className="space-y-3 animate-in fade-in duration-300">
              {items.length === 0 ? (
                <div className="text-center py-12 space-y-4">
                  <AlertTriangle size={48} className="text-amber-500 mx-auto" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-700">No se pudieron extraer materiales</p>
                    <p className="text-xs text-slate-400">Verifica que tu texto o imagen tenga artículos escritos de forma legible.</p>
                  </div>
                  {debugLog && (
                    <button
                      onClick={handleCopyLogs}
                      className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 flex items-center gap-1.5 mx-auto transition-all shadow-sm"
                    >
                      <Clipboard size={14} className="text-slate-400" />
                      {debugCopied ? '¡Logs Copiados!' : 'Copiar Logs de Diagnóstico'}
                    </button>
                  )}
                  <button onClick={handleRetry}
                    className="px-5 py-2 bg-primary text-white text-sm font-bold rounded-xl hover:opacity-90 transition-opacity">
                    Intentar de nuevo
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between border-b pb-2">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {items.length} ítems identificados
                    </p>
                    <div className="flex items-center gap-3">
                      {debugLog && (
                        <button
                          onClick={handleCopyLogs}
                          className="text-xs text-emerald-600 font-bold hover:underline flex items-center gap-1 transition-all"
                        >
                          <Clipboard size={12} />
                          {debugCopied ? '¡Logs Copiados!' : 'Copiar Logs'}
                        </button>
                      )}
                      <button onClick={handleRetry} className="text-xs text-primary font-bold hover:underline">
                        Nueva importación
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                    {items.map((item, idx) => (
                      <ScanResultRow
                        key={idx}
                        item={item}
                        idx={idx}
                        tasa={tasa}
                        onToggle={() => toggleItem(idx)}
                        onCantidadChange={val => handleCantidadChange(idx, val)}
                        onSelectMatch={match => handleSelectMatch(idx, match)}
                        onSelectFromAutocomplete={match => handleSelectFromAutocomplete(idx, match)}
                        onToggleAutocomplete={() => toggleAutocomplete(idx)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        {phase === 'results' && items.length > 0 && (
          <div className="border-t border-slate-200 px-4 sm:px-6 py-3.5 shrink-0 flex items-center justify-between gap-3 bg-slate-50">
            <button onClick={handleClose}
              className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 font-medium">
              Cancelar
            </button>
            <button onClick={handleConfirm} disabled={checkedCount === 0}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed text-sm shadow-md">
              <Check size={16} />
              Agregar {checkedCount} producto{checkedCount !== 1 ? 's' : ''}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Fila de resultado individual ──
function ScanResultRow({ item, idx, tasa, onToggle, onCantidadChange, onSelectMatch, onSelectFromAutocomplete, onToggleAutocomplete }) {
  const match = item.selectedMatch
  const hasMatch = !!match
  const hasStock = hasMatch && (match.stock_actual ?? 0) > 0
  const stockInsuficiente = hasMatch && item.cantidadEdit > (match.stock_actual ?? 0)

  return (
    <div className={`border rounded-xl p-3 transition-all ${
      item.checked ? 'border-slate-200 bg-white shadow-sm' : 'border-slate-100 bg-slate-50 opacity-60'
    }`}>
      <div className="flex items-start gap-2.5 mb-2">
        <button onClick={onToggle}
          className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
            item.checked ? 'border-primary bg-primary' : 'border-slate-300 bg-white'
          }`}>
          {item.checked && <Check size={12} className="text-white" strokeWidth={3} />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-slate-800 leading-snug">
            <span className="text-primary font-black">{item.cantidadEdit}</span>
            {' x '}
            {item.descripcionOriginal}
          </p>
        </div>
        {item.confianza < 0.7 && (
          <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold shrink-0">
            Revisar
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <label className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Cantidad:</label>
        <input type="text" inputMode="decimal"
          value={item.cantidadEdit}
          onFocus={e => e.target.select()}
          onChange={e => onCantidadChange(e.target.value)}
          onBlur={e => {
            const v = parseFloat(String(e.target.value).replace(',', '.'))
            onCantidadChange(!isNaN(v) && v > 0 ? v : 1)
          }}
          className="w-16 px-2 py-0.5 text-xs font-bold text-center border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {hasMatch ? (
        <div className="bg-slate-50 rounded-lg p-2 space-y-1">
          <div className="flex items-start gap-2">
            {match.imagen_url ? (
              <img src={match.imagen_url} alt="" className="w-8 h-8 rounded object-cover shrink-0 bg-slate-100" />
            ) : (
              <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center shrink-0 border">
                <Package size={14} className="text-slate-300" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-slate-700 leading-snug truncate">{match.nombre}</p>
              {match.codigo && <p className="text-[9px] text-slate-400 font-mono">{match.codigo}</p>}
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-black text-emerald-600">{fmtUsd(match.precio_usd)}</p>
              <p className={`text-[9px] font-bold ${hasStock ? (stockInsuficiente ? 'text-amber-500' : 'text-slate-400') : 'text-red-500'}`}>
                {hasStock
                  ? `Stock: ${match.stock_actual} ${match.unidad}${stockInsuficiente ? ' (insuf.)' : ''}`
                  : 'Agotado'}
              </p>
            </div>
          </div>

          {item.matches?.length > 1 && (
            <div className="pt-1.5 border-t border-slate-200/60 mt-1">
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1">Opciones alternativas:</p>
              <div className="flex flex-wrap gap-1">
                {item.matches.filter(m => m.id !== match.id).map(m => (
                  <button key={m.id} onClick={() => onSelectMatch(m)}
                    className="text-[10px] px-2 py-0.5 bg-white border border-slate-200 rounded-md hover:border-primary hover:text-primary transition-all truncate max-w-[200px]">
                    {m.nombre}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button onClick={onToggleAutocomplete}
            className="text-[9px] text-primary font-bold hover:underline flex items-center gap-1 pt-1 uppercase tracking-wider">
            <Search size={10} /> Cambiar producto
          </button>
        </div>
      ) : (
        <div className="bg-red-50/50 rounded-lg p-2.5 space-y-2">
          <p className="text-[10px] text-red-600 font-bold flex items-center gap-1">
            <AlertCircle size={12} /> Sin coincidencia automática
          </p>
          <button onClick={onToggleAutocomplete}
            className="text-[10px] text-primary font-bold hover:underline flex items-center gap-1 uppercase tracking-wider">
            <Search size={10} /> Buscar en catálogo
          </button>
        </div>
      )}

      {item.showAutocomplete && (
        <div className="mt-2 border-t pt-2 border-slate-100">
          <ProductoAutocomplete
            onSelect={p => onSelectFromAutocomplete(p)}
            tasa={tasa}
            placeholder="Buscar manualmente por nombre o código..."
          />
        </div>
      )}
    </div>
  )
}
