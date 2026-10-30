// src/components/transportistas/VehiculosFranja.jsx
// Franja "Vehículos de la Empresa" (Fase 3 del plan de flota): tarjetas por
// camión, alta, edición, baja inteligente y "Ver inactivos".
// Reglas respetadas:
//  - R13: crear/editar (jefe, administracion, logistica, desarrollador);
//    dar de baja también (logística incluida desde 2026-10-30).
//  - R4/R8: la baja usa eliminar_o_desactivar_vehiculo_atomico — sin viajes se
//    borra; con historial se desactiva y los viajes pasados quedan intactos.
//  - Nada de comisiones ni liquidaciones en esta pantalla (R7, Fase 4).
import { useCallback, useEffect, useState } from 'react'
import { Truck, Plus, Pencil, Ban, RefreshCw, Eye, EyeOff, User, Scale } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { useVehiculos, useCrearVehiculo, useActualizarVehiculo, useEliminarVehiculo } from '../../hooks/useVehiculos'
import ConfirmModal from '../ui/ConfirmModal'
import { showToast } from '../ui/Toast'
import { nombreVehiculo, placasVehiculo } from '../../utils/vehiculoImpreso'
import { COLORES_FLOTA_PROPIA } from '../../utils/transportistaColors'

const ROLES_GESTION = ['jefe', 'administracion', 'logistica', 'desarrollador']
const ROLES_BAJA = ['jefe', 'administracion', 'logistica', 'desarrollador']

function VehiculoForm({ inicial = {}, onGuardar, onCancelar, cargando }) {
  // Un solo dato para identificar el camión: el modelo (se guarda en `nombre`).
  // Camiones viejos con modelo aparte: se toma ese modelo como valor inicial.
  const [nombre, setNombre] = useState(inicial?.modelo || inicial?.nombre || '')
  const [placa, setPlaca] = useState(inicial?.placa ?? '')
  const [capacidadKg, setCapacidadKg] = useState(inicial?.capacidad_kg != null ? String(inicial.capacidad_kg) : '')
  const [colorBatea, setColorBatea] = useState(inicial?.color_batea ?? '')
  const [placaBatea, setPlacaBatea] = useState(inicial?.placa_batea ?? '')
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!nombre.trim()) { setError('El modelo es obligatorio'); return }
    if (!placa.trim() && !placaBatea.trim()) { setError('Indica al menos una placa: la del chuto o la de la batea'); return }
    onGuardar({
      nombre: nombre.trim(),
      placa: placa.trim().toUpperCase() || null,
      capacidad_kg: capacidadKg === '' ? null : Number(capacidadKg),
      color_batea: colorBatea.trim() || null,
      modelo: null, // el modelo vive en `nombre`; se limpia el campo aparte antiguo
      placa_batea: placaBatea.trim().toUpperCase() || null,
    })
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 placeholder:text-slate-400'

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Modelo *</label>
          <input value={nombre} onChange={e => { setNombre(e.target.value); setError('') }}
            placeholder="Ej: Ford F-350 2015" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Placa chuto</label>
          <input value={placa} onChange={e => { setPlaca(e.target.value.toUpperCase()); setError('') }}
            placeholder="Ej: A12BC3D" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Placa batea</label>
          <input value={placaBatea} onChange={e => { setPlacaBatea(e.target.value.toUpperCase()); setError('') }}
            placeholder="Ej: XY456ZW" className={inputCls} disabled={cargando} />
        </div>
        <p className="sm:col-span-2 -mt-2 text-[11px] text-slate-400">
          Indica al menos una placa. Si el camión solo tiene placa de batea, deja el chuto vacío.
        </p>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Capacidad (kg)</label>
          <input type="number" min="0" step="1" value={capacidadKg} onChange={e => setCapacidadKg(e.target.value)}
            placeholder="Ej: 12000" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Color / tipo de batea</label>
          <input value={colorBatea} onChange={e => setColorBatea(e.target.value)}
            placeholder="Ej: Batea seca blanca" className={inputCls} disabled={cargando} />
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-colors disabled:opacity-50">
          {cargando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

function VehiculoModalForm({ vehiculo = null, onClose }) {
  const crear = useCrearVehiculo()
  const actualizar = useActualizarVehiculo()
  const esEdicion = !!vehiculo

  async function guardar(campos) {
    try {
      if (esEdicion) await actualizar.mutateAsync({ id: vehiculo.id, ...campos })
      else await crear.mutateAsync(campos)
      onClose()
    } catch {
      // El hook ya mostró el error en un toast (p. ej. placa repetida)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center">
            <Truck size={18} className="text-amber-600" />
          </div>
          <h3 className="font-bold text-slate-800 text-lg">
            {esEdicion ? 'Editar vehículo' : 'Nuevo vehículo'}
          </h3>
        </div>
        <VehiculoForm
          inicial={vehiculo ?? {}}
          onGuardar={guardar}
          onCancelar={onClose}
          cargando={crear.isPending || actualizar.isPending}
        />
      </div>
    </div>
  )
}

// resaltarId: camión a enfocar al llegar desde "Vehículo fijo" de un chofer.
// Ficha del camión con el mismo diseño que la ficha del chofer (TransportistaCard):
// franja de color con ícono, nombre centrado, código interno como subtítulo
// (único lugar donde se muestra), placas como etiquetas y acciones abajo.
function VehiculoCard({ vehiculo: v, resaltado, puedeGestionar, puedeBorrar, onEditar, onBaja, onReactivar }) {
  const activo = v.activo !== false
  // Camiones de la empresa: mismo color fijo que los choferes de la flota propia.
  const colors = COLORES_FLOTA_PROPIA
  const choferes = (v.choferes_asignados || []).filter(c => c.activo !== false)
  const capacidad = Number(v.capacidad_kg) || 0

  return (
    <div id={`vehiculo-${v.id}`}
      className={`bg-white rounded-2xl border overflow-hidden flex flex-col hover:shadow-lg transition-all duration-200 ${activo ? '' : 'opacity-70 grayscale'} ${resaltado ? 'ring-2 ring-amber-400' : ''}`}
      style={{ borderColor: colors.border, boxShadow: `0 1px 3px ${colors.shadow}` }}>

      {/* ── Franja superior con color ── */}
      <div className="relative h-20 shrink-0 flex flex-col items-center justify-center gap-1"
        style={{ background: `linear-gradient(135deg, ${colors.gradientStart} 0%, ${colors.gradientEnd} 100%)` }}>
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
        <div className="relative z-10 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.4)', backdropFilter: 'blur(4px)' }}>
          <Truck size={20} color="white" />
        </div>
        <span className={`absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
          {activo ? 'Activo' : 'Inactivo'}
        </span>
      </div>

      {/* ── Nombre + código interno ── */}
      <div className="px-4 pt-3 pb-1 text-center">
        <p className="font-black text-slate-800 text-sm leading-tight truncate" title={nombreVehiculo(v)}>{nombreVehiculo(v)}</p>
        {/* Código interno (lo pone el sistema): solo se muestra aquí, en la ficha del camión */}
        {v.codigo && <p className="text-[11px] text-slate-400 font-mono mt-0.5">Código {v.codigo}</p>}
      </div>

      {/* ── Detalles ── */}
      <div className="px-4 pb-3 mt-1 space-y-1.5 flex-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
          {v.placa && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">Chuto: {v.placa}</span>}
          {v.placa_batea && (
            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
              Batea: {v.placa_batea}{v.color_batea ? ` (${v.color_batea})` : ''}
            </span>
          )}
        </div>
        {!v.placa_batea && v.color_batea && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-medium text-slate-400">Batea:</span>
            <span className="truncate">{v.color_batea}</span>
          </div>
        )}
        {capacidad > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Scale size={11} className="text-slate-400 shrink-0" />
            <span className="font-medium text-slate-400">Capacidad:</span>
            <span>{capacidad.toLocaleString('es-VE')} kg</span>
          </div>
        )}
        <div className="flex items-start gap-1.5 text-xs text-slate-500">
          <User size={11} className="text-slate-400 shrink-0 mt-0.5" />
          {choferes.length > 0
            ? <span><span className="font-medium text-slate-400">Chofer:</span> <span className="font-semibold text-slate-700">{choferes.map(c => c.nombre).join(', ')}</span></span>
            : <span className="text-slate-400">Sin chofer asignado</span>}
        </div>
      </div>

      {/* ── Acciones ── */}
      {puedeGestionar && (
        <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-1">
          {activo ? (
            <>
              <button onClick={onEditar} title="Editar"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
                <Pencil size={13} />
                Editar
              </button>
              {puedeBorrar && (
                <button onClick={onBaja} title="Eliminar"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors ml-auto">
                  <Ban size={13} />
                  Eliminar
                </button>
              )}
            </>
          ) : (
            <button onClick={onReactivar} title="Reactivar"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-colors">
              <RefreshCw size={13} />
              Reactivar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function VehiculosFranja({ resaltarId = null }) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const rol = perfil?.rol
  const puedeGestionar = ROLES_GESTION.includes(rol)
  const puedeBorrar = ROLES_BAJA.includes(rol)

  const [verInactivos, setVerInactivos] = useState(false)
  const [modalVehiculo, setModalVehiculo] = useState(null) // null | {} (nuevo) | vehículo (editar)
  const [bajando, setBajando] = useState(null)

  const { data: vehiculos = [], isLoading, refetch } = useVehiculos({ incluirInactivos: true })

  // Al llegar desde la ficha de un chofer, llevar la vista a su camión.
  useEffect(() => {
    if (!resaltarId || isLoading) return
    const objetivo = vehiculos.find(v => v.id === resaltarId)
    if (objetivo && objetivo.activo === false) setVerInactivos(true)
    const t = setTimeout(() => {
      document.getElementById(`vehiculo-${resaltarId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    return () => clearTimeout(t)
  }, [resaltarId, isLoading, vehiculos])
  const eliminar = useEliminarVehiculo()
  const actualizar = useActualizarVehiculo()

  const visibles = verInactivos ? vehiculos : vehiculos.filter(v => v.activo !== false)

  async function confirmarBaja() {
    if (!bajando) return
    try {
      const res = await eliminar.mutateAsync(bajando.id)
      if (res?.accion === 'eliminado_fisico') {
        showToast.success('Se eliminó por completo porque no tenía viajes asociados.')
      } else {
        let msg = 'Se marcó como Inactivo: sus viajes pasados siguen intactos en los reportes.'
        if (res?.choferes_desvinculados > 0) {
          msg += ` También se liberó de ${res.choferes_desvinculados} chofer(es), que quedan como "Rotativo".`
        }
        showToast(msg, 'info', 6000)
      }
    } catch {
      // El hook ya mostró el error en un toast
    } finally {
      setBajando(null)
    }
  }

  async function reactivar(v) {
    try {
      await actualizar.mutateAsync({ id: v.id, activo: true })
    } catch {
      // El hook ya mostró el error en un toast
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      {/* Encabezado de la franja */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center">
            <Truck size={16} className="text-amber-600" />
          </div>
          <p className="text-xs font-semibold text-slate-500">
            {isLoading ? 'Cargando...' : `${vehiculos.filter(v => v.activo !== false).length} activo(s) · ${vehiculos.length} en total`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVerInactivos(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            {verInactivos ? <EyeOff size={13} /> : <Eye size={13} />}
            {verInactivos ? 'Ocultar inactivos' : 'Ver inactivos'}
          </button>
          <button
            onClick={() => refetch()}
            className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            title="Actualizar"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </button>
          {puedeGestionar && (
            <button
              onClick={() => setModalVehiculo({})}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-bold shadow-md active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
            >
              <Plus size={13} /> Nuevo Vehículo
            </button>
          )}
        </div>
      </div>

      {/* Tarjetas */}
      {isLoading ? (
        <p className="text-xs text-slate-400 py-3">Cargando vehículos...</p>
      ) : visibles.length === 0 ? (
        <p className="text-xs text-slate-400 py-3">
          {verInactivos ? 'No hay vehículos registrados.' : 'No hay vehículos activos. Usa "Ver inactivos" para revisar los dados de baja.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
          {visibles.map(v => (
            <VehiculoCard
              key={v.id}
              vehiculo={v}
              resaltado={resaltarId === v.id}
              puedeGestionar={puedeGestionar}
              puedeBorrar={puedeBorrar}
              onEditar={() => setModalVehiculo(v)}
              onBaja={() => setBajando(v)}
              onReactivar={() => reactivar(v)}
            />
          ))}
        </div>
      )}

      {/* Modal crear/editar */}
      {modalVehiculo !== null && (
        <VehiculoModalForm
          vehiculo={modalVehiculo.id ? modalVehiculo : null}
          onClose={() => setModalVehiculo(null)}
        />
      )}

      {/* Confirmar baja inteligente */}
      <ConfirmModal
        isOpen={!!bajando}
        onClose={() => setBajando(null)}
        onConfirm={confirmarBaja}
        title="¿Dar de baja este vehículo?"
        message={`"${bajando?.nombre}" (${placasVehiculo(bajando)}).\nSi no tiene viajes se elimina por completo; si tiene historial se marca como Inactivo y sus viajes pasados se conservan en los reportes.`}
        confirmText="Sí, dar de baja"
        variant="danger"
      />
    </div>
  )
}
