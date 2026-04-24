// src/components/cotizaciones/ScanMaterialListModal.jsx
// Modal para escanear listas de materiales (foto) o pegar texto (WhatsApp)
import { useState, useRef } from 'react'
import { X, Camera, Image as ImageIcon, Loader2, AlertCircle, Check, Search, Package, MessageSquareText, ClipboardPaste } from 'lucide-react'
import { comprimirParaOCR } from '../../utils/imageToBase64'
import { useScanMaterialList } from '../../hooks/useScanMaterialList'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import ProductoAutocomplete from './ProductoAutocomplete'

export default function ScanMaterialListModal({ open, onClose, onBulkAdd, tasa = 0 }) {
  const [phase, setPhase] = useState('capture') // capture | paste | processing | results
  const [rawAiText, setRawAiText] = useState('')
  const [preview, setPreview] = useState(null)
  const [pasteText, setPasteText] = useState('')
  const [items, setItems] = useState([])
  const [debugLog, setDebugLog] = useState('')
  const [debugCopied, setDebugCopied] = useState(false)
  const { scan, parseText, loading, error, results, reset } = useScanMaterialList()
  const fileRef = useRef(null)

  if (!open) return null

  function processResults(data) {
    if (data?.rawAiText) setRawAiText(data.rawAiText)

    // Generar log debug detallado
    const logLines = []
    logLines.push(`=== SCAN DEBUG LOG ===`)
    logLines.push(`Timestamp: ${new Date().toISOString()}`)
    logLines.push(`Raw AI text: ${data?.rawAiText || '(vacío)'}`)
    logLines.push(`Items recibidos: ${data?.items?.length || 0}`)
    logLines.push(`---`)
    if (data?.items) {
      data.items.forEach((it, i) => {
        logLines.push(`[${i+1}] descripcion: "${it.descripcionOriginal}" | cantidad: ${it.cantidad} | confianza: ${it.confianza}`)
        logLines.push(`    matches (${it.matches?.length || 0}):`)
        if (it.matches?.length > 0) {
          it.matches.forEach((m, j) => logLines.push(`      ${j+1}. [${m.codigo}] ${m.nombre} | precio: ${m.precio_usd} | stock: ${m.stock_actual}`))
        } else {
          logLines.push(`      (sin coincidencias)`)
        }
      })
    }
    logLines.push(`=== FIN DEBUG ===`)
    setDebugLog(logLines.join('\n'))

    if (data?.items?.length > 0) {
      setItems(data.items.map(it => ({
        ...it,
        checked: true,
        selectedMatch: it.matches?.[0] || null,
        cantidadEdit: it.cantidad,
        showAutocomplete: false,
      })))
      setPhase('results')
    } else {
      setPhase('results')
      setItems([])
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    setPhase('processing')
    try {
      const { base64, mimeType } = await comprimirParaOCR(file)
      const data = await scan(base64, mimeType)
      processResults(data)
    } catch {
      setPhase('capture')
    }
  }

  async function handlePasteSubmit() {
    if (!pasteText.trim()) return
    setPhase('processing')
    try {
      const data = await parseText(pasteText.trim())
      processResults(data)
    } catch {
      setPhase('paste')
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
    reset()
    if (fileRef.current) fileRef.current.value = ''
  }

  function toggleItem(idx) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it))
  }

  function updateCantidad(idx, val) {
    const v = parseFloat(String(val).replace(',', '.'))
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidadEdit: isNaN(v) ? val : v } : it))
  }

  function selectMatch(idx, match) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, selectedMatch: match, showAutocomplete: false } : it))
  }

  function selectFromAutocomplete(idx, producto) {
    setItems(prev => prev.map((it, i) => i === idx ? {
      ...it,
      selectedMatch: {
        id: producto.id,
        codigo: producto.codigo,
        nombre: producto.nombre,
        unidad: producto.unidad,
        precio_usd: Number(producto.precio_usd),
        precio_2: producto.precio_2 ? Number(producto.precio_2) : null,
        precio_3: producto.precio_3 ? Number(producto.precio_3) : null,
        stock_actual: Number(producto.stock_actual),
        stock_minimo: Number(producto.stock_minimo),
        imagen_url: producto.imagen_url,
      },
      showAutocomplete: false,
    } : it))
  }

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
    reset()
    if (fileRef.current) fileRef.current.value = ''
    onClose()
  }

  const checkedCount = items.filter(it => it.checked && it.selectedMatch).length

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-primary" />
            <h2 className="text-sm sm:text-base font-bold text-slate-800">Importar Lista de Materiales</h2>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={18} className="text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">

          {/* ── FASE 1: Captura (foto o texto) ── */}
          {phase === 'capture' && (
            <div className="flex flex-col items-center gap-6 py-6">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Camera size={28} className="text-primary" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-base font-bold text-slate-700">Importar lista de materiales</p>
                <p className="text-sm text-slate-500 max-w-sm">
                  Toma una foto de una lista escrita a mano o pega un texto de WhatsApp
                </p>
              </div>

              <input ref={fileRef} type="file" accept="image/*" capture="environment"
                onChange={handleFile} className="hidden" id="scan-file-input" />

              <div className="flex flex-col gap-3 w-full max-w-xs">
                <label htmlFor="scan-file-input"
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-primary text-white font-bold rounded-xl cursor-pointer hover:opacity-90 transition-opacity text-sm">
                  <Camera size={18} />
                  Tomar Foto
                </label>
                <label className="flex items-center justify-center gap-2 px-6 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl cursor-pointer hover:bg-slate-200 transition-colors text-sm">
                  <ImageIcon size={18} />
                  Subir de Galería
                  <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
                </label>
                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-[10px] text-slate-400 font-bold uppercase">o</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <button onClick={() => setPhase('paste')}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-green-50 text-green-700 font-bold rounded-xl hover:bg-green-100 transition-colors text-sm border border-green-200">
                  <MessageSquareText size={18} />
                  Pegar Texto / WhatsApp
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-4 py-2 rounded-lg">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ── FASE 1b: Pegar texto ── */}
          {phase === 'paste' && (
            <div className="flex flex-col gap-4 py-4">
              <div className="flex items-center gap-2">
                <MessageSquareText size={18} className="text-green-600" />
                <p className="text-sm font-bold text-slate-700">Pega el texto con la lista de materiales</p>
              </div>
              <p className="text-xs text-slate-500">
                Pega un mensaje de WhatsApp, nota, o cualquier texto que contenga materiales con cantidades
              </p>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={"Ej:\n90 cabillas 1/2\n45 cabillas 3/8\n5 tubos 1 1/2\n12 codos 1 1/2\n3 pegas azules\n50 sacos de cemento"}
                className="w-full h-48 px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-slate-300"
                autoFocus
              />
              <div className="flex items-center gap-3">
                <button onClick={() => { setPasteText(''); setPhase('capture') }}
                  className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 font-medium">
                  Volver
                </button>
                <button
                  onClick={async () => {
                    try {
                      const clip = await navigator.clipboard.readText()
                      if (clip) setPasteText(clip)
                    } catch { /* clipboard access denied */ }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 font-bold">
                  <ClipboardPaste size={14} />
                  Pegar
                </button>
                <button onClick={handlePasteSubmit} disabled={!pasteText.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed text-sm">
                  <Search size={16} />
                  Buscar Materiales
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-4 py-2 rounded-lg">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ── FASE 2: Procesando ── */}
          {phase === 'processing' && (
            <div className="flex flex-col items-center gap-6 py-8">
              {preview && (
                <img src={preview} alt="Lista" className="w-40 h-52 object-cover rounded-xl border border-slate-200 shadow-sm" />
              )}
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={32} className="text-primary animate-spin" />
                <p className="text-sm font-bold text-slate-700">Buscando materiales en inventario...</p>
                <p className="text-xs text-slate-400">Esto puede tomar unos segundos</p>
              </div>
              {error && (
                <div className="text-center space-y-3">
                  <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-4 py-2 rounded-lg">
                    <AlertCircle size={16} />
                    {error}
                  </div>
                  <button onClick={handleRetry}
                    className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200">
                    Intentar de nuevo
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── FASE 3: Resultados ── */}
          {phase === 'results' && (
            <div className="space-y-3">
              {items.length === 0 ? (
                <div className="text-center py-8 space-y-4">
                  <AlertCircle size={32} className="text-amber-500 mx-auto" />
                  <p className="text-sm text-slate-600">No se pudieron extraer materiales</p>
                  {rawAiText && (
                    <div className="text-left bg-slate-50 border border-slate-200 rounded-lg p-3 mx-auto max-w-md">
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Respuesta IA (debug):</p>
                      <pre className="text-[11px] text-slate-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{rawAiText}</pre>
                    </div>
                  )}
                  <button onClick={handleRetry}
                    className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-xl hover:opacity-90">
                    Intentar de nuevo
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {items.length} items detectados
                    </p>
                    <button onClick={handleRetry} className="text-xs text-primary font-bold hover:underline">
                      Nueva importación
                    </button>
                  </div>

                  {items.map((item, idx) => (
                    <ScanResultRow
                      key={idx}
                      item={item}
                      idx={idx}
                      tasa={tasa}
                      onToggle={() => toggleItem(idx)}
                      onCantidadChange={(val) => updateCantidad(idx, val)}
                      onSelectMatch={(match) => selectMatch(idx, match)}
                      onSelectFromAutocomplete={(p) => selectFromAutocomplete(idx, p)}
                      onToggleAutocomplete={() => toggleAutocomplete(idx)}
                    />
                  ))}

                  {/* Debug log copiable (temporal) */}
                  {debugLog && (
                    <div className="mt-4 bg-slate-900 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Debug Log</p>
                        <button
                          onClick={() => { navigator.clipboard.writeText(debugLog); setDebugCopied(true); setTimeout(() => setDebugCopied(false), 2000) }}
                          className="text-[10px] px-2 py-1 bg-slate-700 text-slate-300 rounded-md hover:bg-slate-600 font-bold">
                          {debugCopied ? 'Copiado' : 'Copiar'}
                        </button>
                      </div>
                      <pre className="text-[10px] text-green-400 whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono leading-relaxed">{debugLog}</pre>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer - solo en fase results */}
        {phase === 'results' && items.length > 0 && (
          <div className="border-t border-slate-200 px-4 sm:px-6 py-3 shrink-0 flex items-center justify-between gap-3">
            <button onClick={handleClose}
              className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 font-medium">
              Cancelar
            </button>
            <button onClick={handleConfirm} disabled={checkedCount === 0}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed text-sm">
              <Check size={16} />
              Agregar {checkedCount} producto{checkedCount !== 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Fila de resultado individual ──────────────────────────────────────────────
function ScanResultRow({ item, idx, tasa, onToggle, onCantidadChange, onSelectMatch, onSelectFromAutocomplete, onToggleAutocomplete }) {
  const match = item.selectedMatch
  const hasMatch = !!match
  const hasStock = hasMatch && (match.stock_actual ?? 0) > 0
  const stockInsuficiente = hasMatch && item.cantidadEdit > (match.stock_actual ?? 0)

  return (
    <div className={`border rounded-xl p-3 transition-all ${
      item.checked ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'
    }`}>
      {/* Fila superior: checkbox + descripción original */}
      <div className="flex items-start gap-2 mb-2">
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
          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold shrink-0">
            Revisar
          </span>
        )}
      </div>

      {/* Cantidad editable */}
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[10px] text-slate-400 font-bold">Cant:</label>
        <input type="text" inputMode="decimal"
          value={item.cantidadEdit}
          onFocus={e => e.target.select()}
          onChange={e => onCantidadChange(e.target.value)}
          onBlur={e => {
            const v = parseFloat(String(e.target.value).replace(',', '.'))
            onCantidadChange(!isNaN(v) && v > 0 ? v : 1)
          }}
          className="w-16 px-2 py-1 text-xs font-bold text-center border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Match encontrado */}
      {hasMatch ? (
        <div className="bg-slate-50 rounded-lg p-2 space-y-1">
          <div className="flex items-start gap-2">
            {match.imagen_url ? (
              <img src={match.imagen_url} alt="" className="w-8 h-8 rounded object-cover shrink-0 bg-slate-100" />
            ) : (
              <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center shrink-0">
                <Package size={14} className="text-slate-300" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-slate-700 leading-snug line-clamp-2">{match.nombre}</p>
              {match.codigo && <p className="text-[10px] text-slate-400">{match.codigo}</p>}
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-black text-emerald-600">{fmtUsd(match.precio_usd)}</p>
              <p className={`text-[10px] font-bold ${hasStock ? (stockInsuficiente ? 'text-amber-500' : 'text-slate-400') : 'text-red-500'}`}>
                {hasStock
                  ? `${match.stock_actual} ${match.unidad}${stockInsuficiente ? ' (insuf.)' : ''}`
                  : 'Agotado'}
              </p>
            </div>
          </div>

          {/* Alternativas si hay más de 1 match */}
          {item.matches?.length > 1 && (
            <div className="pt-1 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 mb-1">Otras opciones:</p>
              <div className="flex flex-wrap gap-1">
                {item.matches.filter(m => m.id !== match.id).map(m => (
                  <button key={m.id} onClick={() => onSelectMatch(m)}
                    className="text-[10px] px-2 py-0.5 bg-white border border-slate-200 rounded-md hover:border-primary hover:text-primary transition-colors truncate max-w-[180px]">
                    {m.nombre}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Botón para buscar manualmente */}
          <button onClick={onToggleAutocomplete}
            className="text-[10px] text-primary font-bold hover:underline flex items-center gap-1 pt-1">
            <Search size={10} /> Cambiar producto
          </button>
        </div>
      ) : (
        <div className="bg-red-50 rounded-lg p-2 space-y-2">
          <p className="text-[10px] text-red-600 font-bold flex items-center gap-1">
            <AlertCircle size={12} /> Sin coincidencia en inventario
          </p>
          <button onClick={onToggleAutocomplete}
            className="text-[10px] text-primary font-bold hover:underline flex items-center gap-1">
            <Search size={10} /> Buscar manualmente
          </button>
        </div>
      )}

      {/* Autocomplete inline */}
      {item.showAutocomplete && (
        <div className="mt-2">
          <ProductoAutocomplete
            onSelect={p => onSelectFromAutocomplete(p)}
            tasa={tasa}
            placeholder="Buscar producto..."
          />
        </div>
      )}
    </div>
  )
}
