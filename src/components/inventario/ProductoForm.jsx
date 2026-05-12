// src/components/inventario/ProductoForm.jsx
// Formulario para crear/editar productos — solo supervisor
import { useState, useEffect, useRef } from 'react'
import { Hash, Package, Tag, Layers, DollarSign, BarChart2, Loader2, Camera, X } from 'lucide-react'
import { useCrearProducto, useActualizarProducto, useCategorias } from '../../hooks/useInventario'
import { comprimirImagen, subirImagenProducto } from '../../utils/imageCompress'
import supabase from '../../services/supabase/client'
import CustomSelect from '../ui/CustomSelect'
import useAuthStore from '../../store/useAuthStore'

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
  precio1_porcentaje: '', precio2_porcentaje: '', precio3_porcentaje: ''
}

function PrecioBlock({ label, precioName, pctName, campos, cambiar, esAdmin, errores, cargando }) {
  const precio = Number(campos[precioName]) || 0;
  const costo = Number(campos.costo_usd) || 0;
  
  const ganancia = precio - costo;
  const margenReal = precio > 0 ? (ganancia / precio) * 100 : 0;

  let stateColor = 'text-slate-600';
  let inputBorder = 'border-slate-200 focus:border-primary focus:ring-primary-focus';
  let msg = '';
  
  if (costo > 0 && campos[precioName] !== '') {
    if (margenReal > 15) {
      stateColor = 'text-emerald-600';
    } else if (margenReal > 0 && margenReal <= 15) {
      stateColor = 'text-amber-500';
      if (margenReal <= 5) msg = 'Margen bajo';
      inputBorder = 'border-amber-300 focus:border-amber-500 focus:ring-amber-200 bg-amber-50';
    } else if (precio === costo) {
      stateColor = 'text-amber-500';
      msg = 'Precio = Costo';
      inputBorder = 'border-amber-300 focus:border-amber-500 focus:ring-amber-200 bg-amber-50';
    } else {
      stateColor = 'text-red-500';
      msg = 'El precio no cubre el costo';
      inputBorder = 'border-red-300 focus:border-red-500 focus:ring-red-200 bg-red-50';
    }
  }

  const baseInputClass = "w-full px-3 py-2.5 rounded-xl border text-sm text-slate-800 focus:outline-none focus:ring-2 placeholder:text-slate-400 transition-colors bg-slate-50";

  return (
    <div className="space-y-2 border border-slate-200 rounded-xl p-3 bg-white">
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1">
        <DollarSign size={14} className="text-slate-400" />
        {label}
      </label>
      <div className="flex gap-2">
        <div className="flex-1">
          <input type="text" inputMode="decimal" name={precioName} value={campos[precioName]}
            onChange={cambiar} placeholder="0.00" disabled={cargando}
            className={`${baseInputClass} ${errores[precioName] ? 'border-red-500 ring-red-200 bg-red-50' : inputBorder}`} />
        </div>
        {esAdmin && (
          <div className="w-24 relative shrink-0">
            <input type="text" inputMode="decimal" name={pctName} value={campos[pctName]}
              onChange={cambiar} placeholder="0" disabled={cargando}
              className={`${baseInputClass} ${inputBorder} pr-6`} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">%</span>
          </div>
        )}
      </div>
      {esAdmin && costo > 0 && campos[precioName] !== '' && (
        <div className="text-[11px] leading-tight flex flex-col gap-0.5 mt-1">
          <span className="text-slate-500">
            Ganancia: <strong className={stateColor}>${ganancia.toFixed(2)}</strong> · Margen real: <strong>{margenReal.toFixed(1)}%</strong>
          </span>
          {msg && <span className={`font-medium ${stateColor}`}>{msg}</span>}
        </div>
      )}
      {errores[precioName] && <p className="text-xs text-red-500">{errores[precioName]}</p>}
    </div>
  )
}

export default function ProductoForm({ producto = null, onSuccess, onCancel }) {
  const { perfil } = useAuthStore()
  const esAdmin = perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'
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
        precio1_porcentaje: producto.precio1_porcentaje != null ? String(producto.precio1_porcentaje) : '',
        precio2_porcentaje: producto.precio2_porcentaje != null ? String(producto.precio2_porcentaje) : '',
        precio3_porcentaje: producto.precio3_porcentaje != null ? String(producto.precio3_porcentaje) : '',
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

  const camposNumericos = new Set(['precio_usd', 'precio_2', 'precio_3', 'costo_usd', 'stock_actual', 'stock_minimo', 'precio1_porcentaje', 'precio2_porcentaje', 'precio3_porcentaje'])

  function cambiar(e) {
    const { name } = e.target
    let value = e.target.value
    if (camposNumericos.has(name)) value = value.replace(',', '.')

    setCampos(p => {
      const next = { ...p, [name]: value }

      // Auto-calcular porcentaje si cambia precio y hay costo
      if ((name === 'precio_usd' || name === 'precio_2' || name === 'precio_3') && esAdmin) {
        const idx = name === 'precio_usd' ? 1 : name === 'precio_2' ? 2 : 3;
        const costo = Number(next.costo_usd);
        const precio = Number(value);
        if (costo > 0 && !isNaN(precio) && value !== '') {
          next[`precio${idx}_porcentaje`] = (((precio - costo) / costo) * 100).toFixed(2);
        } else if (value === '') {
          next[`precio${idx}_porcentaje`] = '';
        }
      }

      // Auto-calcular precio si cambia porcentaje y hay costo
      if ((name === 'precio1_porcentaje' || name === 'precio2_porcentaje' || name === 'precio3_porcentaje') && esAdmin) {
        const idx = name.replace('precio', '').replace('_porcentaje', '');
        const costo = Number(next.costo_usd);
        const pct = Number(value);
        const targetName = idx === '1' ? 'precio_usd' : `precio_${idx}`;
        if (costo > 0 && !isNaN(pct) && value !== '') {
          next[targetName] = (costo * (1 + pct / 100)).toFixed(2);
        }
      }

      // Si cambia el costo, recalcular precios basados en los % guardados
      if (name === 'costo_usd' && esAdmin) {
        const costo = Number(value);
        if (costo > 0) {
          ['1', '2', '3'].forEach(idx => {
            const pctName = `precio${idx}_porcentaje`;
            const pct = Number(next[pctName]);
            const targetName = idx === '1' ? 'precio_usd' : `precio_${idx}`;
            if (!isNaN(pct) && next[pctName] !== '') {
              next[targetName] = (costo * (1 + pct / 100)).toFixed(2);
            }
          });
        }
      }

      return next
    })

    if (errores[name]) setErrores(p => ({ ...p, [name]: '' }))
    if (errorGeneral) setErrorGeneral('')
  }

  function recalcularPrecios() {
    const costo = Number(campos.costo_usd);
    if (costo <= 0 || isNaN(costo)) return;
    
    setCampos(p => {
      const next = { ...p };
      ['1', '2', '3'].forEach(idx => {
        const pctName = `precio${idx}_porcentaje`;
        const pct = Number(next[pctName]);
        const targetName = idx === '1' ? 'precio_usd' : `precio_${idx}`;
        if (!isNaN(pct) && next[pctName] !== '') {
          next[targetName] = (costo * (1 + pct / 100)).toFixed(2);
        }
      });
      return next;
    });
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

      // Subir imagen si hay una nueva, o eliminarla
      const productoId = productoResult?.id ?? producto?.id
      if (imagenBlob && productoId) {
        const url = await subirImagenProducto(supabase, productoId, imagenBlob)
        await supabase.from('productos').update({ imagen_url: url }).eq('id', productoId)
      } else if (imagenEliminada && productoId) {
        await supabase.from('productos').update({ imagen_url: null }).eq('id', productoId)
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
            options={categoriasExistentes}
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
            options={['und', 'kg', 'g', 'lt', 'ml', 'm', 'cm', 'm2', 'm3', 'caja', 'paq', 'rollo', 'par', 'bolsa', 'saco'].map(u => ({ value: u, label: u }))}
            value={campos.unidad}
            onChange={val => setCampos(p => ({ ...p, unidad: val }))}
            icon={Layers}
            disabled={cargando}
            creatable
            createLabel="Crear"
            createMaxLength={5}
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

      {/* Precios (bloques de precios con márgenes) */}
      <div className={`grid grid-cols-1 ${esAdmin ? 'md:grid-cols-3' : 'grid-cols-3'} gap-3 bg-slate-50/50 p-3 rounded-2xl border border-slate-100`}>
        <PrecioBlock label="Precio 1 (USD)" precioName="precio_usd" pctName="precio1_porcentaje" campos={campos} cambiar={cambiar} esAdmin={esAdmin} errores={errores} cargando={cargando} />
        <PrecioBlock label="Precio 2 (USD)" precioName="precio_2" pctName="precio2_porcentaje" campos={campos} cambiar={cambiar} esAdmin={esAdmin} errores={errores} cargando={cargando} />
        <PrecioBlock label="Precio 3 (USD)" precioName="precio_3" pctName="precio3_porcentaje" campos={campos} cambiar={cambiar} esAdmin={esAdmin} errores={errores} cargando={cargando} />
      </div>

      {/* Costo */}
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <Campo label="Costo (USD)" icono={DollarSign} error={errores.costo_usd}>
            <input type="text" inputMode="decimal" name="costo_usd" value={campos.costo_usd}
              onChange={cambiar} placeholder="0.00"
              className={inputClass} disabled={cargando} />
          </Campo>
        </div>
        {esAdmin && (campos.precio1_porcentaje || campos.precio2_porcentaje || campos.precio3_porcentaje) && (
          <button type="button" onClick={recalcularPrecios} disabled={cargando}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl border border-slate-200 transition-colors h-[42px] flex items-center justify-center">
            Recalcular precios
          </button>
        )}
      </div>

      {/* Stock actual + mínimo (fila) */}
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Stock actual" icono={BarChart2} error={errores.stock_actual}>
          <input type="text" inputMode="decimal" name="stock_actual" value={campos.stock_actual}
            onChange={cambiar} placeholder="0"
            className={inputClass} disabled={cargando} />
        </Campo>
        <Campo label="Stock mínimo" icono={BarChart2} error={errores.stock_minimo}>
          <input type="text" inputMode="decimal" name="stock_minimo" value={campos.stock_minimo}
            onChange={cambiar} placeholder="0"
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
