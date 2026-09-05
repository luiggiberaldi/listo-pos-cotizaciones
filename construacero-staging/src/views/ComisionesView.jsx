// src/views/ComisionesView.jsx
// Vista de comisiones para Jefes y Supervisores con paridad visual a Reportes
import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  DollarSign, Percent, FileText, Download, ChevronDown,
  Star, Loader2, X, Users, Briefcase, Printer, UserCheck, Globe, ArrowUpCircle
} from 'lucide-react'
import { useComisiones, useComisionesResumen } from '../hooks/useComisiones'
import { useVendedores } from '../hooks/useClientes'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import useAuthStore from '../store/useAuthStore'
import { fmtUsd, fmtBs } from '../utils/format'
import { getCorteSemanalRange } from '../utils/dateHelpers'
import PageHeader from '../components/ui/PageHeader'
import Skeleton from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { countUniqueDispatches } from '../utils/comisionUtils'
import DateRangeSelector from '../components/reportes/DateRangeSelector'
import CustomSelect from '../components/ui/CustomSelect'
import ConfirmModal from '../components/ui/ConfirmModal'
import ModalDetalleVendedor, { prepararComisionParaPDF } from '../components/reportes/ModalDetalleVendedor'
import supabase from '../services/supabase/client'

const round2 = value => Math.round((Number(value) || 0) * 100) / 100

function ResumenCard({ icon: Icon, label, value, sub, gradient, border }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.10)' }}
    >
      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-center gap-2.5 relative z-10">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={18} className="text-white" />
        </div>
        <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>{label}</p>
      </div>
      <div className="relative z-10">
        <p className="text-2xl font-black leading-tight text-white">{value}</p>
        {sub && <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{sub}</div>}
      </div>
    </div>
  )
}

// ─── Panel de designación del vendedor del día (exclusivo para jefe) ─────────
function PanelDesignacion({ perfil, vendedores }) {
  const esJefe = perfil?.rol === 'jefe'
  const hoy = new Date().toISOString().slice(0, 10)
  const proximoSabado = (() => {
    const d = new Date()
    const dias = (6 - d.getDay() + 7) % 7
    d.setDate(d.getDate() + dias)
    return d.toISOString().slice(0, 10)
  })()
  const [fecha, setFecha] = useState(proximoSabado)
  const [designado, setDesignado] = useState('')
  const [designaciones, setDesignaciones] = useState({})
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState(null)

  const cargarDesignaciones = useCallback(async () => {
    if (!esJefe) return
    try {
      setCargando(true)
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/comisiones/designacion?desde=${hoy}`), { headers })
      if (!res.ok) throw new Error('Error al cargar designaciones')
      const rows = await res.json()
      setDesignaciones(Object.fromEntries((rows || []).map(r => [r.fecha, r])))
    } catch (e) {
      console.error('Error cargando designaciones:', e)
    } finally {
      setCargando(false)
    }
  }, [esJefe, hoy])

  useEffect(() => { cargarDesignaciones() }, [cargarDesignaciones])

  useEffect(() => {
    setDesignado(designaciones[fecha]?.designado_id || '')
  }, [fecha, designaciones])

  const guardar = useCallback(async () => {
    if (!designado) {
      setMensaje({ tipo: 'error', texto: 'Selecciona el vendedor o supervisor designado.' })
      return
    }
    try {
      setGuardando(true)
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/comisiones/designacion'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ fecha, designado_id: designado })
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Error al designar')
      setDesignaciones(prev => ({ ...prev, [fecha]: json.designacion }))
      setMensaje({ tipo: 'ok', texto: `Designación guardada para ${fecha}. Aplica a los despachos creados ese día.` })
    } catch (e) {
      setMensaje({ tipo: 'error', texto: e.message || 'Error al designar' })
    } finally {
      setGuardando(false)
    }
  }, [designado, fecha])

  const [modalQuitar, setModalQuitar] = useState({ isOpen: false, fecha: '', nombre: '' })

  const fechaLegibleModal = useMemo(() => {
    if (!modalQuitar.fecha) return ''
    try {
      const parts = modalQuitar.fecha.split('-').map(Number)
      if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
        const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0)
        const str = d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        return str.charAt(0).toUpperCase() + str.slice(1)
      }
    } catch {}
    return modalQuitar.fecha
  }, [modalQuitar.fecha])

  const solicitarQuitar = useCallback((f, nombre) => {
    const fechaQuitar = f || fecha
    const nombreDesignado = nombre || designaciones[fechaQuitar]?.designado?.nombre || nombreElegido || ''
    setModalQuitar({
      isOpen: true,
      fecha: fechaQuitar,
      nombre: nombreDesignado
    })
  }, [fecha, designaciones, nombreElegido])

  const confirmarQuitar = useCallback(async () => {
    const fechaQuitar = modalQuitar.fecha
    if (!fechaQuitar) return
    try {
      setGuardando(true)
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/comisiones/designacion'), {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ fecha: fechaQuitar })
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Error al quitar la designación')
      setDesignaciones(prev => {
        const next = { ...prev }
        delete next[fechaQuitar]
        return next
      })
      setMensaje({ tipo: 'ok', texto: `Designación de ${fechaQuitar} eliminada correctamente.` })
    } catch (e) {
      setMensaje({ tipo: 'error', texto: e.message || 'Error al quitar la designación' })
      throw e
    } finally {
      setGuardando(false)
      setModalQuitar({ isOpen: false, fecha: '', nombre: '' })
    }
  }, [modalQuitar.fecha])

  if (!esJefe) return null

  const designadoDelDia = designaciones[fecha]
  const elegibles = (vendedores || []).filter(u => ['vendedor', 'supervisor'].includes(u.rol) && !u.es_externo)
  const nombreElegido = (vendedores || []).find(u => u.id === designado)?.nombre
  const esSabado = fecha ? new Date(`${fecha}T12:00:00`).getDay() === 6 : true
  const proximos = Object.values(designaciones)
    .filter(r => r?.fecha && r.designado)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .slice(0, 6)

  return (
    <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-emerald-200/80 p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-100">
            <Star size={14} className="text-emerald-600" />
          </div>
          <div>
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">Designado del día (sábado)</h3>
            <p className="text-[10px] text-slate-500">Ese día, el designado cobra el 0.5% de las ventas de los demás; el dueño del cliente cobra su % normal. No aplica a externos ni jefes.</p>
          </div>
        </div>
        {cargando && <Loader2 size={14} className="text-slate-400 animate-spin" />}
      </div>

      <div className="flex items-end gap-2.5 flex-wrap">
        <div className="flex flex-col">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1 ml-1">Fecha</span>
          <input
            type="date"
            value={fecha}
            min={hoy}
            onChange={e => { setFecha(e.target.value); setMensaje(null) }}
            className="bg-white px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-300 h-[38px]"
          />
        </div>

        <div className="flex flex-col w-64 min-w-[240px]">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1 ml-1">Designado</span>
          <CustomSelect
            options={elegibles.map(u => ({
              value: u.id,
              label: `${u.nombre} (${u.rol === 'supervisor' ? 'supervisor' : 'vendedor'})`
            }))}
            value={designado}
            onChange={val => { setDesignado(val); setMensaje(null) }}
            placeholder="Seleccionar asesor…"
            searchable
            clearable
          />
        </div>

        <button
          type="button"
          onClick={guardar}
          disabled={guardando || !designado}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-black shadow-sm active:scale-95 transition-all h-[38px]"
        >
          {guardando ? <Loader2 size={13} className="animate-spin" /> : <Star size={13} />}
          {designado && nombreElegido ? `Designar a ${nombreElegido}` : 'Designar'}
        </button>

        {designadoDelDia && (
          <button
            type="button"
            onClick={() => solicitarQuitar(fecha, designadoDelDia.designado?.nombre || nombreElegido)}
            disabled={guardando}
            className="flex items-center gap-1.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50 transition-all h-[38px]"
          >
            <X size={13} /> Quitar
          </button>
        )}
      </div>

      {!esSabado && (
        <p className="text-[11px] font-bold text-amber-600">⚠️ {fecha} no es sábado. El split solo aplica los sábados; la designación se guarda igualmente.</p>
      )}

      {designadoDelDia?.designado && (
        <p className="text-xs text-slate-600">
          <span className="font-bold text-emerald-700">Designado actual:</span>{' '}
          {designadoDelDia.designado?.nombre || designadoDelDia.designado_id}
          {designadoDelDia.designado?.rol ? ` · ${designadoDelDia.designado.rol}` : ''}
        </p>
      )}

      {proximos.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {proximos.map(r => (
            <span key={r.fecha} className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-full pl-2.5 pr-1.5 py-1 text-[10px] font-bold">
              {r.fecha.slice(5)} · {r.designado?.nombre || r.designado_id}
              <button
                type="button"
                onClick={() => solicitarQuitar(r.fecha, r.designado?.nombre)}
                disabled={guardando}
                className="hover:bg-emerald-200 rounded-full p-0.5 disabled:opacity-40"
                title="Quitar designación"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {mensaje && (
        <p className={`text-xs font-bold ${mensaje.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{mensaje.texto}</p>
      )}

      <ConfirmModal
        isOpen={modalQuitar.isOpen}
        onClose={() => setModalQuitar({ isOpen: false, fecha: '', nombre: '' })}
        onConfirm={confirmarQuitar}
        title="¿Quitar designación de guardia?"
        message={`¿Confirmas que deseas anular la designación para el ${fechaLegibleModal}?`}
        details={
          modalQuitar.nombre
            ? `Asesor asignado: ${modalQuitar.nombre}. Los despachos de esta fecha no aplicarán el split del 0.5% y regresarán al esquema de comisiones habitual.`
            : 'Los despachos registrados en esta fecha volverán al esquema habitual de comisiones sin split de guardia.'
        }
        confirmText="Quitar designación"
        cancelText="Mantener designación"
        variant="warning"
      />
    </div>
  )
}

// ─── Vista Principal ────────────────────────────────────────────────────────
export default function ComisionesView() {
  const perfil = useAuthStore(state => state.perfil)
  const esPrivilegiado = ['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(perfil?.rol)

  // Rango inicial: Corte semanal vigente (viernes–jueves)
  const [rango, setRango] = useState(() => {
    const r = getCorteSemanalRange(0)
    return { from: r.from, to: r.to }
  })
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [formatoReporte, setFormatoReporte] = useState('detallado')
  const [ajustesManuales, setAjustesManuales] = useState({})

  const { tasaEuro, tasaUsdt } = useTasaCambio()
  const [tipoTasaComision, setTipoTasaComision] = useState('euro')
  const tasaSeleccionadaInfo = tipoTasaComision === 'usdt' ? tasaUsdt : tasaEuro
  const tasaSeleccionada = Number(tasaSeleccionadaInfo?.precio || 0)
  const tipoTasaLabel = tipoTasaComision === 'usdt' ? 'USDT' : 'Euro BCV'
  const tasaDisponible = tasaSeleccionada > 0

  const [exportando, setExportando] = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [vendedorSeleccionado, setVendedorSeleccionado] = useState(null)

  const { data: comisionesRes, isLoading, isError, refetch } = useComisiones({
    vendedorId: esPrivilegiado ? filtroVendedor : '',
    desde: rango.from,
    hasta: rango.to,
    pageSize: 1000,
  })

  // Consulta paralela para alimentar el dropdown con todos los asesores del rango
  const { data: comisionesDropdownRes } = useComisiones({
    desde: rango.from,
    hasta: rango.to,
    pageSize: 2000,
  })

  const { data: resumen, isLoading: resumenLoading } = useComisionesResumen({
    vendedorId: esPrivilegiado ? filtroVendedor : '',
    desde: rango.from,
    hasta: rango.to,
  })

  const { data: vendedores = [] } = useVendedores()
  const { data: configNeg = {} } = useConfigNegocio()
  const comisiones = comisionesRes?.data ?? []
  const comisionesParaDropdown = comisionesDropdownRes?.data ?? []

  const setAjuste = (vId, campo, valor) => {
    setAjustesManuales(prev => ({
      ...prev,
      [vId]: { ...(prev[vId] || { cxc: '', descuentoCarro: '' }), [campo]: valor }
    }))
  }

  // Agrupación canónica por vendedor
  const vendedoresAgrupados = useMemo(() => {
    const map = {}
    const UUID_HUERFANO = '00000000-0000-0000-0000-000000000000'
    comisiones.forEach(c => {
      const vId = c.vendedor?.id || UUID_HUERFANO
      if (!map[vId]) {
        map[vId] = {
          id: vId,
          nombre: c.vendedor?.nombre || 'Sin Asignar',
          color: c.vendedor?.color || '#cbd5e1',
          markup_pct: c.vendedor?.markup_pct ?? null,
          es_externo: !!c.vendedor?.es_externo,
          rol: c.vendedor?.rol,
          totalUsd: 0,
          totalBs: 0,
          cantidad: 0,
          rows: []
        }
      }
      const m = Number(c.totalcomision || 0)
      map[vId].totalUsd += m
      map[vId].rows.push(c)
    })
    return Object.values(map)
      .map(v => {
        const totalUsd = round2(v.totalUsd)
        const totalBs = round2(totalUsd * Number(tasaSeleccionada || 0))
        return {
          ...v,
          totalUsd,
          totalBs,
          cantidad: countUniqueDispatches(v.rows),
          rows: undefined,
        }
      })
      .filter(v => v.rol !== 'desarrollador' && v.rol !== 'administracion' && v.rol !== 'logistica')
      .sort((a, b) => b.totalUsd - a.totalUsd)
  }, [comisiones, tasaSeleccionada])

  // Asesores disponibles para el CustomSelect
  const vendedoresDisponibles = useMemo(() => {
    if (!esPrivilegiado) return []
    const map = {}
    const UUID_HUERFANO = '00000000-0000-0000-0000-000000000000'
    comisionesParaDropdown.forEach(c => {
      const vId = c.vendedor?.id || UUID_HUERFANO
      const rol = c.vendedor?.rol
      if (rol === 'desarrollador' || rol === 'administracion' || rol === 'logistica') return
      if (!map[vId]) {
        map[vId] = { id: vId, nombre: c.vendedor?.nombre || 'Sin Asignar' }
      }
    })
    vendedores.forEach(u => {
      if (['vendedor', 'vendedor_sin_comision', 'supervisor'].includes(u.rol) && !map[u.id]) {
        map[u.id] = { id: u.id, nombre: u.nombre }
      }
    })
    return Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [comisionesParaDropdown, vendedores, esPrivilegiado])

  // Exportar reporte consolidado (Completo, Solo Internos, Solo Externos)
  async function exportarPDF(tipoFiltro = 'todos', accion = 'descargar') {
    if (!tasaDisponible) {
      alert(`No hay una tasa ${tipoTasaLabel} disponible para generar el PDF.`)
      return
    }
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesGeneradasPDF')

      const params = new URLSearchParams()
      params.set('vista', 'eventos')
      params.set('page', '1')
      params.set('pageSize', '1000')
      if (rango?.from) params.set('desde', rango.from)
      if (rango?.to) params.set('hasta', rango.to)
      if (filtroVendedor) params.set('vendedorId', filtroVendedor)

      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const resJson = await res.json()
      const rawEvents = resJson.data || []

      let filteredEvents = rawEvents
      if (tipoFiltro === 'internos') {
        filteredEvents = rawEvents.filter(r => {
          const v = r.vendedor || {}
          return !(v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0))
        })
      } else if (tipoFiltro === 'externos') {
        filteredEvents = rawEvents.filter(r => {
          const v = r.vendedor || {}
          return !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)
        })
      }

      if (filteredEvents.length === 0) {
        alert('🔍 SIN DATOS: No hay comisiones registradas para el grupo de vendedores seleccionado en este rango.')
        return
      }

      const cotizacionIds = [...new Set(filteredEvents.map(r => r.comisiones?.cotizacionid).filter(Boolean))]
      let cotizacionesMap = {}
      if (cotizacionIds.length > 0) {
        const { data: cotList, error: cotErr } = await supabase
          .from('cotizaciones')
          .select('id, numero, tasa_bcv_snapshot, cliente:clientes(id, nombre)')
          .in('id', cotizacionIds)
        if (!cotErr && cotList) {
          cotizacionesMap = Object.fromEntries(cotList.map(c => [c.id, c]))
        }
      }

      const vendedorInfo = filtroVendedor
        ? vendedoresAgrupados.find(v => v.id === filtroVendedor)
        : null

      const comisionesParaPDF = filteredEvents.map(r => prepararComisionParaPDF(
        r,
        r.comisiones?.cotizacion || cotizacionesMap[r.comisiones?.cotizacionid],
        vendedorInfo,
      ))

      await generarComisionesPDF({
        comisiones: comisionesParaPDF,
        vendedor: vendedorInfo ? { nombre: vendedorInfo.nombre, color: vendedorInfo.color, markup_pct: vendedorInfo.markup_pct, es_externo: vendedorInfo.es_externo } : null,
        tipoVendedor: tipoFiltro === 'todos' ? null : tipoFiltro,
        rango,
        config: configNeg ?? {},
        action: accion === 'imprimir' ? 'print' : 'download',
        formato: formatoReporte,
        tasaEuro: tasaSeleccionada,
        tasaAplicada: tasaSeleccionada,
        tipoTasa: tipoTasaLabel,
        tasaFuente: tasaSeleccionadaInfo?.fuente,
        tasaActualizadaEn: tasaSeleccionadaInfo?.ultimaActualizacion,
        ajustesManuales,
        modoCorteSemanal: formatoReporte === 'detallado',
      })
    } catch (e) {
      console.error('Error generando PDF general:', e)
      alert('❌ Error al generar reporte general: ' + e.message)
    } finally {
      setExportando(false)
    }
  }

  // Exportar reporte individual de un asesor
  async function exportarIndividualPDF(vendedor) {
    if (!tasaDisponible) {
      alert(`No hay una tasa ${tipoTasaLabel} disponible para generar el PDF.`)
      return
    }
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesGeneradasPDF')

      const params = new URLSearchParams()
      params.set('vista', 'eventos')
      params.set('page', '1')
      params.set('pageSize', '1000')
      if (rango?.from) params.set('desde', rango.from)
      if (rango?.to) params.set('hasta', rango.to)
      if (vendedor?.id) params.set('vendedorId', vendedor.id)

      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const resJson = await res.json()
      const rawEvents = resJson.data || []

      if (rawEvents.length === 0) {
        alert(`🔍 SIN DATOS: No hay liberaciones de comisiones para ${vendedor?.nombre || 'este vendedor'} en el periodo seleccionado.`)
        return
      }

      const cotizacionIds = [...new Set(rawEvents.map(r => r.comisiones?.cotizacionid).filter(Boolean))]
      let cotizacionesMap = {}
      if (cotizacionIds.length > 0) {
        const { data: cotList, error: cotErr } = await supabase
          .from('cotizaciones')
          .select('id, numero, tasa_bcv_snapshot, cliente:clientes(id, nombre)')
          .in('id', cotizacionIds)
        if (!cotErr && cotList) {
          cotizacionesMap = Object.fromEntries(cotList.map(c => [c.id, c]))
        }
      }

      const comisionesParaPDF = rawEvents.map(r => prepararComisionParaPDF(
        r,
        r.comisiones?.cotizacion || cotizacionesMap[r.comisiones?.cotizacionid],
        vendedor,
      ))

      await generarComisionesPDF({
        comisiones: comisionesParaPDF,
        vendedor: { nombre: vendedor.nombre, color: vendedor.color, markup_pct: vendedor.markup_pct, es_externo: vendedor.es_externo },
        rango,
        config: configNeg ?? {},
        formato: formatoReporte,
        tasaEuro: tasaSeleccionada,
        tasaAplicada: tasaSeleccionada,
        tipoTasa: tipoTasaLabel,
        tasaFuente: tasaSeleccionadaInfo?.fuente,
        tasaActualizadaEn: tasaSeleccionadaInfo?.ultimaActualizacion,
        ajustesManuales,
        modoCorteSemanal: formatoReporte === 'detallado',
      })
    } catch (e) {
      console.error('Error generando PDF individual:', e)
      alert('❌ Error al generar PDF de ' + vendedor.nombre + ': ' + e.message)
    } finally {
      setExportando(false)
    }
  }

  const vendedoresInternos = vendedoresAgrupados.filter(v => !(v.es_externo || v.markup_pct > 0))
  const vendedoresExternos = vendedoresAgrupados.filter(v => !!v.es_externo || v.markup_pct > 0)

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-4">
      <PageHeader
        icon={DollarSign}
        title="Comisiones"
        subtitle="Comisiones generadas y ajustes manuales para el corte"
      />

      {/* Panel de designación exclusivo para rol jefe */}
      <PanelDesignacion perfil={perfil} vendedores={vendedores} />

      {/* ─── FILTROS PROFESIONALES (Paridad total con Reportes) ─── */}
      <div className="bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm space-y-3.5">
        {/* Fila Superior: Selector de Rango con Presets */}
        <div className="w-full">
          <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">
            Rango de Período
          </label>
          <DateRangeSelector value={rango} onChange={setRango} />
        </div>

        {/* Fila Inferior: Vendedor con CustomSelect, Switch Formato, Tasas y Exportación */}
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-50 pt-3 w-full justify-between">
          <div className="flex flex-wrap items-end gap-3">
            {esPrivilegiado && (
              <div className="w-56">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">
                  Vendedor
                </label>
                <CustomSelect
                  options={[
                    { value: '', label: 'Todos los Asesores' },
                    ...vendedoresDisponibles.map(v => ({ value: v.id, label: v.nombre }))
                  ]}
                  value={filtroVendedor}
                  onChange={setFiltroVendedor}
                  placeholder="Todos los Asesores"
                  searchable
                />
              </div>
            )}

            <div className="w-44">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">
                Formato Reporte
              </label>
              <div className="flex p-0.5 bg-slate-100/80 rounded-xl h-9">
                <button
                  type="button"
                  onClick={() => setFormatoReporte('detallado')}
                  className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${
                    formatoReporte === 'detallado'
                      ? 'bg-white shadow-md text-indigo-600'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Detallado
                </button>
                <button
                  type="button"
                  onClick={() => setFormatoReporte('resumido')}
                  className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${
                    formatoReporte === 'resumido'
                      ? 'bg-white shadow-md text-indigo-600'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Resumido
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 ml-auto shrink-0 self-end">
            {/* Selector de Tasa Euro / USDT */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs font-bold shrink-0 h-9">
              <button
                type="button"
                onClick={() => setTipoTasaComision('euro')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                  tipoTasaComision === 'euro'
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="Calcular comisiones con tasa Euro Oficial BCV"
              >
                <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black shrink-0">€</span>
                <span>Euro BCV:</span>
                <b>{tasaEuro?.precio > 0 ? fmtBs(tasaEuro.precio) : 'N/D'}</b>
              </button>
              <button
                type="button"
                onClick={() => setTipoTasaComision('usdt')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                  tipoTasaComision === 'usdt'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="Calcular comisiones con tasa USDT (Binance P2P)"
              >
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-black shrink-0 font-mono">₮</span>
                <span>USDT:</span>
                <b>{tasaUsdt?.precio > 0 ? fmtBs(tasaUsdt.precio) : 'N/D'}</b>
              </button>
            </div>

            {/* Menús desplegables de Imprimir y Descargar */}
            <div className="flex items-center gap-1.5 relative shrink-0">
              {/* Botón Imprimir */}
              <div className="relative">
                {filtroVendedor ? (
                  <button
                    onClick={() => exportarPDF('todos', 'imprimir')}
                    disabled={exportando || comisiones.length === 0 || !tasaDisponible}
                    className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm h-9"
                  >
                    <Printer size={12} className="text-slate-500" />
                    <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Imprimir PDF'}</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setShowPrintMenu(!showPrintMenu)}
                      disabled={exportando || comisiones.length === 0 || !tasaDisponible}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm h-9"
                    >
                      <Printer size={12} className="text-slate-500" />
                      <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Imprimir PDF'}</span>
                      <ChevronDown size={12} className={`transition-transform duration-200 ${showPrintMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showPrintMenu && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowPrintMenu(false)} />
                        <div className="absolute right-0 mt-1 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                          <button
                            onClick={() => { setShowPrintMenu(false); exportarPDF('todos', 'imprimir') }}
                            className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                          >
                            <FileText size={13} className="text-slate-400" />
                            Imprimir PDF Completo
                          </button>
                          <button
                            onClick={() => { setShowPrintMenu(false); exportarPDF('internos', 'imprimir') }}
                            className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
                          >
                            <UserCheck size={13} className="text-indigo-500" />
                            Imprimir Solo Internos
                          </button>
                          <button
                            onClick={() => { setShowPrintMenu(false); exportarPDF('externos', 'imprimir') }}
                            className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
                          >
                            <Globe size={13} className="text-amber-500" />
                            Imprimir Solo Externos
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Botón Descargar */}
              <div className="relative">
                {filtroVendedor ? (
                  <button
                    onClick={() => exportarPDF('todos', 'descargar')}
                    disabled={exportando || comisiones.length === 0 || !tasaDisponible}
                    className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md h-9"
                    style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
                  >
                    <Download size={12} />
                    <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Descargar PDF'}</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setShowExportMenu(!showExportMenu)}
                      disabled={exportando || comisiones.length === 0 || !tasaDisponible}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md h-9"
                      style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
                    >
                      <Download size={12} />
                      <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Descargar PDF'}</span>
                      <ChevronDown size={12} className={`transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showExportMenu && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                        <div className="absolute right-0 mt-1 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                          <button
                            onClick={() => { setShowExportMenu(false); exportarPDF('todos', 'descargar') }}
                            className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                          >
                            <FileText size={13} className="text-slate-400" />
                            Descargar PDF Completo
                          </button>
                          <button
                            onClick={() => { setShowExportMenu(false); exportarPDF('internos', 'descargar') }}
                            className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
                          >
                            <UserCheck size={13} className="text-indigo-500" />
                            Descargar Solo Internos
                          </button>
                          <button
                            onClick={() => { setShowExportMenu(false); exportarPDF('externos', 'descargar') }}
                            className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
                          >
                            <Globe size={13} className="text-amber-500" />
                            Descargar Solo Externos
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── PANEL DE AJUSTES MANUALES (Modo Resumido) ─── */}
      {formatoReporte === 'resumido' && !isLoading && !isError && vendedoresAgrupados.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <span className="text-base">✏️</span>
            <div>
              <p className="text-xs font-black text-amber-800 uppercase tracking-wide">Ajustes Manuales — Reporte Resumido</p>
              <p className="text-[10px] text-amber-600 font-medium">Ingresa los montos de Comisión CxC y Descuento Carro por vendedor antes de generar el corte o PDF.</p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {vendedoresAgrupados.map(v => {
              const aj = ajustesManuales[v.id] || { cxc: '', descuentoCarro: '' }
              const comisionGen = v.totalUsd || 0
              const cxcVal = Number(aj.cxc) || 0
              const descVal = Number(aj.descuentoCarro) || 0
              const totalPagar = comisionGen + cxcVal - descVal
              const tasa = Number(tasaSeleccionada || 0)

              return (
                <div key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <div className="flex items-center gap-2 w-40 shrink-0">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: v.color }}>
                      {v.nombre.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-bold text-slate-800 truncate">{v.nombre}</span>
                  </div>

                  <div className="flex flex-col items-start">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wide mb-0.5">Comisión Período</label>
                    <span className="text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">${comisionGen.toFixed(2)}</span>
                  </div>

                  <div className="flex flex-col items-start">
                    <label className="text-[9px] font-black text-amber-600 uppercase tracking-wide mb-0.5">Comisión CxC ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={aj.cxc}
                      onChange={e => setAjuste(v.id, 'cxc', e.target.value)}
                      className="w-28 h-8 px-2 text-xs font-bold border border-amber-200 bg-amber-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 text-amber-800 placeholder-amber-300"
                    />
                  </div>

                  <div className="flex flex-col items-start">
                    <label className="text-[9px] font-black text-red-600 uppercase tracking-wide mb-0.5">Descuento Carro ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={aj.descuentoCarro}
                      onChange={e => setAjuste(v.id, 'descuentoCarro', e.target.value)}
                      className="w-28 h-8 px-2 text-xs font-bold border border-red-200 bg-red-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 text-red-800 placeholder-red-300"
                    />
                  </div>

                  <div className="flex flex-col items-start ml-auto">
                    <label className="text-[9px] font-black text-indigo-500 uppercase tracking-wide mb-0.5">Total a Pagar</label>
                    <span className="text-sm font-black text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1">${totalPagar.toFixed(2)}</span>
                  </div>

                  {tasa > 0 && (
                    <div className="flex flex-col items-start">
                      <label className="text-[9px] font-black text-emerald-600 uppercase tracking-wide mb-0.5">Total en Bs ({tipoTasaLabel})</label>
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                        Bs {(totalPagar * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── ESTADOS DE CARGA Y CONTENIDO ─── */}
      {isLoading || resumenLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          </div>
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar comisiones</p>
          <button type="button" onClick={refetch} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : (
        <>
          {/* Tarjetas KPI */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ResumenCard
              icon={DollarSign}
              label="Comisión generada"
              value={fmtUsd(resumen?.totalAcumulado || 0)}
              sub={`${resumen?.totalDespachos || 0} despachos únicos`}
              gradient="linear-gradient(135deg, #1e293b, #0f172a)"
              border="rgba(255,255,255,0.05)"
            />
            <ResumenCard
              icon={Percent}
              label="Comisión CxC manual"
              value="Aparte"
              sub="La administra el responsable del corte"
              gradient="linear-gradient(135deg, #92400e, #78350f)"
              border="rgba(255,255,255,0.05)"
            />
            <ResumenCard
              icon={ArrowUpCircle}
              label="Estado del registro"
              value="Generada"
              sub="Sin pago dentro del sistema"
              gradient="linear-gradient(135deg, #065f46, #064e3b)"
              border="rgba(255,255,255,0.05)"
            />
          </div>

          {vendedoresAgrupados.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="Sin comisiones generadas"
              description="No hay registros en el período seleccionado."
            />
          ) : (
            <div className="space-y-6">
              {/* 1. ASESORES INTERNOS */}
              {vendedoresInternos.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <Users size={16} className="text-slate-500" />
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider">
                      Vendedores Internos ({vendedoresInternos.length})
                    </h4>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {vendedoresInternos.map(v => (
                      <div
                        key={v.id}
                        onClick={() => setVendedorSeleccionado(v)}
                        className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-400 hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col gap-3 group"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-inner"
                            style={{ backgroundColor: v.color }}
                          >
                            {v.nombre.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-slate-800 truncate group-hover:text-indigo-600 transition-colors">
                              {v.nombre}
                            </h4>
                            <p className="text-xs text-slate-500 font-medium">
                              {v.cantidad} despachos únicos
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); exportarIndividualPDF(v) }}
                            title="Descargar reporte individual"
                            className="p-2 bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-xl border border-slate-100 hover:border-indigo-200 transition-all active:scale-95 duration-200"
                          >
                            <Download size={14} />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
                            <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Total USD</p>
                            <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
                          </div>
                          <div className="bg-emerald-50/50 rounded-xl p-2.5 text-center border border-emerald-100/50">
                            <p className="text-[10px] text-emerald-600/70 font-bold uppercase mb-0.5">Generada</p>
                            <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
                          </div>
                        </div>

                        <div className="flex justify-between items-center px-1 pt-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Equiv. Bs</span>
                          <span className="text-xs font-bold text-indigo-600">{fmtBs(v.totalBs)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 2. VENDEDORES EXTERNOS */}
              {vendedoresExternos.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2 px-1">
                    <Briefcase size={16} className="text-amber-600 animate-pulse" />
                    <h4 className="text-xs font-black text-amber-700 uppercase tracking-wider">
                      Vendedores Externos ({vendedoresExternos.length})
                    </h4>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {vendedoresExternos.map(v => (
                      <div
                        key={v.id}
                        onClick={() => setVendedorSeleccionado(v)}
                        className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm cursor-pointer hover:border-amber-400 hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col gap-3 group bg-amber-50/5"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-inner"
                            style={{ backgroundColor: '#D97706' }}
                          >
                            {v.nombre.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-slate-800 truncate group-hover:text-amber-600 transition-colors">
                              {v.nombre}
                            </h4>
                            <div className="flex flex-col gap-0.5 mt-0.5">
                              <span className="text-xs text-slate-500 font-medium">{v.cantidad} despachos únicos</span>
                              <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded px-1.5 py-0.5 w-fit">
                                💼 Externo (+{v.markup_pct || 0}%)
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); exportarIndividualPDF(v) }}
                            title="Descargar reporte individual"
                            className="p-2 bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-700 rounded-xl border border-amber-100 hover:border-amber-200 transition-all active:scale-95 duration-200"
                          >
                            <Download size={14} />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
                            <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Total USD</p>
                            <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
                          </div>
                          <div className="bg-emerald-50/50 rounded-xl p-2.5 text-center border border-emerald-100/50">
                            <p className="text-[10px] text-emerald-600/70 font-bold uppercase mb-0.5">Generada</p>
                            <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
                          </div>
                        </div>

                        <div className="flex justify-between items-center px-1 pt-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Equiv. Bs</span>
                          <span className="text-xs font-bold text-indigo-600">{fmtBs(v.totalBs)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Modal Detalle al hacer clic en un vendedor (Contenido, sin scroll infinito) */}
          <ModalDetalleVendedor
            isOpen={!!vendedorSeleccionado}
            onClose={() => setVendedorSeleccionado(null)}
            vendedor={vendedorSeleccionado}
            rango={rango}
            configNeg={configNeg}
            ajustesManuales={ajustesManuales}
          />
        </>
      )}
    </div>
  )
}
