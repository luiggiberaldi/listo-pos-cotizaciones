import React, { useState, useEffect, useMemo } from 'react'
import { Modal } from '../ui/Modal'
import CustomSelect from '../ui/CustomSelect'
import { showToast } from '../ui/Toast'
import { authFetch } from '../../services/authFetch'
import { Calculator, Eye, CheckCircle2, XCircle, AlertCircle, Search } from 'lucide-react'

const CAMPOS_PRECIO = [['precio_usd', 'Precio 1'], ['precio_2', 'Precio 2'], ['precio_3', 'Precio 3']]

const MAX_FILAS = 150

export default function ModalBatchPrice({ isOpen, onClose, cuentaId, categorias = [], productos = [], onSuccess }) {
  const [modo, setModo] = useState('porcentaje')
  const [porcentaje, setPorcentaje] = useState('')
  const [valorFijo, setValorFijo] = useState('')
  const [categoria, setCategoria] = useState('')
  const [precioObjetivo, setPrecioObjetivo] = useState('precio_usd')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [seleccion, setSeleccion] = useState('todos') // 'todos' | 'elegir'
  const [ids, setIds] = useState([])
  const [busqueda, setBusqueda] = useState('')

  // Resetear estado al cerrar
  useEffect(() => {
    if (!isOpen) {
      setModo('porcentaje')
      setPorcentaje('')
      setValorFijo('')
      setCategoria('')
      setPrecioObjetivo('precio_usd')
      setPreview(null)
      setLoading(false)
      setSeleccion('todos')
      setIds([])
      setBusqueda('')
    }
  }, [isOpen])

  // Resetear preview al cambiar cualquier input
  useEffect(() => {
    setPreview(null)
  }, [modo, porcentaje, valorFijo, categoria, precioObjetivo, seleccion, ids])

  // Productos que se pueden elegir: activos, de la categoría filtrada y que coincidan con la búsqueda
  const campoPrecio = precioObjetivo === 'todos' ? 'precio_usd' : precioObjetivo
  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return productos
      .filter(p => p.activo !== false && (!categoria || p.categoria === categoria))
      .filter(p => !q || (p.nombre || '').toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'))
  }, [productos, categoria, busqueda])
  const idsSet = useMemo(() => new Set(ids), [ids])

  const alternar = (id) => setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const seleccionarVisibles = () => setIds(prev => [...new Set([...prev, ...candidatos.map(p => p.id)])])
  const cambiarCategoria = (nueva) => {
    setCategoria(nueva)
    // Se descartan los productos elegidos que ya no pertenecen a la categoría
    if (nueva) setIds(prev => prev.filter(id => productos.find(p => p.id === id)?.categoria === nueva))
  }

  if (!isOpen) return null

  const handlePreview = async () => {
    const valor = modo === 'porcentaje' ? porcentaje : valorFijo
    if (!valor) {
      showToast('Ingresa un valor para continuar', 'warning')
      return
    }
    if (seleccion === 'elegir' && ids.length === 0) {
      showToast('Elige al menos un producto', 'warning')
      return
    }

    setLoading(true)
    try {
      const res = await authFetch('/api/productos/batch-price', {
        method: 'PATCH',
        body: JSON.stringify({
          cuenta_id: cuentaId,
          modo,
          porcentaje: modo === 'porcentaje' ? Number(porcentaje) : 0,
          valor_fijo: modo === 'valor_fijo' ? Number(valorFijo) : 0,
          categoria: categoria || null,
          precio_objetivo: precioObjetivo,
          preview_only: true,
          producto_ids: seleccion === 'elegir' ? ids : undefined
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al obtener vista previa')
      }

      const data = await res.json()
      setPreview(data)
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (!preview) return
    setLoading(true)
    try {
      const res = await authFetch('/api/productos/batch-price', {
        method: 'PATCH',
        body: JSON.stringify({
          cuenta_id: cuentaId,
          modo,
          porcentaje: modo === 'porcentaje' ? Number(porcentaje) : 0,
          valor_fijo: modo === 'valor_fijo' ? Number(valorFijo) : 0,
          categoria: categoria || null,
          precio_objetivo: precioObjetivo,
          preview_only: false,
          producto_ids: seleccion === 'elegir' ? ids : undefined
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al actualizar precios')
      }

      const data = await res.json()
      showToast(`${data.updated} producto${data.updated !== 1 ? 's' : ''} actualizado${data.updated !== 1 ? 's' : ''} con éxito`, 'success')
      if (onSuccess) onSuccess()
      onClose()
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const catOptions = [
    { value: '', label: '— Todas las categorías —' },
    ...categorias.map(c => ({ value: c, label: c }))
  ]

  const modoOptions = [
    { value: 'porcentaje', label: 'Porcentaje (%)' },
    { value: 'valor_fijo', label: 'Valor fijo (USD)' }
  ]

  const objetivoOptions = [
    { value: 'precio_usd', label: 'Precio 1 (Detal)' },
    { value: 'precio_2', label: 'Precio 2' },
    { value: 'precio_3', label: 'Precio 3' },
    { value: 'todos', label: 'Todos los precios' }
  ]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Actualización Masiva" className="max-w-md">
      <div className="space-y-5">
        
        <div className="space-y-4">
          {/* Modo de ajuste */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">Modo de ajuste</label>
            <CustomSelect
              options={modoOptions}
              value={modo}
              onChange={setModo}
              placeholder="Seleccionar modo"
            />
          </div>

          {/* Valor */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">
              {modo === 'porcentaje' ? 'Porcentaje (%)' : 'Precio fijo (USD)'}
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                value={modo === 'porcentaje' ? porcentaje : valorFijo}
                onChange={e => modo === 'porcentaje' ? setPorcentaje(e.target.value) : setValorFijo(e.target.value)}
                placeholder={modo === 'porcentaje' ? "Ej: 10 o -5" : "Ej: 25.50"}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                {modo === 'porcentaje' ? '%' : '$'}
              </div>
            </div>
          </div>

          {/* Precio objetivo */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">Precio a modificar</label>
            <CustomSelect
              options={objetivoOptions}
              value={precioObjetivo}
              onChange={setPrecioObjetivo}
            />
          </div>

          {/* Categoría */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">Filtrar por categoría</label>
            <CustomSelect
              options={catOptions}
              value={categoria}
              onChange={cambiarCategoria}
              searchable={true}
            />
          </div>

          {/* Productos: todos o elegidos a mano */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">Productos a modificar</label>
            <div className="grid grid-cols-2 gap-2">
              {[['todos', categoria ? 'Toda la categoría' : 'Todos los productos'], ['elegir', 'Elegir productos']].map(([v, etiqueta]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSeleccion(v)}
                  className={`py-2.5 rounded-xl border text-sm font-bold transition-all ${seleccion === v ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                >
                  {etiqueta}
                </button>
              ))}
            </div>

            {seleccion === 'elegir' && (
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="relative border-b border-slate-100">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                    placeholder="Buscar por nombre o código"
                    className="w-full pl-10 pr-3 py-2.5 text-sm text-slate-700 focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 text-[11px] font-bold">
                  <span className="text-slate-600">{ids.length} seleccionado{ids.length !== 1 ? 's' : ''}</span>
                  <div className="flex gap-3">
                    <button type="button" onClick={seleccionarVisibles} disabled={candidatos.length === 0} className="text-amber-700 hover:underline disabled:opacity-40">
                      Seleccionar los {candidatos.length} que se ven
                    </button>
                    <button type="button" onClick={() => setIds([])} disabled={ids.length === 0} className="text-slate-500 hover:underline disabled:opacity-40">
                      Quitar todos
                    </button>
                  </div>
                </div>
                <ul className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                  {candidatos.slice(0, MAX_FILAS).map(p => {
                    const marcado = idsSet.has(p.id)
                    const precio = p[campoPrecio]
                    return (
                      <li key={p.id}>
                        <label className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm ${marcado ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}>
                          <input type="checkbox" checked={marcado} onChange={() => alternar(p.id)} className="w-4 h-4 accent-amber-600 shrink-0" />
                          <span className="flex-1 min-w-0">
                            <span className="block truncate font-medium text-slate-700">{p.nombre}</span>
                            {p.codigo && <span className="block text-[10px] text-slate-400">{p.codigo}</span>}
                          </span>
                          <span className="font-mono text-xs font-bold text-slate-500 shrink-0">
                            {precio === null || precio === undefined ? '—' : `$${Number(precio).toFixed(2)}`}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                  {candidatos.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-400">No hay productos con ese filtro</li>}
                </ul>
                {candidatos.length > MAX_FILAS && (
                  <div className="px-3 py-2 bg-slate-50 text-[11px] text-slate-500">Se muestran {MAX_FILAS} de {candidatos.length}. Escribe en el buscador para acotar.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Botón Preview */}
        <button
          onClick={handlePreview}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Eye size={18} />
          )}
          Vista previa
        </button>

        {/* Sección de Preview */}
        {preview && (
          <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <CheckCircle2 size={16} />
              {preview.count === 0
                ? 'Ningún precio cambiaría con estos valores'
                : `Se cambiará el precio de ${preview.count} producto${preview.count !== 1 ? 's' : ''}`}
            </div>
            {preview.sin_precio > 0 && (
              <div className="flex items-start gap-2 text-[11px] text-slate-500">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                {preview.sin_precio} producto{preview.sin_precio !== 1 ? 's' : ''} no tiene{preview.sin_precio !== 1 ? 'n' : ''} ese precio definido y no se tocará.
              </div>
            )}
            
            <div className="space-y-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ejemplos:</div>
              {preview.ejemplos.map((ej, i) => (
                <div key={i} className="flex flex-col text-xs">
                  <span className="text-slate-600 font-medium truncate">{ej.nombre}</span>
                  {CAMPOS_PRECIO.filter(([f]) => ej[f]).map(([f, etiqueta]) => (
                    <div key={f} className="flex items-center gap-2 font-mono font-bold">
                      <span className="w-14 font-sans font-semibold text-slate-400">{etiqueta}</span>
                      <span className="text-slate-400">${Number(ej[f].actual).toFixed(2)}</span>
                      <span className="text-primary">→</span>
                      <span className="text-primary-focus">${Number(ej[f].nuevo).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {preview && preview.count > 0 && (
          <p className="text-[11px] text-slate-500 leading-snug">
            Este cambio se aplica de una sola vez y no se puede deshacer desde aquí. Revisa los ejemplos antes de confirmar.
          </p>
        )}

        {/* Botón Confirmar */}
        <button
          onClick={handleConfirm}
          disabled={!preview || preview.count === 0 || loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 text-white font-black rounded-2xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-30 disabled:grayscale"
          style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
        >
          Confirmar actualización
        </button>

        {/* Espaciador para evitar que los dropdowns se corten al final del modal */}
        <div className="h-20" />

      </div>
    </Modal>
  )
}
