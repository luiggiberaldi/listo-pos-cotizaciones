// src/views/ComisionesView.jsx
// Vista de comisiones para Jefes y Supervisores con paridad visual a Reportes
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  DollarSign, Percent, FileText, Download, ChevronDown,
  Star, Loader2, X, Users, Briefcase, Printer, UserCheck, Globe, ArrowUpCircle,
  Calendar, ChevronLeft, ChevronRight, Lock, AlertTriangle, CheckCircle2, RotateCcw
} from 'lucide-react'
import { useComisiones, useComisionesResumen } from '../hooks/useComisiones'
import { useVendedores } from '../hooks/useClientes'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import useAuthStore from '../store/useAuthStore'
import { fmtUsd, fmtBs } from '../utils/format'
import { getCorteSemanalRange } from '../utils/dateHelpers'
import {
  calcularCambiosCalendario,
  contarTurnosPorVendedor,
  desplazarMes,
  detectarAlertaSabadoSemana,
  getFechaCaracasISO,
  obtenerRangoMesISO,
  obtenerSabadoDeLaSemana,
  obtenerSabadosDelMes,
} from '../utils/calendarioSabados'
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
import { cargarEventosComisionesParaPdf } from '../services/comisionesPdfHelper'
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

// ─── Calendario mensual de sábados para el vendedor designado (OP-2026-036) ──
function PanelDesignacion({ perfil, vendedores }) {
  const esJefe = perfil?.rol === 'jefe'
  // Fecha local de Venezuela (sin salto UTC después de las 8 p. m.)
  const hoy = useMemo(() => getFechaCaracasISO(), [])
  const sabadoSemanaISO = useMemo(() => obtenerSabadoDeLaSemana(hoy), [hoy])

  // Mes inicial: el del sábado de esta semana (si ya pasaron todos los sábados
  // del mes actual, abre directamente el mes siguiente).
  const mesBase = useMemo(() => ({
    anio: Number(sabadoSemanaISO.slice(0, 4)),
    mes: Number(sabadoSemanaISO.slice(5, 7)),
  }), [sabadoSemanaISO])

  const [mesVista, setMesVista] = useState(() => mesBase)
  const [designaciones, setDesignaciones] = useState({})
  const [borradores, setBorradores] = useState({})
  const [cargando, setCargando] = useState(false)
  const [cargadoUnaVez, setCargadoUnaVez] = useState(false)
  const [errorCarga, setErrorCarga] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState(null)
  const [modalConfirmar, setModalConfirmar] = useState(false)
  const reqIdRef = useRef(0)
  const abortRef = useRef(null)

  // Guardarraíl: solo vendedores y supervisores activos y NO externos
  const elegibles = useMemo(() => {
    return (vendedores || []).filter(u => ['vendedor', 'supervisor'].includes(u.rol) && !u.es_externo)
  }, [vendedores])

  const vendedoresPorId = useMemo(() => {
    return Object.fromEntries((vendedores || []).map(u => [u.id, u]))
  }, [vendedores])

  const rangoMes = useMemo(
    () => obtenerRangoMesISO(mesVista.anio, mesVista.mes),
    [mesVista.anio, mesVista.mes],
  )

  const sabadosMes = useMemo(
    () => obtenerSabadosDelMes(mesVista.anio, mesVista.mes, hoy),
    [mesVista.anio, mesVista.mes, hoy],
  )

  // Límite de navegación: hasta 6 meses atrás (historial) y 3 meses hacia adelante
  const offsetMeses = (mesVista.anio - mesBase.anio) * 12 + (mesVista.mes - mesBase.mes)
  const puedeMesAnterior = offsetMeses > -6
  const puedeMesSiguiente = offsetMeses < 3

  const cargarDesignaciones = useCallback(async () => {
    if (!esJefe) return
    // Guardarraíl contra clics rápidos en ◀/▶: cancela la carga anterior e ignora respuestas viejas
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const myReqId = ++reqIdRef.current

    try {
      setCargando(true)
      setErrorCarga(null)
      const headers = await getAuthHeaders()
      // Pedimos el mes visible + el sábado de esta semana (para que la alerta semanal siempre tenga el dato)
      const desde = rangoMes.desde < hoy ? rangoMes.desde : hoy
      const hasta = rangoMes.hasta > sabadoSemanaISO ? rangoMes.hasta : sabadoSemanaISO
      const res = await fetch(
        apiUrl(`/api/comisiones/designacion?desde=${desde}&hasta=${hasta}`),
        { headers, signal: controller.signal },
      )
      if (!res.ok) throw new Error('No se pudo cargar el calendario de este mes. Revisa tu conexión.')
      const rows = await res.json()
      if (myReqId !== reqIdRef.current) return
      setDesignaciones(prev => {
        const next = { ...prev }
        // Limpiamos el rango consultado y cargamos lo que devolvió la base
        for (const k of Object.keys(next)) {
          if (k >= desde && k <= hasta) delete next[k]
        }
        for (const r of (rows || [])) {
          if (r?.fecha) next[r.fecha] = r
        }
        return next
      })
      setCargadoUnaVez(true)
    } catch (e) {
      if (e?.name === 'AbortError' || myReqId !== reqIdRef.current) return
      console.error('Error cargando designaciones:', e)
      setErrorCarga(e.message || 'No se pudo cargar el calendario de este mes.')
    } finally {
      if (myReqId === reqIdRef.current) setCargando(false)
    }
  }, [esJefe, rangoMes.desde, rangoMes.hasta, hoy, sabadoSemanaISO])

  useEffect(() => {
    cargarDesignaciones()
    return () => { if (abortRef.current) abortRef.current.abort() }
  }, [cargarDesignaciones])

  const cambiosPendientes = useMemo(
    () => calcularCambiosCalendario(sabadosMes, designaciones, borradores, vendedoresPorId),
    [sabadosMes, designaciones, borradores, vendedoresPorId],
  )
  const tienePendientes = cambiosPendientes.length > 0

  const cambiarMes = useCallback((delta) => {
    if (tienePendientes) return
    setMesVista(prev => desplazarMes(prev.anio, prev.mes, delta))
    setBorradores({})
    setMensaje(null)
  }, [tienePendientes])

  const irAMes = useCallback((anio, mes) => {
    if (tienePendientes) return
    setMesVista({ anio, mes })
    setBorradores({})
    setMensaje(null)
  }, [tienePendientes])

  const turnosMes = useMemo(
    () => contarTurnosPorVendedor(sabadosMes, designaciones, borradores, vendedoresPorId),
    [sabadosMes, designaciones, borradores, vendedoresPorId],
  )

  const alertaSemana = useMemo(
    () => detectarAlertaSabadoSemana(designaciones, hoy),
    [designaciones, hoy],
  )

  const estadisticasMes = useMemo(() => {
    const total = sabadosMes.length
    let asignados = 0
    for (const s of sabadosMes) {
      const actualId = designaciones[s.fecha]?.designado_id || ''
      const id = s.editable && Object.prototype.hasOwnProperty.call(borradores, s.fecha)
        ? (borradores[s.fecha] || '')
        : actualId
      if (id) asignados++
    }
    return { total, asignados, faltan: Math.max(total - asignados, 0) }
  }, [sabadosMes, designaciones, borradores])

  const seleccionarVendedorSabado = useCallback((fechaSabado, vendedorId) => {
    setBorradores(prev => ({
      ...prev,
      [fechaSabado]: vendedorId || '',
    }))
    setMensaje(null)
  }, [])

  const deshacerCambios = useCallback(() => {
    setBorradores({})
    setMensaje(null)
  }, [])

  const abrirConfirmacion = useCallback(() => {
    if (cambiosPendientes.length === 0 || guardando || cargando || errorCarga) return
    setModalConfirmar(true)
  }, [cambiosPendientes.length, guardando, cargando, errorCarga])

  const confirmarGuardarMes = useCallback(async () => {
    if (cambiosPendientes.length === 0 || errorCarga) return
    try {
      setGuardando(true)
      const headers = await getAuthHeaders()
      const payload = {
        cambios: cambiosPendientes.map(c => ({
          fecha: c.fecha,
          designado_id: c.nuevoId,
        })),
      }
      const res = await fetch(apiUrl('/api/comisiones/designacion'), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Error al guardar el calendario de sábados')

      setDesignaciones(prev => {
        const next = { ...prev }
        for (const f of (json.eliminadas || [])) {
          delete next[f]
        }
        for (const row of (json.actualizadas || [])) {
          if (row?.fecha) {
            next[row.fecha] = {
              ...row,
              designado: row.designado || vendedoresPorId[row.designado_id] || null,
            }
          }
        }
        return next
      })
      setBorradores({})
      const n = cambiosPendientes.length
      setMensaje({
        tipo: 'ok',
        texto: n === 1
          ? `Listo: se guardó el cambio del ${cambiosPendientes[0].etiquetaLarga.toLowerCase()}.`
          : `Listo: se guardaron los ${n} sábados modificados de ${rangoMes.etiqueta.toLowerCase()}.`,
      })
    } catch (e) {
      setMensaje({ tipo: 'error', texto: e.message || 'Error al guardar el calendario' })
      // Resincronizar con la base real para no mostrar estado desfasado si falló a mitad
      cargarDesignaciones()
      throw e
    } finally {
      setGuardando(false)
    }
  }, [cambiosPendientes, errorCarga, rangoMes.etiqueta, vendedoresPorId, cargarDesignaciones])

  const resumenModal = useMemo(() => {
    return cambiosPendientes.map(c => {
      if (c.tipo === 'quitar') {
        return `• ${c.etiquetaCorta}: Quitar designación${c.anteriorNombre ? ` (antes: ${c.anteriorNombre})` : ''}`
      }
      if (c.tipo === 'cambiar') {
        return `• ${c.etiquetaCorta}: Cambiar de ${c.anteriorNombre || 'anterior'} a ${c.nuevoNombre}`
      }
      return `• ${c.etiquetaCorta}: Designar a ${c.nuevoNombre}`
    }).join('\n')
  }, [cambiosPendientes])

  const incluyeCambioHoy = useMemo(
    () => cambiosPendientes.some(c => c.esHoy),
    [cambiosPendientes],
  )

  if (!esJefe) return null

  return (
    <div
      data-testid="calendario-sabados-panel"
      className="bg-white/80 backdrop-blur-md rounded-2xl border border-emerald-200/80 p-4 space-y-3.5 shadow-sm"
    >
      {/* Encabezado y navegador de mes */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-emerald-100 shrink-0">
            <Calendar size={16} className="text-emerald-700" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wide">
                Calendario de designados (sábados)
              </h3>
              <span
                data-testid="calendario-estado-mes"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border ${
                  estadisticasMes.faltan === 0
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {estadisticasMes.faltan === 0 ? (
                  <>
                    <CheckCircle2 size={11} />
                    {estadisticasMes.asignados} de {estadisticasMes.total} sábados asignados
                  </>
                ) : (
                  <>
                    <AlertTriangle size={11} />
                    {estadisticasMes.asignados} de {estadisticasMes.total} asignados (falta{estadisticasMes.faltan > 1 ? 'n' : ''} {estadisticasMes.faltan})
                  </>
                )}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Cada sábado el designado cobra 0,5 % y el dueño del cliente 1,5 %. Puedes dejar programado todo el mes de una sola vez.
            </p>
          </div>
        </div>

        {/* Selector de mes ◀ Mes Año ▶ */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(mesVista.anio !== mesBase.anio || mesVista.mes !== mesBase.mes) && (
            <button
              type="button"
              onClick={() => irAMes(mesBase.anio, mesBase.mes)}
              disabled={tienePendientes || cargando || guardando}
              title={tienePendientes ? 'Guarda o deshaz tus cambios antes de cambiar de mes' : 'Volver al mes actual'}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-40 transition-colors"
            >
              Mes actual
            </button>
          )}
          <div className="inline-flex items-center bg-slate-50 border border-slate-200 rounded-xl p-0.5">
            <button
              type="button"
              data-testid="calendario-mes-prev"
              onClick={() => cambiarMes(-1)}
              disabled={!puedeMesAnterior || tienePendientes || cargando || guardando}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-white hover:shadow-xs disabled:opacity-35 transition-all"
              title={tienePendientes ? 'Guarda o deshaz tus cambios antes de cambiar de mes' : 'Mes anterior'}
            >
              <ChevronLeft size={14} />
            </button>
            <span
              data-testid="calendario-mes-titulo"
              className="px-2.5 sm:px-3 text-xs font-black text-slate-800 min-w-[118px] sm:min-w-[128px] text-center select-none"
            >
              {rangoMes.etiqueta}
            </span>
            <button
              type="button"
              data-testid="calendario-mes-next"
              onClick={() => cambiarMes(1)}
              disabled={!puedeMesSiguiente || tienePendientes || cargando || guardando}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-white hover:shadow-xs disabled:opacity-35 transition-all"
              title={tienePendientes ? 'Guarda o deshaz tus cambios antes de cambiar de mes' : 'Mes siguiente'}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          {cargando && <Loader2 size={14} className="text-slate-400 animate-spin ml-1" />}
        </div>
      </div>

      {/* Guardarraíl de red: si falló la carga del mes, avisar y ofrecer Reintentar */}
      {errorCarga && (
        <div
          data-testid="calendario-error-carga"
          className="flex items-center justify-between gap-2 flex-wrap bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle size={15} className="text-red-600 shrink-0" />
            <span>{errorCarga} No se puede guardar hasta cargar los datos actuales.</span>
          </div>
          <button
            type="button"
            onClick={cargarDesignaciones}
            disabled={cargando}
            className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[11px] font-black transition-colors"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Aviso si hay cambios sin guardar (explica por qué las flechas de mes esperan) */}
      {tienePendientes && !errorCarga && (
        <p data-testid="calendario-aviso-pendientes" className="text-[11px] font-bold text-amber-700">
          Tienes {cambiosPendientes.length} {cambiosPendientes.length === 1 ? 'cambio sin guardar' : 'cambios sin guardar'} en {rangoMes.etiqueta}. Pulsa <strong>Guardar cambios</strong> o <strong>Deshacer</strong> antes de cambiar de mes.
        </p>
      )}

      {/* Guardarraíl preventivo: alerta solo tras terminar la primera carga (sin parpadeo falso) */}
      {cargadoUnaVez && !errorCarga && alertaSemana.alerta && (
        <div
          data-testid="calendario-alerta-semana"
          className="flex items-center justify-between gap-2 flex-wrap bg-amber-50 border border-amber-300/80 text-amber-900 rounded-xl px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle size={15} className="text-amber-600 shrink-0" />
            <span>{alertaSemana.mensaje} Elígelo en su tarjeta y pulsa <strong>Guardar cambios</strong>.</span>
          </div>
          {(mesVista.anio !== alertaSemana.anio || mesVista.mes !== alertaSemana.mes) && !tienePendientes && (
            <button
              type="button"
              onClick={() => irAMes(alertaSemana.anio, alertaSemana.mes)}
              className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-black transition-colors"
            >
              Ir a ese sábado
            </button>
          )}
        </div>
      )}

      {/* Grilla de los 4 o 5 sábados del mes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {sabadosMes.map(s => {
          const actualRow = designaciones[s.fecha]
          const actualId = actualRow?.designado_id || ''
          const valorSeleccionado = s.editable && Object.prototype.hasOwnProperty.call(borradores, s.fecha)
            ? (borradores[s.fecha] || '')
            : actualId
          const modificado = s.editable && valorSeleccionado !== actualId
          const nombreGuardado =
            actualRow?.designado?.nombre ||
            vendedoresPorId[actualId]?.nombre ||
            ''
          const rolGuardado =
            actualRow?.designado?.rol ||
            vendedoresPorId[actualId]?.rol ||
            ''

          let badgeEstado = null
          if (s.estado === 'hoy') {
            badgeEstado = (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white">
                <Star size={10} /> Hoy sábado
              </span>
            )
          } else if (s.estado === 'proximo') {
            badgeEstado = (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-200">
                Próximo sábado
              </span>
            )
          } else if (s.estado === 'pasado') {
            badgeEstado = (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                <Lock size={10} /> Cerrado
              </span>
            )
          }

          return (
            <div
              key={s.fecha}
              data-testid={`sabado-card-${s.fecha}`}
              className={`rounded-xl border p-3 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                !s.editable
                  ? 'bg-slate-50/80 border-slate-200/80 opacity-85'
                  : modificado
                    ? 'bg-amber-50/40 border-amber-300 ring-1 ring-amber-200'
                    : valorSeleccionado
                      ? 'bg-emerald-50/30 border-emerald-200/80'
                      : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex flex-col gap-0.5 min-w-[140px]">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-black text-slate-800">{s.etiquetaCorta}</span>
                  {badgeEstado}
                  {modificado && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-100 text-amber-800">
                      Sin guardar
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500">
                  {!s.editable
                    ? (nombreGuardado ? 'Sábado cumplido' : 'Sin designado ese sábado')
                    : (valorSeleccionado ? 'Designado elegido' : 'Pendiente de elegir')}
                </span>
              </div>

              {/* Selector para sábados de hoy/futuros, o vista protegida para sábados pasados */}
              <div className="w-full sm:w-64 sm:min-w-[230px]">
                {!s.editable ? (
                  <div className="h-[36px] px-3 rounded-xl bg-slate-100/80 border border-slate-200/80 flex items-center justify-between text-xs">
                    {nombreGuardado ? (
                      <span className="font-bold text-slate-700 truncate">
                        {nombreGuardado}
                        {rolGuardado ? <span className="text-slate-400 font-normal"> · {rolGuardado}</span> : ''}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Sin designado</span>
                    )}
                    <Lock size={12} className="text-slate-400 shrink-0 ml-2" />
                  </div>
                ) : (
                  <CustomSelect
                    options={elegibles.map(u => ({
                      value: u.id,
                      label: `${u.nombre} (${u.rol === 'supervisor' ? 'supervisor' : 'vendedor'})`,
                    }))}
                    value={valorSeleccionado}
                    onChange={val => seleccionarVendedorSabado(s.fecha, val)}
                    placeholder="Elegir vendedor…"
                    disabled={cargando || guardando || Boolean(errorCarga)}
                    searchable
                    clearable
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pie del calendario: reparto de turnos del mes + botones Deshacer / Guardar */}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-600">
          <span className="font-bold text-slate-500">Turnos en {rangoMes.etiqueta.toLowerCase()}:</span>
          {turnosMes.length === 0 ? (
            <span className="text-slate-400 italic">ningún sábado asignado todavía</span>
          ) : (
            turnosMes.map(t => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 text-slate-700 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
              >
                {t.nombre}: {t.cantidad}
              </span>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {cambiosPendientes.length > 0 && (
            <button
              type="button"
              data-testid="calendario-deshacer-btn"
              onClick={deshacerCambios}
              disabled={guardando}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50 transition-all h-[36px]"
            >
              <RotateCcw size={13} />
              Deshacer
            </button>
          )}
          <button
            type="button"
            data-testid="calendario-guardar-btn"
            onClick={abrirConfirmacion}
            disabled={guardando || cargando || Boolean(errorCarga) || cambiosPendientes.length === 0}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white px-4 py-2 rounded-xl text-xs font-black shadow-sm active:scale-95 transition-all h-[36px]"
          >
            {guardando ? <Loader2 size={13} className="animate-spin" /> : <Star size={13} />}
            {cambiosPendientes.length > 0
              ? `Guardar cambios (${cambiosPendientes.length})`
              : 'Guardar cambios del mes'}
          </button>
        </div>
      </div>

      {mensaje && (
        <p
          data-testid="calendario-mensaje"
          className={`text-xs font-bold ${mensaje.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}
        >
          {mensaje.texto}
        </p>
      )}

      {/* Ventana de confirmación con resumen completo y guardarraíl de ventas de hoy */}
      <ConfirmModal
        isOpen={modalConfirmar}
        onClose={() => setModalConfirmar(false)}
        onConfirm={confirmarGuardarMes}
        title={`¿Guardar sábados de ${rangoMes.etiqueta}?`}
        message={resumenModal}
        details={
          incluyeCambioHoy
            ? '⚠️ Atención: uno de los cambios es para HOY sábado. Las ventas que ya se hayan entregado hoy mantienen su comisión anterior hasta que se recalculen.\n\nEn las ventas de los sábados asignados, el designado cobra 0,5 % y el dueño del cliente 1,5 %.'
            : 'Cada sábado asignado repartirá la comisión: 0,5 % para el vendedor designado y 1,5 % para el dueño del cliente.'
        }
        confirmText="Sí, guardar sábados"
        cancelText="Volver"
        variant={incluyeCambioHoy ? 'warning' : 'success'}
      />
    </div>
  )
}

// ─── Vista Principal ────────────────────────────────────────────────────────
export default function ComisionesView() {
  const perfil = useAuthStore(state => state.perfil)
  const esPrivilegiado = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)

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

  const { data: comisionesRes, isLoading, isFetching: cargandoComisiones, isPlaceholderData: cambiandoComisiones, isError, refetch } = useComisiones({
    vendedorId: esPrivilegiado ? filtroVendedor : '',
    desde: rango.from,
    hasta: rango.to,
    todas: true,
  })

  useEffect(() => {
    setAjustesManuales({})
  }, [rango.from, rango.to])

  // Consulta paralela para alimentar el dropdown con todos los asesores del rango
  const { data: comisionesDropdownRes } = useComisiones({
    desde: rango.from,
    hasta: rango.to,
    todas: true,
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
      const { filteredEvents, cotizacionesMap } = await cargarEventosComisionesParaPdf({
        desde: rango?.from || '',
        hasta: rango?.to || '',
        vendedorId: filtroVendedor || '',
        tipoFiltro,
      })

      if (filteredEvents.length === 0) {
        alert('🔍 SIN DATOS: No hay comisiones registradas para el grupo de vendedores seleccionado en este rango.')
        return
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
        vendedor: vendedorInfo ? { id: vendedorInfo.id, codigo: vendedorInfo.codigo, nombre: vendedorInfo.nombre, color: vendedorInfo.color, markup_pct: vendedorInfo.markup_pct, es_externo: vendedorInfo.es_externo } : null,
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
      const { filteredEvents: rawEvents, cotizacionesMap } = await cargarEventosComisionesParaPdf({
        desde: rango?.from || '',
        hasta: rango?.to || '',
        vendedorId: vendedor?.id || '',
        tipoFiltro: 'todos',
      })

      if (rawEvents.length === 0) {
        alert(`🔍 SIN DATOS: No hay liberaciones de comisiones para ${vendedor?.nombre || 'este vendedor'} en el periodo seleccionado.`)
        return
      }

      const comisionesParaPDF = rawEvents.map(r => prepararComisionParaPDF(
        r,
        r.comisiones?.cotizacion || cotizacionesMap[r.comisiones?.cotizacionid],
        vendedor,
      ))

      await generarComisionesPDF({
        comisiones: comisionesParaPDF,
        vendedor: { id: vendedor.id, codigo: vendedor.codigo, nombre: vendedor.nombre, color: vendedor.color, markup_pct: vendedor.markup_pct, es_externo: vendedor.es_externo },
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
          <DateRangeSelector value={rango} onChange={setRango} ocultarPresets={perfil?.rol === 'administracion' ? ['thisMonth', 'lastMonth'] : undefined} />
        </div>

        {/* Fila Inferior: Vendedor con CustomSelect, Switch Formato, Tasas y Exportación */}
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-50 pt-3 w-full justify-between min-w-0">
          <div className="flex flex-wrap items-end gap-3 w-full md:w-auto min-w-0">
            {esPrivilegiado && (
              <div className="w-full sm:w-56 min-w-0">
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

            <div className="w-full sm:w-44 min-w-0">
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

          <div className="w-full md:w-auto flex flex-wrap items-center gap-2 md:ml-auto min-w-0 self-end">
            {/* Selector de Tasa Euro / USDT */}
            <div className="flex flex-wrap sm:flex-nowrap items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs font-bold min-h-9 w-full sm:w-auto min-w-0">
              <button
                type="button"
                onClick={() => setTipoTasaComision('euro')}
                className={`flex-1 sm:flex-none justify-center px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg transition-all flex items-center gap-1 min-w-0 ${
                  tipoTasaComision === 'euro'
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="Calcular comisiones con tasa Euro Oficial BCV"
              >
                <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black shrink-0">€</span>
                <span className="hidden sm:inline">Euro BCV:</span>
                <span className="sm:hidden">Euro:</span>
                <b className="truncate">{tasaEuro?.precio > 0 ? fmtBs(tasaEuro.precio) : 'N/D'}</b>
              </button>
              <button
                type="button"
                onClick={() => setTipoTasaComision('usdt')}
                className={`flex-1 sm:flex-none justify-center px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg transition-all flex items-center gap-1 min-w-0 ${
                  tipoTasaComision === 'usdt'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="Calcular comisiones con tasa USDT (Binance P2P)"
              >
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-black shrink-0 font-mono">₮</span>
                <span>USDT:</span>
                <b className="truncate">{tasaUsdt?.precio > 0 ? fmtBs(tasaUsdt.precio) : 'N/D'}</b>
              </button>
            </div>

            {/* Menús desplegables de Imprimir y Descargar */}
            <div className="flex flex-wrap items-center gap-1.5 relative w-full sm:w-auto min-w-0">
              {/* Botón Imprimir */}
              <div className="relative flex-1 sm:flex-none">
                {filtroVendedor ? (
                  <button
                    onClick={() => exportarPDF('todos', 'imprimir')}
                    disabled={exportando || isLoading || cargandoComisiones || cambiandoComisiones || comisiones.length === 0 || !tasaDisponible}
                    className="w-full sm:w-auto justify-center flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm min-h-9"
                  >
                    <Printer size={13} className="text-slate-500 shrink-0" />
                    <span className="sm:hidden">{exportando ? 'Generando...' : 'Imprimir'}</span>
                    <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Imprimir PDF'}</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setShowPrintMenu(!showPrintMenu)}
                      disabled={exportando || isLoading || cargandoComisiones || cambiandoComisiones || comisiones.length === 0 || !tasaDisponible}
                      className="w-full sm:w-auto justify-center flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm min-h-9"
                    >
                      <Printer size={13} className="text-slate-500 shrink-0" />
                      <span className="sm:hidden">{exportando ? 'Generando...' : 'Imprimir'}</span>
                      <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Imprimir PDF'}</span>
                      <ChevronDown size={12} className={`transition-transform duration-200 ${showPrintMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showPrintMenu && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowPrintMenu(false)} />
                        <div className="absolute left-0 sm:left-auto sm:right-0 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
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
              <div className="relative flex-1 sm:flex-none">
                {filtroVendedor ? (
                  <button
                    onClick={() => exportarPDF('todos', 'descargar')}
                    disabled={exportando || isLoading || cargandoComisiones || cambiandoComisiones || comisiones.length === 0 || !tasaDisponible}
                    className="w-full sm:w-auto justify-center flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md min-h-9"
                    style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
                  >
                    <Download size={13} className="shrink-0" />
                    <span className="sm:hidden">{exportando ? 'Generando...' : 'Descargar'}</span>
                    <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Descargar PDF'}</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setShowExportMenu(!showExportMenu)}
                      disabled={exportando || isLoading || cargandoComisiones || cambiandoComisiones || comisiones.length === 0 || !tasaDisponible}
                      className="w-full sm:w-auto justify-center flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md min-h-9"
                      style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
                    >
                      <Download size={13} className="shrink-0" />
                      <span className="sm:hidden">{exportando ? 'Generando...' : 'Descargar'}</span>
                      <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Descargar PDF'}</span>
                      <ChevronDown size={12} className={`transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showExportMenu && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                        <div className="absolute right-0 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
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
                            disabled={exportando || isLoading || cargandoComisiones || cambiandoComisiones || !tasaDisponible}
                            title="Descargar reporte individual"
                            className="p-2 bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-xl border border-slate-100 hover:border-indigo-200 transition-all active:scale-95 duration-200 disabled:opacity-50"
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
                            disabled={exportando || isLoading || cargandoComisiones || cambiandoComisiones || !tasaDisponible}
                            title="Descargar reporte individual"
                            className="p-2 bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-700 rounded-xl border border-amber-100 hover:border-amber-200 transition-all active:scale-95 duration-200 disabled:opacity-50"
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
