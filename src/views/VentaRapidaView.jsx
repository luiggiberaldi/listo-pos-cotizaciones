// src/views/VentaRapidaView.jsx
// Venta rápida — wizard de 3 pasos: cliente+productos, pago, confirmar
import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Zap, User, X, Plus, Minus, Package, ArrowLeft, ArrowRight, Loader2,
  Search, CheckCircle, ShoppingCart, DollarSign, Truck, CreditCard,
  AlertCircle, ChevronRight, UserPlus, ChevronUp, Hash, FileText,
} from 'lucide-react'
import { useClientes } from '../hooks/useClientes'
import ClienteForm from '../components/clientes/ClienteForm'
import { useInventario, useCategorias } from '../hooks/useInventario'
import { parseSearchTerms, smartMatchProducto } from '../utils/smartSearch'
import { useVentaRapida } from '../hooks/useVentaRapida'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { useTransportistas } from '../hooks/useTransportistas'
import useAuthStore from '../store/useAuthStore'
import { round2, mulR } from '../utils/dinero'
import { calcTotales } from '../utils/calcTotales'
import { fmtUsdSimple as fmtUsd, fmtBs } from '../utils/format'
import { guardarProductoReciente, getProductosRecientes } from '../components/cotizaciones/ProductosRecientes'
import { showToast } from '../components/ui/Toast'
import PageHeader from '../components/ui/PageHeader'

const FORMAS_PAGO = ['Efectivo', 'Zelle', 'Pago Móvil', 'USDT', 'Transferencia', 'Cta por cobrar']

export default function VentaRapidaView() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const { data: clientes = [] } = useClientes()
  const { data: inventarioData } = useInventario({ pageSize: 1000 })
  const productos = inventarioData?.productos ?? inventarioData ?? []
  const { data: categorias = [] } = useCategorias()
  const { data: config = {} } = useConfigNegocio()
  const { data: transportistas = [] } = useTransportistas()
  const tasaHook = useTasaCambio()
  const ventaRapida = useVentaRapida()

  // Wizard step: 0=productos, 1=pago, 2=confirmar
  const [step, setStep] = useState(0)

  // Step 1: Cliente + Productos
  const [clienteId, setClienteId] = useState('')
  const [clienteBusqueda, setClienteBusqueda] = useState('')
  const [clienteOpen, setClienteOpen] = useState(false)
  const [productoBusqueda, setProductoBusqueda] = useState('')
  const [catActiva, setCatActiva] = useState('')
  const [items, setItems] = useState([])
  const [showNuevoCliente, setShowNuevoCliente] = useState(false)
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  const [confirmAjeno, setConfirmAjeno] = useState(null)

  // Step 2: Pago + Envío
  const [formaPago, setFormaPago] = useState('')
  const [formaPagoCliente, setFormaPagoCliente] = useState('')
  const [referenciaPago, setReferenciaPago] = useState('')
  const [transportistaId, setTransportistaId] = useState('')
  const [fleteUsd, setFleteUsd] = useState('')
  const [notas, setNotas] = useState('')

  const clienteRef = useRef(null)
  const productoInputRef = useRef(null)

  const costoEnvioUsd = 0
  const { subtotal, ivaUsd, totalUsd } = calcTotales(items, 0, costoEnvioUsd, config.iva_pct ?? 0)
  const tasa = tasaHook.tasaEfectiva || 0
  const totalBs = tasa > 0 ? mulR(totalUsd, tasa) : 0
  const flete = Math.max(0, Number(fleteUsd) || 0)
  const totalConFlete = round2(totalUsd + flete)

  const idsAgregados = new Set(items.map(it => it.productoId))
  const clienteSeleccionado = clientes.find(c => c.id === clienteId)
  const totalItems = items.reduce((s, it) => s + it.cantidad, 0)
  const transportistaSeleccionado = transportistas.find(t => t.id === transportistaId)

  // Validaciones
  const step1Valid = !!clienteId && items.length > 0
  const step2Valid = !!formaPago

  // Close cliente dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (clienteRef.current && !clienteRef.current.contains(e.target)) setClienteOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Block scroll when mobile cart is open
  useEffect(() => {
    if (mobileCartOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [mobileCartOpen])

  // Filtrar clientes
  const clientesFiltrados = clienteBusqueda.trim()
    ? clientes.filter(c =>
        c.nombre.toLowerCase().includes(clienteBusqueda.toLowerCase()) ||
        (c.rif_cedula ?? '').toLowerCase().includes(clienteBusqueda.toLowerCase()) ||
        (c.telefono ?? '').includes(clienteBusqueda)
      ).slice(0, 8)
    : []

  // Filtrar productos
  const searchTerms = productoBusqueda.trim() ? parseSearchTerms(productoBusqueda) : null
  const productosFiltrados = useMemo(() => productos.filter(p => {
    if (!p.activo) return false
    const coincideTexto = !searchTerms || smartMatchProducto(p, searchTerms)
    const coincideCat = !catActiva || (p.categoria ?? '').toUpperCase().startsWith(catActiva.toUpperCase())
    return coincideTexto && coincideCat
  }), [productos, searchTerms, catActiva])

  const recientes = getProductosRecientes(perfil?.id)
    .map(r => productos.find(p => p.id === r.id))
    .filter(Boolean)
    .slice(0, 6)

  function elegirCliente(c) {
    if (!esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id) {
      setConfirmAjeno(c)
      return
    }
    setClienteId(c.id)
    setClienteBusqueda('')
    setClienteOpen(false)
  }

  function agregarProducto(p) {
    guardarProductoReciente(perfil?.id, p)
    setItems(prev => {
      const existing = prev.find(it => it.productoId === p.id)
      if (existing) {
        return prev.map(it =>
          it.productoId === p.id ? { ...it, cantidad: it.cantidad + 1 } : it
        )
      }
      return [...prev, {
        productoId: p.id,
        codigoSnap: p.codigo || null,
        nombreSnap: p.nombre,
        unidadSnap: p.unidad || 'und',
        cantidad: 1,
        precioUnitUsd: Number(p.precio_usd) || 0,
      }]
    })
  }

  function cambiarCantidad(productoId, delta) {
    setItems(prev => prev.map(it => {
      if (it.productoId !== productoId) return it
      const nueva = Math.max(1, it.cantidad + delta)
      return { ...it, cantidad: nueva }
    }))
  }

  function cambiarPrecio(productoId, precio) {
    setItems(prev => prev.map(it =>
      it.productoId === productoId ? { ...it, precioUnitUsd: Math.max(0, Number(precio) || 0) } : it
    ))
  }

  function quitarItem(productoId) {
    setItems(prev => prev.filter(it => it.productoId !== productoId))
  }

  async function handleSubmit() {
    if (!step1Valid || !step2Valid) return
    ventaRapida.mutate({
      clienteId,
      clienteNombre: clienteSeleccionado?.nombre,
      transportistaId: transportistaId || null,
      fleteUsd: flete,
      formaPago,
      formaPagoCliente: formaPagoCliente || null,
      referenciaPago: referenciaPago || null,
      notas,
      notasCliente: null,
      items: items.map(it => ({
        productoId: it.productoId,
        cantidad: it.cantidad,
        precioUnitUsd: it.precioUnitUsd,
        descuentoPct: 0,
      })),
      costoEnvioUsd,
      tasaBcv: tasa,
    }, {
      onSuccess: () => {
        // Reset form
        setStep(0)
        setClienteId('')
        setItems([])
        setFormaPago('')
        setFormaPagoCliente('')
        setReferenciaPago('')
        setTransportistaId('')
        setFleteUsd('')
        setNotas('')
      },
    })
  }

  // ─── Step indicators ──────────────────────────────────────────────────────
  const steps = [
    { label: 'Productos', icon: Package },
    { label: 'Pago', icon: CreditCard },
    { label: 'Confirmar', icon: CheckCircle },
  ]

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Venta rápida"
        subtitle="Cotización + despacho en un solo paso"
        icon={Zap}
      />

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1 sm:gap-2 px-4 py-3 bg-white/60 border-b border-slate-200/60">
        {steps.map((s, i) => {
          const Icon = s.icon
          const active = i === step
          const done = i < step
          return (
            <div key={i} className="flex items-center gap-1 sm:gap-2">
              {i > 0 && <div className={`w-6 sm:w-10 h-0.5 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
              <button
                onClick={() => { if (done) setStep(i) }}
                disabled={!done && !active}
                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  active ? 'bg-sky-100 text-sky-700 ring-1 ring-sky-300' :
                  done ? 'bg-emerald-50 text-emerald-700 cursor-pointer hover:bg-emerald-100' :
                  'bg-slate-100 text-slate-400'
                }`}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            </div>
          )
        })}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-auto">
        {step === 0 && (
          <Step1Productos
            clienteRef={clienteRef}
            clienteId={clienteId}
            clienteSeleccionado={clienteSeleccionado}
            clienteBusqueda={clienteBusqueda}
            setClienteBusqueda={setClienteBusqueda}
            clienteOpen={clienteOpen}
            setClienteOpen={setClienteOpen}
            clientesFiltrados={clientesFiltrados}
            elegirCliente={elegirCliente}
            setClienteId={setClienteId}
            confirmAjeno={confirmAjeno}
            setConfirmAjeno={setConfirmAjeno}
            esSupervisor={esSupervisor}
            showNuevoCliente={showNuevoCliente}
            setShowNuevoCliente={setShowNuevoCliente}
            clientes={clientes}
            productoBusqueda={productoBusqueda}
            setProductoBusqueda={setProductoBusqueda}
            productoInputRef={productoInputRef}
            categorias={categorias}
            catActiva={catActiva}
            setCatActiva={setCatActiva}
            productosFiltrados={productosFiltrados}
            recientes={recientes}
            idsAgregados={idsAgregados}
            agregarProducto={agregarProducto}
            items={items}
            cambiarCantidad={cambiarCantidad}
            cambiarPrecio={cambiarPrecio}
            quitarItem={quitarItem}
            totalItems={totalItems}
            totalUsd={totalUsd}
            totalBs={totalBs}
            tasa={tasa}
            mobileCartOpen={mobileCartOpen}
            setMobileCartOpen={setMobileCartOpen}
          />
        )}

        {step === 1 && (
          <Step2Pago
            formaPago={formaPago}
            setFormaPago={setFormaPago}
            formaPagoCliente={formaPagoCliente}
            setFormaPagoCliente={setFormaPagoCliente}
            referenciaPago={referenciaPago}
            setReferenciaPago={setReferenciaPago}
            transportistas={transportistas}
            transportistaId={transportistaId}
            setTransportistaId={setTransportistaId}
            fleteUsd={fleteUsd}
            setFleteUsd={setFleteUsd}
            notas={notas}
            setNotas={setNotas}
          />
        )}

        {step === 2 && (
          <Step3Confirmar
            clienteSeleccionado={clienteSeleccionado}
            items={items}
            subtotal={subtotal}
            ivaUsd={ivaUsd}
            totalUsd={totalUsd}
            flete={flete}
            totalConFlete={totalConFlete}
            totalBs={totalBs}
            tasa={tasa}
            formaPago={formaPago}
            formaPagoCliente={formaPagoCliente}
            referenciaPago={referenciaPago}
            transportistaSeleccionado={transportistaSeleccionado}
            notas={notas}
          />
        )}
      </div>

      {/* Bottom bar with nav buttons */}
      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-3 z-20">
        {step > 0 ? (
          <button onClick={() => setStep(step - 1)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
            <ArrowLeft size={16} /> Atrás
          </button>
        ) : <div />}

        {step < 2 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={step === 0 ? !step1Valid : !step2Valid}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Siguiente <ArrowRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={ventaRapida.isPending || !step1Valid || !step2Valid}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {ventaRapida.isPending ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            Crear venta rápida
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Cliente + Productos
// ─────────────────────────────────────────────────────────────────────────────
function Step1Productos({
  clienteRef, clienteId, clienteSeleccionado, clienteBusqueda, setClienteBusqueda,
  clienteOpen, setClienteOpen, clientesFiltrados, elegirCliente, setClienteId,
  confirmAjeno, setConfirmAjeno, esSupervisor,
  showNuevoCliente, setShowNuevoCliente, clientes,
  productoBusqueda, setProductoBusqueda, productoInputRef,
  categorias, catActiva, setCatActiva,
  productosFiltrados, recientes, idsAgregados, agregarProducto,
  items, cambiarCantidad, cambiarPrecio, quitarItem,
  totalItems, totalUsd, totalBs, tasa,
  mobileCartOpen, setMobileCartOpen,
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Nuevo cliente modal */}
      {showNuevoCliente && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-slate-800">Nuevo cliente</h3>
              <button onClick={() => setShowNuevoCliente(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="p-4">
              <ClienteForm onSuccess={(nuevo) => {
                setClienteId(nuevo.id)
                setShowNuevoCliente(false)
              }} onCancel={() => setShowNuevoCliente(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Confirm ajeno modal */}
      {confirmAjeno && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-3">
            <p className="text-sm font-medium text-amber-700 flex items-center gap-2">
              <AlertCircle size={16} /> Este cliente pertenece a otro vendedor
            </p>
            <p className="text-sm text-slate-600">{confirmAjeno.nombre}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmAjeno(null)} className="flex-1 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200">Cancelar</button>
              <button onClick={() => { setClienteId(confirmAjeno.id); setConfirmAjeno(null); setClienteOpen(false) }}
                className="flex-1 py-2 rounded-lg text-sm bg-amber-500 text-white hover:bg-amber-600">Continuar</button>
            </div>
          </div>
        </div>
      )}

      {/* Cliente selector */}
      <div ref={clienteRef} className="relative">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Cliente</label>
        {clienteSeleccionado ? (
          <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
            <User size={18} className="text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-slate-800 truncate">{clienteSeleccionado.nombre}</p>
              {clienteSeleccionado.rif_cedula && <p className="text-xs text-slate-500">{clienteSeleccionado.rif_cedula}</p>}
            </div>
            <button onClick={() => setClienteId('')} className="p-1 rounded-lg hover:bg-emerald-100">
              <X size={16} className="text-slate-400" />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text" placeholder="Buscar cliente..."
                value={clienteBusqueda}
                onChange={e => { setClienteBusqueda(e.target.value); setClienteOpen(true) }}
                onFocus={() => setClienteOpen(true)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none"
              />
              {clienteOpen && clientesFiltrados.length > 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-auto">
                  {clientesFiltrados.map(c => (
                    <button key={c.id} onClick={() => elegirCliente(c)}
                      className="w-full text-left px-3 py-2 hover:bg-sky-50 text-sm flex items-center gap-2 border-b border-slate-50 last:border-0">
                      <User size={14} className="text-slate-400 shrink-0" />
                      <span className="truncate">{c.nombre}</span>
                      {c.rif_cedula && <span className="text-xs text-slate-400 shrink-0">{c.rif_cedula}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowNuevoCliente(true)}
              className="px-3 py-2.5 rounded-xl bg-sky-50 text-sky-600 hover:bg-sky-100 border border-sky-200">
              <UserPlus size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Productos */}
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Productos</label>
        <div className="relative mb-2">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input ref={productoInputRef}
            type="text" placeholder="Buscar producto..."
            value={productoBusqueda}
            onChange={e => setProductoBusqueda(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none"
          />
        </div>

        {/* Categorías */}
        {categorias.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 scrollbar-hide">
            <button onClick={() => setCatActiva('')}
              className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${!catActiva ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              Todos
            </button>
            {categorias.map(cat => (
              <button key={cat} onClick={() => setCatActiva(cat === catActiva ? '' : cat)}
                className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${cat === catActiva ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Product list */}
        <div className="space-y-1 max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white">
          {(productoBusqueda || catActiva ? productosFiltrados : recientes.length > 0 ? recientes : productosFiltrados).slice(0, 20).map(p => {
            const added = idsAgregados.has(p.id)
            const stock = Number(p.stock_actual) || 0
            return (
              <button key={p.id} onClick={() => !added && stock > 0 && agregarProducto(p)}
                disabled={added || stock <= 0}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm border-b border-slate-50 last:border-0 transition-colors ${
                  added ? 'bg-emerald-50 opacity-60' : stock <= 0 ? 'opacity-40' : 'hover:bg-sky-50'
                }`}>
                <Package size={14} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-slate-700">{p.nombre}</p>
                  <p className="text-xs text-slate-400">{p.codigo} · {fmtUsd(p.precio_usd)} · Stock: {stock}</p>
                </div>
                {added ? <CheckCircle size={16} className="text-emerald-500 shrink-0" /> :
                 stock > 0 ? <Plus size={16} className="text-sky-500 shrink-0" /> : null}
              </button>
            )
          })}
          {productosFiltrados.length === 0 && productoBusqueda && (
            <p className="px-3 py-4 text-sm text-slate-400 text-center">Sin resultados</p>
          )}
        </div>
      </div>

      {/* Cart (items added) */}
      {items.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Carrito ({totalItems} items)
            </span>
            <span className="text-sm font-bold text-slate-800">{fmtUsd(totalUsd)}</span>
          </div>
          <div className="space-y-2">
            {items.map(it => (
              <div key={it.productoId} className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{it.nombreSnap}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-slate-400">{fmtUsd(it.precioUnitUsd)} × {it.cantidad}</span>
                    <span className="text-xs font-semibold text-slate-600">{fmtUsd(round2(it.precioUnitUsd * it.cantidad))}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => cambiarCantidad(it.productoId, -1)}
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
                    <Minus size={14} />
                  </button>
                  <span className="w-8 text-center text-sm font-semibold">{it.cantidad}</span>
                  <button onClick={() => cambiarCantidad(it.productoId, 1)}
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
                    <Plus size={14} />
                  </button>
                </div>
                <button onClick={() => quitarItem(it.productoId)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
          {tasa > 0 && (
            <p className="text-xs text-slate-400 mt-2 text-right">≈ {fmtBs(totalBs)}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Pago y Envío
// ─────────────────────────────────────────────────────────────────────────────
function Step2Pago({
  formaPago, setFormaPago, formaPagoCliente, setFormaPagoCliente,
  referenciaPago, setReferenciaPago,
  transportistas, transportistaId, setTransportistaId,
  fleteUsd, setFleteUsd, notas, setNotas,
}) {
  return (
    <div className="p-4 space-y-5">
      {/* Forma de pago (empresa) */}
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
          Forma de pago <span className="text-red-400">*</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {FORMAS_PAGO.map(fp => (
            <button key={fp} onClick={() => setFormaPago(fp)}
              className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                formaPago === fp
                  ? 'bg-sky-50 border-sky-300 text-sky-700 ring-1 ring-sky-200'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {fp}
            </button>
          ))}
        </div>
      </div>

      {/* Pago del cliente */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
            Forma de pago del cliente
          </label>
          <select value={formaPagoCliente} onChange={e => setFormaPagoCliente(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none">
            <option value="">— Seleccionar —</option>
            {FORMAS_PAGO.filter(fp => fp !== 'Cta por cobrar').map(fp => (
              <option key={fp} value={fp}>{fp}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
            Referencia / comprobante
          </label>
          <input type="text" value={referenciaPago} onChange={e => setReferenciaPago(e.target.value)}
            placeholder="Ej: REF-12345"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none" />
        </div>
      </div>

      {/* Transportista */}
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
          Transportista (opcional)
        </label>
        <select value={transportistaId} onChange={e => setTransportistaId(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none">
          <option value="">— Sin transportista —</option>
          {transportistas.map(t => (
            <option key={t.id} value={t.id}>{t.nombre}{t.vehiculo ? ` — ${t.vehiculo}` : ''}</option>
          ))}
        </select>
      </div>

      {/* Flete */}
      {transportistaId && (
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
            Monto del flete (USD)
          </label>
          <input type="number" min="0" step="0.01" value={fleteUsd} onChange={e => setFleteUsd(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none" />
        </div>
      )}

      {/* Notas */}
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
          Notas (opcional)
        </label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)}
          rows={2} placeholder="Observaciones internas..."
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none resize-none" />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Confirmar
// ─────────────────────────────────────────────────────────────────────────────
function Step3Confirmar({
  clienteSeleccionado, items, subtotal, ivaUsd, totalUsd, flete, totalConFlete,
  totalBs, tasa, formaPago, formaPagoCliente, referenciaPago, transportistaSeleccionado, notas,
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
        <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800">
          Al confirmar se creará la cotización y el despacho. El stock se descontará inmediatamente.
        </p>
      </div>

      {/* Cliente */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Cliente</h3>
        <div className="flex items-center gap-2">
          <User size={16} className="text-slate-400" />
          <span className="font-medium text-slate-800">{clienteSeleccionado?.nombre}</span>
        </div>
        {clienteSeleccionado?.direccion && (
          <p className="text-xs text-slate-400 mt-1 ml-6">{clienteSeleccionado.direccion}</p>
        )}
      </div>

      {/* Items */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          Productos ({items.length})
        </h3>
        <div className="space-y-2">
          {items.map(it => (
            <div key={it.productoId} className="flex items-center justify-between text-sm">
              <div className="flex-1 min-w-0">
                <span className="text-slate-700 truncate block">{it.nombreSnap}</span>
                <span className="text-xs text-slate-400">{it.cantidad} × {fmtUsd(it.precioUnitUsd)}</span>
              </div>
              <span className="font-semibold text-slate-800 shrink-0 ml-2">{fmtUsd(round2(it.cantidad * it.precioUnitUsd))}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Totales */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Subtotal</span>
          <span className="text-slate-700">{fmtUsd(subtotal)}</span>
        </div>
        {ivaUsd > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">IVA</span>
            <span className="text-slate-700">{fmtUsd(ivaUsd)}</span>
          </div>
        )}
        {flete > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Flete</span>
            <span className="text-slate-700">{fmtUsd(flete)}</span>
          </div>
        )}
        <div className="border-t border-slate-100 pt-2 flex justify-between">
          <span className="font-semibold text-slate-800">Total</span>
          <div className="text-right">
            <p className="font-bold text-lg text-slate-800">{fmtUsd(totalConFlete)}</p>
            {tasa > 0 && <p className="text-xs text-slate-400">≈ {fmtBs(totalBs)}</p>}
          </div>
        </div>
      </div>

      {/* Pago */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Pago</h3>
        <div className="flex items-center gap-2 text-sm">
          <CreditCard size={14} className="text-slate-400" />
          <span className="text-slate-700">{formaPago}</span>
        </div>
        {formaPagoCliente && (
          <div className="flex items-center gap-2 text-sm">
            <DollarSign size={14} className="text-slate-400" />
            <span className="text-slate-600">Cliente pagó con: {formaPagoCliente}</span>
          </div>
        )}
        {referenciaPago && (
          <div className="flex items-center gap-2 text-sm">
            <Hash size={14} className="text-slate-400" />
            <span className="text-slate-600">Ref: {referenciaPago}</span>
          </div>
        )}
      </div>

      {/* Transportista */}
      {transportistaSeleccionado && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Transporte</h3>
          <div className="flex items-center gap-2 text-sm">
            <Truck size={14} className="text-slate-400" />
            <span className="text-slate-700">{transportistaSeleccionado.nombre}</span>
            {transportistaSeleccionado.vehiculo && (
              <span className="text-xs text-slate-400">— {transportistaSeleccionado.vehiculo}</span>
            )}
          </div>
        </div>
      )}

      {/* Notas */}
      {notas && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Notas</h3>
          <p className="text-sm text-slate-600">{notas}</p>
        </div>
      )}
    </div>
  )
}
