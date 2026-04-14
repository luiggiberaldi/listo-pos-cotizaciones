// src/components/inventario/ProductoForm.jsx
// Formulario para crear/editar productos — solo supervisor
import { useState, useEffect } from 'react'
import { Hash, Package, Tag, Layers, DollarSign, BarChart2, Loader2 } from 'lucide-react'
import { useCrearProducto, useActualizarProducto } from '../../hooks/useInventario'
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
  unidad: 'und', precio_usd: '', costo_usd: '',
  stock_actual: '0', stock_minimo: '0',
}

export default function ProductoForm({ producto = null, onSuccess, onCancel }) {
  const esEdicion = !!producto
  const [campos, setCampos] = useState(VACIO)
  const [errores, setErrores] = useState({})
  const [errorGeneral, setErrorGeneral] = useState('')

  const crear     = useCrearProducto()
  const actualizar = useActualizarProducto()
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
        costo_usd:    producto.costo_usd  != null ? String(producto.costo_usd)  : '',
        stock_actual: producto.stock_actual != null ? String(producto.stock_actual) : '0',
        stock_minimo: producto.stock_minimo != null ? String(producto.stock_minimo) : '0',
      })
    }
  }, [producto])

  function cambiar(e) {
    const { name, value } = e.target
    setCampos(p => ({ ...p, [name]: value }))
    if (errores[name]) setErrores(p => ({ ...p, [name]: '' }))
    if (errorGeneral) setErrorGeneral('')
  }

  function validar() {
    const errs = {}
    if (!campos.nombre.trim()) errs.nombre = 'El nombre es obligatorio'
    if (campos.precio_usd !== '' && isNaN(Number(campos.precio_usd)))
      errs.precio_usd = 'Precio inválido'
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
      if (esEdicion) {
        await actualizar.mutateAsync({ id: producto.id, campos })
      } else {
        await crear.mutateAsync(campos)
      }
      onSuccess?.()
    } catch (err) {
      setErrorGeneral(err.message ?? 'Ocurrió un error. Intenta de nuevo.')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

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
          <input type="text" name="categoria" value={campos.categoria}
            onChange={cambiar} placeholder="Ej: Cemento"
            className={inputClass} disabled={cargando} />
        </Campo>
        <Campo label="Unidad" icono={Layers} error={errores.unidad}>
          <CustomSelect
            options={['und', 'kg', 'g', 'lt', 'ml', 'm', 'cm', 'm2', 'm3', 'caja', 'rollo', 'par', 'bolsa'].map(u => ({ value: u, label: u }))}
            value={campos.unidad}
            onChange={val => setCampos(p => ({ ...p, unidad: val }))}
            icon={Layers}
            disabled={cargando}
            searchable={false}
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

      {/* Precio venta + Costo (fila) */}
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Precio venta (USD)" icono={DollarSign} error={errores.precio_usd}>
          <input type="number" name="precio_usd" value={campos.precio_usd}
            onChange={cambiar} placeholder="0.00" step="0.01" min="0"
            className={inputClass} disabled={cargando} />
        </Campo>
        <Campo label="Costo (USD)" icono={DollarSign} error={errores.costo_usd}>
          <input type="number" name="costo_usd" value={campos.costo_usd}
            onChange={cambiar} placeholder="0.00" step="0.01" min="0"
            className={inputClass} disabled={cargando} />
        </Campo>
      </div>

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
        <button type="submit" disabled={cargando}
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
