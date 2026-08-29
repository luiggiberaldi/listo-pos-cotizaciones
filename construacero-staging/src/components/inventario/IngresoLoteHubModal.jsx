// src/components/inventario/IngresoLoteHubModal.jsx
// Modal de ingesta inteligente por lote en Construacero Carabobo C.A.
// Admite:
// 1. Pegado desde Excel/Sheets (TSV)
// 2. Texto libre desestructurado (heurística de construcción/ferretería)
// 3. Foto de factura/remisión (OCR simulado Side-by-Side)
// Y unifica todo en una grilla interactiva antes de la persistencia transaccional.

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { 
  Clipboard as _Clipboard, FileText as _FileText, Camera as _Camera, AlertTriangle as _AlertTriangle,
  Trash2 as _Trash2, Sparkles as _Sparkles, RefreshCw as _RefreshCw, UploadCloud as _UploadCloud,
  Info as _Info, CheckCircle2 as _CheckCircle2
} from 'lucide-react'
import { Modal as _Modal } from '../ui/Modal'
import _CustomSelect from '../ui/CustomSelect'
import { showToast } from '../ui/Toast'
import { authFetch } from '../../services/authFetch'
import {  smartSearchProductos,
  findBestFuzzyCodeMatch,
 
  parsearLineaCompletaInteligente, 
  preprocesarImagenCanvas 
} from '../../utils/smartSearch'

// Categorías por defecto del sistema
const DEFAULT_CATEGORIES = [
  'CONEXIONES',
  'ELECTRICIDAD',
  'LAMINAS',
  'PERFILES',
  'TUBOS ESTRUCTURALES',
  'TUBOS GALVANIZADO',
  'TUBOS PULIDO',
  'TUBOS PVC',
  'TUBOS',
  'VIGAS',
  'SOLDADURA',
  'HERRAMIENTAS',
  'VARIOS'
]

// Unidades por defecto (abreviadas para evitar cortes visuales en la tabla)
const DEFAULT_UNITS = [
  { value: 'und', label: 'und' },
  { value: 'kg', label: 'kg' },
  { value: 'mts', label: 'mts' },
  { value: 'saco', label: 'saco' },
  { value: 'rollo', label: 'rollo' },
  { value: 'tramo', label: 'tramo' },
  { value: 'paquete', label: 'paquete' },
  { value: 'caja', label: 'caja' },
]



export default function IngresoLoteHubModal({ isOpen, onClose, productos = [], categorias = [], onSuccess }) {
  const [tab, setTab] = useState('excel') // 'excel' | 'texto' | 'foto'
  const [paso, setPaso] = useState(1) // 1 = Configuración/Input, 2 = Grilla de Verificación
  
  // Estados para cada pestaña
  const [excelText, setExcelText] = useState('')
  const [freeText, setFreeText] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isProcessingFile, setIsProcessingFile] = useState(false)
  const [, setSelectedFile] = useState(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState(null)

  // Grilla de verificación
  const [filas, setFilas] = useState([])
  const [motivoIngreso, setMotivoIngreso] = useState('Ingreso de mercancía por lote')
  const [isSaving, setIsSaving] = useState(false)
  const idempotencyKeyRef = useRef(null)

  // Opciones de categorías consolidadas
  const catOptions = useMemo(() => {
    const rawList = categorias.length > 0 ? categorias.map(c => c.value || c) : DEFAULT_CATEGORIES
    const cleanList = [...new Set(rawList.map(c => c.replace(/^\s*↳\s*/, '').trim()))].sort()
    return cleanList.map(c => ({ value: c, label: c }))
  }, [categorias])

  // Resetear estados al abrir/cerrar
  useEffect(() => {
    if (!isOpen) {
      setTab('excel')
      setPaso(1)
      setExcelText('')
      setFreeText('')
      setSelectedFile(null)
      setFilePreviewUrl(null)
      setUploadProgress(0)
      setIsProcessingFile(false)
      setFilas([])
      setMotivoIngreso('Ingreso de mercancía por lote')
      setIsSaving(false)
      idempotencyKeyRef.current = null
    }
  }, [isOpen])

  // Cargar Tesseract.js dinámicamente cuando se entra a la pestaña de fotos
  useEffect(() => {
    if (isOpen && tab === 'foto' && !window.Tesseract) {
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/tesseract.js@5.0.3/dist/tesseract.min.js'
      script.async = true
      script.onload = () => {
        console.log('Tesseract.js cargado de forma dinámica desde CDN')
      }
      script.onerror = () => {
        showToast('Error cargando el motor OCR. Revisa tu conexión de red.', 'error')
      }
      document.body.appendChild(script)
      return () => {
        const s = document.querySelector('script[src*="tesseract"]')
        if (s) document.body.removeChild(s)
      }
    }
  }, [isOpen, tab])

  // --- 1. Parser Excel / TSV (Tab Separated Values) ---
  const procesarExcel = useCallback(() => {
    if (!excelText.trim()) return

    const lineas = excelText.split('\n')
    const parsedRows = []

    lineas.forEach(linea => {
      if (!linea.trim()) return
      const celdas = linea.split('\t').map(c => c.trim())
      
      // Si la fila está vacía o parece un encabezado obvio, la omitimos
      if (celdas.length === 0 || celdas[0].toLowerCase().includes('código') || celdas[0].toLowerCase().includes('codigo')) {
        return
      }

      // Mapear por posición de celda comunes en Excel:
      // Esperado común: Código | Nombre | Cantidad/Stock | Costo | Precio1 | Categoría | Unidad
      let codigo = celdas[0] || ''
      let nombre = celdas[1] || ''
      let cantidad = Math.max(1, parseFloat(celdas[2]) || 0)
      let costo = Math.max(0, parseFloat(celdas[3]?.replace(/[$,]/g, '')) || 0)
      let precio = Math.max(0, parseFloat(celdas[4]?.replace(/[$,]/g, '')) || 0)
      let categoriaRow = celdas[5] || ''
      let unidadRow = celdas[6] || 'und'

      // Si parece que no tiene código pero la columna 1 tiene texto largo, asumimos que es el nombre
      if (codigo.length > 15 && !nombre) {
        nombre = codigo
        codigo = ''
      }

      if (!nombre && celdas.length > 1) {
        nombre = celdas.find(c => c.length > 5) || celdas[0]
      }

      if (nombre) {
        parsedRows.push(crearFilaObjeto(codigo, nombre, cantidad, costo, precio, categoriaRow, unidadRow))
      }
    })

    if (parsedRows.length > 0) {
      setFilas(parsedRows)
      setPaso(2)
      showToast(`${parsedRows.length} productos cargados desde planilla.`, 'success')
    } else {
      showToast('No se detectaron productos válidos. Revisa el formato.', 'warning')
    }
  }, [excelText, crearFilaObjeto])

  // --- 2. Parser Heurístico de Texto Libre ---
  const procesarTextoLibre = useCallback(() => {
    if (!freeText.trim()) return

    const lineas = freeText.split('\n').filter(l => l.trim())
    const parsedRows = []

    lineas.forEach(linea => {
      const res = parsearLineaCompletaInteligente(linea)
      if (res) {
        parsedRows.push(crearFilaObjeto(res.codigo, res.nombre, res.cantidad, res.costo, res.precio, '', res.unidad))
      }
    })

    if (parsedRows.length > 0) {
      setFilas(parsedRows)
      setPaso(2)
      showToast(`${parsedRows.length} productos parseados del texto.`, 'success')
    } else {
      showToast('No se identificaron productos. Escribe en líneas separadas.', 'warning')
    }
  }, [freeText, crearFilaObjeto])

  // --- 3. Simulación OCR Side-by-Side ---
  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true)
    } else if (e.type === 'dragleave') {
      setIsDragging(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      procesarArchivo(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      procesarArchivo(e.target.files[0])
    }
  }

  const procesarArchivo = async (file) => {
    setSelectedFile(file)
    
    // 1. Mostrar previsualización de la imagen original
    const reader = new FileReader()
    reader.onload = () => {
      setFilePreviewUrl(reader.result)
      
      // Lanzar el proceso de OCR con la imagen preprocesada por Canvas
      iniciarOcrConImagenMejorada(reader.result, file)
    }
    reader.readAsDataURL(file)
  }

  const iniciarOcrConImagenMejorada = async (imageSrc, _file) => {
    setIsProcessingFile(true)
    setUploadProgress(0)

    // 2. Verificar que Tesseract se haya cargado
    if (!window.Tesseract) {
      showToast('Cargando motor OCR en el navegador. Por favor espera...', 'info')
      let reintentos = 0
      while (!window.Tesseract && reintentos < 40) {
        await new Promise(r => setTimeout(r, 200))
        reintentos++
      }
      if (!window.Tesseract) {
        showToast('No se pudo inicializar el motor OCR. Inténtalo de nuevo.', 'error')
        setIsProcessingFile(false)
        return
      }
    }

    try {
      // 3. Preprocesar la imagen en canvas para potenciar el contraste (10x más preciso)
      showToast('Optimizando nitidez y contraste de la imagen...', 'info')
      const canvasMejorado = await preprocesarImagenCanvas(imageSrc)

      // 4. Ejecutar escaneo Tesseract.js real del canvas
      showToast('Escaneando caracteres y columnas...', 'info')
      const response = await window.Tesseract.recognize(
        canvasMejorado,
        'spa', // Español
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              setUploadProgress(Math.round(m.progress * 100))
            }
          }
        }
      )

      const extractedText = response?.data?.text || ''
      if (!extractedText.trim()) {
        showToast('No se pudo extraer ningún texto legible del documento.', 'warning')
        setIsProcessingFile(false)
        return
      }

      // 5. Procesar el texto de Tesseract usando el parser heurístico inteligente
      const lineas = extractedText.split('\n')
      const parsedRows = []

      lineas.forEach(linea => {
        const res = parsearLineaCompletaInteligente(linea)
        if (res) {
          parsedRows.push(crearFilaObjeto(res.codigo, res.nombre, res.cantidad, res.costo, res.precio, '', res.unidad))
        }
      })

      if (parsedRows.length > 0) {
        setFilas(parsedRows)
        setPaso(2)
        showToast(`Escaneo OCR real completado. ${parsedRows.length} ítems extraídos con éxito.`, 'success')
      } else {
        showToast('No se pudieron estructurar filas automáticamente; revisa e ingresa los datos manualmente.', 'warning')
        setFilas([crearFilaObjeto('', 'FACTURA LEÍDA: REVISAR MANUALMENTE', 1, 0, 0, 'VARIOS', 'und')])
        setPaso(2)
      }

    } catch (error) {
      console.error('Error durante OCR real:', error)
      showToast(`Error al analizar la imagen: ${error.message}`, 'error')
    } finally {
      setIsProcessingFile(false)
    }
  }

  // --- 4. Creador de objetos de fila y lógica de coincidencia (Matching) ---
  const crearFilaObjeto = useCallback((codigo, nombre, cantidad, costo, precio, catSugerida = '', unidad = 'und') => {
    const codUpper = codigo?.toUpperCase().trim()
    const nomUpper = nombre?.toUpperCase().trim()

    // Intentar buscar coincidencia en el inventario actual utilizando fuzzy matching inteligente sobre el código
    let match = null
    if (codUpper) {
      match = findBestFuzzyCodeMatch(codUpper, productos)
    }
    if (!match && nomUpper) {
      // Buscar por nombre exacto
      match = productos.find(p => p.nombre?.toUpperCase() === nomUpper)
      // Si no, búsqueda difusa simple
      if (!match) {
        const matches = smartSearchProductos(productos, nombre)
        // smartSearchProductos ya devuelve solo coincidencias válidas y
        // conserva cobertura/score para ordenarlas; no usar _relevance porque
        // esa propiedad no forma parte de su contrato.
        if (matches.length > 0) {
          match = matches[0]
        }
      }
    }

    // Si coincide con un producto existente, auto-corregimos el código y nombre con los datos oficiales del catálogo
    let finalCodigo = codUpper || ''
    let finalNombre = nomUpper || ''
    let finalUnidad = unidad
    if (match) {
      finalCodigo = match.codigo
      finalNombre = match.nombre
      finalUnidad = match.unidad
    }

    // Determinar categoría por palabras clave si no tiene
    let finalCat = catSugerida || (match ? match.categoria : '')
    if (!finalCat) {
      const nom = finalNombre || ''
      if (nom.includes('TUBO') && nom.includes('PVC')) finalCat = 'TUBOS PVC'
      else if (nom.includes('TUBO') && nom.includes('ESTRUCTURAL')) finalCat = 'TUBOS ESTRUCTURALES'
      else if (nom.includes('TUBO') && nom.includes('GALV')) finalCat = 'TUBOS GALVANIZADO'
      else if (nom.includes('TUBO')) finalCat = 'TUBOS'
      else if (nom.includes('LAMINA') || nom.includes('LÁMINA')) finalCat = 'LAMINAS'
      else if (nom.includes('VIGA')) finalCat = 'VIGAS'
      else if (nom.includes('PERFIL') || nom.includes('CABILLA') || nom.includes('ANGULO')) finalCat = 'PERFILES'
      else if (nom.includes('SOLDADURA') || nom.includes('ELECTRODO')) finalCat = 'SOLDADURA'
      else finalCat = 'VARIOS'
    }

    return {
      id: crypto.randomUUID(),
      codigo: finalCodigo,
      nombre: finalNombre,
      cantidadInput: cantidad,
      costoInput: costo || (match ? match.costo_usd || 0 : 0),
      precioInput: precio || (match ? match.precio_usd || 0 : 0),
      categoria: finalCat,
      unidad: finalUnidad,
      
      // Metadatos de coincidencia
      matchedProduct: match, // Referencia al producto existente
      modoExistente: 'sumar', // 'sumar' | 'sobrescribir' (para stock en coincidentes)
      actualizarCosto: true,  // Si se debe actualizar el costo en existentes
      
      // Estado de validación
      estado: match ? 'existente' : 'nuevo', // 'nuevo' | 'existente' | 'error'
      errorMsg: ''
    }
  }, [productos])

  // --- 5. Validaciones y Lógica de Edición en Grilla ---
  const handleFilaChange = (id, campo, valor) => {
    setFilas(prev => prev.map(fila => {
      if (fila.id !== id) return fila

      const nuevaFila = { ...fila, [campo]: valor }

      // Si cambia el código, re-evaluar si coincide con uno existente
      if (campo === 'codigo') {
        const codUpper = String(valor).toUpperCase().trim()
        const match = productos.find(p => p.codigo?.toUpperCase() === codUpper)
        if (match) {
          nuevaFila.matchedProduct = match
          nuevaFila.estado = 'existente'
          nuevaFila.nombre = match.nombre // Sincronizar nombre para evitar confusión
          nuevaFila.unidad = match.unidad
          nuevaFila.categoria = match.categoria
          if (!fila.costoInput) nuevaFila.costoInput = match.costo_usd || 0
          if (!fila.precioInput) nuevaFila.precioInput = match.precio_usd || 0
        } else {
          nuevaFila.matchedProduct = null
          nuevaFila.estado = 'nuevo'
        }
      }

      // Validaciones rápidas
      let error = ''
      if (campo === 'nombre' && !valor.trim()) {
        error = 'El nombre es obligatorio'
      }
      if (campo === 'cantidadInput' && (parseFloat(valor) <= 0 || isNaN(valor))) {
        error = 'La cantidad debe ser mayor a 0'
      }

      nuevaFila.errorMsg = error
      if (error) nuevaFila.estado = 'error'
      else if (!nuevaFila.matchedProduct) nuevaFila.estado = 'nuevo'
      else nuevaFila.estado = 'existente'

      return nuevaFila
    }))
  }

  const eliminarFila = (id) => {
    setFilas(prev => prev.filter(f => f.id !== id))
  }

  // Aplicar una misma categoría a todos los productos nuevos
  const aplicarCategoriaMasiva = (cat) => {
    if (!cat) return
    setFilas(prev => prev.map(f => f.estado === 'nuevo' ? { ...f, categoria: cat } : f))
    showToast(`Categoría "${cat}" aplicada a todos los productos nuevos.`, 'info')
  }

  // --- 6. Confirmación y Envío Final al Worker ---
  const handleConfirmarIngesta = async () => {
    // Validar que no haya errores
    const conErrores = filas.filter(f => !f.nombre || f.cantidadInput <= 0 || !f.categoria)
    if (conErrores.length > 0) {
      showToast('Corrige los errores antes de confirmar el ingreso.', 'error')
      return
    }

    if (!motivoIngreso.trim()) {
      showToast('Por favor, ingresa el motivo del movimiento.', 'warning')
      return
    }

    setIsSaving(true)
    try {
      idempotencyKeyRef.current = idempotencyKeyRef.current || globalThis.crypto?.randomUUID?.()
      const payload = {
        motivo: motivoIngreso.trim(),
        idempotencyKey: idempotencyKeyRef.current,
        productos: filas.map(f => ({
          id: f.matchedProduct?.id || null, // ID de supabase si ya existe
          codigo: f.codigo || null,
          nombre: f.nombre.trim(),
          cantidad: Number(f.cantidadInput),
          costo: Number(f.costoInput) || 0,
          precio: Number(f.precioInput) || 0,
          categoria: f.categoria,
          unidad: f.unidad,
          isNuevo: f.estado === 'nuevo',
          modoExistente: f.modoExistente, // 'sumar' | 'sobrescribir'
          actualizarCosto: f.actualizarCosto
        }))
      }

      const res = await authFetch('/api/inventario/batch-ingest', {
        method: 'POST',
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al procesar el lote en el servidor')
      }

      const data = await res.json()
      showToast(`¡Ingreso masivo exitoso! Se procesaron ${data.procesados} productos.`, 'success')
      
      if (onSuccess) onSuccess()
      onClose()
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <_Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={
        <div className="flex items-center gap-2">
          <_Sparkles className="text-emerald-500" size={20} />
          <span>Centro de Ingreso Masivo por Lote</span>
        </div>
      }
      className="sm:!max-w-7xl h-[90vh] flex flex-col"
    >
      <div className="flex-1 flex flex-col min-h-0 space-y-4">
        
        {paso === 1 ? (
          /* ==========================================
             PASO 1: SELECCIÓN DE CANAL DE INGESTA
             ========================================== */
          <div className="flex-1 flex flex-col min-h-0 space-y-4">
            
            {/* Tabs de Selección */}
            <div className="flex border-b border-slate-200 shrink-0">
              <button
                onClick={() => setTab('excel')}
                className={`flex items-center gap-2 px-6 py-3 font-bold text-sm border-b-2 transition-all ${
                  tab === 'excel' 
                    ? 'border-primary text-primary bg-primary/5' 
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <_Clipboard size={16} />
                Pegar Planilla (Excel)
              </button>
              <button
                onClick={() => setTab('texto')}
                className={`flex items-center gap-2 px-6 py-3 font-bold text-sm border-b-2 transition-all ${
                  tab === 'texto' 
                    ? 'border-primary text-primary bg-primary/5' 
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <_FileText size={16} />
                Texto Desestructurado
              </button>
              <button
                onClick={() => setTab('foto')}
                className={`flex items-center gap-2 px-6 py-3 font-bold text-sm border-b-2 transition-all ${
                  tab === 'foto' 
                    ? 'border-primary text-primary bg-primary/5' 
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <_Camera size={16} />
                Cargar Factura / OCR
              </button>
            </div>

            {/* Contenidos de Pestañas */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              
              {/* TAB 1: EXCEL PLANILLA */}
              {tab === 'excel' && (
                <div className="space-y-4 h-full flex flex-col">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-3">
                    <_Info size={16} className="text-primary mt-0.5 shrink-0" />
                    <div className="text-xs text-slate-600 space-y-1">
                      <p className="font-bold text-slate-800">Copia y pega directo desde Excel o Google Sheets</p>
                      <p>
                        Asegúrate de copiar las columnas completas. El orden recomendado es:
                        <span className="font-mono bg-white px-1 py-0.5 rounded border ml-1 font-bold">Código | Nombre | Cantidad | Costo | Precio | Categoría | Unidad</span>
                      </p>
                    </div>
                  </div>

                  <textarea
                    value={excelText}
                    onChange={e => setExcelText(e.target.value)}
                    rows={12}
                    placeholder={`Ejemplo (puedes copiar filas completas desde Excel):\nEST-100\tVIGA DE ACERO IPE 100\t10\t45.00\t60.00\tVIGAS\ttramo\nEST-120\tVIGA DE ACERO IPE 120\t5\t58.00\t78.00\tVIGAS\ttramo`}
                    className="w-full flex-1 min-h-[250px] p-4 rounded-xl border border-slate-200 bg-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary resize-none custom-scrollbar"
                  />

                  <div className="flex justify-end gap-2 shrink-0">
                    <button
                      onClick={procesarExcel}
                      disabled={!excelText.trim()}
                      className="flex items-center gap-2 px-6 py-3 text-white font-bold text-sm rounded-xl transition-all shadow-md active:scale-[0.98] disabled:opacity-40 disabled:scale-100 bg-slate-800 hover:bg-slate-700"
                    >
                      Procesar Planilla
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 2: TEXTO DESESTRUCTURADO */}
              {tab === 'texto' && (
                <div className="space-y-4 h-full flex flex-col">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-3">
                    <_Sparkles size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                    <div className="text-xs text-slate-600 space-y-1">
                      <p className="font-bold text-slate-800">Escribe o pega texto libre. El sistema extraerá de forma inteligente:</p>
                      <ul className="list-disc list-inside space-y-0.5 pl-1 font-medium">
                        <li>Cantidades al inicio de cada línea.</li>
                        <li>Costo y precio indicados con prefijos (ej: "costo: 12", "pv: 18", "a 4.5").</li>
                        <li>Unidades y Categorías deducidas de palabras metalúrgicas (ej: "tubo structural", "cabilla").</li>
                      </ul>
                    </div>
                  </div>

                  <textarea
                    value={freeText}
                    onChange={e => setFreeText(e.target.value)}
                    rows={12}
                    placeholder={`Escribe una línea por producto, por ejemplo:\n10 tubos pvc de 1 pulgada costo: 4.5 pv: 7.20\n15 cabillas de 1/2 a 5.50\nperfil angular de 3x3, 8 barras, costo 18.20 precio: 26.00`}
                    className="w-full flex-1 min-h-[250px] p-4 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary resize-none custom-scrollbar"
                  />

                  <div className="flex justify-end gap-2 shrink-0">
                    <button
                      onClick={procesarTextoLibre}
                      disabled={!freeText.trim()}
                      className="flex items-center gap-2 px-6 py-3 text-white font-bold text-sm rounded-xl transition-all shadow-md active:scale-[0.98] disabled:opacity-40 disabled:scale-100 bg-slate-800 hover:bg-slate-700"
                    >
                      Analizar Texto
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: CARGA FOTO/OCR */}
              {tab === 'foto' && (
                <div className="space-y-4 h-full flex flex-col justify-center items-center min-h-[300px]">
                  
                  {isProcessingFile ? (
                    <div className="text-center space-y-4 max-w-sm">
                      <_RefreshCw className="animate-spin text-emerald-500 mx-auto" size={48} />
                      <div className="space-y-2">
                        <p className="font-black text-slate-800 text-sm">Escaneando documento...</p>
                        <p className="text-xs text-slate-500">Ejecutando OCR inteligente de alta resolución sobre facturas.</p>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-gradient-to-r from-emerald-500 to-primary h-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div 
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      className={`w-full max-w-xl p-8 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center space-y-4 transition-all ${
                        isDragging 
                          ? 'border-emerald-500 bg-emerald-50/50' 
                          : 'border-slate-300 bg-slate-50 hover:bg-slate-100/50'
                      }`}
                    >
                      <_UploadCloud className="text-slate-400" size={56} />
                      <div className="space-y-1">
                        <p className="font-bold text-slate-800">Arrastra una fotografía de tu factura aquí</p>
                        <p className="text-xs text-slate-400">O haz clic para explorar en tu computadora (.png, .jpg, .pdf)</p>
                      </div>
                      <label className="px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-sm cursor-pointer transition-colors active:scale-[0.98]">
                        Explorar archivos
                        <input 
                          type="file" 
                          accept="image/*,application/pdf" 
                          className="hidden" 
                          onChange={handleFileChange} 
                        />
                      </label>
                    </div>
                  )}

                  <div className="text-center p-3 bg-emerald-50 rounded-xl border border-emerald-200 max-w-md flex items-start gap-2">
                    <_Sparkles className="text-emerald-600 shrink-0 mt-0.5" size={14} />
                    <div className="text-left space-y-0.5">
                      <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Motor OCR Activo (Local)</p>
                      <p className="text-[11px] text-emerald-700 leading-tight">
                        El escaneo ocurre completamente en tu navegador mediante WebAssembly y Tesseract.js. Tus documentos no se envían a ningún servidor de terceros, garantizando privacidad absoluta.
                      </p>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        ) : (
          /* ==========================================
             PASO 2: GRILLA DE VERIFICACIÓN UNIFICADA
             ========================================== */
          <div className="flex-1 flex flex-col min-h-0 space-y-4">
            
            {/* Cabecera de la Grilla */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0 bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-black text-slate-800 text-sm">Verificación de Lote Ingresado</span>
                  <span className="text-[10px] bg-slate-800 text-white font-bold px-2 py-0.5 rounded-full">
                    {filas.length} ítems
                  </span>
                </div>
                <p className="text-xs text-slate-500">Revisa, completa y corrige celdas antes de aplicar la ingesta al inventario.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                {/* Categoría Masiva */}
                <div className="flex items-center gap-1.5 w-full sm:w-auto">
                  <span className="text-xs text-slate-500 font-semibold shrink-0">Categoría a nuevos:</span>
                  <div className="w-44">
                    <_CustomSelect
                      options={catOptions}
                      value=""
                      onChange={aplicarCategoriaMasiva}
                      placeholder="Seleccionar..."
                      size="sm"
                    />
                  </div>
                </div>

                <button 
                  onClick={() => setPaso(1)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition-all"
                >
                  Volver a cargar
                </button>
              </div>
            </div>

            {/* Split Screen si es carga de foto, o tabla normal en las demás */}
            <div className="flex-1 flex min-h-0 gap-4">
              
              {/* Lado Izquierdo: Previsualización de Factura (Solo si tab es Foto) */}
              {tab === 'foto' && filePreviewUrl && (
                <div className="w-1/3 border border-slate-200 rounded-2xl overflow-hidden bg-slate-100 flex flex-col shrink-0">
                  <div className="p-2 border-b bg-white flex justify-between items-center">
                    <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider">Factura Soporte</span>
                    <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-bold">Cargado</span>
                  </div>
                  <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
                    <img 
                      src={filePreviewUrl} 
                      alt="Factura" 
                      className="max-w-full max-h-full object-contain rounded shadow-lg border"
                    />
                  </div>
                </div>
              )}

              {/* Lado Derecho/Central: La Tabla Interactiva */}
              <div className="flex-1 border border-slate-200 rounded-2xl bg-white overflow-hidden flex flex-col min-w-0">
                <div className="flex-1 overflow-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[900px]">
                    <thead>
                      <tr className="bg-slate-800 text-white text-[11px] font-black uppercase tracking-wider sticky top-0 z-10">
                        <th className="px-4 py-3 text-center w-24">Estado</th>
                        <th className="px-4 py-3 w-32">Código</th>
                        <th className="px-4 py-3">Nombre del Producto</th>
                        <th className="px-4 py-3 w-28 text-center">Cant. Ingreso</th>
                        <th className="px-4 py-3 w-28">Unidad</th>
                        <th className="px-4 py-3 w-28 text-right">Costo (USD)</th>
                        <th className="px-4 py-3 w-28 text-right">Precio (USD)</th>
                        <th className="px-4 py-3 w-44">Categoría</th>
                        <th className="px-4 py-3 text-center w-12">Elim</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filas.map((fila, _idx) => {
                        const esExistente = fila.estado === 'existente'
                        const esNuevo = fila.estado === 'nuevo'
                        const esError = fila.estado === 'error' || fila.errorMsg

                        return (
                          <tr key={fila.id} className={`hover:bg-slate-50/50 ${esError ? 'bg-red-50/30' : ''}`}>
                            
                            {/* ESTADO */}
                            <td className="px-4 py-2 text-center">
                              {esExistente && (
                                <span className="inline-flex flex-col items-center">
                                  <span className="text-[10px] bg-blue-100 text-blue-700 font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                                    Existente
                                  </span>
                                  {fila.matchedProduct && (
                                    <span className="text-[9px] text-slate-400 font-mono mt-0.5 block">
                                      Stock: {fila.matchedProduct.stock_actual}
                                    </span>
                                  )}
                                </span>
                              )}
                              {esNuevo && (
                                <span className="text-[10px] bg-emerald-100 text-emerald-700 font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                                  Nuevo
                                </span>
                              )}
                              {esError && (
                                <span 
                                  title={fila.errorMsg} 
                                  className="text-[10px] bg-red-100 text-red-700 font-black px-2 py-0.5 rounded-md uppercase tracking-wider cursor-help flex items-center justify-center gap-1"
                                >
                                  <_AlertTriangle size={12} />
                                  Error
                                </span>
                              )}
                            </td>

                            {/* CÓDIGO */}
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={fila.codigo}
                                onChange={e => handleFilaChange(fila.id, 'codigo', e.target.value)}
                                placeholder="Auto"
                                className="w-full px-2 py-1 text-xs font-mono font-bold bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                              />
                            </td>

                            {/* NOMBRE */}
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={fila.nombre}
                                onChange={e => handleFilaChange(fila.id, 'nombre', e.target.value)}
                                placeholder="Nombre del producto"
                                className="w-full px-2 py-1 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                              />
                            </td>

                            {/* CANTIDAD / MODO */}
                            <td className="px-2 py-1.5">
                              <div className="flex flex-col gap-1">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  value={fila.cantidadInput}
                                  onChange={e => handleFilaChange(fila.id, 'cantidadInput', parseFloat(e.target.value) || 0)}
                                  className="w-full px-2 py-1 text-xs font-black text-center bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                                />
                                
                                {/* Si es existente, selector de sumar o sobrescribir */}
                                {esExistente && (
                                  <div className="flex bg-slate-100 rounded p-0.5 text-[9px] font-bold">
                                    <button
                                      onClick={() => handleFilaChange(fila.id, 'modoExistente', 'sumar')}
                                      className={`flex-1 py-0.5 rounded text-center transition-colors ${
                                        fila.modoExistente === 'sumar' 
                                          ? 'bg-white text-slate-800 shadow-sm' 
                                          : 'text-slate-400 hover:text-slate-600'
                                      }`}
                                      title="Suma la cantidad ingresada al stock actual"
                                    >
                                      Suma
                                    </button>
                                    <button
                                      onClick={() => handleFilaChange(fila.id, 'modoExistente', 'sobrescribir')}
                                      className={`flex-1 py-0.5 rounded text-center transition-colors ${
                                        fila.modoExistente === 'sobrescribir' 
                                          ? 'bg-white text-slate-800 shadow-sm' 
                                          : 'text-slate-400 hover:text-slate-600'
                                      }`}
                                      title="Sobrescribe el stock actual con este valor"
                                    >
                                      Sobre
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* UNIDAD */}
                            <td className="px-2 py-1.5">
                              <select
                                value={fila.unidad}
                                onChange={e => handleFilaChange(fila.id, 'unidad', e.target.value)}
                                className="w-full px-1.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none"
                              >
                                {DEFAULT_UNITS.map(u => (
                                  <option key={u.value} value={u.value}>{u.label}</option>
                                ))}
                              </select>
                            </td>

                            {/* COSTO */}
                            <td className="px-2 py-1.5">
                              <div className="flex flex-col gap-1">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={fila.costoInput}
                                  onChange={e => handleFilaChange(fila.id, 'costoInput', parseFloat(e.target.value) || 0)}
                                  className="w-full px-2 py-1 text-xs font-black text-right bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                                />
                                {esExistente && fila.matchedProduct && (
                                  <label className="flex items-center gap-1 text-[9px] text-slate-400 justify-end cursor-pointer">
                                    <input 
                                      type="checkbox" 
                                      checked={fila.actualizarCosto} 
                                      onChange={e => handleFilaChange(fila.id, 'actualizarCosto', e.target.checked)}
                                      className="rounded border-slate-300 scale-90"
                                    />
                                    Costo: ${fila.matchedProduct.costo_usd || 0}
                                  </label>
                                )}
                              </div>
                            </td>

                            {/* PRECIO */}
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={fila.precioInput}
                                onChange={e => handleFilaChange(fila.id, 'precioInput', parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 text-xs font-black text-right bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                              />
                            </td>

                            {/* CATEGORÍA */}
                            <td className="px-2 py-1.5">
                              <select
                                value={fila.categoria}
                                onChange={e => handleFilaChange(fila.id, 'categoria', e.target.value)}
                                className="w-full px-1.5 py-1 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none"
                              >
                                {catOptions.map(c => (
                                  <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                              </select>
                            </td>

                            {/* ELIMINAR */}
                            <td className="px-4 py-2 text-center">
                              <button
                                onClick={() => eliminarFila(fila.id)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <_Trash2 size={14} />
                              </button>
                            </td>

                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer del Panel de la Tabla: Configuración del Lote */}
                <div className="p-4 border-t bg-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
                  <div className="flex-1 w-full space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Motivo del Movimiento de Inventario Y Kardex:
                    </label>
                    <input
                      type="text"
                      value={motivoIngreso}
                      onChange={e => setMotivoIngreso(e.target.value)}
                      placeholder="Ej: Ingreso de mercancía Importación #12 o Ajuste mensual"
                      className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary"
                    />
                  </div>

                  <div className="flex gap-2 w-full md:w-auto shrink-0 justify-end pt-5 md:pt-0">
                    <button
                      onClick={handleConfirmarIngesta}
                      disabled={isSaving || filas.length === 0}
                      className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3.5 text-white font-black text-sm rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-40 disabled:scale-100"
                      style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
                    >
                      {isSaving ? (
                        <>
                          <_RefreshCw className="animate-spin" size={16} />
                          Procesando ingreso...
                        </>
                      ) : (
                        <>
                          <_CheckCircle2 size={16} />
                          Confirmar Ingreso Masivo ({filas.length})
                        </>
                      )}
                    </button>
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}

      </div>
    </_Modal>
  )
}
