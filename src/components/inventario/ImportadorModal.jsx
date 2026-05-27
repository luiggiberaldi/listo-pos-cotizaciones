// src/components/inventario/ImportadorModal.jsx
// Módulo de importación guiada de productos desde CSV o Excel (CSV exportado)
import { useState, useRef, useCallback } from 'react'
import { Upload, X, FileText, AlertTriangle, CheckCircle2, Loader2, Table2, ChevronRight, RefreshCw } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useCrearProducto } from '../../hooks/useInventario'

// ─── Constantes ───────────────────────────────────────────────────────────────
const CAMPOS_DESTINO = [
  { key: 'nombre',      label: 'Nombre *',        requerido: true  },
  { key: 'codigo',      label: 'Código',           requerido: false },
  { key: 'categoria',   label: 'Categoría',        requerido: false },
  { key: 'unidad',      label: 'Unidad',           requerido: false },
  { key: 'precio_usd',  label: 'Precio USD (P1)',  requerido: false },
  { key: 'precio_2',    label: 'Precio Mayor (P2)',requerido: false },
  { key: 'precio_3',    label: 'Precio Especial (P3)', requerido: false },
  { key: 'costo_usd',   label: 'Costo USD',        requerido: false },
  { key: 'stock_actual',label: 'Stock Inicial',    requerido: false },
  { key: 'stock_minimo',label: 'Stock Mínimo',     requerido: false },
  { key: 'descripcion', label: 'Descripción',      requerido: false },
  { key: '__ignorar',   label: '— Ignorar columna —', requerido: false },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parsearCSV(texto) {
  // Detectar separador: coma o punto y coma
  const primeraLinea = texto.split('\n')[0] || ''
  const sep = (primeraLinea.split(';').length > primeraLinea.split(',').length) ? ';' : ','

  const lineas = texto.split('\n').map(l => l.replace(/\r$/, ''))
  if (lineas.length < 2) throw new Error('El archivo debe tener al menos una fila de encabezado y una fila de datos.')

  const encabezados = lineas[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''))
  const filas = []
  for (let i = 1; i < lineas.length; i++) {
    const linea = lineas[i].trim()
    if (!linea) continue
    const cols = linea.split(sep).map(c => c.trim().replace(/^"|"$/g, ''))
    const fila = {}
    encabezados.forEach((h, idx) => { fila[h] = cols[idx] ?? '' })
    filas.push(fila)
  }
  return { encabezados, filas }
}

function autoMapear(encabezados) {
  const map = {}
  const alias = {
    nombre:       ['nombre', 'name', 'producto', 'descripcion', 'articulo', 'item'],
    codigo:       ['codigo', 'code', 'cod', 'sku', 'ref', 'referencia'],
    categoria:    ['categoria', 'category', 'grupo', 'linea', 'tipo'],
    unidad:       ['unidad', 'unit', 'und', 'um'],
    precio_usd:   ['precio', 'precio_usd', 'precio1', 'p1', 'price', 'precio_venta', 'detal'],
    precio_2:     ['precio_2', 'precio2', 'p2', 'mayor', 'wholesale'],
    precio_3:     ['precio_3', 'precio3', 'p3', 'especial', 'special'],
    costo_usd:    ['costo', 'costo_usd', 'cost', 'coste'],
    stock_actual: ['stock', 'stock_actual', 'cantidad', 'qty', 'existencia', 'inventario'],
    stock_minimo: ['stock_minimo', 'minimo', 'min_stock', 'stock_min'],
    descripcion:  ['descripcion', 'description', 'detalle', 'obs', 'notas'],
  }

  encabezados.forEach(h => {
    const lower = h.toLowerCase().replace(/[^a-z0-9]/g, '')
    let matched = '__ignorar'
    for (const [campo, aliases] of Object.entries(alias)) {
      if (aliases.some(a => lower === a || lower.includes(a) || a.includes(lower))) {
        matched = campo
        break
      }
    }
    map[h] = matched
  })
  return map
}

function leerArchivo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = () => reject(new Error('Error al leer el archivo'))
    reader.readAsText(file, 'UTF-8')
  })
}

// ─── Pasos del wizard ─────────────────────────────────────────────────────────
const PASOS = ['Cargar archivo', 'Mapear columnas', 'Vista previa', 'Importar']

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ImportadorModal({ isOpen, onClose, onSuccess }) {
  const crear = useCrearProducto()

  const [paso, setPaso] = useState(0)
  const [encabezados, setEncabezados] = useState([])
  const [filas, setFilas] = useState([])
  const [mapeo, setMapeo] = useState({})
  const [erroresPrevio, setErroresPrevio] = useState([])
  const [resultado, setResultado] = useState(null) // { ok, errores }
  const [importando, setImportando] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  // ── Reset al cerrar ──────────────────────────────────────────────────────────
  function resetear() {
    setPaso(0)
    setEncabezados([])
    setFilas([])
    setMapeo({})
    setErroresPrevio([])
    setResultado(null)
    setImportando(false)
  }

  function handleClose() {
    resetear()
    onClose()
  }

  // ── Cargar archivo ───────────────────────────────────────────────────────────
  async function procesarArchivo(file) {
    if (!file) return
    if (!file.name.match(/\.(csv|txt)$/i)) {
      setErroresPrevio(['Solo se admiten archivos CSV (.csv) o texto (.txt). Para Excel: File → Save As → CSV UTF-8.'])
      return
    }
    try {
      const texto = await leerArchivo(file)
      const { encabezados: heads, filas: rows } = parsearCSV(texto)
      const autoMap = autoMapear(heads)
      setEncabezados(heads)
      setFilas(rows)
      setMapeo(autoMap)
      setErroresPrevio([])
      setPaso(1)
    } catch (err) {
      setErroresPrevio([err.message])
    }
  }

  function handleFileInput(e) {
    procesarArchivo(e.target.files?.[0])
    e.target.value = ''
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    procesarArchivo(e.dataTransfer.files?.[0])
  }

  // ── Validar antes de previsualizar ───────────────────────────────────────────
  function validarMapeo() {
    // Verificar que 'nombre' esté mapeado
    const tieneNombre = Object.values(mapeo).includes('nombre')
    if (!tieneNombre) return ['Debes mapear al menos la columna "Nombre" para continuar.']
    return []
  }

  function construirProducto(fila) {
    const p = {
      nombre: '', codigo: '', categoria: '', unidad: 'und',
      precio_usd: null, precio_2: null, precio_3: null,
      costo_usd: null, stock_actual: 0, stock_minimo: 0,
      descripcion: '',
    }
    encabezados.forEach(h => {
      const destino = mapeo[h]
      if (!destino || destino === '__ignorar') return
      const val = fila[h]?.trim() ?? ''
      const numericos = ['precio_usd', 'precio_2', 'precio_3', 'costo_usd', 'stock_actual', 'stock_minimo']
      if (numericos.includes(destino)) {
        const n = parseFloat(val.replace(',', '.'))
        p[destino] = isNaN(n) ? null : n
      } else {
        p[destino] = val || p[destino]
      }
    })
    return p
  }

  const productosPrevio = filas.map(construirProducto)

  // ── Importar ─────────────────────────────────────────────────────────────────
  async function importar() {
    setImportando(true)
    const ok = []
    const errores = []

    for (let i = 0; i < productosPrevio.length; i++) {
      const p = productosPrevio[i]
      if (!p.nombre) {
        errores.push({ fila: i + 2, mensaje: 'Sin nombre' })
        continue
      }
      try {
        await crear.mutateAsync(p)
        ok.push(p.nombre)
      } catch (e) {
        errores.push({ fila: i + 2, mensaje: e.message ?? 'Error desconocido' })
      }
    }

    setResultado({ ok, errores })
    setImportando(false)
    setPaso(3)
    if (ok.length > 0) onSuccess?.()
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="📥 Importar productos desde CSV"
      className="sm:max-w-3xl"
    >
      {/* Stepper */}
      <div className="flex items-center gap-1 mb-6">
        {PASOS.map((label, idx) => (
          <div key={idx} className="flex items-center flex-1 min-w-0">
            <div className={`flex items-center gap-1.5 shrink-0 text-xs font-bold px-2 py-1 rounded-lg transition-colors ${
              idx === paso
                ? 'bg-primary text-white'
                : idx < paso
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-400'
            }`}>
              {idx < paso ? <CheckCircle2 size={12} /> : <span>{idx + 1}</span>}
              <span className="hidden sm:inline">{label}</span>
            </div>
            {idx < PASOS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 rounded ${idx < paso ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </div>
        ))}
      </div>

      {/* ── PASO 0: Cargar archivo ─────────────────────────────────────────── */}
      {paso === 0 && (
        <div className="space-y-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              dragOver
                ? 'border-primary bg-primary-light scale-[1.01]'
                : 'border-slate-300 bg-slate-50 hover:border-primary hover:bg-primary-light'
            }`}
          >
            <Upload size={36} className="mx-auto mb-3 text-slate-400" />
            <p className="text-sm font-semibold text-slate-700">Arrastra tu archivo CSV aquí</p>
            <p className="text-xs text-slate-400 mt-1">o haz clic para seleccionarlo</p>
            <p className="text-xs text-slate-400 mt-3 bg-white inline-block px-3 py-1 rounded-lg border border-slate-200">
              💡 En Excel: <strong>Archivo → Guardar como → CSV UTF-8</strong>
            </p>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileInput} />
          </div>

          {erroresPrevio.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2">
              <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                {erroresPrevio.map((e, i) => <p key={i} className="text-sm text-red-700">{e}</p>)}
              </div>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
            <p className="text-xs font-semibold text-blue-700 mb-1">Formato recomendado de columnas:</p>
            <code className="text-[10px] text-blue-600 break-all">nombre, codigo, categoria, unidad, precio_usd, precio_2, precio_3, costo_usd, stock_actual, stock_minimo, descripcion</code>
          </div>
        </div>
      )}

      {/* ── PASO 1: Mapear columnas ────────────────────────────────────────── */}
      {paso === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Se detectaron <strong>{encabezados.length} columnas</strong> y <strong>{filas.length} filas</strong> de datos.
            Asigna cada columna del archivo a un campo del sistema:
          </p>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {encabezados.map(h => (
              <div key={h} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">{h}</p>
                  <p className="text-[10px] text-slate-400 truncate">Ej: {filas[0]?.[h] || '—'}</p>
                </div>
                <ChevronRight size={14} className="text-slate-300 shrink-0" />
                <select
                  value={mapeo[h] ?? '__ignorar'}
                  onChange={e => setMapeo(m => ({ ...m, [h]: e.target.value }))}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-focus text-slate-700 min-w-[160px]"
                >
                  {CAMPOS_DESTINO.map(c => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {erroresPrevio.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
              <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
              <div>{erroresPrevio.map((e, i) => <p key={i} className="text-sm text-amber-700">{e}</p>)}</div>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={() => setPaso(0)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">
              Atrás
            </button>
            <button type="button"
              onClick={() => {
                const errs = validarMapeo()
                if (errs.length) { setErroresPrevio(errs); return }
                setErroresPrevio([])
                setPaso(2)
              }}
              className="ml-auto flex items-center gap-1.5 px-5 py-2 rounded-xl text-white text-sm font-bold transition-all shadow-md active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
            >
              Ver vista previa <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── PASO 2: Vista previa ───────────────────────────────────────────── */}
      {paso === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              <strong>{productosPrevio.length}</strong> productos listos para importar.
              Revisa los datos antes de confirmar:
            </p>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Table2 size={12} /> {productosPrevio.filter(p => p.nombre).length} válidos
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-64">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-slate-500 font-semibold">#</th>
                  {Object.entries(mapeo)
                    .filter(([, v]) => v !== '__ignorar')
                    .map(([h, campo]) => {
                      const def = CAMPOS_DESTINO.find(c => c.key === campo)
                      return <th key={h} className="text-left px-3 py-2 text-slate-500 font-semibold whitespace-nowrap">{def?.label ?? campo}</th>
                    })}
                </tr>
              </thead>
              <tbody>
                {productosPrevio.slice(0, 50).map((p, i) => (
                  <tr key={i} className={`border-b border-slate-100 ${!p.nombre ? 'bg-red-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                    <td className="px-3 py-1.5 text-slate-400">{i + 2}</td>
                    {Object.entries(mapeo)
                      .filter(([, v]) => v !== '__ignorar')
                      .map(([h, campo]) => (
                        <td key={h} className="px-3 py-1.5 text-slate-700 max-w-[160px] truncate">
                          {p[campo] !== null && p[campo] !== undefined && p[campo] !== '' ? String(p[campo]) : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {productosPrevio.length > 50 && (
            <p className="text-[11px] text-slate-400 text-center">Mostrando primeras 50 de {productosPrevio.length} filas</p>
          )}

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={() => setPaso(1)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">
              Atrás
            </button>
            <button type="button" onClick={importar} disabled={importando}
              className="ml-auto flex items-center gap-2 px-5 py-2 rounded-xl text-white text-sm font-bold transition-all shadow-md active:scale-[0.98] disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
            >
              {importando ? <><Loader2 size={14} className="animate-spin" /> Importando...</> : <><Upload size={14} /> Importar {productosPrevio.length} productos</>}
            </button>
          </div>
        </div>
      )}

      {/* ── PASO 3: Resultado ─────────────────────────────────────────────── */}
      {paso === 3 && resultado && (
        <div className="space-y-4">
          <div className="text-center py-4">
            {resultado.ok.length > 0 ? (
              <CheckCircle2 size={48} className="mx-auto text-emerald-500 mb-3" />
            ) : (
              <AlertTriangle size={48} className="mx-auto text-red-500 mb-3" />
            )}
            <p className="text-lg font-bold text-slate-800">
              {resultado.ok.length > 0
                ? `¡${resultado.ok.length} producto${resultado.ok.length !== 1 ? 's' : ''} importado${resultado.ok.length !== 1 ? 's' : ''} con éxito!`
                : 'No se pudo importar ningún producto'}
            </p>
            {resultado.errores.length > 0 && (
              <p className="text-sm text-amber-600 mt-1">{resultado.errores.length} fila{resultado.errores.length !== 1 ? 's' : ''} con error</p>
            )}
          </div>

          {resultado.errores.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 max-h-40 overflow-y-auto space-y-1">
              {resultado.errores.map((e, i) => (
                <p key={i} className="text-xs text-red-700">
                  <span className="font-bold">Fila {e.fila}:</span> {e.mensaje}
                </p>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={resetear}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">
              <RefreshCw size={13} /> Nueva importación
            </button>
            <button type="button" onClick={handleClose}
              className="ml-auto flex items-center gap-1.5 px-5 py-2 rounded-xl text-white text-sm font-bold transition-all shadow-md"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
