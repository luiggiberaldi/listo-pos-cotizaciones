// src/views/ConfiguracionView.jsx
// Configuración del negocio — solo supervisor
// Datos usados en el encabezado del PDF y ajustes globales
import { useState, useEffect } from 'react'
import { Settings, Building2, Phone, Mail, MapPin, FileText, Save, CheckCircle } from 'lucide-react'
import { useConfigNegocio, useActualizarConfig } from '../hooks/useConfigNegocio'

export default function ConfiguracionView() {
  const { data: config = {}, isLoading } = useConfigNegocio()
  const actualizar = useActualizarConfig()
  const [guardado, setGuardado] = useState(false)
  const [error,    setError]    = useState('')

  const [campos, setCampos] = useState({
    nombre_negocio:          '',
    rif_negocio:             '',
    telefono_negocio:        '',
    email_negocio:           '',
    direccion_negocio:       '',
    pie_pagina_pdf:          '',
    validez_cotizacion_dias: 15,
  })

  // Poblar formulario cuando carguen los datos
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
      })
    }
  }, [config])

  function cambiar(k, v) {
    setCampos(p => ({ ...p, [k]: v }))
    setGuardado(false)
    setError('')
  }

  async function handleGuardar(e) {
    e.preventDefault()
    if (!campos.nombre_negocio.trim()) { setError('El nombre del negocio es obligatorio'); return }
    try {
      await actualizar.mutateAsync(campos)
      setGuardado(true)
      setTimeout(() => setGuardado(false), 3000)
    } catch (err) {
      setError(err.message ?? 'Error al guardar')
    }
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400'
  const cargando = actualizar.isPending

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-2xl">

      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary-light rounded-xl flex items-center justify-center">
          <Settings size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Configuración del negocio</h1>
          <p className="text-sm text-slate-500">Datos que aparecen en el encabezado de los PDFs</p>
        </div>
      </div>

      <form onSubmit={handleGuardar} className="space-y-5">

        {/* Sección: Identidad */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
            <Building2 size={14} className="text-slate-400" />
            Identidad
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">Nombre del negocio *</label>
              <input
                value={campos.nombre_negocio}
                onChange={e => cambiar('nombre_negocio', e.target.value)}
                placeholder="Ej: Ferretería El Tornillo C.A."
                className={inputCls} disabled={isLoading || cargando}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">RIF</label>
              <input
                value={campos.rif_negocio}
                onChange={e => cambiar('rif_negocio', e.target.value)}
                placeholder="J-00000000-0"
                className={inputCls} disabled={isLoading || cargando}
              />
            </div>
          </div>
        </div>

        {/* Sección: Contacto */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
            <Phone size={14} className="text-slate-400" />
            Contacto
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Phone size={12} className="text-slate-400" /> Teléfono
              </label>
              <input
                value={campos.telefono_negocio}
                onChange={e => cambiar('telefono_negocio', e.target.value)}
                placeholder="0212-000-0000"
                className={inputCls} disabled={isLoading || cargando}
              />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Mail size={12} className="text-slate-400" /> Email
              </label>
              <input
                type="email"
                value={campos.email_negocio}
                onChange={e => cambiar('email_negocio', e.target.value)}
                placeholder="ventas@empresa.com"
                className={inputCls} disabled={isLoading || cargando}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <MapPin size={12} className="text-slate-400" /> Dirección
              </label>
              <input
                value={campos.direccion_negocio}
                onChange={e => cambiar('direccion_negocio', e.target.value)}
                placeholder="Av. Principal, Local 1, Caracas"
                className={inputCls} disabled={isLoading || cargando}
              />
            </div>
          </div>
        </div>

        {/* Sección: PDF */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
            <FileText size={14} className="text-slate-400" />
            PDF y cotizaciones
          </h2>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Pie de página del PDF
                <span className="ml-1.5 text-xs text-slate-400">(aparece al final de cada cotización)</span>
              </label>
              <textarea
                value={campos.pie_pagina_pdf}
                onChange={e => cambiar('pie_pagina_pdf', e.target.value)}
                rows={2}
                placeholder="Ej: Precios sujetos a cambio sin previo aviso. Válido sujeto a disponibilidad."
                className={`${inputCls} resize-none`} disabled={isLoading || cargando}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Validez por defecto de cotizaciones
                <span className="ml-1.5 text-xs text-slate-400">(días)</span>
              </label>
              <input
                type="number" min="1" max="365"
                value={campos.validez_cotizacion_dias}
                onChange={e => cambiar('validez_cotizacion_dias', Math.max(1, Number(e.target.value)))}
                className="w-32 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus"
                disabled={isLoading || cargando}
              />
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Botón guardar */}
        <div className="flex items-center justify-end gap-3">
          {guardado && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
              <CheckCircle size={15} />
              Cambios guardados
            </div>
          )}
          <button
            type="submit"
            disabled={isLoading || cargando}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50"
          >
            {cargando
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Guardando...</>
              : <><Save size={15} />Guardar cambios</>
            }
          </button>
        </div>
      </form>
    </div>
  )
}
