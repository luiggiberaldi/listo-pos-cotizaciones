// src/components/vehiculos/VehiculoViajeSelect.jsx
// "Vehículo para este viaje" (Fase 3 del plan de flota): solo aplica a choferes
// locales. El camión habitual se autocompleta al elegir el chofer (lo hace el
// padre en su onChange); la casilla opcional deja ese camión como el nuevo fijo
// del chofer (actualizarVehiculoHabitual). Cambiar el camión sin la casilla
// aplica SOLO a ese viaje y nunca toca la ficha del chofer (raíl R12).
import CustomSelect from '../ui/CustomSelect'
import { useVehiculos } from '../../hooks/useVehiculos'
import { nombreVehiculo } from '../../utils/vehiculoImpreso'
import { Truck } from 'lucide-react'

export default function VehiculoViajeSelect({
  transportista,
  vehiculoId,
  onChange,
  fijar = false,
  onChangeFijar,
  disabled = false,
}) {
  const { data: vehiculos = [] } = useVehiculos()

  // Un camión propio solo aplica a choferes locales; los externos viajan con
  // su propio vehículo y no se les enlaza ninguno (raíl R2).
  if (!transportista?.es_local) return null

  const activos = vehiculos.filter(v => v.activo !== false)

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Vehículo para este viaje</p>
      <CustomSelect
        value={vehiculoId || ''}
        onChange={v => onChange(v || '')}
        options={activos.map(v => ({
          value: v.id,
          label: nombreVehiculo(v),
          selectedLabel: nombreVehiculo(v),
          sub: [v.placa, v.capacidad_kg ? `${v.capacidad_kg} kg` : ''].filter(Boolean).join(' · ') || undefined,
        }))}
        placeholder="— Sin camión asignado —"
        clearable
        icon={Truck}
        disabled={disabled}
      />
      <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer select-none pt-0.5">
        <input
          type="checkbox"
          checked={!!fijar}
          onChange={e => onChangeFijar?.(e.target.checked)}
          disabled={disabled || !vehiculoId}
          className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-amber-500 focus:ring-amber-200"
        />
        <span>Dejar este vehículo como el nuevo camión fijo de este chofer</span>
      </label>
    </div>
  )
}
