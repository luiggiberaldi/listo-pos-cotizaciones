// src/components/cotizaciones/CotizacionBuilder.jsx
// Constructor de cotizaciones — wizard de 4 pasos
// Paso 1: Seleccionar/crear cliente
// Paso 2: Agregar productos
// Paso 3: Descuentos, envío, notas y resumen
// Paso 4: Confirmación (post-envío) con PDF y WhatsApp
import { useState, useEffect, useRef } from 'react'
import {
  User, Truck, Search, Plus, Trash2, UserPlus, ChevronDown, X, Package,
  Save, Send, ArrowLeft, ArrowRight, Loader2, AlertCircle, DollarSign, RefreshCw,
  CheckCircle, FileDown, MessageCircle, StickyNote, Tag, Hash, Phone, Mail, MapPin,
  LayoutGrid, LayoutList, ShoppingCart, Minus,
} from 'lucide-react'
import { useClientes, useVendedores } from '../../hooks/useClientes'
import { useInventario, useCategorias } from '../../hooks/useInventario'
import { useTransportistas }   from '../../hooks/useTransportistas'
import { useGuardarBorrador, useEnviarCotizacion } from '../../hooks/useCotizaciones'
import { useTasaCambio }       from '../../hooks/useTasaCambio'
import { useConfigNegocio }    from '../../hooks/useConfigNegocio'
import useAuthStore            from '../../store/useAuthStore'
import { notifyClienteAjeno }  from '../../services/notificationService'
import { sendPushNotification } from '../../hooks/usePushNotifications'
import { compartirPorWhatsApp, generarMensaje } from '../../utils/whatsapp'
import { round2, round4, mulR } from '../../utils/dinero'
import { calcTotales } from '../../utils/calcTotales'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../../utils/format'
import { getLocalISODate }     from '../../utils/dateHelpers'
import supabase from '../../services/supabase/client'
import CustomSelect from '../ui/CustomSelect'
import ClienteForm from '../clientes/ClienteForm'

// ─── Helpers ─────────────────────────────────────────────────────────────────
let _itemCounter = 0

const STEP_LABELS = ['Cliente', 'Productos', 'Resumen', 'Enviada']

// ─── Indicador de pasos ──────────────────────────────────────────────────────
function StepIndicator({ paso, totalPasos = 4 }) {
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {Array.from({ length: totalPasos }).map((_, i) => {
        const step = i + 1
        const isActive = step === paso
        const isDone   = step < paso
        return (
          <div key={step} className="flex items-center gap-1 sm:gap-2">
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold transition-all ${
              isDone ? 'bg-emerald-100 text-emerald-700' : !isActive ? 'bg-slate-100 text-slate-400' : ''
            }`}
              style={isActive ? {
                background: 'linear-gradient(135deg, #1B365D, #B8860B)',
                color: 'white',
                boxShadow: '0 2px 8px rgba(27,54,93,0.3)',
              } : undefined}>
              {isDone ? <CheckCircle size={12} /> : <span>{step}</span>}
              <span className="hidden sm:inline">{STEP_LABELS[i]}</span>
            </div>
            {i < totalPasos - 1 && (
              <div className={`w-4 sm:w-8 h-0.5 rounded-full transition-colors ${
                step < paso ? 'bg-emerald-300' : 'bg-slate-200'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Línea de ítem (desktop) ────────────────────────────────────────────────
function ItemLinea({ item, idx, onChange, onDelete, tasa = 0 }) {
  const lineTotal = round2(item.cantidad * item.precioUnitUsd * (1 - item.descuentoPct / 100))

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/60 group">
      <td className="py-3 px-3 max-w-[200px]">
        <div className="font-semibold text-sm text-slate-800 truncate">{item.nombreSnap}</div>
        {item.codigoSnap && <div className="text-[11px] text-slate-400 font-mono mt-0.5">{item.codigoSnap}</div>}
      </td>
      <td className="py-3 px-2">
        <span className="text-[11px] font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{item.unidadSnap}</span>
      </td>
      <td className="py-3 px-2">
        <input type="number" min="0.01" step="0.01"
          value={item.cantidad}
          onChange={e => onChange(idx, 'cantidad', Math.max(0.01, Number(e.target.value)))}
          onFocus={e => e.target.select()}
          className="w-20 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary bg-white transition-all"
        />
      </td>
      <td className="py-3 px-2">
        <input type="number" min="0" step="0.01"
          value={item.precioUnitUsd}
          onChange={e => onChange(idx, 'precioUnitUsd', Math.max(0, Number(e.target.value)))}
          onFocus={e => e.target.select()}
          className="w-24 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary bg-white transition-all"
        />
        {tasa > 0 && <p className="text-[10px] text-slate-400 text-right pr-1 mt-0.5">{fmtBs(usdToBs(item.precioUnitUsd, tasa))}</p>}
      </td>
      <td className="py-3 px-2">
        <div className="flex items-center gap-1">
          <input type="number" min="0" max="100" step="0.5"
            value={item.descuentoPct}
            onChange={e => onChange(idx, 'descuentoPct', Math.min(100, Math.max(0, Number(e.target.value))))}
            onFocus={e => e.target.select()}
            className="w-14 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary bg-white transition-all"
          />
          <span className="text-xs text-slate-400">%</span>
        </div>
      </td>
      <td className="py-3 px-3 text-right">
        <p className="text-sm font-black text-slate-800">{fmtUsd(lineTotal)}</p>
        {tasa > 0 && <p className="text-[10px] text-slate-400">{fmtBs(usdToBs(lineTotal, tasa))}</p>}
      </td>
      <td className="py-3 px-2">
        <button onClick={() => onDelete(idx)}
          className="p-1.5 rounded-lg text-slate-200 hover:text-red-500 hover:bg-red-50 group-hover:text-slate-300 transition-all">
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  )
}

// ─── Tarjeta de ítem (móvil) ────────────────────────────────────────────────
function ItemCard({ item, idx, onChange, onDelete, tasa = 0 }) {
  const lineTotal = round2(item.cantidad * item.precioUnitUsd * (1 - item.descuentoPct / 100))

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm text-slate-800 truncate">{item.nombreSnap}</p>
          {item.codigoSnap && <p className="text-xs text-slate-400 font-mono">{item.codigoSnap}</p>}
          <p className="text-xs text-slate-400">{item.unidadSnap}</p>
        </div>
        <button onClick={() => onDelete(idx)}
          className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Cantidad</label>
          <input type="number" min="0.01" step="0.01"
            value={item.cantidad}
            onChange={e => onChange(idx, 'cantidad', Math.max(0.01, Number(e.target.value)))}
            className="w-full px-3 py-2.5 text-sm text-right border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Precio USD</label>
          <input type="number" min="0" step="0.01"
            value={item.precioUnitUsd}
            onChange={e => onChange(idx, 'precioUnitUsd', Math.max(0, Number(e.target.value)))}
            className="w-full px-3 py-2.5 text-sm text-right border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
          />
          {tasa > 0 && <p className="text-[10px] text-slate-400 text-right">{fmtBs(usdToBs(item.precioUnitUsd, tasa))}</p>}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Desc. %</label>
          <input type="number" min="0" max="100" step="0.5"
            value={item.descuentoPct}
            onChange={e => onChange(idx, 'descuentoPct', Math.min(100, Math.max(0, Number(e.target.value))))}
            className="w-full px-3 py-2.5 text-sm text-right border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Total</label>
          <div className="px-3 py-2.5 text-right bg-white border border-slate-200 rounded-xl">
            <p className="text-sm font-bold text-slate-800">{fmtUsd(lineTotal)}</p>
            {tasa > 0 && <p className="text-[10px] text-slate-400">{fmtBs(usdToBs(lineTotal, tasa))}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Buscador de productos ────────────────────────────────────────────────────
const PRODUCTOS_POR_PAGINA = 12

function BuscadorProductos({ onAgregar, itemsAgregados = [], tasa = 0 }) {
  const [texto, setTexto] = useState('')
  const [catActiva, setCatActiva] = useState('')
  const [pagina, setPagina] = useState(0)
  const { data: inventarioData, isLoading } = useInventario({})
  const todosProductos = inventarioData?.productos ?? inventarioData ?? []
  const { data: categorias = [] } = useCategorias()

  const filtrados = todosProductos.filter(p => {
    const coincideTexto = !texto.trim() ||
      p.nombre.toLowerCase().includes(texto.toLowerCase()) ||
      (p.codigo ?? '').toLowerCase().includes(texto.toLowerCase())
    const coincideCat = !catActiva || (p.categoria ?? '').toUpperCase().startsWith(catActiva.toUpperCase())
    return coincideTexto && coincideCat
  })

  const idsAgregados = new Set(itemsAgregados.map(it => it.productoId))
  const totalPags = Math.ceil(filtrados.length / PRODUCTOS_POR_PAGINA)
  const paginados = filtrados.slice(pagina * PRODUCTOS_POR_PAGINA, (pagina + 1) * PRODUCTOS_POR_PAGINA)

  function cambiarTexto(val) { setTexto(val); setPagina(0) }
  function cambiarCat(val)   { setCatActiva(val); setPagina(0) }

  return (
    <div className="space-y-3">

      {/* Barra de búsqueda */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={texto}
          onChange={e => cambiarTexto(e.target.value)}
          placeholder="Buscar por nombre o código..."
          className="w-full pl-10 pr-10 py-3 text-sm border border-slate-200 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400 transition-all"
          autoFocus
        />
        {texto && (
          <button type="button" onClick={() => cambiarTexto('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Chips de categoría — scroll horizontal con fade indicador */}
      {categorias.length > 0 && (
        <div className="relative -mx-3 sm:-mx-5">
          {/* Fade derecho para indicar que hay más */}
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-white to-transparent z-10" />
          <div className="overflow-x-auto scrollbar-hide px-3 sm:px-5 pb-1">
            <div className="flex gap-1.5 py-0.5 w-max pr-8">
              <button type="button" onClick={() => cambiarCat('')}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                  !catActiva ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}>
                Todos
              </button>
              {categorias.map(cat => (
                <button key={cat} type="button" onClick={() => cambiarCat(catActiva === cat ? '' : cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                    catActiva === cat ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cargando */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="h-16 bg-slate-100 animate-pulse" />
              <div className="p-2.5 space-y-1.5">
                <div className="h-2.5 bg-slate-100 rounded animate-pulse w-3/4" />
                <div className="h-2 bg-slate-100 rounded animate-pulse w-1/2" />
                <div className="h-4 bg-slate-100 rounded animate-pulse w-2/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grid de productos — ajustado para panel angosto */}
      {!isLoading && paginados.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
            {paginados.map(p => {
              const yaAgregado = idsAgregados.has(p.id)
              const sinStock   = p.stock_actual != null && p.stock_actual <= 0
              const sinPrecio  = !p.precio_usd || Number(p.precio_usd) <= 0
              const bloqueado  = sinStock || sinPrecio
              return (
                <button key={p.id} type="button"
                  onClick={() => !bloqueado && onAgregar(p)}
                  disabled={bloqueado}
                  title={sinPrecio ? 'Sin precio — no se puede cotizar' : sinStock ? 'Sin stock' : undefined}
                  className={`relative bg-white rounded-xl border text-left transition-all flex flex-col overflow-hidden ${
                    bloqueado
                      ? 'opacity-40 cursor-not-allowed border-slate-100'
                      : yaAgregado
                        ? 'border-emerald-300 shadow-sm shadow-emerald-100/80'
                        : 'border-slate-200 hover:border-primary/50 hover:shadow-md active:scale-[0.97]'
                  }`}>

                  {/* Zona imagen */}
                  <div className={`relative flex items-center justify-center h-14 transition-colors ${
                    yaAgregado ? 'bg-emerald-50' : 'bg-slate-50 group-hover:bg-primary-light/30'
                  }`}>
                    {p.imagen_url
                      ? <img src={p.imagen_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      : <div className={`transition-colors ${yaAgregado ? 'text-emerald-400' : 'text-slate-300'}`}>
                          {yaAgregado ? <CheckCircle size={20} /> : <Package size={20} />}
                        </div>
                    }
                    {/* Badge stock */}
                    {p.stock_actual != null && (
                      <span className={`absolute top-1.5 right-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none ${
                        sinStock
                          ? 'bg-red-500 text-white'
                          : p.stock_actual <= (p.stock_minimo ?? 0)
                            ? 'bg-amber-400 text-white'
                            : 'bg-emerald-500 text-white'
                      }`}>
                        {sinStock ? 'Ago.' : p.stock_actual}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-2.5 flex flex-col gap-0.5 flex-1">
                    <p className={`text-[11px] font-bold line-clamp-2 leading-tight ${
                      yaAgregado ? 'text-emerald-700' : 'text-slate-800'
                    }`}>
                      {p.nombre}
                    </p>
                    {p.codigo && (
                      <p className="text-[10px] font-mono text-slate-400 truncate mt-auto pt-1">{p.codigo} · {p.unidad}</p>
                    )}
                    <p className={`text-sm font-black mt-1 ${yaAgregado ? 'text-emerald-600' : 'text-slate-800'}`}>
                      {fmtUsd(p.precio_usd)}
                    </p>
                    {tasa > 0 && (
                      <p className="text-[10px] text-slate-400 -mt-0.5">{fmtBs(usdToBs(p.precio_usd, tasa))}</p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Paginación + contador */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-slate-400">
              {filtrados.length} producto{filtrados.length !== 1 ? 's' : ''}
              {totalPags > 1 && ` · pág. ${pagina + 1}/${totalPags}`}
            </p>
            {totalPags > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPagina(p => p - 1)} disabled={pagina === 0}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                  <ArrowLeft size={12} />
                </button>
                {Array.from({ length: Math.min(totalPags, 5) }).map((_, i) => {
                  let num
                  if (totalPags <= 5) num = i
                  else if (pagina < 3) num = i
                  else if (pagina > totalPags - 4) num = totalPags - 5 + i
                  else num = pagina - 2 + i
                  return (
                    <button key={num} type="button" onClick={() => setPagina(num)}
                      className={`w-7 h-7 text-xs font-bold rounded-lg transition-all ${
                        num === pagina ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                      }`}>
                      {num + 1}
                    </button>
                  )
                })}
                <button type="button" onClick={() => setPagina(p => p + 1)} disabled={pagina >= totalPags - 1}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                  <ArrowRight size={12} />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Sin resultados */}
      {!isLoading && filtrados.length === 0 && (texto || catActiva) && (
        <div className="text-center py-10">
          <Search size={28} className="mx-auto text-slate-200 mb-3" />
          <p className="text-sm font-bold text-slate-400">Sin resultados</p>
          <p className="text-xs text-slate-300 mt-1">Prueba con otro término o categoría</p>
          <button type="button" onClick={() => { cambiarTexto(''); cambiarCat('') }}
            className="text-xs text-primary font-semibold hover:underline mt-3 block mx-auto">
            Limpiar filtros
          </button>
        </div>
      )}

      {/* Sin inventario */}
      {!isLoading && filtrados.length === 0 && !texto && !catActiva && (
        <div className="text-center py-10">
          <Package size={28} className="mx-auto text-slate-200 mb-3" />
          <p className="text-sm font-bold text-slate-400">No hay productos en el inventario</p>
        </div>
      )}
    </div>
  )
}

// ─── Modal de envío (con tasa auto/manual) ──────────────────────────────────
function ModalEnvio({ isOpen, onConfirm, onCancel, cargando, tasaHook }) {
  const { tasaBcv, tasaEfectiva, modoAuto, setModoAuto, tasaManual, setTasaManual, cargando: tasaCargando, refrescar } = tasaHook
  const [error, setError] = useState('')

  if (!isOpen) return null

  function confirmar() {
    if (!tasaEfectiva || tasaEfectiva <= 0) {
      setError('La tasa debe ser mayor a 0')
      return
    }
    onConfirm(tasaEfectiva)
  }

  const fmtBs = n => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-sm p-4 sm:p-6 space-y-4">
        <h3 className="font-black text-slate-800 text-lg">Enviar cotización</h3>
        <p className="text-sm text-slate-500">
          Confirma la tasa de cambio para registrar el equivalente en bolívares.
        </p>

        {/* Toggle auto/manual */}
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Tasa de cambio</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold">
                {modoAuto
                  ? <span className="text-emerald-600">Auto BCV</span>
                  : <span className="text-primary">Manual</span>}
              </span>
              <button
                onClick={() => setModoAuto(!modoAuto)}
                style={{ minHeight: 0 }}
                className={`relative w-10 h-6 rounded-full transition-colors ${modoAuto ? 'bg-emerald-500' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform shadow-sm ${modoAuto ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>

          {modoAuto ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-black text-emerald-600">{fmtBs(tasaBcv.precio)} <span className="text-xs font-medium text-slate-400">Bs/$</span></p>
                <p className="text-[10px] text-slate-400">
                  {tasaBcv.fuente || 'Sin datos'}
                  {tasaBcv.ultimaActualizacion && ` · ${new Date(tasaBcv.ultimaActualizacion).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`}
                </p>
              </div>
              <button onClick={refrescar} disabled={tasaCargando}
                className="p-2 rounded-xl hover:bg-white text-slate-400 hover:text-emerald-600 transition-colors">
                <RefreshCw size={16} className={tasaCargando ? 'animate-spin' : ''} />
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <input type="number" min="0.01" step="0.01"
                value={tasaManual}
                onChange={e => { setTasaManual(e.target.value); setError('') }}
                placeholder="Ej: 48.50"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-primary focus:outline-none focus:ring-2 focus:ring-primary-focus"
                autoFocus
              />
              {tasaBcv.precio > 0 && (
                <p className="text-[10px] text-slate-400">
                  Referencia BCV: {fmtBs(tasaBcv.precio)} Bs/$
                </p>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button onClick={onCancel} disabled={cargando}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={cargando || tasaEfectiva <= 0}
            className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {cargando ? <><Loader2 size={15} className="animate-spin" />Enviando...</> : 'Confirmar envío'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Selector de cliente personalizado (reemplaza el select nativo) ──────────
const TIPO_COLORS = {
  natural:  'bg-slate-100 text-slate-600',
  juridico: 'bg-violet-100 text-violet-700',
}
const TIPO_LABELS_SHORT = {
  natural: 'Natural', juridico: 'Jurídico',
}

function ClienteSelector({ clientes, clienteId, onSelect }) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [confirmAjeno, setConfirmAjeno] = useState(null)
  const ref = useRef(null)
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    if (abierto) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [abierto])

  const seleccionado = clientes.find(c => c.id === clienteId)
  const filtrados = busqueda.trim()
    ? clientes.filter(c =>
        c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
        (c.rif_cedula ?? '').toLowerCase().includes(busqueda.toLowerCase()) ||
        (c.telefono ?? '').includes(busqueda)
      )
    : clientes

  function elegir(c) {
    // Si es vendedor y el cliente pertenece a otro vendedor, pedir confirmación
    if (!esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id) {
      setConfirmAjeno(c)
      return
    }
    onSelect(c.id)
    setAbierto(false)
    setBusqueda('')
  }

  function confirmarClienteAjeno() {
    if (confirmAjeno) {
      onSelect(confirmAjeno.id)
      setAbierto(false)
      setBusqueda('')
      setConfirmAjeno(null)
    }
  }

  function limpiar(e) {
    e.stopPropagation()
    onSelect('')
    setBusqueda('')
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
          abierto
            ? 'border-primary ring-2 ring-primary-focus bg-white'
            : seleccionado
              ? 'border-primary/30 bg-primary-light/20 hover:border-primary/50'
              : 'border-slate-200 bg-slate-50 hover:border-slate-300'
        }`}
      >
        {seleccionado ? (
          <>
            <div className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
              <User size={16} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800 text-sm truncate">{seleccionado.nombre}</p>
              <p className="text-xs text-slate-500 truncate">
                {seleccionado.rif_cedula ?? ''}{seleccionado.rif_cedula && seleccionado.telefono ? ' · ' : ''}{seleccionado.telefono ?? ''}
              </p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${TIPO_COLORS[seleccionado.tipo_cliente] ?? TIPO_COLORS.natural}`}>
              {TIPO_LABELS_SHORT[seleccionado.tipo_cliente] ?? 'Particular'}
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
            <span className="flex-1 text-sm text-slate-400">Seleccionar cliente...</span>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {/* Dropdown */}
      {abierto && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
          {/* Buscador */}
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre, RIF o teléfono..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-100 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
                autoFocus
              />
            </div>
          </div>

          {/* Lista */}
          <div className="max-h-60 overflow-y-auto">
            {filtrados.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">
                {busqueda ? 'Sin resultados' : 'No hay clientes'}
              </p>
            ) : (
              filtrados.map(c => {
                const esAjeno = !esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id
                const vendedorColor = c.vendedor?.color || null
                return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => elegir(c)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                    c.id === clienteId ? 'bg-primary-light/30' : ''
                  }`}
                  style={vendedorColor ? { borderLeft: `3px solid ${vendedorColor}` } : undefined}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={vendedorColor ? { backgroundColor: vendedorColor + '20' } : { backgroundColor: '#f1f5f9' }}>
                    <User size={14} style={vendedorColor ? { color: vendedorColor } : undefined} className={!vendedorColor ? 'text-slate-500' : ''} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-sm truncate">{c.nombre}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {[c.rif_cedula, c.telefono].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                    </p>
                  </div>
                  {esAjeno && c.vendedor && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 shrink-0 whitespace-nowrap">
                      {c.vendedor.nombre}
                    </span>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${TIPO_COLORS[c.tipo_cliente] ?? TIPO_COLORS.natural}`}>
                    {TIPO_LABELS_SHORT[c.tipo_cliente] ?? 'Particular'}
                  </span>
                  {c.id === clienteId && (
                    <CheckCircle size={14} className="text-primary shrink-0" />
                  )}
                </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Modal confirmación cliente ajeno */}
      {confirmAjeno && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmAjeno(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                <AlertCircle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Cliente de otro vendedor</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  <strong>{confirmAjeno.nombre}</strong> está asignado a <strong>{confirmAjeno.vendedor?.nombre || 'otro vendedor'}</strong>
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Puedes usar este cliente, pero se notificará al supervisor. ¿Deseas continuar?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmAjeno(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={confirmarClienteAjeno}
                className="px-4 py-2 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors">
                Sí, usar cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Componente principal (Wizard) ───────────────────────────────────────────

// Mini header de sección consistente con el resto de la app
function SectionH3({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: 'linear-gradient(180deg, #B8860B, #1B365D)', minHeight: '18px' }} />
      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
        style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08), rgba(184,134,11,0.08))', border: '1px solid rgba(27,54,93,0.1)' }}>
        {Icon && <Icon size={12} style={{ color: '#1B365D' }} />}
      </div>
      <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">{children}</h3>
    </div>
  )
}
// ─── Panel de cesta (lado derecho del paso 2) ────────────────────────────────
function CestaPanel({ items, onCambiar, onEliminar, subtotal, tasa, onSiguiente, onAnterior }) {
  const [expandido, setExpandido] = useState(false)

  // En móvil: barra sticky + drawer expandible
  // En desktop (lg+): panel completo lateral
  return (
    <>
      {/* ── Móvil: barra inferior sticky ── */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 shadow-lg">
        {/* Drawer expandido */}
        {expandido && (
          <div className="border-b border-slate-100 max-h-[50vh] overflow-y-auto divide-y divide-slate-50">
            {items.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">Sin productos todavía</p>
            )}
            {items.map((it, idx) => {
              const linea = mulR(it.cantidad, mulR(it.precioUnitUsd, 1 - it.descuentoPct / 100))
              return (
                <div key={it._key} className="px-4 py-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{it.nombreSnap}</p>
                    <p className="text-[11px] text-slate-400">{fmtUsd(it.precioUnitUsd)} · {it.unidadSnap}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button"
                      onClick={() => it.cantidad <= 1 ? onEliminar(idx) : onCambiar(idx, 'cantidad', it.cantidad - 1)}
                      className="w-6 h-6 rounded-full bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-500 flex items-center justify-center transition-colors">
                      <Minus size={10} />
                    </button>
                    <span className="w-6 text-center text-xs font-bold">{it.cantidad}</span>
                    <button type="button"
                      onClick={() => onCambiar(idx, 'cantidad', it.cantidad + 1)}
                      className="w-6 h-6 rounded-full bg-slate-100 hover:bg-emerald-100 text-slate-500 hover:text-emerald-600 flex items-center justify-center transition-colors">
                      <Plus size={10} />
                    </button>
                  </div>
                  <span className="text-xs font-bold text-slate-800 w-14 text-right shrink-0">{fmtUsd(linea)}</span>
                  <button type="button" onClick={() => onEliminar(idx)} className="text-slate-300 hover:text-red-400 transition-colors">
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {/* Barra compacta */}
        <div className="px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => setExpandido(v => !v)}
            className="flex items-center gap-2 flex-1 min-w-0">
            <ShoppingCart size={16} className="text-primary shrink-0" />
            <span className="text-sm font-bold text-slate-700">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
            {items.length > 0 && (
              <span className="text-sm font-black text-slate-800 ml-1">{fmtUsd(subtotal)}</span>
            )}
            <ChevronDown size={14} className={`text-slate-400 ml-auto transition-transform ${expandido ? 'rotate-180' : ''}`} />
          </button>
          <button type="button" onClick={onSiguiente} disabled={items.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-white font-bold text-sm rounded-xl disabled:opacity-40 shrink-0"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
            Continuar <ArrowRight size={14} />
          </button>
        </div>
      </div>
      {/* Spacer para que el contenido no quede detrás de la barra */}
      <div className="lg:hidden h-24" />

      {/* ── Desktop: panel lateral completo ── */}
      <div className="hidden lg:flex bg-white rounded-2xl border border-slate-200 flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-slate-700 text-sm flex items-center gap-2">
            <ShoppingCart size={14} className="text-primary" /> Cesta
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${items.length > 0 ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'}`}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        {/* Lista de items */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-50" style={{ maxHeight: 'calc(100vh - 360px)', minHeight: '120px' }}>
          {items.length === 0 && (
            <div className="p-8 text-center text-slate-400">
              <ShoppingCart size={28} className="mx-auto mb-2 opacity-20" />
              <p className="text-xs">Sin productos todavía</p>
              <p className="text-[11px] text-slate-300 mt-1">Haz clic en un producto del catálogo</p>
            </div>
          )}
          {items.map((it, idx) => {
            const linea = mulR(it.cantidad, mulR(it.precioUnitUsd, 1 - it.descuentoPct / 100))
            return (
              <div key={it._key} className="px-3 py-2.5 flex items-start gap-2 hover:bg-slate-50/50 transition-colors group">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 leading-snug line-clamp-2">{it.nombreSnap}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{fmtUsd(it.precioUnitUsd)} · {it.unidadSnap}</p>
                  {it.descuentoPct > 0 && (
                    <p className="text-[10px] text-amber-500 font-semibold mt-0.5">Desc. {it.descuentoPct}%</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  <button type="button"
                    onClick={() => it.cantidad <= 1 ? onEliminar(idx) : onCambiar(idx, 'cantidad', Math.max(0.01, it.cantidad - 1))}
                    className="w-5 h-5 rounded-full bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-500 flex items-center justify-center transition-colors">
                    <Minus size={9} />
                  </button>
                  <input
                    type="number" min="0.01" step="0.01"
                    value={it.cantidad}
                    onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) onCambiar(idx, 'cantidad', v) }}
                    className="w-10 text-center text-xs font-bold border border-slate-200 rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
                  />
                  <button type="button"
                    onClick={() => onCambiar(idx, 'cantidad', it.cantidad + 1)}
                    className="w-5 h-5 rounded-full bg-slate-100 hover:bg-emerald-100 text-slate-500 hover:text-emerald-600 flex items-center justify-center transition-colors">
                    <Plus size={9} />
                  </button>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs font-bold text-slate-800">{fmtUsd(linea)}</span>
                  <button type="button" onClick={() => onEliminar(idx)}
                    className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all">
                    <X size={11} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Totales */}
        {items.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3 space-y-1.5">
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-slate-500">Subtotal</span>
              <span className="text-base font-black text-slate-800">{fmtUsd(subtotal)}</span>
            </div>
            {tasa > 0 && (
              <div className="flex justify-between items-baseline">
                <span className="text-[11px] text-slate-400">En Bs</span>
                <span className="text-xs text-slate-400">{fmtBs(usdToBs(subtotal, tasa))}</span>
              </div>
            )}
            <p className="text-[10px] text-slate-300">* Descuentos y envío en el siguiente paso</p>
          </div>
        )}

        {/* Botones */}
        <div className="border-t border-slate-100 p-3 space-y-2">
          <button type="button" onClick={onSiguiente} disabled={items.length === 0}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-white font-bold text-sm rounded-xl transition-all disabled:opacity-40 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
            Continuar al resumen <ArrowRight size={14} />
          </button>
          <button type="button" onClick={onAnterior}
            className="w-full py-2 border border-slate-200 text-slate-500 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors">
            Volver
          </button>
        </div>
      </div>
    </>
  )
}

export default function CotizacionBuilder({ cotizacionExistente = null, onVolver, onGuardado }) {
  const esEdicion = !!cotizacionExistente
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  // Paso actual del wizard (1-4)
  const [paso, setPaso] = useState(esEdicion ? 2 : 1)
  const [showCrearCliente, setShowCrearCliente] = useState(false)

  // Estado del formulario
  const [vendedorId,         setVendedorId]         = useState(cotizacionExistente?.vendedor_id ?? '')
  const [clienteId,          setClienteId]          = useState(cotizacionExistente?.cliente_id ?? '')
  const [transportistaId,    setTransportistaId]    = useState(cotizacionExistente?.transportista_id ?? '')
  const [validaHasta,        setValidaHasta]        = useState(cotizacionExistente?.valida_hasta ?? '')
  const [notasCliente,       setNotasCliente]       = useState(cotizacionExistente?.notas_cliente ?? '')
  const [notasInternas,      setNotasInternas]      = useState(cotizacionExistente?.notas_internas ?? '')
  const [descuentoGlobalPct, setDescuentoGlobalPct] = useState(cotizacionExistente?.descuento_global_pct ?? 0)
  const [costoEnvioUsd,      setCostoEnvioUsd]      = useState(cotizacionExistente?.costo_envio_usd ?? 0)
  const [items,              setItems]              = useState(
    (cotizacionExistente?.items ?? []).map(it => ({
      _key:          `item-${++_itemCounter}`,
      productoId:    it.producto_id,
      codigoSnap:    it.codigo_snap,
      nombreSnap:    it.nombre_snap,
      unidadSnap:    it.unidad_snap,
      cantidad:      Number(it.cantidad),
      precioUnitUsd: Number(it.precio_unit_usd),
      descuentoPct:  Number(it.descuento_pct),
    }))
  )

  const [errorGeneral,  setErrorGeneral]  = useState('')
  const [modalEnvio,    setModalEnvio]    = useState(false)
  const [cotizacionId,  setCotizacionId]  = useState(cotizacionExistente?.id ?? null)

  // Estado post-envío (para paso 4)
  const [enviada, setEnviada] = useState(false)
  const [numDisplay, setNumDisplay] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [waLoading, setWaLoading]   = useState(false)

  const { data: clientes      = [], refetch: refetchClientes } = useClientes()
  const { data: transportistas = [] } = useTransportistas()
  const { data: vendedores     = [] } = useVendedores()
  const { data: config = {} }  = useConfigNegocio()
  const guardarBorrador  = useGuardarBorrador()
  const enviarCotizacion = useEnviarCotizacion()
  const tasaHook         = useTasaCambio()

  const { subtotal, descuentoUsd, ivaUsd, totalUsd } = calcTotales(items, descuentoGlobalPct, costoEnvioUsd, config.iva_pct ?? 0)
  const totalBs = tasaHook.tasaEfectiva > 0 ? mulR(totalUsd, tasaHook.tasaEfectiva) : 0

  // Cliente seleccionado (para mostrar datos)
  const clienteSeleccionado = clientes.find(c => c.id === clienteId)

  // ── Agregar producto ─────────────────────────────────────────────────────
  function agregarProducto(p) {
    setItems(prev => {
      const idx = prev.findIndex(it => it.productoId === p.id)
      if (idx !== -1) {
        // Ya existe → sumar 1 a la cantidad
        return prev.map((it, i) => i === idx ? { ...it, cantidad: it.cantidad + 1 } : it)
      }
      return [...prev, {
        _key:          `item-${++_itemCounter}`,
        productoId:    p.id,
        codigoSnap:    p.codigo ?? '',
        nombreSnap:    p.nombre,
        unidadSnap:    p.unidad ?? 'und',
        cantidad:      1,
        precioUnitUsd: Number(p.precio_usd),
        descuentoPct:  0,
      }]
    })
  }

  function cambiarItem(idx, campo, valor) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [campo]: valor } : it))
  }

  function eliminarItem(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Navegación entre pasos ─────────────────────────────────────────────
  function siguiente() {
    setErrorGeneral('')
    if (paso === 1) {
      if (esSupervisor && !esEdicion && !vendedorId) { setErrorGeneral('Selecciona un vendedor para asignar la cotización'); return }
      if (!clienteId) { setErrorGeneral('Selecciona un cliente para continuar'); return }
      setPaso(2)
    } else if (paso === 2) {
      if (items.length === 0) { setErrorGeneral('Agrega al menos un producto'); return }
      setPaso(3)
    }
  }

  function anterior() {
    setErrorGeneral('')
    if (paso > 1 && paso < 4) setPaso(paso - 1)
  }

  // ── Guardar borrador ─────────────────────────────────────────────────────
  async function handleGuardar() {
    if (!clienteId) { setErrorGeneral('Selecciona un cliente'); return }
    if (items.length === 0) { setErrorGeneral('Agrega al menos un producto'); return }
    setErrorGeneral('')

    try {
      const id = await guardarBorrador.mutateAsync({
        cotizacionId,
        campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd, ivaPct: config.iva_pct ?? 0 },
        items,
      })
      setCotizacionId(id)
      onGuardado?.()
    } catch (e) {
      setErrorGeneral(e.message ?? 'Error al guardar')
    }
  }

  // ── Enviar cotización ────────────────────────────────────────────────────
  async function handleEnviar(tasaBcv) {
    if (!clienteId) { setErrorGeneral('Selecciona un cliente'); setModalEnvio(false); return }
    if (items.length === 0) { setErrorGeneral('Agrega al menos un producto'); setModalEnvio(false); return }

    try {
      let id = cotizacionId
      // Guardar primero si no tiene ID
      if (!id) {
        id = await guardarBorrador.mutateAsync({
          cotizacionId,
          campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd, ivaPct: config.iva_pct ?? 0 },
          items,
        })
        setCotizacionId(id)
      } else {
        // Actualizar borrador con datos actuales antes de enviar
        await guardarBorrador.mutateAsync({
          cotizacionId: id,
          campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd, ivaPct: config.iva_pct ?? 0 },
          items,
        })
      }
      await enviarCotizacion.mutateAsync({ cotizacionId: id, tasaBcv })
      setModalEnvio(false)

      // Obtener número de cotización para mostrar en confirmación
      const tabla = esSupervisor ? 'cotizaciones' : 'v_cotizaciones_vendedor'
      const { data: cotEnviada } = await supabase
        .from(tabla).select('numero, version').eq('id', id).single()
      if (cotEnviada) {
        const nd = cotEnviada.version > 1
          ? `COT-${String(cotEnviada.numero).padStart(5, '0')} Rev.${cotEnviada.version}`
          : `COT-${String(cotEnviada.numero).padStart(5, '0')}`
        setNumDisplay(nd)
      }

      setEnviada(true)
      setPaso(4)

      // Notificar al supervisor si el vendedor usó un cliente ajeno
      const clienteUsado = clientes.find(c => c.id === clienteId)
      if (clienteUsado && perfil?.rol !== 'supervisor' && clienteUsado.vendedor_id && clienteUsado.vendedor_id !== perfil?.id) {
        const numCot = cotEnviada ? String(cotEnviada.numero).padStart(5, '0') : '—'
        notifyClienteAjeno(
          perfil?.nombre || 'Vendedor',
          clienteUsado.nombre,
          clienteUsado.vendedor?.nombre || 'otro vendedor',
          numCot
        )
        sendPushNotification({
          title: 'Cliente Ajeno Usado',
          message: `${perfil?.nombre} creó cotización #${numCot} con ${clienteUsado.nombre} (cliente de ${clienteUsado.vendedor?.nombre || 'otro vendedor'})`,
          tag: `cliente-ajeno-${numCot}`,
          url: '/cotizaciones',
        })
      }
    } catch (e) {
      setErrorGeneral(e.message ?? 'Error al enviar')
      setModalEnvio(false)
    }
  }

  // ── Acciones post-envío (Paso 4) ─────────────────────────────────────────
  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const [{ generarPDF }, itemsRes, cotRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacionId).order('orden'),
        supabase.from('cotizaciones').select('*').eq('id', cotizacionId).single(),
      ])
      if (itemsRes.error) throw itemsRes.error
      if (cotRes.error) throw cotRes.error
      const vendedor = esSupervisor
        ? vendedores.find(v => v.id === vendedorId) || null
        : perfil
      await generarPDF({
        cotizacion: { ...cotRes.data, cliente: clienteSeleccionado, vendedor },
        items: itemsRes.data ?? [],
        config,
      })
    } catch (err) {
      console.error('PDF error:', err)
    } finally {
      setPdfLoading(false)
    }
  }

  async function handleWhatsApp() {
    setWaLoading(true)
    try {
      const [{ generarPDF }, itemsRes, cotRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacionId).order('orden'),
        supabase.from('cotizaciones').select('*').eq('id', cotizacionId).single(),
      ])
      if (itemsRes.error) throw itemsRes.error
      if (cotRes.error) throw cotRes.error

      const vendedor = esSupervisor
        ? vendedores.find(v => v.id === vendedorId) || null
        : perfil
      const pdfBlob = await generarPDF({
        cotizacion: { ...cotRes.data, cliente: clienteSeleccionado, vendedor },
        items: itemsRes.data ?? [],
        config,
        returnBlob: true,
      })

      const mensaje = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: clienteSeleccionado?.nombre,
        numDisplay,
        totalUsd,
        validaHasta,
        nombreVendedor: vendedor?.nombre || perfil?.nombre,
        items: itemsRes.data ?? [],
      })

      await compartirPorWhatsApp({
        pdfBlob,
        pdfFilename: `${numDisplay.replace(/\s+/g, '_')}.pdf`,
        telefono: clienteSeleccionado?.telefono,
        mensaje,
      })
    } catch (err) {
      console.error('WhatsApp error:', err)
      const texto = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: clienteSeleccionado?.nombre,
        numDisplay,
        totalUsd,
        validaHasta,
        nombreVendedor: perfil?.nombre,
      })
      window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
    } finally {
      setWaLoading(false)
    }
  }

  const cargando = guardarBorrador.isPending || enviarCotizacion.isPending
  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400'

  return (
    <div className="min-h-full bg-slate-50">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 md:py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-2 max-w-6xl mx-auto">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {paso < 4 && (
              <button onClick={paso === 1 ? onVolver : anterior}
                className="p-1.5 sm:p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors shrink-0">
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 className="font-bold text-slate-800 text-sm sm:text-base md:text-lg truncate">
              {paso === 4 ? 'Cotización enviada' :
               esEdicion
                ? cotizacionExistente.version > 1
                  ? `Editar Rev.${cotizacionExistente.version}`
                  : `Editar borrador`
                : 'Nueva cotización'}
            </h2>
          </div>

          {paso < 4 && <StepIndicator paso={paso} />}
        </div>
      </div>

      {/* ── Contenido por paso ─────────────────────────────────────────── */}
      <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-3 sm:space-y-4 md:space-y-6">

        {/* Error general */}
        {errorGeneral && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertCircle size={15} className="shrink-0" />
            {errorGeneral}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 1: Seleccionar o crear cliente                           */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 1 && (
          <div className="space-y-4">
            {/* Selector de vendedor — solo supervisor al crear (no editar) */}
            {esSupervisor && !esEdicion && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
                <SectionH3 icon={Tag}>Asignar a vendedor</SectionH3>
                <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-2">
                  {vendedores.map(v => {
                    const sel = vendedorId === v.id
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVendedorId(v.id)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 transition-all text-sm font-semibold ${
                          sel ? 'border-primary bg-primary-light text-primary' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: v.color || '#94a3b8' }}
                        />
                        {v.nombre}
                      </button>
                    )
                  })}
                </div>
                {!vendedorId && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle size={11} /> Selecciona a quién se le asignará esta cotización
                  </p>
                )}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <SectionH3 icon={User}>Seleccionar cliente</SectionH3>
                <button onClick={() => setShowCrearCliente(!showCrearCliente)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
                  <UserPlus size={13} /> {showCrearCliente ? 'Cancelar' : 'Nuevo cliente'}
                </button>
              </div>

              {/* Crear cliente completo (formulario inline) */}
              {showCrearCliente && (
                <div className="bg-emerald-50/50 border border-emerald-200 rounded-2xl p-4">
                  <h4 className="font-bold text-emerald-800 text-sm flex items-center gap-1.5 mb-3">
                    <UserPlus size={14} /> Registrar nuevo cliente
                  </h4>
                  <ClienteForm
                    compact
                    onSuccess={(nuevo) => {
                      refetchClientes()
                      setClienteId(nuevo.id)
                      setShowCrearCliente(false)
                    }}
                    onCancel={() => setShowCrearCliente(false)}
                  />
                </div>
              )}

              {/* Seleccionar de lista */}
              {!showCrearCliente && (
                <div className="space-y-3">
                  <ClienteSelector
                    clientes={clientes}
                    clienteId={clienteId}
                    onSelect={setClienteId}
                  />

                  {/* Vista previa del cliente seleccionado */}
                  {clienteSeleccionado && (
                    <div className="bg-primary-light/30 border border-primary-focus/30 rounded-xl p-3 sm:p-4">
                      <div className="grid grid-cols-1 xs:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
                        {clienteSeleccionado.rif_cedula && (
                          <span className="flex items-center gap-1.5"><Hash size={11} className="text-slate-400" /> {clienteSeleccionado.rif_cedula}</span>
                        )}
                        {clienteSeleccionado.telefono && (
                          <span className="flex items-center gap-1.5"><Phone size={11} className="text-slate-400" /> {clienteSeleccionado.telefono}</span>
                        )}
                        {clienteSeleccionado.email && (
                          <span className="flex items-center gap-1.5"><Mail size={11} className="text-slate-400" /> {clienteSeleccionado.email}</span>
                        )}
                        {clienteSeleccionado.direccion && (
                          <span className="flex items-center gap-1.5 col-span-2"><MapPin size={11} className="text-slate-400" /> {clienteSeleccionado.direccion}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Alerta: cliente de otro vendedor */}
                  {clienteSeleccionado && perfil?.rol !== 'supervisor' && clienteSeleccionado.vendedor_id && clienteSeleccionado.vendedor_id !== perfil?.id && (
                    <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                      <AlertCircle size={16} className="text-amber-500 shrink-0" />
                      <p className="text-xs text-amber-700">
                        Este cliente está asignado a <strong>{clienteSeleccionado.vendedor?.nombre || 'otro vendedor'}</strong>.
                        Puedes continuar, pero se notificará al supervisor al enviar la cotización.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Botón siguiente */}
            <div className="flex justify-end">
              <button onClick={siguiente}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 text-white font-bold text-sm rounded-xl transition-all shadow-lg active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                Siguiente: Productos <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 2: Agregar productos                                      */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 2 && (
          <div className="space-y-4">
            {/* Mini resumen del cliente */}
            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-2 text-sm">
              <User size={14} className="text-primary shrink-0" />
              <span className="font-medium text-slate-700">{clienteSeleccionado?.nombre ?? 'Sin cliente'}</span>
              {clienteSeleccionado?.tipo_cliente && (
                <span className="text-xs text-slate-400 capitalize">· {clienteSeleccionado.tipo_cliente}</span>
              )}
            </div>

            {/* Split: catálogo izquierda + cesta derecha */}
            <div className="flex flex-col lg:flex-row gap-4 items-start">

              {/* ── Catálogo de productos ── */}
              <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 p-3 sm:p-5 space-y-3 sm:space-y-4">
                <SectionH3 icon={Package}>Agregar productos</SectionH3>
                <BuscadorProductos onAgregar={agregarProducto} itemsAgregados={items} tasa={tasaHook.tasaEfectiva} />
              </div>

              {/* ── Cesta flotante ── */}
              <div className="w-full lg:w-80 shrink-0 lg:sticky lg:top-[73px]">
                <CestaPanel
                  items={items}
                  onCambiar={cambiarItem}
                  onEliminar={eliminarItem}
                  subtotal={subtotal}
                  tasa={tasaHook.tasaEfectiva}
                  onSiguiente={siguiente}
                  onAnterior={anterior}
                />
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 3: Resumen, descuentos, notas y envío                     */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 3 && (
          <div className="space-y-4">
            {/* Resumen de cliente + items */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
              <SectionH3 icon={User}>Resumen</SectionH3>
              <div className="flex items-center gap-2 text-sm">
                <User size={14} className="text-primary" />
                <span className="font-medium text-slate-700">{clienteSeleccionado?.nombre}</span>
                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full capitalize">{clienteSeleccionado?.tipo_cliente}</span>
              </div>
              <div className="text-xs text-slate-500">
                {items.length} producto{items.length !== 1 ? 's' : ''} · Subtotal: <strong>{fmtUsd(subtotal)}</strong>
              </div>
            </div>

            {/* Envío y validez */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
              <SectionH3 icon={Truck}>Envío y validez</SectionH3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Transportista</label>
                  <CustomSelect
                    options={[
                      { value: '', label: 'Sin transportista' },
                      ...transportistas.map(t => ({
                        value: t.id,
                        label: t.nombre,
                        sub: [t.zona_cobertura, t.tarifa_base > 0 ? `$${Number(t.tarifa_base).toFixed(2)}` : ''].filter(Boolean).join(' · ') || undefined,
                      })),
                    ]}
                    value={transportistaId}
                    onChange={val => setTransportistaId(val)}
                    placeholder="Sin transportista"
                    icon={Truck}
                    disabled={cargando}
                    clearable
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Válida hasta</label>
                  <input type="date" value={validaHasta} onChange={e => setValidaHasta(e.target.value)}
                    min={getLocalISODate()} className={inputCls} disabled={cargando} />
                </div>
              </div>
            </div>

            {/* Descuentos y totales */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
              <SectionH3 icon={DollarSign}>Descuentos y totales</SectionH3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Descuento global (%)</label>
                    <input type="number" min="0" max="100" step="0.5"
                      value={descuentoGlobalPct}
                      onChange={e => setDescuentoGlobalPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                      onFocus={e => e.target.select()}
                      className={inputCls} disabled={cargando} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Costo de envío (USD)</label>
                    <input type="number" min="0" step="0.01"
                      value={costoEnvioUsd}
                      onChange={e => setCostoEnvioUsd(Math.max(0, Number(e.target.value)))}
                      onFocus={e => e.target.select()}
                      className={inputCls} disabled={cargando} />
                  </div>
                </div>

                {/* Resumen numérico */}
                <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Subtotal</span>
                    <div className="text-right">
                      <span className="font-medium">{fmtUsd(subtotal)}</span>
                      {tasaHook.tasaEfectiva > 0 && <p className="text-[10px] text-slate-400">{fmtBs(usdToBs(subtotal, tasaHook.tasaEfectiva))}</p>}
                    </div>
                  </div>
                  {descuentoUsd > 0 && (
                    <div className="flex justify-between text-sm text-emerald-600">
                      <span>Descuento ({descuentoGlobalPct}%)</span>
                      <span>-{fmtUsd(descuentoUsd)}</span>
                    </div>
                  )}
                  {ivaUsd > 0 && (
                    <div className="flex justify-between text-sm text-blue-600">
                      <span>IVA ({config.iva_pct}%)</span>
                      <span>+{fmtUsd(ivaUsd)}</span>
                    </div>
                  )}
                  {costoEnvioUsd > 0 && (
                    <div className="flex justify-between text-sm text-slate-600">
                      <span>Envío</span>
                      <span>{fmtUsd(costoEnvioUsd)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-slate-800 text-lg border-t border-slate-200 pt-2 mt-2">
                    <span>TOTAL</span>
                    <span>{fmtUsd(totalUsd)}</span>
                  </div>
                  {tasaHook.tasaEfectiva > 0 && totalUsd > 0 && (
                    <div className="flex justify-between text-sm text-slate-500 pt-1">
                      <span className="flex items-center gap-1">
                        <DollarSign size={12} className="text-slate-400" />
                        Equiv. Bs
                      </span>
                      <span className="font-semibold text-slate-700">
                        Bs {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalBs)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Notas */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
              <SectionH3 icon={StickyNote}>Notas</SectionH3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Notas para el cliente <span className="text-slate-400">(aparece en PDF)</span>
                  </label>
                  <textarea value={notasCliente} onChange={e => setNotasCliente(e.target.value)}
                    rows={3} placeholder="Ej: Precios válidos por 15 días..."
                    className={`${inputCls} resize-none`} disabled={cargando} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Notas internas <span className="text-slate-400">(no aparece en PDF)</span>
                  </label>
                  <textarea value={notasInternas} onChange={e => setNotasInternas(e.target.value)}
                    rows={3} placeholder="Observaciones internas..."
                    className={`${inputCls} resize-none`} disabled={cargando} />
                </div>
              </div>
            </div>

            {/* Navegación paso 3 */}
            <div className="flex flex-col gap-3 pb-8">
              {/* Botones de acción principales — arriba en móvil */}
              <div className="flex flex-col sm:flex-row gap-3 order-1 sm:order-2">
                <button onClick={handleGuardar} disabled={cargando}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors disabled:opacity-50 w-full sm:w-auto">
                  {guardarBorrador.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Guardar borrador
                </button>
                <button onClick={() => { setErrorGeneral(''); handleEnviar(tasaHook.tasaEfectiva) }}
                  disabled={cargando || tasaHook.tasaEfectiva <= 0}
                  className="flex items-center justify-center gap-2 px-6 py-3 text-white font-bold text-sm rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 w-full sm:w-auto"
                  style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                  {enviarCotizacion.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Enviar cotización
                </button>
              </div>
              <button onClick={anterior} disabled={cargando}
                className="flex items-center justify-center gap-2 px-5 py-3 border border-slate-200 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50 order-2 sm:order-1 sm:self-start">
                <ArrowLeft size={16} /> Volver
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 4: Confirmación post-envío                                */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 4 && (
          <div className="flex items-center justify-center min-h-[50vh] px-2">
            <div className="bg-white rounded-2xl border border-emerald-200 shadow-lg overflow-hidden max-w-md w-full">

              {/* Strip de éxito */}
              <div className="relative h-20 sm:h-24 flex flex-col items-center justify-center gap-1"
                style={{ background: 'linear-gradient(135deg, #065f46ee 0%, #059669aa 100%)' }}>
                <div className="absolute inset-0 opacity-10 pointer-events-none"
                  style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
                <div className="relative z-10 w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.25)', border: '2px solid rgba(255,255,255,0.5)' }}>
                  <CheckCircle size={24} color="white" />
                </div>
              </div>

              <div className="p-5 sm:p-6 md:p-8 space-y-4 sm:space-y-5 text-center">
                <div>
                  <h3 className="text-xl font-black text-slate-800">Cotización enviada</h3>
                  {numDisplay && (
                    <p className="font-bold text-lg font-mono mt-1" style={{ color: '#1B365D' }}>{numDisplay}</p>
                  )}
                </div>

                <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm text-left">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cliente</span>
                    <span className="font-medium text-slate-800">{clienteSeleccionado?.nombre}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total</span>
                    <span className="font-bold text-slate-800">{fmtUsd(totalUsd)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Items</span>
                    <span className="text-slate-700">{items.length} producto{items.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>

                {/* Acciones */}
                <div className="space-y-3">
                  <div className="flex flex-col xs:flex-row gap-2 sm:gap-3">
                    <button onClick={descargarPDF} disabled={pdfLoading}
                      className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-sm rounded-xl transition-colors disabled:opacity-50">
                      {pdfLoading
                        ? <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        : <FileDown size={16} />}
                      Descargar PDF
                    </button>
                    <button onClick={handleWhatsApp} disabled={waLoading}
                      className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-sm rounded-xl transition-colors disabled:opacity-50">
                      {waLoading
                        ? <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                        : <MessageCircle size={16} />}
                      WhatsApp
                    </button>
                  </div>

                  <button onClick={onGuardado}
                    className="w-full py-3 text-white font-bold text-sm rounded-xl transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                    <Plus size={16} /> Nueva cotización
                  </button>

                  <button onClick={onVolver}
                    className="w-full py-2.5 text-slate-500 hover:text-slate-700 font-medium text-sm transition-colors">
                    Volver a la lista
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Modal de envío */}
      <ModalEnvio
        isOpen={modalEnvio}
        onConfirm={handleEnviar}
        onCancel={() => setModalEnvio(false)}
        cargando={enviarCotizacion.isPending}
        tasaHook={tasaHook}
      />
    </div>
  )
}
