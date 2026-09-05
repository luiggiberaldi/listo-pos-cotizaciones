// src/components/transportistas/TransportistaFormCompact.jsx
// Formulario compacto reutilizable para crear y editar transportista
import { useState, useEffect } from 'react'
import { PREFIJOS_RIF, parsearRif, formatearRif } from '../../utils/rif'

export default function TransportistaFormCompact({
  inicial = {},
  modo = 'crear',
  onGuardar,
  onCancelar,
  cargando = false,
}) {
  const parsed = parsearRif(inicial?.rif)
  const [rifPrefijo, setRifPrefijo] = useState(parsed.prefijo || 'V')
  const [rifNumero, setRifNumero] = useState(parsed.numero || '')
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [telefono, setTelefono] = useState(inicial?.telefono ?? '')
  const [color, setColor] = useState(inicial?.color ?? '')
  const [vehiculo, setVehiculo] = useState(inicial?.vehiculo ?? '')
  const [placaChuto, setPlacaChuto] = useState(inicial?.placa_chuto ?? '')
  const [placaBatea, setPlacaBatea] = useState(inicial?.placa_batea ?? '')
  const [colorBatea, setColorBatea] = useState(inicial?.color_batea ?? '')
  const [zonaCobertura, setZonaCobertura] = useState(inicial?.zona_cobertura ?? '')
  const [capacidad, setCapacidad] = useState(inicial?.capacidad ?? '')
  const [esLocal, setEsLocal] = useState(!!inicial?.es_local)
  const [notas, setNotas] = useState(inicial?.notas ?? '')
  const [error, setError] = useState('')

  // Sincronizar si cambia inicial (por ejemplo al seleccionar otro transportista)
  useEffect(() => {
    if (inicial && Object.keys(inicial).length > 0) {
      const p = parsearRif(inicial.rif)
      setRifPrefijo(p.prefijo || 'V')
      setRifNumero(p.numero || '')
      setNombre(inicial.nombre ?? '')
      setTelefono(inicial.telefono ?? '')
      setColor(inicial.color ?? '')
      setVehiculo(inicial.vehiculo ?? '')
      setPlacaChuto(inicial.placa_chuto ?? '')
      setPlacaBatea(inicial.placa_batea ?? '')
      setColorBatea(inicial.color_batea ?? '')
      setZonaCobertura(inicial.zona_cobertura ?? '')
      setCapacidad(inicial.capacidad ?? '')
      setEsLocal(!!inicial.es_local)
      setNotas(inicial.notas ?? '')
    }
  }, [inicial])

  function submit(e) {
    e.preventDefault()
    if (!nombre.trim()) { setError('El nombre es obligatorio'); return }
    onGuardar({
      nombre: nombre.trim(),
      rif: formatearRif(rifPrefijo, rifNumero),
      telefono: telefono.trim(),
      color: color.trim(),
      vehiculo: vehiculo.trim(),
      placa_chuto: placaChuto.trim().toUpperCase(),
      placa_batea: placaBatea.trim().toUpperCase(),
      color_batea: colorBatea.trim(),
      zona_cobertura: zonaCobertura.trim(),
      capacidad: capacidad.trim(),
      es_local: esLocal,
      notas: notas.trim(),
    })
  }

  const isEdit = modo === 'editar'
  const inputCls = 'w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 placeholder:text-slate-400'

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Nombre *</label>
          <input
            value={nombre}
            onChange={e => { setNombre(e.target.value.replace(/(^|\s)\S/g, c => c.toUpperCase())); setError('') }}
            placeholder="Nombre del transportista"
            className={inputCls}
            disabled={cargando}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Cédula / RIF</label>
          <div className="flex gap-1 mb-1">
            {PREFIJOS_RIF.map(p => (
              <button
                key={p}
                type="button"
                disabled={cargando}
                onClick={() => setRifPrefijo(p)}
                className={`px-2 py-0.5 rounded-lg text-xs font-bold transition-all ${
                  rifPrefijo === p
                    ? 'bg-amber-500 text-white shadow-sm scale-105'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                } disabled:opacity-50`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center">
            <span className="inline-flex items-center px-2.5 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-sm font-bold text-slate-600 select-none h-[38px]">
              {rifPrefijo}{rifPrefijo !== 'V' ? '-' : ''}
            </span>
            <input
              value={rifNumero}
              onChange={e => {
                if (rifPrefijo === 'V') {
                  setRifNumero(e.target.value.replace(/\D/g, '').slice(0, 9))
                } else {
                  const val = e.target.value.replace(/[^\d-]/g, '')
                  if (val.replace(/-/g, '').length > 10) return
                  setRifNumero(val)
                }
              }}
              placeholder={rifPrefijo === 'V' ? '24457713' : '30123456-7'}
              className={`${inputCls} !rounded-l-none !h-[38px]`}
              disabled={cargando}
              inputMode="numeric"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Teléfono</label>
          <input
            value={telefono}
            onChange={e => setTelefono(e.target.value)}
            placeholder="Ej: 0414-1234567"
            className={inputCls}
            disabled={cargando}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Vehículo</label>
          <input
            value={vehiculo}
            onChange={e => setVehiculo(e.target.value)}
            placeholder="Ej: Mack Granite 2020"
            className={inputCls}
            disabled={cargando}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Color Chuto</label>
          <input
            value={color}
            onChange={e => setColor(e.target.value)}
            placeholder="Ej: Blanco, Rojo"
            className={inputCls}
            disabled={cargando}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Color Batea</label>
          <input
            value={colorBatea}
            onChange={e => setColorBatea(e.target.value)}
            placeholder="Ej: Azul, Amarillo"
            className={inputCls}
            disabled={cargando}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Placa Chuto</label>
          <input
            value={placaChuto}
            onChange={e => setPlacaChuto(e.target.value.toUpperCase())}
            placeholder="Ej: AB123CD"
            className={inputCls}
            disabled={cargando}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Placa Batea</label>
          <input
            value={placaBatea}
            onChange={e => setPlacaBatea(e.target.value.toUpperCase())}
            placeholder="Ej: XY456ZW"
            className={inputCls}
            disabled={cargando}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Capacidad de Carga</label>
          <input
            value={capacidad}
            onChange={e => setCapacidad(e.target.value)}
            placeholder="Ej: 30 Toneladas, 350 Sacos"
            className={inputCls}
            disabled={cargando}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Cobertura (Zonas)</label>
          <input
            value={zonaCobertura}
            onChange={e => setZonaCobertura(e.target.value)}
            placeholder="Ej: Centro, Caracas, Occidente"
            className={inputCls}
            disabled={cargando}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">Notas / Observaciones</label>
        <input
          value={notas}
          onChange={e => setNotas(e.target.value)}
          placeholder="Observaciones de la unidad o chofer..."
          className={inputCls}
          disabled={cargando}
        />
      </div>

      {/* ── Transportista local ── */}
      <div className="space-y-1.5 pt-2 border-t border-slate-100">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={esLocal}
            onChange={e => setEsLocal(e.target.checked)}
            disabled={cargando}
            className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-200"
          />
          Es transportista local (cobra comisión del flete fuera de Carabobo)
        </label>
        <p className="text-[11px] text-slate-500 italic px-1">
          {esLocal
            ? 'En Carabobo se procesa por nómina externa; fuera de Carabobo genera comisión.'
            : 'Transportista General: flete directo estándar, sin comisión de nómina local.'}
        </p>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancelar}
          disabled={cargando}
          className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={cargando}
          className={`px-4 py-2 rounded-xl text-white text-xs font-semibold transition-all shadow-sm active:scale-95 disabled:opacity-50 ${
            isEdit
              ? 'bg-amber-600 hover:bg-amber-700'
              : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {cargando
            ? (isEdit ? 'Guardando...' : 'Creando...')
            : (isEdit ? 'Guardar Cambios' : 'Crear Transportista')}
        </button>
      </div>
    </form>
  )
}
