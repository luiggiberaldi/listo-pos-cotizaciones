import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Modal } from '../ui/Modal'
import CustomSelect from '../ui/CustomSelect'
import { showToast } from '../ui/Toast'
import { authFetch } from '../../services/authFetch'
import { validarValorMasivo, precioNuevoMasivo } from '../../utils/precioMasivo'
import { CheckCircle2, AlertCircle, Search } from 'lucide-react'

const CAMPOS_PRECIO = [['precio_usd', 'Precio 1'], ['precio_2', 'Precio 2'], ['precio_3', 'Precio 3']]
const MAX_FILAS = 150
const ESPERA_VISTA_PREVIA_MS = 500

const fmt = n => `$${Number(n).toFixed(2)}`

export default function ModalBatchPrice({ isOpen, onClose, cuentaId, categorias = [], productos = [], onSuccess }) {
  const [modo, setModo] = useState('porcentaje')
  const [porcentaje, setPorcentaje] = useState('')
  const [valorFijo, setValorFijo] = useState('')
  const [categoria, setCategoria] = useState('')
  const [precioObjetivo, setPrecioObjetivo] = useState('precio_usd')
  const [seleccion, setSeleccion] = useState('todos') // 'todos' | 'elegir'
  const [ids, setIds] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [preview, setPreview] = useState(null) // { key, data }
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [errorPreview, setErrorPreview] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const seq = useRef(0)

  // Resetear estado al cerrar
  useEffect(() => {
    if (!isOpen) {
      setModo('porcentaje')
      setPorcentaje('')
      setValorFijo('')
      setCategoria('')
      setPrecioObjetivo('precio_usd')
      setSeleccion('todos')
      setIds([])
      setBusqueda('')
      setPreview(null)
      setCargandoPreview(false)
      setErrorPreview(null)
      setGuardando(false)
      seq.current++
    }
  }, [isOpen])

  const valorTexto = modo === 'porcentaje' ? porcentaje : valorFijo
  const errorValor = validarValorMasivo(modo, valorTexto)
  const hayValor = valorTexto !== '' && !errorValor
  const listo = hayValor && (seleccion === 'todos' || ids.length > 0)

  // Todo lo que cambia el resultado. Si cambia, la vista previa anterior ya no sirve.
  const claveParams = useMemo(
    () => JSON.stringify([modo, valorTexto, categoria, precioObjetivo, seleccion, seleccion === 'elegir' ? [...ids].sort() : null]),
    [modo, valorTexto, categoria, precioObjetivo, seleccion, ids]
  )

  const cuerpo = previewOnly => JSON.stringify({
    cuenta_id: cuentaId,
    modo,
    porcentaje: modo === 'porcentaje' ? Number(porcentaje) : 0,
    valor_fijo: modo === 'valor_fijo' ? Number(valorFijo) : 0,
    categoria: categoria || null,
    precio_objetivo: precioObjetivo,
    preview_only: previewOnly,
    producto_ids: seleccion === 'elegir' ? ids : undefined
  })

  // Vista previa automática: el servidor calcula el resumen oficial medio segundo
  // después de que el usuario deja de cambiar algo.
  useEffect(() => {
    if (!isOpen) return undefined
    const miSeq = ++seq.current
    if (!listo) {
      setPreview(null)
      setErrorPreview(null)
      setCargandoPreview(false)
      return undefined
    }
    setCargandoPreview(true)
    setErrorPreview(null)
    const timer = setTimeout(async () => {
      try {
        const res = await authFetch('/api/productos/batch-price', { method: 'PATCH', body: cuerpo(true) })
        const data = await res.json().catch(() => ({}))
        if (miSeq !== seq.current) return
        if (!res.ok) throw new Error(data.error || 'Error al obtener vista previa')
        setPreview({ key: claveParams, data })
      } catch (error) {
        if (miSeq !== seq.current) return
        setPreview(null)
        setErrorPreview(error.message)
      } finally {
        if (miSeq === seq.current) setCargandoPreview(false)
      }
    }, ESPERA_VISTA_PREVIA_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, listo, claveParams])

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

  const alternar = id => setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const seleccionarVisibles = () => setIds(prev => [...new Set([...prev, ...candidatos.map(p => p.id)])])
  const cambiarCategoria = nueva => {
    setCategoria(nueva)
    // Se descartan los productos elegidos que ya no pertenecen a la categoría
    if (nueva) setIds(prev => prev.filter(id => productos.find(p => p.id === id)?.categoria === nueva))
  }

  if (!isOpen) return null

  const previewVigente = preview && preview.key === claveParams ? preview.data : null
  const puedeConfirmar = !!previewVigente && previewVigente.count > 0 && !cargandoPreview && !guardando

  const handleConfirm = async () => {
    if (!puedeConfirmar) return
    setGuardando(true)
    try {
      const res = await authFetch('/api/productos/batch-price', { method: 'PATCH', body: cuerpo(false) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al actualizar precios')
      }
      const data = await res.json()
      showToast(`${data.updated} producto${data.updated !== 1 ? 's' : ''} actualizado${data.updated !== 1 ? 's' : ''} con éxito`, 'success')
      if (onSuccess) onSuccess()
      onClose()
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      setGuardando(false)
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

  const etiquetaSeccion = 'text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Actualización Masiva" className="max-w-md md:max-w-4xl">
      <div className="grid gap-5 md:grid-cols-2 md:gap-x-8">

        {/* A · Ajustes */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className={etiquetaSeccion}>Modo de ajuste</label>
            <CustomSelect options={modoOptions} value={modo} onChange={setModo} placeholder="Seleccionar modo" />
          </div>

          <div className="space-y-1.5">
            <label className={etiquetaSeccion}>
              {modo === 'porcentaje' ? 'Porcentaje (%)' : 'Precio fijo (USD)'}
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                value={valorTexto}
                onChange={e => modo === 'porcentaje' ? setPorcentaje(e.target.value) : setValorFijo(e.target.value)}
                placeholder={modo === 'porcentaje' ? 'Ej: 10 o -5' : 'Ej: 25.50'}
                aria-invalid={!!errorValor}
                className={`w-full px-4 py-2.5 rounded-xl border bg-slate-50 text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${errorValor ? 'border-red-300 focus:border-red-400' : 'border-slate-200 focus:border-primary'}`}
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                {modo === 'porcentaje' ? '%' : '$'}
              </div>
            </div>
            {errorValor && <p className="text-[11px] text-red-600 ml-1">{errorValor}</p>}
          </div>

          <div className="space-y-1.5">
            <label className={etiquetaSeccion}>Precio a modificar</label>
            <CustomSelect options={objetivoOptions} value={precioObjetivo} onChange={setPrecioObjetivo} />
          </div>

          <div className="space-y-1.5">
            <label className={etiquetaSeccion}>Filtrar por categoría</label>
            <CustomSelect options={catOptions} value={categoria} onChange={cambiarCategoria} searchable={true} />
          </div>
        </div>

        {/* B · Productos a modificar (a la derecha en pantallas anchas) */}
        <div className="space-y-1.5 md:col-start-2 md:row-start-1 md:row-span-2">
          <label className={etiquetaSeccion}>Productos a modificar</label>
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
                <span className="text-slate-600">{`${ids.length} seleccionado${ids.length !== 1 ? 's' : ''}`}</span>
                <div className="flex gap-3">
                  <button type="button" onClick={seleccionarVisibles} disabled={candidatos.length === 0} className="text-amber-700 hover:underline disabled:opacity-40">
                    {`Seleccionar los ${candidatos.length} que se ven`}
                  </button>
                  <button type="button" onClick={() => setIds([])} disabled={ids.length === 0} className="text-slate-500 hover:underline disabled:opacity-40">
                    Quitar todos
                  </button>
                </div>
              </div>
              <ul className="max-h-56 md:max-h-[26rem] overflow-y-auto divide-y divide-slate-100">
                {candidatos.slice(0, MAX_FILAS).map(p => {
                  const marcado = idsSet.has(p.id)
                  const actual = p[campoPrecio]
                  // Precio nuevo en vivo, solo para los productos elegidos
                  const nuevo = marcado ? precioNuevoMasivo(modo, valorTexto, actual) : null
                  const cambia = nuevo !== null && nuevo !== Math.round(Number(actual) * 100) / 100
                  return (
                    <li key={p.id}>
                      <label className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer text-sm ${marcado ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}>
                        <input type="checkbox" checked={marcado} onChange={() => alternar(p.id)} className="w-4 h-4 mt-0.5 accent-amber-600 shrink-0" />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-slate-700 leading-snug break-words">{p.nombre}</span>
                          {p.codigo && <span className="block text-[10px] text-slate-400">{p.codigo}</span>}
                        </span>
                        <span className="font-mono text-xs font-bold shrink-0 flex items-center gap-1.5 whitespace-nowrap pt-0.5">
                          {actual === null || actual === undefined ? (
                            <span className="text-slate-400">—</span>
                          ) : cambia ? (
                            <>
                              <span className="text-slate-400 line-through decoration-slate-300">{fmt(actual)}</span>
                              <span className="text-slate-400 font-sans">→</span>
                              <span className="text-emerald-700">{fmt(nuevo)}</span>
                            </>
                          ) : (
                            <span className="text-slate-500">{fmt(actual)}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  )
                })}
                {candidatos.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-400">No hay productos con ese filtro</li>}
              </ul>
              {candidatos.length > MAX_FILAS && (
                <div className="px-3 py-2 bg-slate-50 text-[11px] text-slate-500">{`Se muestran ${MAX_FILAS} de ${candidatos.length}. Escribe en el buscador para acotar.`}</div>
              )}
            </div>
          )}
        </div>

        {/* C · Resumen en vivo y confirmar */}
        <div className="space-y-4 md:col-start-1">
          <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 space-y-3 min-h-[5.5rem]" aria-live="polite">
            {!listo && !errorValor && (
              <p className="text-sm text-slate-500">
                {!hayValor
                  ? `Escribe ${modo === 'porcentaje' ? 'un porcentaje' : 'un precio fijo'} para ver cómo quedarán los precios.`
                  : 'Elige al menos un producto para ver cómo quedarán los precios.'}
              </p>
            )}
            {!listo && errorValor && <p className="text-sm text-slate-500">Corrige el valor para ver el resultado.</p>}

            {listo && errorPreview && (
              <div className="flex items-start gap-2 text-sm text-red-600">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                {errorPreview}
              </div>
            )}

            {listo && !errorPreview && !previewVigente && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                Calculando…
              </div>
            )}

            {listo && previewVigente && (
              <>
                <div className={`flex items-center gap-2 text-primary font-bold text-sm transition-opacity ${cargandoPreview ? 'opacity-50' : ''}`}>
                  <CheckCircle2 size={16} />
                  {previewVigente.count === 0
                    ? 'Ningún precio cambiaría con estos valores'
                    : `Se cambiará el precio de ${previewVigente.count} producto${previewVigente.count !== 1 ? 's' : ''}`}
                </div>
                {previewVigente.sin_precio > 0 && (
                  <div className="flex items-start gap-2 text-[11px] text-slate-500">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    {`${previewVigente.sin_precio} producto${previewVigente.sin_precio !== 1 ? 's no tienen' : ' no tiene'} ese precio definido y no se tocará.`}
                  </div>
                )}
                {previewVigente.en_cero > 0 && (
                  <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    {`${previewVigente.en_cero} producto${previewVigente.en_cero !== 1 ? 's tienen' : ' tiene'} precio $0 y un porcentaje no lo cambia. Para ponerles precio usa "Valor fijo".`}
                  </div>
                )}
                {seleccion === 'todos' && previewVigente.ejemplos?.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ejemplos:</div>
                    {previewVigente.ejemplos.map((ej, i) => (
                      <div key={i} className="flex flex-col text-xs">
                        <span className="text-slate-600 font-medium break-words">{ej.nombre}</span>
                        {CAMPOS_PRECIO.filter(([f]) => ej[f]).map(([f, etiqueta]) => (
                          <div key={f} className="flex items-center gap-2 font-mono font-bold">
                            <span className="w-14 font-sans font-semibold text-slate-400">{etiqueta}</span>
                            <span className="text-slate-400">{fmt(ej[f].actual)}</span>
                            <span className="text-primary">→</span>
                            <span className="text-primary-focus">{fmt(ej[f].nuevo)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {previewVigente && previewVigente.count > 0 && (
            <p className="text-[11px] text-slate-500 leading-snug">
              Este cambio se aplica de una sola vez y no se puede deshacer desde aquí. Revisa el resultado antes de confirmar.
            </p>
          )}

          <button
            onClick={handleConfirm}
            disabled={!puedeConfirmar}
            className="w-full flex items-center justify-center gap-2 py-3.5 text-white font-black rounded-2xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-30 disabled:grayscale"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
          >
            {guardando ? <div className="w-5 h-5 border-2 border-white/70 border-t-transparent rounded-full animate-spin" /> : null}
            Confirmar actualización
          </button>
        </div>

        {/* Espaciador para evitar que los dropdowns se corten al final del modal */}
        <div className="h-20 md:col-span-2 md:h-12" />

      </div>
    </Modal>
  )
}
