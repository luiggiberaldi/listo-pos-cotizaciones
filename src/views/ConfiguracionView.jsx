// src/views/ConfiguracionView.jsx
// Configuración del negocio — solo supervisor (rediseñado con tabs)
import { useState, useRef, useEffect } from 'react'
import {
  Settings, Building2, Phone, Mail, MapPin, FileText, Save, CheckCircle,
  Eye, EyeOff, Accessibility, HardDrive, Download, Upload,
  AlertCircle, AlertTriangle, Percent, Users, Database, Copy, Check, DollarSign,
  ZoomIn, ZoomOut, RotateCcw,
} from 'lucide-react'
import { useConfigNegocio, useActualizarConfig, hashSHA256 } from '../hooks/useConfigNegocio'
import { useCategorias } from '../hooks/useInventario'
import CustomSelect from '../components/ui/CustomSelect'
import { fmtUsd } from '../utils/format'
import { adminAPI } from '../services/supabase/adminClient'
import useAuthStore from '../store/useAuthStore'
import UsuariosView from './UsuariosView'
import PageHeader  from '../components/ui/PageHeader'

// ─── Tabs ───────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'comisiones', label: 'Comisiones', icon: DollarSign },
  { id: 'usuarios',   label: 'Usuarios',   icon: Users     },
  { id: 'datos',      label: 'Datos',      icon: Database  },
]

// ─── Section Header reutilizable ─────────────────────────────────────────────
const SectionHeader = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-3 mb-1">
    <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: 'linear-gradient(180deg, #B8860B, #1B365D)', minHeight: '20px' }} />
    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08), rgba(184,134,11,0.08))', border: '1px solid rgba(27,54,93,0.1)' }}>
      <Icon size={13} style={{ color: '#1B365D' }} />
    </div>
    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">{children}</h2>
  </div>
)

// ─── Comisiones Tab (extraído para claridad) ─────────────────────────────────
function ComisionesTab({ campos, cambiar, isLoading, cargando }) {
  const { data: categorias = [] } = useCategorias()
  const disabled = isLoading || cargando

  // Parse categorías especiales: [{cat, pct}]
  // La primera siempre viene de comision_categoria_cabilla + comision_pct_cabilla
  // Las adicionales se guardan como JSON en un campo especial
  const [extras, setExtras] = useState([])

  // Inicializar extras desde config (puede ser array nativo o string JSON)
  useEffect(() => {
    if (campos._comision_extras) {
      try {
        const val = campos._comision_extras
        const parsed = Array.isArray(val) ? val : JSON.parse(val)
        if (Array.isArray(parsed)) setExtras(parsed)
      } catch {}
    }
  }, [campos._comision_extras])

  // Todas las categorías especiales (la principal + extras)
  const catPrincipal = campos.comision_categoria_cabilla || ''
  const catsEspeciales = [catPrincipal, ...extras.map(e => e.cat)].filter(Boolean)

  function agregarCategoria() {
    // Buscar primera categoría no usada
    const disponibles = categorias.filter(c => !catsEspeciales.includes(c))
    if (disponibles.length === 0) return
    const nuevas = [...extras, { cat: disponibles[0], pct: 2 }]
    setExtras(nuevas)
    cambiar('_comision_extras', nuevas)
  }

  function cambiarExtra(idx, campo, valor) {
    const nuevas = extras.map((e, i) => i === idx ? { ...e, [campo]: valor } : e)
    setExtras(nuevas)
    cambiar('_comision_extras', nuevas)
  }

  function eliminarExtra(idx) {
    const nuevas = extras.filter((_, i) => i !== idx)
    setExtras(nuevas)
    cambiar('_comision_extras', nuevas)
  }

  const selectOnFocus = (e) => e.target.select()

  // Categorías disponibles para nueva selección
  const catsDisponibles = categorias.filter(c => !catsEspeciales.includes(c))

  // Colores para las tarjetas
  const COLORES = [
    { from: 'from-amber-50', to: 'to-orange-50', border: 'border-amber-200', dot: 'bg-amber-500', title: 'text-amber-800', ring: 'focus:ring-amber-300', pct: 'text-amber-600', ejemplo: 'text-amber-700' },
    { from: 'from-violet-50', to: 'to-purple-50', border: 'border-violet-200', dot: 'bg-violet-500', title: 'text-violet-800', ring: 'focus:ring-violet-300', pct: 'text-violet-600', ejemplo: 'text-violet-700' },
    { from: 'from-emerald-50', to: 'to-teal-50', border: 'border-emerald-200', dot: 'bg-emerald-500', title: 'text-emerald-800', ring: 'focus:ring-emerald-300', pct: 'text-emerald-600', ejemplo: 'text-emerald-700' },
    { from: 'from-rose-50', to: 'to-pink-50', border: 'border-rose-200', dot: 'bg-rose-500', title: 'text-rose-800', ring: 'focus:ring-rose-300', pct: 'text-rose-600', ejemplo: 'text-rose-700' },
  ]

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
        <SectionHeader icon={Percent}>Tasas de comisión</SectionHeader>
        <p className="text-xs text-slate-500 -mt-2">
          Porcentaje que se calcula al marcar un despacho como entregado. Asigna tasas diferenciadas por categoría.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Tarjeta categoría principal */}
          <div className={`bg-gradient-to-br ${COLORES[0].from} ${COLORES[0].to} rounded-xl border ${COLORES[0].border} p-4 space-y-3`}>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${COLORES[0].dot}`} />
              <span className={`text-xs font-bold uppercase tracking-wider ${COLORES[0].title}`}>Categoría especial</span>
            </div>

            {/* Selector dropdown */}
            {categorias.length > 0 && (
              <CustomSelect
                options={categorias.filter(c => !extras.map(e => e.cat).includes(c)).map(c => ({ value: c, label: c }))}
                value={catPrincipal}
                onChange={val => !disabled && cambiar('comision_categoria_cabilla', val)}
                placeholder="Seleccionar categoría"
                disabled={disabled}
              />
            )}

            <div className="flex items-baseline gap-2">
              <input type="number" min="0" max="100" step="0.01"
                value={campos.comision_pct_cabilla}
                onFocus={selectOnFocus}
                onChange={e => cambiar('comision_pct_cabilla', Math.max(0, Math.min(100, Number(e.target.value))))}
                className={`w-20 px-3 py-2.5 rounded-xl border ${COLORES[0].border} bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 ${COLORES[0].ring} text-right font-bold`}
                disabled={disabled} />
              <span className={`text-lg font-bold ${COLORES[0].pct}`}>%</span>
            </div>
            <p className={`text-xs ${COLORES[0].ejemplo}`}>
              $1,000 → <strong>{fmtUsd(1000 * campos.comision_pct_cabilla / 100)}</strong>
            </p>
          </div>

          {/* Tarjetas de categorías extras */}
          {extras.map((extra, idx) => {
            const color = COLORES[(idx + 1) % COLORES.length]
            return (
              <div key={idx} className={`bg-gradient-to-br ${color.from} ${color.to} rounded-xl border ${color.border} p-4 space-y-3 relative`}>
                <button type="button" onClick={() => eliminarExtra(idx)} disabled={disabled}
                  className="absolute top-2 right-2 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                  <span className={`text-xs font-bold uppercase tracking-wider ${color.title}`}>Categoría especial {idx + 2}</span>
                </div>

                {/* Selector dropdown */}
                <CustomSelect
                  options={[
                    { value: extra.cat, label: extra.cat },
                    ...categorias.filter(c => !catsEspeciales.includes(c)).map(c => ({ value: c, label: c })),
                  ]}
                  value={extra.cat}
                  onChange={val => !disabled && cambiarExtra(idx, 'cat', val)}
                  placeholder="Seleccionar categoría"
                  disabled={disabled}
                />

                <div className="flex items-baseline gap-2">
                  <input type="number" min="0" max="100" step="0.01"
                    value={extra.pct}
                    onFocus={selectOnFocus}
                    onChange={e => cambiarExtra(idx, 'pct', Math.max(0, Math.min(100, Number(e.target.value))))}
                    className={`w-20 px-3 py-2.5 rounded-xl border ${color.border} bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 ${color.ring} text-right font-bold`}
                    disabled={disabled} />
                  <span className={`text-lg font-bold ${color.pct}`}>%</span>
                </div>
                <p className={`text-xs ${color.ejemplo}`}>
                  $1,000 → <strong>{fmtUsd(1000 * extra.pct / 100)}</strong>
                </p>
              </div>
            )
          })}

          {/* Tarjeta "Demás categorías" (siempre al final) */}
          <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Demás categorías</span>
            </div>
            <p className="text-[11px] text-slate-400">Aplica a todas las categorías sin tasa especial.</p>
            <div className="flex items-baseline gap-2">
              <input type="number" min="0" max="100" step="0.01"
                value={campos.comision_pct_otros}
                onFocus={selectOnFocus}
                onChange={e => cambiar('comision_pct_otros', Math.max(0, Math.min(100, Number(e.target.value))))}
                className="w-20 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 text-right font-bold"
                disabled={disabled} />
              <span className="text-lg font-bold text-blue-500">%</span>
            </div>
            <p className="text-xs text-slate-500">
              $1,000 → <strong>{fmtUsd(1000 * campos.comision_pct_otros / 100)}</strong>
            </p>
          </div>
        </div>

        {/* Botón agregar categoría */}
        {catsDisponibles.length > 0 && (
          <button type="button" onClick={agregarCategoria} disabled={disabled}
            className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary-hover transition-colors disabled:opacity-50">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
            Agregar otra categoría con tasa especial
          </button>
        )}
      </div>
    </div>
  )
}

export default function ConfiguracionView() {
  const { data: config = {}, isLoading } = useConfigNegocio()
  const actualizar = useActualizarConfig()
  const { perfil } = useAuthStore()
  const esSuperAdmin = perfil?.id === '00000000-0000-0000-0000-000000000000'
  const [tab, setTab]         = useState('comisiones')
  const [guardado, setGuardado] = useState(false)
  const [error,    setError]    = useState('')
  const [showGatePass, setShowGatePass] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupMsg, setBackupMsg]         = useState(null)
  const [clearLoading, setClearLoading] = useState(false)
  const [clearMsg, setClearMsg]         = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetMsg, setResetMsg]         = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [restoreMsg, setRestoreMsg]         = useState(null)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [copiedSql, setCopiedSql]           = useState(false)
  const restoreInputRef = useRef(null)

  const [modoAccesible, setModoAccesible] = useState(() =>
    localStorage.getItem('modo-accesible') === '1'
  )

  function toggleModoAccesible() {
    const next = !modoAccesible
    setModoAccesible(next)
    localStorage.setItem('modo-accesible', next ? '1' : '0')
    document.documentElement.classList.toggle('modo-accesible', next)
  }

  const [zoom, setZoom] = useState(() => {
    const saved = localStorage.getItem('app-zoom')
    return saved ? Number(saved) : 100
  })

  function applyZoom(val) {
    const clamped = Math.max(70, Math.min(130, val))
    setZoom(clamped)
    localStorage.setItem('app-zoom', String(clamped))
    document.documentElement.style.zoom = `${clamped}%`
  }

  const [campos, setCampos] = useState({
    nombre_negocio:          '',
    rif_negocio:             '',
    telefono_negocio:        '',
    email_negocio:           '',
    direccion_negocio:       '',
    pie_pagina_pdf:          '',
    validez_cotizacion_dias: 15,
    iva_pct:                 0,
    gate_email:              '',
    comision_pct_cabilla:         2,
    comision_pct_otros:           3,
    comision_categoria_cabilla:   'Cabilla',
  })
  const [gatePassword, setGatePassword] = useState('')

  useEffect(() => {
    if (config && Object.keys(config).length > 0) {
      setCampos({
        nombre_negocio:          config.nombre_negocio          ?? '',
        rif_negocio:             config.rif_negocio             ?? '',
        telefono_negocio:        config.telefono_negocio        ?? '',
        email_negocio:           config.email_negocio           ?? '',
        direccion_negocio:       config.direccion_negocio       ?? '',
        pie_pagina_pdf:          config.pie_pagina_pdf          ?? '',
        validez_cotizacion_dias: config.validez_cotizacion_dias ?? 15,
        iva_pct:                 config.iva_pct                 ?? 0,
        gate_email:              config.gate_email              ?? '',
        comision_pct_cabilla:       config.comision_pct_cabilla       ?? 2,
        comision_pct_otros:         config.comision_pct_otros         ?? 3,
        comision_categoria_cabilla: config.comision_categoria_cabilla ?? 'Cabilla',
      })
    }
  }, [config])

  async function handleClearInventory() {
    setClearLoading(true); setClearMsg(null); setConfirmClear(false)
    try {
      await adminAPI.clearInventory()
      setClearMsg({ tipo: 'ok', texto: 'Inventario borrado correctamente' })
    } catch (err) {
      setClearMsg({ tipo: 'error', texto: err.message || 'Error al borrar' })
    } finally { setClearLoading(false) }
  }

  async function handleFactoryReset() {
    setResetLoading(true); setResetMsg(null); setConfirmReset(false)
    try {
      await adminAPI.factoryReset()
      setResetMsg({ tipo: 'ok', texto: 'Reinicio completado. El inventario se conservó.' })
    } catch (err) {
      setResetMsg({ tipo: 'error', texto: err.message || 'Error al reiniciar' })
    } finally { setResetLoading(false) }
  }

  async function handleBackup() {
    setBackupMsg(null)
    try {
      const filename = await adminAPI.downloadBackup()
      setBackupMsg({ tipo: 'ok', texto: `Descargado: ${filename}` })
    } catch (err) {
      setBackupMsg({ tipo: 'error', texto: err.message || 'Error al generar backup' })
    } finally { setBackupLoading(false) }
  }

  async function handleRestoreFile(e) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    if (!confirmRestore) { setConfirmRestore(file); return }
    await doRestore(file)
  }

  async function doRestore(file) {
    setRestoreLoading(true); setRestoreMsg(null); setConfirmRestore(false)
    try {
      const resumen = await adminAPI.restoreBackup(file)
      const total   = Object.values(resumen).reduce((a, b) => a + b, 0)
      setRestoreMsg({ tipo: 'ok', texto: `Restaurado: ${total} registros en ${Object.keys(resumen).length} tablas` })
    } catch (err) {
      setRestoreMsg({ tipo: 'error', texto: err.message || 'Error al restaurar' })
    } finally { setRestoreLoading(false) }
  }

  function cambiar(k, v) { setCampos(p => ({ ...p, [k]: v })); setGuardado(false); setError('') }

  async function handleGuardar(e) {
    e.preventDefault()
    if (!campos.nombre_negocio.trim()) { setError('El nombre del negocio es obligatorio'); return }
    try {
      const datosGuardar = { ...campos }
      if (gatePassword.trim()) {
        datosGuardar.gate_password_hash = await hashSHA256(gatePassword)
        setGatePassword('')
      }
      await actualizar.mutateAsync(datosGuardar)
      setGuardado(true)
      setTimeout(() => setGuardado(false), 3000)
    } catch (err) {
      setError(err.message ?? 'Error al guardar')
    }
  }

  const migrationSql = `ALTER TABLE configuracion_negocio\n  ADD COLUMN IF NOT EXISTS iva_pct NUMERIC(5,2) NOT NULL DEFAULT 0;`
  const ivaMissing   = config.iva_pct === undefined || config.iva_pct === null

  async function copiarSql() {
    await navigator.clipboard.writeText(migrationSql).catch(() => {})
    setCopiedSql(true)
    setTimeout(() => setCopiedSql(false), 2000)
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400'
  const cargando = actualizar.isPending
  const esTabForm = tab === 'comisiones'

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 max-w-4xl space-y-4">

      {/* Encabezado */}
      <PageHeader
        icon={Settings}
        title="Configuración"
        subtitle="Ajustes del sistema y del negocio"
      />

      {/* ── Zoom de pantalla ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08), rgba(184,134,11,0.08))', border: '1px solid rgba(27,54,93,0.1)' }}>
            <Eye size={13} style={{ color: '#1B365D' }} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-700">Tamaño de pantalla</p>
            <p className="text-xs text-slate-400">Ajusta el zoom de la interfaz</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => applyZoom(zoom - 5)}
            disabled={zoom <= 70}
            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition-all disabled:opacity-30">
            <ZoomOut size={15} />
          </button>
          <span className="text-sm font-bold text-slate-700 w-12 text-center">{zoom}%</span>
          <button type="button" onClick={() => applyZoom(zoom + 5)}
            disabled={zoom >= 130}
            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition-all disabled:opacity-30">
            <ZoomIn size={15} />
          </button>
          {zoom !== 100 && (
            <button type="button" onClick={() => applyZoom(100)}
              className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
              title="Restablecer a 100%">
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-1 bg-slate-100 p-1 rounded-2xl scrollbar-hide">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all sm:flex-1 justify-center overflow-hidden ${
                active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {active && (
                <span className="absolute bottom-0 left-[20%] right-[20%] h-0.5 rounded-full"
                  style={{ background: 'linear-gradient(to right, #1B365D, #B8860B)' }} />
              )}
              <span className={`flex items-center justify-center w-5 h-5 rounded-md transition-all ${
                active ? 'text-[#1B365D]' : ''
              }`}>
                <Icon size={14} />
              </span>
              <span className="inline sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tabs de formulario — Negocio, Fiscal, Sistema */}
      {esTabForm && (
        <form onSubmit={handleGuardar} className="space-y-5">

          {/* ── Comisiones ────────────────────────────────────────────────── */}
          {tab === 'comisiones' && <ComisionesTab campos={campos} cambiar={cambiar} isLoading={isLoading} cargando={cargando} />}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
              {error.includes('iva_pct') && (
                <p className="mt-1 text-xs">Ejecuta la migración SQL en Supabase Dashboard (ver tab "Fiscal").</p>
              )}
            </div>
          )}

          {/* Botón guardar */}
          <div className="flex items-center justify-end gap-3 pb-4">
            {guardado && (
              <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                <CheckCircle size={15} /> Cambios guardados
              </div>
            )}
            <button type="submit" disabled={isLoading || cargando}
              className="flex items-center gap-2 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              {cargando
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Guardando...</>
                : <><Save size={15} />Guardar cambios</>
              }
            </button>
          </div>
        </form>
      )}

      {/* ── Tab Usuarios ───────────────────────────────────────────────────── */}
      {tab === 'usuarios' && <UsuariosView embedded />}

      {/* ── Tab Datos ──────────────────────────────────────────────────────── */}
      {tab === 'datos' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <SectionHeader icon={HardDrive}>Copia de seguridad</SectionHeader>
            <p className="text-xs text-slate-500 -mt-2">
              Descarga o importa un archivo JSON con todos los datos del sistema.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleBackup} disabled={backupLoading}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50">
                {backupLoading
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Generando...</>
                  : <><Download size={15} />Descargar backup</>
                }
              </button>
              <input ref={restoreInputRef} type="file" accept=".json" className="hidden" onChange={handleRestoreFile} />
              <button type="button" onClick={() => restoreInputRef.current?.click()} disabled={restoreLoading}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50">
                {restoreLoading
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Restaurando...</>
                  : <><Upload size={15} />Importar backup</>
                }
              </button>
            </div>
            {confirmRestore && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">¿Confirmar restauración?</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Sobreescribirá los datos existentes con <strong>{confirmRestore.name}</strong>. No se puede deshacer.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => doRestore(confirmRestore)}
                    className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
                    <Upload size={13} />Sí, restaurar
                  </button>
                  <button type="button" onClick={() => setConfirmRestore(false)}
                    className="text-sm font-medium text-slate-600 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {backupMsg && (
              <div className={`flex items-center gap-1.5 text-sm font-medium ${backupMsg.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                {backupMsg.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                {backupMsg.texto}
              </div>
            )}
            {restoreMsg && (
              <div className={`flex items-center gap-1.5 text-sm font-medium ${restoreMsg.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                {restoreMsg.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                {restoreMsg.texto}
              </div>
            )}
          </div>

          {esSuperAdmin && (
          <div className="bg-white rounded-2xl border border-red-200 p-5 space-y-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-0.5 self-stretch rounded-full shrink-0 bg-red-400" style={{ minHeight: '20px' }} />
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-red-50 border border-red-200">
                <AlertTriangle size={13} className="text-red-500" />
              </div>
              <h2 className="text-sm font-bold text-red-700 uppercase tracking-wide">Zona de peligro</h2>
            </div>
            <p className="text-xs text-slate-500 -mt-2">Acciones permanentes e irreversibles. Descarga un backup antes.</p>
            {!confirmClear ? (
              <button type="button" onClick={() => setConfirmClear(true)}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm">
                <AlertTriangle size={15} />Borrar todo el inventario
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-red-800">
                  ¿Estás seguro? Borrará <strong>todos los productos</strong> permanentemente.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={handleClearInventory} disabled={clearLoading}
                    className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                    {clearLoading
                      ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Borrando...</>
                      : 'Sí, borrar todo'
                    }
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)}
                    className="text-sm font-medium text-slate-600 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {clearMsg && (
              <div className={`flex items-center gap-1.5 text-sm font-medium ${clearMsg.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                {clearMsg.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                {clearMsg.texto}
              </div>
            )}

            <div className="border-t border-red-100 pt-4 mt-2">
              <p className="text-xs text-slate-500 mb-3">Elimina clientes, cotizaciones, despachos, comisiones y transportistas. <strong>El inventario, los usuarios y la configuración se conservan.</strong></p>
              {!confirmReset ? (
                <button type="button" onClick={() => setConfirmReset(true)}
                  className="flex items-center gap-2 bg-red-800 hover:bg-red-900 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm">
                  <AlertTriangle size={15} />Reinicio de fábrica
                </button>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-red-800">
                    ¿Estás seguro? Se borrarán clientes, cotizaciones, despachos, comisiones y transportistas. <strong>El inventario se conserva.</strong>
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleFactoryReset} disabled={resetLoading}
                      className="flex items-center gap-1.5 bg-red-800 hover:bg-red-900 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                      {resetLoading
                        ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Reiniciando...</>
                        : 'Sí, reiniciar todo'
                      }
                    </button>
                    <button type="button" onClick={() => setConfirmReset(false)}
                      className="text-sm font-medium text-slate-600 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {resetMsg && (
                <div className={`flex items-center gap-1.5 text-sm font-medium mt-2 ${resetMsg.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {resetMsg.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                  {resetMsg.texto}
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  )
}
