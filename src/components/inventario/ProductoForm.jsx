// src/components/inventario/ProductoForm.jsx
// Formulario para crear/editar productos — solo supervisor
import { useState, useEffect, useRef } from 'react'
import { Hash, Package, Tag, Layers, DollarSign, BarChart2, Loader2, Camera, X } from 'lucide-react'
import { useCrearProducto, useActualizarProducto, useCategorias } from '../../hooks/useInventario'
import { comprimirImagen, subirImagenProducto } from '../../utils/imageCompress'
import supabase from '../../services/supabase/client'
import CustomSelect from '../ui/CustomSelect'

function Campo({ label, icono: Icono, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {Icono && <Icono size={14} className="text-slate-400" />}
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

const inputClass = `
  w-full px-3 py-2.5 rounded-xl border text-sm text-slate-800
  bg-slate-50 border-slate-200
  focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary
  placeholder:text-slate-400 transition-colors
`

const VACIO = {
  codigo: '', nombre: '', descripcion: '', categoria: '',
  unidad: 'und', precio_usd: '', precio_2: '', precio_3: '', costo_usd: '',
  stock_actual: '0', stock_minimo: '0',
}

export default function ProductoForm({ producto = null, onSuccess, onCancel }) {
  const esEdicion = !!producto
  const [campos, setCampos] = useState(VACIO)
  const [errores, setErrores] = useState({})
  const [errorGeneral, setErrorGeneral] = useState('')

  // Imagen
  const fileRef = useRef(null)
  const [imagenPreview, setImagenPreview] = useState(null) // URL para preview
  const [imagenBlob, setImagenBlob] = useState(null)       // Blob comprimido para subir
  const [imagenEliminada, setImagenEliminada] = useState(false)
  const [comprimiendo, setComprimiendo] = useState(false)

  const crear     = useCrearProducto()
  const actualizar = useActualizarProducto()
  const { data: categoriasExistentes = [] } = useCategorias()
  const mutation  = esEdicion ? actualizar : crear
  const cargando  = mutation.isPending

  useEffect(() => {
    if (producto) {
      setCampos({
        codigo:       producto.codigo       ?? '',
        nombre:       producto.nombre       ?? '',
        descripcion:  producto.descripcion  ?? '',
        categoria:    producto.categoria    ?? '',
        unidad:       producto.unidad       ?? 'und',
        precio_usd:   producto.precio_usd != null ? String(producto.precio_usd) : '',
        precio_2:     producto.precio_2  != null ? String(producto.precio_2)  : '',
        precio_3:     producto.precio_3  != null ? String(producto.precio_3)  : '',
        costo_usd:    producto.costo_usd  != null ? String(producto.costo_usd)  : '',
        stock_actual: producto.stock_actual != null ? String(producto.stock_actual) : '0',
        stock_minimo: producto.stock_minimo != null ? String(producto.stock_minimo) : '0',
      })
      if (producto.imagen_url) setImagenPreview(producto.imagen_url)
    }
  }, [producto])

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      if (imagenPreview && imagenPreview.startsWith('blob:')) URL.revokeObjectURL(imagenPreview)
    }
  }, [imagenPreview])

  async function handleImagen(e) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset file input
    e.target.value = ''

    setComprimiendo(true)
    try {
      const { blob, dataUrl } = await comprimirImagen(file)
      // Limpiar preview anterior si era blob
      if (imagenPreview?.startsWith('blob:')) URL.revokeObjectURL(imagenPreview)
      setImagenBlob(blob)
      setImagenPreview(dataUrl)
      setImagenEliminada(false)
    } catch (err) {
      setErrorGeneral('Error al procesar la imagen: ' + err.message)
    } finally {
      setComprimiendo(false)
    }
  }

  function quitarImagen() {
    if (imagenPreview?.startsWith('blob:')) URL.revokeObjectURL(imagenPreview)
    setImagenPreview(null)
    setImagenBlob(null)
    setImagenEliminada(true)
  }

  const camposNumericos = new Set(['precio_usd', 'precio_2', 'precio_3', 'costo_usd', 'stock_actual', 'stock_minimo'])

  function cambiar(e) {
    const { name } = e.target
    let value = e.target.value
    if (camposNumericos.has(name)) value = value.replace(',', '.')
    setCampos(p => ({ ...p, [name]: value }))
    if (errores[name]) setErrores(p => ({ ...p, [name]: '' }))
    if (errorGeneral) setErrorGeneral('')
  }

  function validar() {
    const errs = {}
    if (!campos.nombre.trim()) errs.nombre = 'El nombre es obligatorio'
    if (campos.precio_usd !== '' && isNaN(Number(campos.precio_usd)))
      errs.precio_usd = 'Precio inválido'
    if (campos.precio_2 !== '' && isNaN(Number(campos.precio_2)))
      errs.precio_2 = 'Precio inválido'
    if (campos.precio_3 !== '' && isNaN(Number(campos.precio_3)))
      errs.precio_3 = 'Precio inválido'
    if (campos.costo_usd !== '' && isNaN(Number(campos.costo_usd)))
      errs.costo_usd = 'Costo inválido'
    if (isNaN(Number(campos.stock_actual)))
      errs.stock_actual = 'Stock inválido'
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validar()
    if (Object.keys(errs).length) { setErrores(errs); return }

    try {
      let productoResult
      if (esEdicion) {
        productoResult = await actualizar.mutateAsync({ id: producto.id, campos, imagen_url: producto.imagen_url })
      } else {
        productoResult = await crear.mutateAsync(campos)
      }

      // Subir imagen si hay una nueva
      const productoId = productoResult?.id ?? producto?.id
      if (imagenBlob && productoId) {
        const url = await subirImagenProducto(supabase, productoId, imagenBlob)
        await supabase.from('productos').update({ imagen_url: url }).eq('id', productoId)
      } else if (imagenEliminada && productoId) {
        await supabase.from('productos').update({ imagen_url: null }).eq('id', productoId)
      } else if (esEdicion && productoId && producto.imagen_url) {
        // Restaurar imagen_url en caso de que el RPC la haya limpiado
        await supabase.from('productos').update({ imagen_url: producto.imagen_url }).eq('id', productoId)
      }

      onSuccess?.()
    } catch (err) {
      setErrorGeneral(err.message ?? 'Ocurrió un error. Intenta de nuevo.')
    }
  }

  const tieneImagen = !!imagenPreview

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* Imagen del producto */}
      <div className="flex items-center gap-4">
        <div
          onClick={() => !cargando && fileRef.current?.click()}
          className={`relative w-20 h-20 rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer transition-all overflow-hidden shrink-0 ${
            tieneImagen ? 'border-primary/30 bg-white' : 'border-slate-300 bg-slate-50 hover:border-primary hover:bg-primary-light'
          }`}
        >
          {comprimiendo ? (
            <Loader2 size={20} className="text-slate-400 animate-spin" />
          ) : tieneImagen ? (
            <img src={imagenPreview} alt="Producto" className="w-full h-full object-cover" />
          ) : (
            <Camera size={22} className="text-slate-400" />
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={handleImagen} disabled={cargando} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700">Foto del producto</p>
          <p className="text-xs text-slate-400">JPG, PNG o WebP. Se comprime automáticamente.</p>
          {tieneImagen && (
            <button type="button" onClick={quitarImagen} disabled={cargando}
              className="flex items-center gap-1 mt-1 text-xs text-red-500 hover:text-red-700 transition-colors">
              <X size={12} /> Quitar imagen
            </button>
          )}
        </div>
      </div>

      {/* Nombre */}
      <Campo label="Nombre *" icono={Package} error={errores.nombre}>
        <input type="text" name="nombre" value={campos.nombre}
          onChange={cambiar} placeholder="Ej: Cemento Gris Bolsa 42kg"
          className={inputClass} disabled={cargando} autoFocus />
      </Campo>

      {/* Código */}
      <Campo label="Código" icono={Hash} error={errores.codigo}>
        <input type="text" name="codigo" value={campos.codigo}
          onChange={cambiar} placeholder="Ej: CEM-001"
          className={inputClass} disabled={cargando} />
      </Campo>

      {/* Categoría + Unidad (fila) */}
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Categoría" icono={Tag} error={errores.categoria}>
          <CustomSelect
            options={categoriasExistentes.map(c => ({ value: c, label: c }))}
            value={campos.categoria}
            onChange={val => { setCampos(p => ({ ...p, categoria: val })); if (errores.categoria) setErrores(p => ({ ...p, categoria: '' })); if (errorGeneral) setErrorGeneral('') }}
            placeholder="Seleccionar categoría..."
            icon={Tag}
            disabled={cargando}
            clearable
            creatable
            createLabel="Crear"
          />
        </Campo>
        <Campo label="Unidad" icono={Layers} error={errores.unidad}>
          <CustomSelect
            options={['und', 'kg', 'g', 'lt', 'ml', 'm', 'cm', 'm2', 'm3', 'caja', 'rollo', 'par', 'bolsa', 'saco'].map(u => ({ value: u, label: u }))}
            value={campos.unidad}
            onChange={val => setCampos(p => ({ ...p, unidad: val }))}
            icon={Layers}
            disabled={cargando}
            creatable
            createLabel="Crear"
          />
        </Campo>
      </div>

      {/* Descripción */}
      <Campo label="Descripción" icono={Package} error={errores.descripcion}>
        <textarea name="descripcion" value={campos.descripcion}
          onChange={cambiar} rows={2}
          placeholder="Descripción opcional del producto..."
          className={`${inputClass} resize-none`} disabled={cargando} />
      </Campo>

      {/* Precios (fila de 3) */}
      <div className="grid grid-cols-3 gap-3">
        <Campo label="Precio 1 (USD)" icono={DollarSign} error={errores.precio_usd}>
          <input type="text" inputMode="decimal" name="precio_usd" value={campos.precio_usd}
            onChange={cambiar} placeholder="0.00"
            className={inputClass} disabled={cargando} />
        </Campo>
        <Campo label="Precio 2 (USD)" icono={DollarSign} error={errores.precio_2}>
          <input type="text" inputMode="decimal" name="precio_2" value={campos.precio_2}
            onChange={cambiar} placeholder="Opcional"
            className={inputClass} disabled={cargando} />
        </Campo>
        <Campo label="Precio 3 (USD)" icono={DollarSign} error={errores.precio_3}>
          <input type="text" inputMode="decimal" name="precio_3" value={campos.precio_3}
            onChange={cambiar} placeholder="Opcional"
            className={inputClass} disabled={cargando} />
        </Campo>
      </div>

      {/* Costo */}
      <Campo label="Costo (USD)" icono={DollarSign} error={errores.costo_usd}>
        <input type="number" name="costo_usd" value={campos.costo_usd}
          onChange={cambiar} placeholder="0.00" step="0.01" min="0"
          className={inputClass} disabled={cargando} />
      </Campo>

      {/* Stock actual + mínimo (fila) */}
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Stock actual" icono={BarChart2} error={errores.stock_actual}>
          <input type="number" name="stock_actual" value={campos.stock_actual}
            onChange={cambiar} placeholder="0" step="1" min="0"
            className={inputClass} disabled={cargando} />
        </Campo>
        <Campo label="Stock mínimo" icono={BarChart2} error={errores.stock_minimo}>
          <input type="number" name="stock_minimo" value={campos.stock_minimo}
            onChange={cambiar} placeholder="0" step="1" min="0"
            className={inputClass} disabled={cargando} />
        </Campo>
      </div>

      {errorGeneral && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {errorGeneral}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} disabled={cargando}
          className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando || comprimiendo}
          className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {cargando
            ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
            : esEdicion ? 'Guardar cambios' : 'Crear producto'
          }
        </button>
      </div>
    </form>
  )
}
