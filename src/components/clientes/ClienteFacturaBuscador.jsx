// src/components/clientes/ClienteFacturaBuscador.jsx
// Buscador inteligente de clientes con creación inline para facturación alterna
import { useState, useRef, useEffect } from 'react'
import { User, Search, X, Plus, ChevronDown, CheckCircle, Building2, UserCircle2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import ClienteForm from './ClienteForm'
import { buscarClientes } from '../../utils/clienteSearch'

const TIPO_COLORS = {
  natural:  'bg-slate-100 text-slate-600',
  juridico: 'bg-violet-100 text-violet-700',
}
const TIPO_ICONS = {
  natural:  UserCircle2,
  juridico: Building2,
}

export default function ClienteFacturaBuscador({ clientes = [], clienteId, onSelect }) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [showCrear, setShowCrear] = useState(false)
  const ref = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    if (abierto) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [abierto])

  useEffect(() => {
    if (abierto) setTimeout(() => inputRef.current?.focus(), 50)
  }, [abierto])

  const seleccionado = clientes.find(c => c.id === clienteId)
  const resultados = busqueda.trim().length >= 1
    ? buscarClientes(clientes, busqueda).slice(0, 8)
    : clientes.slice(0, 8)

  function elegir(c) {
    onSelect(c.id)
    setAbierto(false)
    setBusqueda('')
  }

  function limpiar(e) {
    e.stopPropagation()
    onSelect('')
    setBusqueda('')
  }

  function handleClienteCreado(nuevoCliente) {
    setShowCrear(false)
    if (nuevoCliente?.id) onSelect(nuevoCliente.id)
    setAbierto(false)
  }

  const TipoIconoSel = TIPO_ICONS[seleccionado?.tipo_cliente] || User

  return (
    <>
      <div ref={ref} className="relative">
        {/* Trigger */}
        <button
          type="button"
          onClick={() => setAbierto(v => !v)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
            abierto
              ? 'border-violet-400 ring-2 ring-violet-100 bg-white'
              : seleccionado
                ? 'border-violet-300 bg-violet-50/40 hover:border-violet-400'
                : 'border-slate-200 bg-slate-50 hover:border-slate-300'
          }`}
        >
          {seleccionado ? (
            <>
              <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                <TipoIconoSel size={16} className="text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 text-sm truncate">{seleccionado.nombre}</p>
                <p className="text-xs text-slate-500 truncate">
                  {[seleccionado.rif_cedula, seleccionado.telefono].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                </p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${TIPO_COLORS[seleccionado.tipo_cliente] ?? TIPO_COLORS.natural}`}>
                {seleccionado.tipo_cliente === 'juridico' ? 'Jurídico' : 'Natural'}
              </span>
              <button type="button" onClick={limpiar}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors shrink-0">
                <X size={14} />
              </button>
            </>
          ) : (
            <>
              <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                <User size={16} className="text-slate-400" />
              </div>
              <span className="flex-1 text-sm text-slate-400">Buscar cliente para facturar...</span>
              <ChevronDown size={16} className={`text-slate-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
            </>
          )}
        </button>

        {/* Dropdown */}
        {abierto && (
          <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
            {/* Buscador */}
            <div className="p-2 border-b border-slate-100">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  placeholder="Nombre, RIF, teléfono, ciudad..."
                  className="w-full pl-8 pr-3 py-2 text-sm border border-slate-100 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-violet-300 focus:border-violet-400 placeholder:text-slate-400"
                />
                {busqueda && (
                  <button type="button" onClick={() => setBusqueda('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Lista */}
            <div className="max-h-56 overflow-y-auto">
              {resultados.length === 0 ? (
                <div className="py-4 px-4 text-center">
                  <p className="text-sm text-slate-400 mb-2">
                    {busqueda ? `Sin resultados para "${busqueda}"` : 'No hay clientes'}
                  </p>
                  <button
                    type="button"
                    onClick={() => { setShowCrear(true); setAbierto(false) }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg border border-violet-200 transition-colors">
                    <Plus size={12} /> Crear cliente nuevo
                  </button>
                </div>
              ) : (
                <>
                  {resultados.map(c => {
                    const TipoIcn = TIPO_ICONS[c.tipo_cliente] || User
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => elegir(c)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 ${
                          c.id === clienteId ? 'bg-violet-50' : ''
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <TipoIcn size={14} className="text-slate-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-800 text-sm truncate">{c.nombre}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {[c.rif_cedula, c.telefono, c.ciudad].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                          </p>
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${TIPO_COLORS[c.tipo_cliente] ?? TIPO_COLORS.natural}`}>
                          {c.tipo_cliente === 'juridico' ? 'J' : 'N'}
                        </span>
                        {c.id === clienteId && <CheckCircle size={14} className="text-violet-500 shrink-0" />}
                      </button>
                    )
                  })}
                  {/* Botón crear siempre visible al fondo */}
                  <div className="border-t border-slate-100 p-2">
                    <button
                      type="button"
                      onClick={() => { setShowCrear(true); setAbierto(false) }}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg border border-violet-200 transition-colors">
                      <Plus size={12} /> Crear cliente nuevo
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal crear cliente */}
      {showCrear && (
        <Modal isOpen title="Nuevo cliente" onClose={() => setShowCrear(false)}>
          <ClienteForm
            compact
            onSuccess={handleClienteCreado}
            onCancel={() => setShowCrear(false)}
          />
        </Modal>
      )}
    </>
  )
}
