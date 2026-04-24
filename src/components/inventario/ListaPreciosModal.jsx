// src/components/inventario/ListaPreciosModal.jsx
// Modal para configurar y generar PDF "Lista de Precios" para clientes
import { useState } from 'react'
import { FileText, Loader2, DollarSign, Check, X, PackageCheck } from 'lucide-react'

export default function ListaPreciosModal({
  isOpen,
  onClose,
  productos = [],
  categorias = [],
  tasa = 0,
  config = {},
}) {
  const [moneda, setMoneda] = useState('$')
  const [soloConStock, setSoloConStock] = useState(true)
  const [modoCats, setModoCats] = useState('todas') // 'todas' | 'seleccionar'
  const [catsSeleccionadas, setCatsSeleccionadas] = useState(new Set())
  const [columnas, setColumnas] = useState({
    codigo: true,
    categoria: false,
    unidad: true,
    stock: false,
    precio2: false,
    precio3: false,
  })
  const [generando, setGenerando] = useState(false)

  if (!isOpen) return null

  const toggleCat = (cat) => {
    setCatsSeleccionadas(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  const toggleCol = (key) => {
    setColumnas(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const productosFiltrados = (() => {
    let lista = modoCats === 'todas'
      ? productos
      : productos.filter(p => catsSeleccionadas.has(p.categoria || 'Sin categoría'))
    if (soloConStock) lista = lista.filter(p => Number(p.stock_actual) > 0)
    return lista
  })()

  const handleGenerar = async () => {
    setGenerando(true)
    try {
      const { generarListaPreciosPDF } = await import('../../services/pdf/listaPreciosPDF')
      await generarListaPreciosPDF({
        productos: productosFiltrados,
        config,
        opciones: { moneda, tasa, columnas },
      })
      onClose()
    } catch (e) {
      console.error('Error generando PDF:', e)
    } finally {
      setGenerando(false)
    }
  }

  const tieneP2 = productos.some(p => p.precio_2 != null)
  const tieneP3 = productos.some(p => p.precio_3 != null)

  const MONEDAS = [
    { value: '$', label: 'USDT ($)', icon: '$' },
    { value: 'bcv', label: 'Dólar BCV', icon: '$' },
    { value: 'bs', label: 'Bolívares', icon: 'Bs' },
    { value: 'mixto', label: 'Mixto USDT', icon: '$/Bs' },
    { value: 'mixto_bcv', label: 'Mixto BCV', icon: '$/Bs' },
  ]

  const COLUMNAS_OPT = [
    { key: 'codigo', label: 'Código' },
    { key: 'unidad', label: 'Unidad' },
    { key: 'stock', label: 'Stock disponible' },
    ...(tieneP2 ? [{ key: 'precio2', label: 'Precio Mayor' }] : []),
    ...(tieneP3 ? [{ key: 'precio3', label: 'Precio 3' }] : []),
  ]

  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative bg-white w-full sm:max-w-lg sm:rounded-[1.5rem] rounded-t-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 max-h-[90dvh] flex flex-col"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="relative h-20 sm:h-24 flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, #93c5fd 0%, #3a63a8 100%)' }}>
          <div className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
              backgroundSize: '12px 12px',
            }} />
          <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.25)',
              border: '1.5px solid rgba(255,255,255,0.5)',
              backdropFilter: 'blur(4px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            }}>
            <FileText size={24} color="white" />
          </div>
          <button onClick={onClose} disabled={generando}
            className="absolute top-3 right-3 p-1.5 rounded-full transition-colors disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)', color: 'white' }}>
            <X size={14} />
          </button>
        </div>

        {/* ── Content ── */}
        <div className="p-5 sm:p-6 flex-1 overflow-y-auto space-y-5 min-h-0">
          <div className="text-center">
            <h3 className="text-lg font-black text-slate-800">Lista de Precios</h3>
            <p className="text-sm text-slate-500 mt-1">Configura el PDF para enviar a tus clientes</p>
          </div>

          {/* ── 1. Categorías ── */}
          <div className="space-y-2.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Productos</label>
            <div className="flex gap-2">
              {['todas', 'seleccionar'].map(m => (
                <button key={m} type="button" onClick={() => setModoCats(m)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    modoCats === m
                      ? 'bg-blue-50 border-2 border-blue-400 text-blue-700'
                      : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}>
                  {m === 'todas' ? `Todos (${productos.length})` : 'Por categoría'}
                </button>
              ))}
            </div>

            {modoCats === 'seleccionar' && (
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pt-1">
                {categorias.map(cat => {
                  const sel = catsSeleccionadas.has(cat)
                  const count = productos.filter(p => (p.categoria || 'Sin categoría') === cat).length
                  return (
                    <button key={cat} type="button" onClick={() => toggleCat(cat)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1 ${
                        sel
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}>
                      {sel && <Check size={12} />}
                      {cat} ({count})
                    </button>
                  )
                })}
              </div>
            )}

            {modoCats === 'seleccionar' && catsSeleccionadas.size > 0 && (
              <p className="text-xs text-blue-600 font-medium ml-1">
                {productosFiltrados.length} productos seleccionados
              </p>
            )}
          </div>

          {/* ── 1b. Filtro stock ── */}
          <button type="button" onClick={() => setSoloConStock(!soloConStock)}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all active:scale-[0.98] ${
              soloConStock
                ? 'bg-emerald-50 border-2 border-emerald-400'
                : 'bg-white border border-slate-200 hover:border-slate-300'
            }`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              soloConStock ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'
            }`}>
              <PackageCheck size={15} />
            </div>
            <div className="flex-1">
              <span className={`text-sm font-semibold ${soloConStock ? 'text-emerald-700' : 'text-slate-600'}`}>
                Solo productos con stock
              </span>
              <p className="text-[11px] text-slate-400">Excluir productos sin existencia</p>
            </div>
            {soloConStock && (
              <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                <Check size={12} color="white" />
              </div>
            )}
          </button>

          <p className="text-xs text-blue-600 font-medium ml-1">
            {productosFiltrados.length} productos a incluir
          </p>

          {/* ── 2. Moneda ── */}
          <div className="space-y-2.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Moneda</label>
            <div className="space-y-1.5">
              {MONEDAS.map(m => (
                <button key={m.value} type="button" onClick={() => setMoneda(m.value)}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all active:scale-[0.98] ${
                    moneda === m.value
                      ? 'bg-blue-50 border-2 border-blue-400'
                      : 'bg-white border border-slate-200 hover:border-slate-300'
                  }`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black ${
                    moneda === m.value ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {m.icon}
                  </div>
                  <span className={`text-sm font-semibold ${moneda === m.value ? 'text-blue-700' : 'text-slate-600'}`}>
                    {m.label}
                  </span>
                  {moneda === m.value && (
                    <div className="ml-auto w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                      <Check size={12} color="white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
            {['bs', 'mixto', 'mixto_bcv', 'bcv'].includes(moneda) && tasa > 0 && (
              <p className="text-xs text-slate-400 ml-1">Tasa vigente: Bs {tasa.toFixed(2)}</p>
            )}
            {['bs', 'mixto', 'mixto_bcv', 'bcv'].includes(moneda) && tasa <= 0 && (
              <p className="text-xs text-amber-600 font-medium ml-1">No hay tasa disponible — se mostrará en USD</p>
            )}
          </div>

          {/* ── 3. Columnas opcionales ── */}
          <div className="space-y-2.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Columnas adicionales</label>
            <div className="flex flex-wrap gap-2">
              {COLUMNAS_OPT.map(c => (
                <button key={c.key} type="button" onClick={() => toggleCol(c.key)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    columnas[c.key]
                      ? 'bg-blue-50 border-2 border-blue-400 text-blue-700'
                      : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}>
                  {columnas[c.key] && <Check size={12} />}
                  {c.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 ml-1">Nombre y precio siempre incluidos</p>
          </div>
        </div>

        {/* ── Botones ── */}
        <div className="px-5 pb-5 sm:px-6 sm:pb-6 pt-2 flex gap-3 shrink-0">
          <button
            onClick={onClose}
            disabled={generando}
            className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors border border-slate-100 disabled:opacity-50 min-h-[48px]"
          >
            Cancelar
          </button>
          <button
            onClick={handleGenerar}
            disabled={generando || (modoCats === 'seleccionar' && catsSeleccionadas.size === 0)}
            className="flex-1 py-3 text-sm font-bold text-white rounded-xl active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]"
            style={{ background: 'linear-gradient(135deg, #3a63a8, #1B365D)', boxShadow: '0 4px 12px rgba(58,99,168,0.3)' }}
          >
            {generando ? (
              <><Loader2 size={16} className="animate-spin" /> Generando...</>
            ) : (
              <><FileText size={16} /> Generar PDF</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
