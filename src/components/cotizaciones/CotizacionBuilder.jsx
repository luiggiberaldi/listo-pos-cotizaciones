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
  LayoutGrid, LayoutList,
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
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../../utils/format'
import { getLocalISODate }     from '../../utils/dateHelpers'
import supabase from '../../services/supabase/client'
import CustomSelect from '../ui/CustomSelect'
import ClienteForm from '../clientes/ClienteForm'

// ─── Helpers ─────────────────────────────────────────────────────────────────
let _itemCounter = 0

function calcTotales(items, descGlobalPct, costoEnvio) {
  const subtotal    = round2(items.reduce((s, it) =>
    round2(s + round2(it.cantidad * it.precioUnitUsd * (1 - it.descuentoPct / 100))), 0))
  const descuentoUsd = round2(subtotal * (Number(descGlobalPct) || 0) / 100)
  const totalUsd     = round2(subtotal - descuentoUsd + (Number(costoEnvio) || 0))
  return { subtotal, descuentoUsd, totalUsd }
}

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
              isActive ? 'bg-primary text-white shadow-sm' :
              isDone   ? 'bg-emerald-100 text-emerald-700' :
                         'bg-slate-100 text-slate-400'
            }`}>
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
    <tr className="border-b border-slate-100 hover:bg-slate-50/50">
      <td className="py-2 px-3 text-sm text-slate-800 max-w-[180px]">
        <div className="font-medium truncate">{item.nombreSnap}</div>
        {item.codigoSnap && <div className="text-xs text-slate-400 font-mono">{item.codigoSnap}</div>}
      </td>
      <td className="py-2 px-2 text-xs text-slate-400">{item.unidadSnap}</td>
      <td className="py-2 px-2">
        <input type="number" min="0.01" step="0.01"
          value={item.cantidad}
          onChange={e => onChange(idx, 'cantidad', Math.max(0.01, Number(e.target.value)))}
          onFocus={e => e.target.select()}
          className="w-20 px-2 py-1 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
        />
      </td>
      <td className="py-2 px-2">
        <input type="number" min="0" step="0.01"
          value={item.precioUnitUsd}
          onChange={e => onChange(idx, 'precioUnitUsd', Math.max(0, Number(e.target.value)))}
          onFocus={e => e.target.select()}
          className="w-24 px-2 py-1 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
        />
        {tasa > 0 && <p className="text-[10px] text-slate-400 text-right pr-1">{fmtBs(usdToBs(item.precioUnitUsd, tasa))}</p>}
      </td>
      <td className="py-2 px-2">
        <div className="flex items-center">
          <input type="number" min="0" max="100" step="0.5"
            value={item.descuentoPct}
            onChange={e => onChange(idx, 'descuentoPct', Math.min(100, Math.max(0, Number(e.target.value))))}
            onFocus={e => e.target.select()}
            className="w-16 px-2 py-1 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
          />
          <span className="ml-1 text-xs text-slate-400">%</span>
        </div>
      </td>
      <td className="py-2 px-2 text-right">
        <p className="text-sm font-semibold text-slate-800">{fmtUsd(lineTotal)}</p>
        {tasa > 0 && <p className="text-[10px] text-slate-400">{fmtBs(usdToBs(lineTotal, tasa))}</p>}
      </td>
      <td className="py-2 px-2">
        <button onClick={() => onDelete(idx)}
          className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
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
  const [vistaGrid, setVistaGrid] = useState(true)
  const [pagina, setPagina] = useState(0)
  const { data: todosProductos = [], isLoading } = useInventario({})
  const { data: categorias = [] } = useCategorias()

  // Filtrar localmente para búsqueda instantánea
  const filtrados = todosProductos.filter(p => {
    const coincideTexto = !texto.trim() ||
      p.nombre.toLowerCase().includes(texto.toLowerCase()) ||
      (p.codigo ?? '').toLowerCase().includes(texto.toLowerCase())
    const coincideCat = !catActiva || p.categoria === catActiva
    return coincideTexto && coincideCat
  })

  // IDs ya agregados para marcar visualmente
  const idsAgregados = new Set(itemsAgregados.map(it => it.productoId))

  // Paginación
  const totalPags = Math.ceil(filtrados.length / PRODUCTOS_POR_PAGINA)
  const paginados = filtrados.slice(pagina * PRODUCTOS_POR_PAGINA, (pagina + 1) * PRODUCTOS_POR_PAGINA)

  // Reset página al cambiar filtros
  function cambiarTexto(val) { setTexto(val); setPagina(0) }
  function cambiarCat(val) { setCatActiva(val); setPagina(0) }

  return (
    <div className="space-y-3">
      {/* Barra superior: búsqueda + toggle vista */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={texto}
            onChange={e => cambiarTexto(e.target.value)}
            placeholder="Buscar por nombre o código..."
          className="w-full pl-10 pr-10 py-3 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400 transition-all"
          autoFocus
        />
        {texto && (
          <button type="button" onClick={() => cambiarTexto('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>
      {/* Toggle vista cuadrícula / lista */}
      <div className="flex bg-slate-100 rounded-lg p-0.5">
        <button type="button" onClick={() => setVistaGrid(true)}
          className={`p-2 rounded-md transition-all ${vistaGrid ? 'bg-white shadow-sm text-primary' : 'text-slate-400 hover:text-slate-600'}`}
          title="Cuadrícula">
          <LayoutGrid size={16} />
        </button>
        <button type="button" onClick={() => setVistaGrid(false)}
          className={`p-2 rounded-md transition-all ${!vistaGrid ? 'bg-white shadow-sm text-primary' : 'text-slate-400 hover:text-slate-600'}`}
          title="Lista">
          <LayoutList size={16} />
        </button>
      </div>
      </div>

      {/* Chips de categoría */}
      {categorias.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => cambiarCat('')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              !catActiva
                ? 'bg-primary text-white shadow-sm'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}>
            Todos
          </button>
          {categorias.map(cat => (
            <button key={cat} type="button" onClick={() => cambiarCat(catActiva === cat ? '' : cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                catActiva === cat
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}>
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Estado de carga */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Resultados */}
      {!isLoading && paginados.length > 0 && (
        <>
          {vistaGrid ? (
            /* ── Vista cuadrícula ── */
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
              {paginados.map(p => {
                const yaAgregado = idsAgregados.has(p.id)
                const sinStock = p.stock_actual != null && p.stock_actual <= 0
                const sinPrecio = !p.precio_usd || Number(p.precio_usd) <= 0
                const bloqueado = sinStock || sinPrecio
                return (
                  <button key={p.id} type="button" onClick={() => !bloqueado && onAgregar(p)}
                    disabled={bloqueado}
                    title={sinPrecio ? 'Sin precio — no se puede cotizar' : undefined}
                    className={`bg-white rounded-xl border p-3 text-left transition-all group flex flex-col gap-2 ${
                      bloqueado
                        ? 'opacity-50 cursor-not-allowed border-slate-100'
                        : yaAgregado
                          ? 'border-emerald-200 bg-emerald-50/30 hover:shadow-md'
                          : 'border-slate-200 hover:border-primary hover:shadow-md active:scale-[0.98]'
                    }`}>
                    {/* Imagen/icono + badge */}
                    <div className="flex items-center justify-between">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden ${
                        yaAgregado ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400 group-hover:bg-primary-light group-hover:text-primary'
                      } transition-colors`}>
                        {p.imagen_url ? (
                          <img src={p.imagen_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : yaAgregado ? <CheckCircle size={16} /> : <Package size={16} />}
                      </div>
                      {p.stock_actual != null && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          sinStock ? 'bg-red-100 text-red-600' :
                          p.stock_actual <= (p.stock_minimo ?? 0) ? 'bg-amber-100 text-amber-600' :
                          'bg-emerald-100 text-emerald-600'
                        }`}>
                          {sinStock ? 'Agotado' : p.stock_actual}
                        </span>
                      )}
                    </div>
                    {/* Nombre */}
                    <p className="text-xs font-semibold text-slate-800 line-clamp-2 leading-tight group-hover:text-primary transition-colors">
                      {p.nombre}
                    </p>
                    {/* Código + unidad */}
                    <div className="flex items-center gap-1 mt-auto">
                      {p.codigo && <span className="text-[10px] font-mono text-slate-400 truncate">{p.codigo}</span>}
                      <span className="text-[10px] text-slate-300">·</span>
                      <span className="text-[10px] text-slate-400">{p.unidad}</span>
                    </div>
                    {/* Precio */}
                    <div>
                      <p className="text-sm font-bold text-slate-800">{fmtUsd(p.precio_usd)}</p>
                      {tasa > 0 && <p className="text-[10px] text-slate-400">{fmtBs(usdToBs(p.precio_usd, tasa))}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            /* ── Vista lista ── */
            <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
              {paginados.map(p => {
                const yaAgregado = idsAgregados.has(p.id)
                const sinStock = p.stock_actual != null && p.stock_actual <= 0
                const sinPrecio = !p.precio_usd || Number(p.precio_usd) <= 0
                const bloqueado = sinStock || sinPrecio
                return (
                  <button key={p.id} type="button" onClick={() => !bloqueado && onAgregar(p)}
                    disabled={bloqueado}
                    title={sinPrecio ? 'Sin precio — no se puede cotizar' : undefined}
                    className={`w-full flex items-center gap-3 px-3.5 py-3 text-left transition-all group ${
                      bloqueado
                        ? 'opacity-50 cursor-not-allowed bg-slate-50'
                        : yaAgregado
                          ? 'bg-emerald-50/30 hover:bg-emerald-50'
                          : 'bg-white hover:bg-primary-light/40 active:scale-[0.995]'
                    }`}>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden ${
                      yaAgregado ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {p.imagen_url ? (
                        <img src={p.imagen_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : yaAgregado ? <CheckCircle size={16} /> : <Package size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-primary transition-colors">{p.nombre}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {p.codigo && <span className="text-[11px] font-mono text-slate-400">{p.codigo}</span>}
                        <span className="text-[11px] text-slate-400">· {p.unidad}</span>
                        {p.categoria && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{p.categoria}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-slate-800">{fmtUsd(p.precio_usd)}</p>
                      {tasa > 0 && <p className="text-[10px] text-slate-400">{fmtBs(usdToBs(p.precio_usd, tasa))}</p>}
                      {p.stock_actual != null && (
                        <p className={`text-[10px] font-medium ${
                          sinStock ? 'text-red-500' :
                          p.stock_actual <= (p.stock_minimo ?? 0) ? 'text-amber-500' :
                          'text-emerald-600'
                        }`}>
                          {sinStock ? 'Agotado' : `Stock: ${p.stock_actual}`}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Paginación */}
          {totalPags > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-slate-400">
                {filtrados.length} producto{filtrados.length !== 1 ? 's' : ''}
                {' · '}Pág. {pagina + 1}/{totalPags}
              </p>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPagina(p => p - 1)} disabled={pagina === 0}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                  <ArrowLeft size={13} />
                </button>
                {Array.from({ length: Math.min(totalPags, 5) }).map((_, i) => {
                  let num
                  if (totalPags <= 5) num = i
                  else if (pagina < 3) num = i
                  else if (pagina > totalPags - 4) num = totalPags - 5 + i
                  else num = pagina - 2 + i
                  return (
                    <button key={num} type="button" onClick={() => setPagina(num)}
                      className={`w-8 h-8 text-xs font-semibold rounded-lg transition-all ${
                        num === pagina
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-slate-500 hover:bg-slate-100'
                      }`}>
                      {num + 1}
                    </button>
                  )
                })}
                <button type="button" onClick={() => setPagina(p => p + 1)} disabled={pagina >= totalPags - 1}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          )}

          {/* Contador solo si 1 página */}
          {totalPags <= 1 && (
            <p className="text-[11px] text-slate-400 text-right">
              {filtrados.length} producto{filtrados.length !== 1 ? 's' : ''}
            </p>
          )}
        </>
      )}

      {/* Sin resultados */}
      {!isLoading && filtrados.length === 0 && (texto || catActiva) && (
        <div className="text-center py-8">
          <Search size={24} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-400 font-medium">Sin resultados</p>
          <p className="text-xs text-slate-300 mt-1">Prueba con otro término o categoría</p>
          <button type="button" onClick={() => { cambiarTexto(''); cambiarCat('') }}
            className="text-xs text-primary hover:underline mt-2">
            Limpiar filtros
          </button>
        </div>
      )}

      {/* Estado vacío inicial */}
      {!isLoading && filtrados.length === 0 && !texto && !catActiva && (
        <div className="text-center py-8">
          <Package size={24} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-400 font-medium">No hay productos en el inventario</p>
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

  const { subtotal, descuentoUsd, totalUsd } = calcTotales(items, descuentoGlobalPct, costoEnvioUsd)
  const totalBs = tasaHook.tasaEfectiva > 0 ? mulR(totalUsd, tasaHook.tasaEfectiva) : 0

  // Cliente seleccionado (para mostrar datos)
  const clienteSeleccionado = clientes.find(c => c.id === clienteId)

  // ── Agregar producto ─────────────────────────────────────────────────────
  function agregarProducto(p) {
    setItems(prev => [...prev, {
      _key:          `item-${++_itemCounter}`,
      productoId:    p.id,
      codigoSnap:    p.codigo ?? '',
      nombreSnap:    p.nombre,
      unidadSnap:    p.unidad ?? 'und',
      cantidad:      1,
      precioUnitUsd: Number(p.precio_usd),
      descuentoPct:  0,
    }])
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
        campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd },
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
          campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd },
          items,
        })
        setCotizacionId(id)
      } else {
        // Actualizar borrador con datos actuales antes de enviar
        await guardarBorrador.mutateAsync({
          cotizacionId: id,
          campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd },
          items,
        })
      }
      await enviarCotizacion.mutateAsync({ cotizacionId: id, tasaBcv })
      setModalEnvio(false)

      // Obtener número de cotización para mostrar en confirmación
      const { data: cotEnviada } = await supabase
        .from('cotizaciones').select('numero, version').eq('id', id).single()
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
      const [{ generarPDF }, itemsRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacionId).order('orden'),
      ])
      if (itemsRes.error) throw itemsRes.error
      // Construir objeto cotizacion con vendedor (para color) y cliente
      const vendedor = esSupervisor
        ? vendedores.find(v => v.id === vendedorId) || null
        : perfil
      await generarPDF({
        cotizacion: { ...cotizacionExistente, cliente: clienteSeleccionado, vendedor },
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
      const [{ generarPDF }, itemsRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacionId).order('orden'),
      ])
      if (itemsRes.error) throw itemsRes.error

      const vendedor = esSupervisor
        ? vendedores.find(v => v.id === vendedorId) || null
        : perfil
      const pdfBlob = await generarPDF({
        cotizacion: { ...cotizacionExistente, cliente: clienteSeleccionado, vendedor },
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
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 md:py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-2 max-w-6xl mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            {paso < 4 && (
              <button onClick={paso === 1 ? onVolver : anterior}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors shrink-0">
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 className="font-bold text-slate-800 text-base md:text-lg truncate">
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
      <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-4 md:space-y-6">

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
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
                  <Tag size={14} className="text-slate-400" /> Asignar a vendedor
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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

            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
                  <User size={14} className="text-slate-400" /> Seleccionar cliente
                </h3>
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
                    <div className="bg-primary-light/30 border border-primary-focus/30 rounded-xl p-4">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
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
                className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold text-sm rounded-xl transition-colors shadow-sm">
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

            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">
                Agregar productos
              </h3>
              <BuscadorProductos onAgregar={agregarProducto} itemsAgregados={items} tasa={tasaHook.tasaEfectiva} />

              {items.length > 0 && (
                <>
                  {/* Desktop: tabla */}
                  <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                        <th className="text-left py-2 px-3">Producto</th>
                        <th className="text-left py-2 px-2">Unidad</th>
                        <th className="text-right py-2 px-2">Cantidad</th>
                        <th className="text-right py-2 px-2">Precio USD</th>
                        <th className="text-right py-2 px-2">Desc.</th>
                        <th className="text-right py-2 px-2">Total</th>
                        <th className="py-2 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => (
                        <ItemLinea key={it._key} item={it} idx={idx}
                          onChange={cambiarItem} onDelete={eliminarItem} tasa={tasaHook.tasaEfectiva} />
                      ))}
                    </tbody>
                  </table>
                  </div>
                  {/* Móvil: cards */}
                  <div className="md:hidden space-y-3">
                    {items.map((it, idx) => (
                      <ItemCard key={it._key} item={it} idx={idx}
                        onChange={cambiarItem} onDelete={eliminarItem} tasa={tasaHook.tasaEfectiva} />
                    ))}
                  </div>

                  {/* Total parcial */}
                  <div className="flex justify-end">
                    <div className="bg-slate-50 rounded-xl px-4 py-2 text-sm">
                      <span className="text-slate-500">Subtotal: </span>
                      <span className="font-bold text-slate-800">{fmtUsd(subtotal)}</span>
                      {tasaHook.tasaEfectiva > 0 && (
                        <span className="text-slate-400 ml-1 text-xs">({fmtBs(usdToBs(subtotal, tasaHook.tasaEfectiva))})</span>
                      )}
                      <span className="text-slate-400 ml-2">({items.length} item{items.length !== 1 ? 's' : ''})</span>
                    </div>
                  </div>
                </>
              )}

              {items.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">
                  Busca y agrega productos a la cotización
                </p>
              )}
            </div>

            {/* Navegación */}
            <div className="flex justify-between gap-3">
              <button onClick={anterior}
                className="flex items-center gap-2 px-5 py-3 border border-slate-200 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors">
                <ArrowLeft size={16} /> Volver
              </button>
              <button onClick={siguiente}
                className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold text-sm rounded-xl transition-colors shadow-sm">
                Siguiente: Resumen <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 3: Resumen, descuentos, notas y envío                     */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 3 && (
          <div className="space-y-4">
            {/* Resumen de cliente + items */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
              <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">Resumen</h3>
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
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
                <Truck size={14} className="text-slate-400" /> Envío y validez
              </h3>
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
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">
                Descuentos y totales
              </h3>
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
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
                <StickyNote size={14} className="text-slate-400" /> Notas
              </h3>
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
            <div className="flex flex-col sm:flex-row justify-between gap-3 pb-8">
              <button onClick={anterior} disabled={cargando}
                className="flex items-center gap-2 px-5 py-3 border border-slate-200 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50">
                <ArrowLeft size={16} /> Volver
              </button>
              <div className="flex gap-3">
                <button onClick={handleGuardar} disabled={cargando}
                  className="flex items-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors disabled:opacity-50">
                  {guardarBorrador.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Guardar borrador
                </button>
                <button onClick={() => { setErrorGeneral(''); handleEnviar(tasaHook.tasaEfectiva) }}
                  disabled={cargando || tasaHook.tasaEfectiva <= 0}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold text-sm rounded-xl transition-colors shadow-sm disabled:opacity-50">
                  {enviarCotizacion.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Enviar cotización
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 4: Confirmación post-envío                                */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 4 && (
          <div className="flex items-center justify-center min-h-[50vh]">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-6 sm:p-8 max-w-md w-full text-center space-y-5">

              {/* Icono de éxito */}
              <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
                <CheckCircle size={32} className="text-emerald-500" />
              </div>

              <div>
                <h3 className="text-xl font-black text-slate-800">Cotización enviada</h3>
                {numDisplay && (
                  <p className="text-primary font-bold text-lg font-mono mt-1">{numDisplay}</p>
                )}
              </div>

              <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
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
                <div className="flex gap-3">
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
                  className="w-full py-3 bg-primary hover:bg-primary-hover text-white font-bold text-sm rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2">
                  <Plus size={16} /> Nueva cotización
                </button>

                <button onClick={onVolver}
                  className="w-full py-2.5 text-slate-500 hover:text-slate-700 font-medium text-sm transition-colors">
                  Volver a la lista
                </button>
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
