// src/components/clientes/ClienteFacturaBuscador.jsx
// Campo inline compacto: busca cliente alterno para facturación
// Fusiona toggle + buscador + selector en un solo componente
// Botón [+] crear cliente al lado del campo (como transportista)
import { useState, useRef, useEffect } from 'react'
import { Search, X, Plus, Building2, UserCircle2, Receipt } from 'lucide-react'
import { Modal } from '../ui/Modal'
import ClienteForm from './ClienteForm'
import { buscarClientes } from '../../utils/clienteSearch'

const TIPO_BADGE = {
  natural:  { cls: 'bg-slate-100 text-slate-600', label: 'N' },
  juridico: { cls: 'bg-violet-100 text-violet-700', label: 'J' },
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
    ? buscarClientes(clientes, busqueda).slice(0, 6)
    : clientes.slice(0, 6)

  function elegir(c) {
    onSelect(c.id)
    setAbierto(false)
    setBusqueda('')
  }

  function limpiar(e) {
    e.stopPropagation()
    onSelect('')
    setBusqueda('')
    setAbierto(false)
  }

  function handleClienteCreado(nuevoCliente) {
    setShowCrear(false)
    if (nuevoCliente?.id) onSelect(nuevoCliente.id)
    setAbierto(false)
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <div ref={ref} className="relative flex-1 min-w-0">
          {/* ── Campo inline ── */}
          {seleccionado ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-violet-300 bg-violet-50 text-left">
              <Receipt size={12} className="text-violet-500 shrink-0" />
              <span className="flex-1 min-w-0 text-xs font-semibold text-violet-800 truncate">
                {seleccionado.nombre}
                {seleccionado.rif_cedula && <span className="font-normal text-violet-500 ml-1">· {seleccionado.rif_cedula}</span>}
              </span>
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${TIPO_BADGE[seleccionado.tipo_cliente]?.cls ?? TIPO_BADGE.natural.cls}`}>
                {TIPO_BADGE[seleccionado.tipo_cliente]?.label ?? 'N'}
              </span>
              <button type="button" onClick={limpiar}
                className="p-0.5 rounded hover:bg-violet-200 text-violet-400 hover:text-violet-700 transition-colors shrink-0">
                <X size={12} />
              </button>
            </div>
          ) : abierto ? (
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-violet-400 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Nombre, RIF, teléfono..."
                className="w-full pl-7 pr-7 py-1.5 text-xs border border-violet-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-200 placeholder:text-slate-400"
              />
              <button type="button" onClick={() => { setAbierto(false); setBusqueda('') }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={11} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-dashed border-slate-200 text-xs text-slate-400 hover:border-violet-300 hover:text-violet-500 transition-colors"
            >
              <Receipt size={12} />
              <span>Facturar a otro cliente</span>
              <span className="ml-auto text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full font-semibold">Opcional</span>
            </button>
          )}

          {/* ── Dropdown de resultados ── */}
          {abierto && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white rounded-lg border border-slate-200 shadow-lg overflow-hidden">
              <div className="max-h-48 overflow-y-auto">
                {resultados.length === 0 ? (
                  <div className="py-3 px-3 text-center">
                    <p className="text-xs text-slate-400">
                      {busqueda ? `Sin resultados para "${busqueda}"` : 'No hay clientes'}
                    </p>
                  </div>
                ) : (
                  resultados.map(c => {
                    const TipoIcn = c.tipo_cliente === 'juridico' ? Building2 : UserCircle2
                    return (
                      <button key={c.id} type="button" onClick={() => elegir(c)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50 ${
                          c.id === clienteId ? 'bg-violet-50' : ''
                        }`}>
                        <TipoIcn size={13} className="text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-700 text-xs truncate">{c.nombre}</p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {[c.rif_cedula, c.telefono].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${TIPO_BADGE[c.tipo_cliente]?.cls ?? TIPO_BADGE.natural.cls}`}>
                          {TIPO_BADGE[c.tipo_cliente]?.label ?? 'N'}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Botón [+] crear cliente — al lado del campo ── */}
        <button type="button" onClick={() => setShowCrear(true)}
          className="shrink-0 w-8 h-8 rounded-lg bg-violet-50 hover:bg-violet-100 border border-violet-200 flex items-center justify-center transition-colors active:scale-95"
          title="Crear cliente nuevo">
          <Plus size={13} className="text-violet-600" />
        </button>
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
