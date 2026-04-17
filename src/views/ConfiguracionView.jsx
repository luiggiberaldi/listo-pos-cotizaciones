// src/views/ConfiguracionView.jsx
// Configuración del negocio — solo supervisor (rediseñado con tabs)
import { useState, useRef, useEffect } from 'react'
import {
  Settings, Building2, Phone, Mail, MapPin, FileText, Save, CheckCircle,
  Lock, Eye, EyeOff, Accessibility, HardDrive, Download, Upload,
  AlertCircle, AlertTriangle, Percent, Users, Database, Copy, Check,
} from 'lucide-react'
import { useConfigNegocio, useActualizarConfig, hashSHA256 } from '../hooks/useConfigNegocio'
import { adminAPI } from '../services/supabase/adminClient'
import UsuariosView from './UsuariosView'
import PageHeader  from '../components/ui/PageHeader'

// ─── Tabs ───────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'negocio',  label: 'Negocio',   icon: Building2 },
  { id: 'fiscal',   label: 'Fiscal',    icon: Percent   },
  { id: 'sistema',  label: 'Sistema',   icon: Lock      },
  { id: 'usuarios', label: 'Usuarios',  icon: Users     },
  { id: 'datos',    label: 'Datos',     icon: Database  },
]

export default function ConfiguracionView() {
  const { data: config = {}, isLoading } = useConfigNegocio()
  const actualizar = useActualizarConfig()
  const [tab, setTab]         = useState('negocio')
  const [guardado, setGuardado] = useState(false)
  const [error,    setError]    = useState('')
  const [showGatePass, setShowGatePass] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupMsg, setBackupMsg]         = useState(null)
  const [clearLoading, setClearLoading] = useState(false)
  const [clearMsg, setClearMsg]         = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)
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
  const esTabForm = ['negocio', 'fiscal', 'sistema'].includes(tab)

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-4xl space-y-5">

      {/* Encabezado */}
      <PageHeader
        icon={Settings}
        title="Configuración"
        subtitle="Ajustes del sistema y del negocio"
      />

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-1 bg-slate-100 p-1 rounded-2xl">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex-1 justify-center ${
                active
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tabs de formulario — Negocio, Fiscal, Sistema */}
      {esTabForm && (
        <form onSubmit={handleGuardar} className="space-y-5">

          {/* ── Negocio ─────────────────────────────────────────────────── */}
          {tab === 'negocio' && (
            <>
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
                  <Building2 size={14} className="text-slate-400" /> Identidad del negocio
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-sm font-medium text-slate-700">Nombre del negocio *</label>
                    <input value={campos.nombre_negocio} onChange={e => cambiar('nombre_negocio', e.target.value)}
                      placeholder="Ej: Ferretería El Tornillo C.A." className={inputCls} disabled={isLoading || cargando} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">RIF</label>
                    <input value={campos.rif_negocio} onChange={e => cambiar('rif_negocio', e.target.value)}
                      placeholder="J-00000000-0" className={inputCls} disabled={isLoading || cargando} />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
                  <Phone size={14} className="text-slate-400" /> Contacto
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      <Phone size={12} className="text-slate-400" /> Teléfono
                    </label>
                    <input value={campos.telefono_negocio} onChange={e => cambiar('telefono_negocio', e.target.value)}
                      placeholder="0212-000-0000" className={inputCls} disabled={isLoading || cargando} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      <Mail size={12} className="text-slate-400" /> Email
                    </label>
                    <input type="email" value={campos.email_negocio} onChange={e => cambiar('email_negocio', e.target.value)}
                      placeholder="ventas@empresa.com" className={inputCls} disabled={isLoading || cargando} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      <MapPin size={12} className="text-slate-400" /> Dirección
                    </label>
                    <input value={campos.direccion_negocio} onChange={e => cambiar('direccion_negocio', e.target.value)}
                      placeholder="Av. Principal, Local 1, Caracas" className={inputCls} disabled={isLoading || cargando} />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Fiscal ──────────────────────────────────────────────────── */}
          {tab === 'fiscal' && (
            <>
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
                  <Percent size={14} className="text-slate-400" /> Impuestos
                </h2>

                {ivaMissing ? (
                  <div className="space-y-3">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                        <div className="space-y-2 min-w-0">
                          <p className="text-sm font-semibold text-amber-800">Requiere migración de base de datos</p>
                          <p className="text-xs text-amber-700">
                            Para activar el IVA, ejecuta este SQL en el <strong>Editor SQL de Supabase Dashboard</strong>:
                          </p>
                          <div className="relative">
                            <pre className="bg-amber-100 rounded-lg p-3 text-xs font-mono text-amber-900 overflow-x-auto whitespace-pre-wrap">{migrationSql}</pre>
                            <button type="button" onClick={copiarSql}
                              className="absolute top-2 right-2 p-1.5 rounded-lg bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors">
                              {copiedSql ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">
                        Porcentaje de IVA
                        <span className="ml-1.5 text-xs text-slate-400">(0 = desactivado)</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input type="number" min="0" max="100" step="0.01"
                          value={campos.iva_pct}
                          onChange={e => cambiar('iva_pct', Math.max(0, Math.min(100, Number(e.target.value))))}
                          className="w-28 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus text-right"
                          disabled={isLoading || cargando} />
                        <span className="text-lg font-bold text-slate-500">%</span>
                        {campos.iva_pct > 0 && (
                          <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2.5 py-1 rounded-full">
                            Activo — {campos.iva_pct}% IVA
                          </span>
                        )}
                        {campos.iva_pct === 0 && (
                          <span className="text-xs bg-slate-100 text-slate-500 font-semibold px-2.5 py-1 rounded-full">
                            Desactivado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">
                        Venezuela aplica IVA general del 16%. Se añade al subtotal de cada cotización.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
                  <FileText size={14} className="text-slate-400" /> Cotizaciones
                </h2>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Pie de página del PDF
                      <span className="ml-1.5 text-xs text-slate-400">(aparece al final de cada cotización)</span>
                    </label>
                    <textarea value={campos.pie_pagina_pdf} onChange={e => cambiar('pie_pagina_pdf', e.target.value)}
                      rows={2} placeholder="Ej: Precios sujetos a cambio sin previo aviso."
                      className={`${inputCls} resize-none`} disabled={isLoading || cargando} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Validez por defecto
                      <span className="ml-1.5 text-xs text-slate-400">(días)</span>
                    </label>
                    <input type="number" min="1" max="365"
                      value={campos.validez_cotizacion_dias}
                      onChange={e => cambiar('validez_cotizacion_dias', Math.max(1, Number(e.target.value)))}
                      className="w-32 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus"
                      disabled={isLoading || cargando} />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Sistema ─────────────────────────────────────────────────── */}
          {tab === 'sistema' && (
            <>
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
                  <Lock size={14} className="text-slate-400" /> Acceso al sistema
                </h2>
                <p className="text-xs text-slate-500 -mt-2">
                  Credenciales compartidas en todos los dispositivos. Cada vendedor se identifica después con su PIN.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      <Mail size={12} className="text-slate-400" /> Correo de acceso
                    </label>
                    <input type="email" value={campos.gate_email} onChange={e => cambiar('gate_email', e.target.value)}
                      placeholder="negocio@ejemplo.com" className={inputCls} disabled={isLoading || cargando} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      <Lock size={12} className="text-slate-400" /> Nueva contraseña
                      <span className="text-xs text-slate-400">(vacío = no cambiar)</span>
                    </label>
                    <div className="relative">
                      <input type={showGatePass ? 'text' : 'password'} value={gatePassword}
                        onChange={e => { setGatePassword(e.target.value); setGuardado(false); setError('') }}
                        placeholder="••••••••" className={`${inputCls} pr-10`} disabled={isLoading || cargando} />
                      <button type="button" onClick={() => setShowGatePass(!showGatePass)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-sky-500 transition-colors">
                        {showGatePass ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
                {config.gate_email && (
                  <p className="text-xs text-emerald-600 font-medium">Acceso configurado: {config.gate_email}</p>
                )}
                {!config.gate_email && (
                  <p className="text-xs text-amber-600 font-medium">Sin configurar — cualquier persona puede acceder.</p>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
                  <Accessibility size={14} className="text-slate-400" /> Modo lectura fácil
                </h2>
                <p className="text-xs text-slate-500 -mt-2">
                  Textos y botones más grandes. Solo aplica en este dispositivo.
                </p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-700">Activar modo lectura fácil</p>
                    <p className="text-xs text-slate-400">Mayor contraste y tamaño</p>
                  </div>
                  <button type="button" onClick={toggleModoAccesible}
                    className={`relative w-12 h-7 rounded-full transition-colors ${modoAccesible ? 'bg-sky-500' : 'bg-slate-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${modoAccesible ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </>
          )}

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
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50">
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
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
              <HardDrive size={14} className="text-slate-400" /> Copia de seguridad
            </h2>
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

          <div className="bg-white rounded-2xl border border-red-200 p-5 space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-bold text-red-700 uppercase tracking-wide">
              <AlertTriangle size={14} className="text-red-500" /> Zona de peligro
            </h2>
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
          </div>
        </div>
      )}
    </div>
  )
}
