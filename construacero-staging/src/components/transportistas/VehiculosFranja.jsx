// src/components/transportistas/VehiculosFranja.jsx
// Franja "Vehículos de la Empresa" (Fase 3 del plan de flota): tarjetas por
// camión, alta, edición, baja inteligente y "Ver inactivos".
// Reglas respetadas:
//  - R13: crear/editar (jefe, administracion, logistica, desarrollador);
//    dar de baja solo (jefe, administracion, desarrollador).
//  - R4/R8: la baja usa eliminar_o_desactivar_vehiculo_atomico — sin viajes se
//    borra; con historial se desactiva y los viajes pasados quedan intactos.
//  - Nada de comisiones ni liquidaciones en esta pantalla (R7, Fase 4).
import { useCallback, useEffect, useState } from 'react'
import { Truck, Plus, Pencil, Ban, RefreshCw, Eye, EyeOff, User } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { useVehiculos, useCrearVehiculo, useActualizarVehiculo, useEliminarVehiculo } from '../../hooks/useVehiculos'
import ConfirmModal from '../ui/ConfirmModal'
import { showToast } from '../ui/Toast'
import { nombreVehiculo } from '../../utils/vehiculoImpreso'

const ROLES_GESTION = ['jefe', 'administracion', 'logistica', 'desarrollador']
const ROLES_BAJA = ['jefe', 'administracion', 'desarrollador']

function VehiculoForm({ inicial = {}, onGuardar, onCancelar, cargando }) {
  const [codigo, setCodigo] = useState(inicial?.codigo ?? '')
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [placa, setPlaca] = useState(inicial?.placa ?? '')
  const [capacidadKg, setCapacidadKg] = useState(inicial?.capacidad_kg != null ? String(inicial.capacidad_kg) : '')
  const [colorBatea, setColorBatea] = useState(inicial?.color_batea ?? '')
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!codigo.trim()) { setError('El código es obligatorio'); return }
    if (!nombre.trim()) { setError('El nombre es obligatorio'); return }
    if (!placa.trim()) { setError('La placa es obligatoria'); return }
    onGuardar({
      codigo: codigo.trim(),
      nombre: nombre.trim(),
      placa: placa.trim().toUpperCase(),
      capacidad_kg: capacidadKg === '' ? null : Number(capacidadKg),
      color_batea: colorBatea.trim() || null,
    })
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 placeholder:text-slate-400'

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Código *</label>
          <input value={codigo} onChange={e => { setCodigo(e.target.value.toUpperCase()); setError('') }}
            placeholder="Ej: CAM-01" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Nombre corto *</label>
          <input value={nombre} onChange={e => { setNombre(e.target.value); setError('') }}
            placeholder="Ej: Camión 01" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Placa *</label>
          <input value={placa} onChange={e => { setPlaca(e.target.value.toUpperCase()); setError('') }}
            placeholder="Ej: A12BC3D" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Capacidad (kg)</label>
          <input type="number" min="0" step="1" value={capacidadKg} onChange={e => setCapacidadKg(e.target.value)}
            placeholder="Ej: 12000" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
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
          <div>
            <h3 className="font-black text-slate-800 text-sm leading-tight">Vehículos de la Empresa</h3>
            <p className="text-[11px] text-slate-400">
              {isLoading ? 'Cargando...' : `${vehiculos.filter(v => v.activo !== false).length} activo(s) · ${vehiculos.length} en total`}
            </p>
          </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {visibles.map(v => (
            <div key={v.id} id={`vehiculo-${v.id}`} className={`rounded-xl border p-3 space-y-2 transition-all ${v.activo !== false ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-slate-100 opacity-75'} ${resaltarId === v.id ? 'ring-2 ring-amber-400 border-amber-300' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-black text-slate-800 text-sm leading-tight truncate" title={nombreVehiculo(v)}>{nombreVehiculo(v)}</p>
                  <p className="text-[11px] text-slate-500 font-mono">{v.placa}</p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${v.activo !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                  {v.activo !== false ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <div className="space-y-1 text-[11px] text-slate-500">
                {v.capacidad_kg != null && (
                  <p><span className="text-slate-400 font-medium">Capacidad:</span> {Number(v.capacidad_kg).toLocaleString('es-VE')} kg</p>
                )}
                {v.color_batea && (
                  <p><span className="text-slate-400 font-medium">Batea:</span> {v.color_batea}</p>
                )}
                <p className="flex items-start gap-1">
                  <User size={11} className="text-slate-400 shrink-0 mt-0.5" />
                  <span>
                    {(v.choferes_asignados || []).filter(c => c.activo !== false).length > 0
                      ? <>Chofer: <span className="font-semibold text-slate-700">{v.choferes_asignados.filter(c => c.activo !== false).map(c => c.nombre).join(', ')}</span></>
                      : <span className="text-slate-400">Sin chofer asignado</span>}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1 pt-1 border-t border-slate-100">
                {puedeGestionar && (
                  v.activo !== false ? (
                    <>
                      <button
                        onClick={() => setModalVehiculo(v)}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 transition-colors"
                      >
                        <Pencil size={12} /> Editar
                      </button>
                      {puedeBorrar && (
                        <button
                          onClick={() => setBajando(v)}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors ml-auto"
                        >
                          <Ban size={12} /> Eliminar
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => reactivar(v)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
                    >
                      <RefreshCw size={12} /> Reactivar
                    </button>
                  )
                )}
              </div>
            </div>
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
        message={`"${bajando?.codigo} ${bajando?.nombre}" (${bajando?.placa}).\nSi no tiene viajes se elimina por completo; si tiene historial se marca como Inactivo y sus viajes pasados se conservan en los reportes.`}
        confirmText="Sí, dar de baja"
        variant="danger"
      />
    </div>
  )
}
