// src/components/inventario/BusquedaListaModal.jsx
// Procesar lista de texto pegado → emparejar con inventario → enviar por WhatsApp
import { useState, useMemo, useCallback } from 'react'
import { X, Search, Check, AlertTriangle, Send, RotateCcw, ClipboardPaste, Trash2 } from 'lucide-react'
import { smartSearchProductos } from '../../utils/smartSearch'
import { Modal } from '../ui/Modal'

// ─── Palabras de unidad que se limpian del texto de búsqueda ──────────────────
const UNIT_WORDS = /\b(und|unid|unidades|pzas?|piezas?|sacos?|bultos?|rollos?|kilos?|kg|lts?|litros?|barras?|tramos?|paquetes?|cajas?|bolsas?|latas?|galones?|gal|pares?|jgos?|juegos?|atados?)\b\.?/gi

// ─── Pre-limpiar una línea antes de parsear ───────────────────────────────────
function preLimpiar(linea) {
  let t = linea.trim()
  // Quitar bullets: *, -, •, ►, etc. al inicio
  t = t.replace(/^\s*[*•·▪►→\-]\s*/, '')
  // Quitar * sueltos al final (decoración de WhatsApp)
  t = t.replace(/\s*\*\s*$/, '')
  // Quitar * sueltos en medio (negrita WhatsApp) pero preservar contenido
  t = t.replace(/\*\s*/g, ' ')
  return t.replace(/\s{2,}/g, ' ').trim()
}

// ─── Extraer cantidad + texto de una línea individual ─────────────────────────
function parsearLineaSimple(linea) {
  const trimmed = preLimpiar(linea)
  if (!trimmed || trimmed.length < 2) return null

  // 1. Cantidad al inicio: "01 atado tubo", "20 tubos galvanizado", "150 kilos electrodo"
  //    Pero NO matchear dimensiones como "120x60" ni medidas sueltas
  const m1 = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/i)
  if (m1) {
    const cant = parseFloat(m1[1].replace(',', '.'))
    const resto = m1[2].trim()
    // Verificar que el resto NO empieza con x/X seguido de número (sería una dimensión)
    if (cant > 0 && resto.length >= 2 && !/^[xX×]\d/.test(resto)) {
      return { cantidad: cant, texto: limpiarTexto(resto) }
    }
  }

  // 2. Sin cantidad detectada → cantidad = 1
  return { cantidad: 1, texto: limpiarTexto(trimmed) }
}

// ─── Limpiar texto de ruido (unidades, puntuación, espacios extra) ────────────
function limpiarTexto(raw) {
  let t = raw
    .replace(UNIT_WORDS, ' ')          // quitar palabras de unidad
    .replace(/^\s*[-•·▪►→]\s*/, '')    // quitar bullets restantes
    .replace(/\s*[:]\s*$/, '')          // quitar : al final
    .replace(/\s{2,}/g, ' ')           // colapsar espacios
    .trim()
  // Preservar "de" antes de medidas ("de 4 mt", "de 100mt") para contexto
  return t
}

// ─── Procesar una línea completa ──────────────────────────────────────────────
function parsearLinea(linea) {
  const trimmed = preLimpiar(linea)
  if (!trimmed || trimmed.length < 2) return []

  // NO dividir por comas/separadores — en listas de construcción
  // las comas casi siempre son decimales (c/ 0,90) o parte de medidas
  // Cada línea = 1 producto
  const parsed = parsearLineaSimple(trimmed)
  return parsed ? [parsed] : []
}

// ─── Formatear precio ─────────────────────────────────────────────────────────
function fmtPrecio(val) {
  if (!val || val <= 0) return '—'
  return '$' + Number(val).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPrecioBs(val, tasa) {
  if (!val || val <= 0 || !tasa || tasa <= 0) return ''
  const bs = val * tasa
  return 'Bs ' + bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── Componente: Fila de resultado ────────────────────────────────────────────
function FilaResultado({ item, index, productos, tasa, onToggle, onCambiarProducto, onCambiarCantidad }) {
  const [buscando, setBuscando] = useState(false)
  const [queryLocal, setQueryLocal] = useState('')

  const sugerencias = useMemo(() => {
    if (!queryLocal.trim() || queryLocal.length < 2) return []
    return smartSearchProductos(productos, queryLocal).slice(0, 6)
  }, [queryLocal, productos])

  const precio = item.producto?.precio_venta_usd || 0
  const total = precio * item.cantidad

  return (
    <div className={`border rounded-xl transition-colors ${item.incluir ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
      {/* Fila principal */}
      <div className="flex items-start gap-2 p-3">
        {/* Checkbox */}
        <button
          onClick={() => onToggle(index)}
          className={`mt-1 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
            item.incluir
              ? 'bg-emerald-500 border-emerald-500 text-white'
              : 'border-slate-300 bg-white'
          }`}
        >
          {item.incluir && <Check size={12} strokeWidth={3} />}
        </button>

        {/* Contenido */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Texto original del cliente */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400">#{index + 1}</span>
            <span className="text-xs text-slate-500 italic truncate">"{item.textoOriginal}"</span>
          </div>

          {/* Producto encontrado */}
          {item.producto ? (
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-800 leading-tight">{item.producto.nombre}</p>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                {item.producto.codigo && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{item.producto.codigo}</span>}
                <span className={item.producto.stock_actual <= 0 ? 'text-red-500 font-bold' : ''}>
                  Stock: {item.producto.stock_actual ?? '—'}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-amber-600">
              <AlertTriangle size={14} />
              <span className="text-xs font-bold">Sin coincidencia encontrada</span>
            </div>
          )}

          {/* Mini buscador inline */}
          {buscando && (
            <div className="mt-2 space-y-1">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={queryLocal}
                  onChange={e => setQueryLocal(e.target.value)}
                  placeholder="Buscar producto manualmente..."
                  autoFocus
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-primary-focus/20 focus:border-primary"
                />
              </div>
              {sugerencias.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden max-h-36 overflow-y-auto">
                  {sugerencias.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onCambiarProducto(index, p)
                        setBuscando(false)
                        setQueryLocal('')
                      }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0 transition-colors"
                    >
                      <span className="font-bold text-slate-800">{p.nombre}</span>
                      {p.codigo && <span className="ml-2 text-slate-400 font-mono">{p.codigo}</span>}
                      <span className="ml-2 text-emerald-600 font-bold">{fmtPrecio(p.precio_venta_usd)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cantidad + Precio */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="1"
              value={item.cantidad}
              onChange={e => onCambiarCantidad(index, Math.max(1, parseInt(e.target.value) || 1))}
              className="w-14 text-center text-sm font-bold border border-slate-200 rounded-lg py-1 focus:outline-none focus:ring-1 focus:ring-primary-focus/20"
            />
          </div>
          {precio > 0 && (
            <>
              <span className="text-xs text-slate-400">{fmtPrecio(precio)} c/u</span>
              <span className="text-sm font-black text-slate-800">{fmtPrecio(total)}</span>
              {tasa > 0 && <span className="text-[10px] text-slate-400">{fmtPrecioBs(total, tasa)}</span>}
            </>
          )}
        </div>

        {/* Botón cambiar */}
        <button
          onClick={() => { setBuscando(!buscando); setQueryLocal('') }}
          title="Cambiar producto"
          className="mt-1 p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
        >
          <Search size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function BusquedaListaModal({ open, onClose, productos = [], tasa = 0, configNeg = {} }) {
  const [paso, setPaso] = useState(1) // 1 = pegar texto, 2 = resultados
  const [textoRaw, setTextoRaw] = useState('')
  const [resultados, setResultados] = useState([])

  // ── Analizar texto ────────────────────────────────────────────────────────
  const analizarTexto = useCallback(() => {
    if (!textoRaw.trim()) return

    const lineas = textoRaw.split('\n').filter(l => l.trim())
    const items = []

    for (const linea of lineas) {
      // parsearLinea ahora retorna un ARRAY (puede haber varios productos por línea)
      const parsed = parsearLinea(linea)
      if (!parsed || parsed.length === 0) continue

      for (const { cantidad, texto } of parsed) {
        // Paso 1: Buscar por código exacto primero (si el texto parece un código)
        let mejorMatch = null
        const textoUpper = texto.toUpperCase().trim()
        if (textoUpper.length >= 3 && textoUpper.length <= 20 && /^[A-Z0-9\-/.]+$/.test(textoUpper)) {
          mejorMatch = productos.find(p =>
            p.codigo && p.codigo.toUpperCase() === textoUpper
          ) || null
        }

        // Paso 2: Smart search completa
        if (!mejorMatch) {
          const matches = smartSearchProductos(productos, texto)
          if (matches.length > 0) {
            mejorMatch = matches[0]
          }
        }

        // Paso 3: Si no hay match, buscar con palabras clave principales (sin stopwords)
        if (!mejorMatch) {
          const palabras = texto.split(/\s+/).filter(p => p.length >= 3)
          for (let len = palabras.length; len >= 1 && !mejorMatch; len--) {
            const subquery = palabras.slice(0, len).join(' ')
            const matches = smartSearchProductos(productos, subquery)
            if (matches.length > 0) mejorMatch = matches[0]
          }
        }

        items.push({
          textoOriginal: texto,
          cantidad,
          producto: mejorMatch,
          incluir: !!mejorMatch,
        })
      }
    }

    setResultados(items)
    setPaso(2)
  }, [textoRaw, productos])

  // ── Acciones sobre resultados ─────────────────────────────────────────────
  const toggleIncluir = (idx) => {
    setResultados(prev => prev.map((r, i) => i === idx ? { ...r, incluir: !r.incluir } : r))
  }

  const cambiarProducto = (idx, producto) => {
    setResultados(prev => prev.map((r, i) => i === idx ? { ...r, producto, incluir: true } : r))
  }

  const cambiarCantidad = (idx, cantidad) => {
    setResultados(prev => prev.map((r, i) => i === idx ? { ...r, cantidad } : r))
  }

  // ── Totales ───────────────────────────────────────────────────────────────
  const { totalUsd, totalBs, itemsIncluidos } = useMemo(() => {
    const incluidos = resultados.filter(r => r.incluir && r.producto)
    const usd = incluidos.reduce((s, r) => s + (r.producto.precio_venta_usd || 0) * r.cantidad, 0)
    return {
      totalUsd: usd,
      totalBs: tasa > 0 ? usd * tasa : 0,
      itemsIncluidos: incluidos.length,
    }
  }, [resultados, tasa])

  // ── Generar mensaje WhatsApp ──────────────────────────────────────────────
  const enviarWhatsApp = useCallback(() => {
    const incluidos = resultados.filter(r => r.incluir && r.producto)
    if (incluidos.length === 0) return

    const negocio = configNeg?.nombre_negocio || 'CONSTRUACERO CARABOBO, C.A.'

    let msg = `*${negocio}*\n_Cotización rápida_\n\n`

    incluidos.forEach((item, i) => {
      const precio = item.producto.precio_venta_usd || 0
      const total = precio * item.cantidad
      const linea = `${i + 1}. ${item.producto.nombre} — ${fmtPrecio(precio)} c/u × ${item.cantidad} = *${fmtPrecio(total)}*`
      msg += linea + '\n'
    })

    msg += `\n*TOTAL: ${fmtPrecio(totalUsd)}*`
    if (totalBs > 0) {
      msg += `\n_Ref. Bs: ${fmtPrecioBs(totalUsd, tasa)}_`
    }
    msg += `\n\n_Precios sujetos a disponibilidad_`

    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank')
  }, [resultados, totalUsd, totalBs, tasa, configNeg])

  // ── Copiar al portapapeles ────────────────────────────────────────────────
  const copiarTexto = useCallback(() => {
    const incluidos = resultados.filter(r => r.incluir && r.producto)
    if (incluidos.length === 0) return

    const negocio = configNeg?.nombre_negocio || 'CONSTRUACERO CARABOBO, C.A.'

    let msg = `${negocio}\nCotización rápida\n\n`

    incluidos.forEach((item, i) => {
      const precio = item.producto.precio_venta_usd || 0
      const total = precio * item.cantidad
      msg += `${i + 1}. ${item.producto.nombre} — ${fmtPrecio(precio)} c/u × ${item.cantidad} = ${fmtPrecio(total)}\n`
    })

    msg += `\nTOTAL: ${fmtPrecio(totalUsd)}`
    if (totalBs > 0) {
      msg += `\nRef. Bs: ${fmtPrecioBs(totalUsd, tasa)}`
    }

    navigator.clipboard.writeText(msg)
  }, [resultados, totalUsd, totalBs, tasa, configNeg])

  // ── Reset ─────────────────────────────────────────────────────────────────
  const volver = () => {
    setPaso(1)
    setResultados([])
  }

  const cerrar = () => {
    setPaso(1)
    setTextoRaw('')
    setResultados([])
    onClose()
  }

  return (
    <Modal isOpen={open} onClose={cerrar} title="Procesar Lista" className="sm:!max-w-3xl">
      {paso === 1 && (
        <div className="space-y-4">
          {/* Instrucciones */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 border border-blue-100">
            <ClipboardPaste size={20} className="text-blue-500 mt-0.5 shrink-0" />
            <div className="text-xs text-blue-700 space-y-1">
              <p className="font-bold">Pega aquí la lista del cliente</p>
              <p>Cada línea se analizará por separado. Si hay un número al inicio, se tomará como cantidad.</p>
            </div>
          </div>

          {/* Textarea */}
          <textarea
            value={textoRaw}
            onChange={e => setTextoRaw(e.target.value)}
            rows={10}
            placeholder={`Ejemplo:\n10 cabillas 1/2\n5 sacos cemento\ntubo pvc 3/4 agua fria\n2 laminas zinc 3.66\nmalla truckson 6x6`}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-primary-focus/20 focus:border-primary placeholder:text-slate-400 resize-none font-mono"
          />

          {/* Contador */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {textoRaw.split('\n').filter(l => l.trim()).length} líneas detectadas
            </span>
            <button
              onClick={analizarTexto}
              disabled={!textoRaw.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white transition-all shadow-lg active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
            >
              <Search size={16} />
              Analizar Lista
            </button>
          </div>
        </div>
      )}

      {paso === 2 && (
        <div className="space-y-3">
          {/* Resumen rápido */}
          <div className="flex items-center justify-between">
            <button onClick={volver} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-primary font-bold transition-colors">
              <RotateCcw size={14} />
              Volver a pegar
            </button>
            <div className="text-xs text-slate-500">
              <span className="font-bold text-emerald-600">{itemsIncluidos}</span> de {resultados.length} productos seleccionados
            </div>
          </div>

          {/* Lista de resultados */}
          <div className="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar pr-1">
            {resultados.map((item, idx) => (
              <FilaResultado
                key={idx}
                item={item}
                index={idx}
                productos={productos}
                tasa={tasa}
                onToggle={toggleIncluir}
                onCambiarProducto={cambiarProducto}
                onCambiarCantidad={cambiarCantidad}
              />
            ))}
          </div>

          {/* Barra de total */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800 text-white">
            <span className="font-bold text-sm">Total ({itemsIncluidos} items):</span>
            <div className="text-right">
              <span className="font-black text-lg">{fmtPrecio(totalUsd)}</span>
              {totalBs > 0 && <span className="block text-xs text-slate-300">{fmtPrecioBs(totalUsd, tasa)}</span>}
            </div>
          </div>

          {/* Botones de acción */}
          <div className="flex gap-2">
            <button
              onClick={copiarTexto}
              disabled={itemsIncluidos === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm border-2 border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
            >
              <ClipboardPaste size={16} />
              Copiar texto
            </button>
            <button
              onClick={enviarWhatsApp}
              disabled={itemsIncluidos === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm text-white transition-all shadow-lg active:scale-[0.98] disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #25D366, #128C7E)' }}
            >
              <Send size={16} />
              Enviar por WhatsApp
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
