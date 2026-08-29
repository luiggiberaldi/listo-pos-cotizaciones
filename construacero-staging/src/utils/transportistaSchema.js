// PostgREST acepta `*` aunque existan migraciones opcionales ausentes; así
// evitamos provocar un 400 por seleccionar columnas que aún no están en el esquema.
export const TRANSPORTISTA_SELECT_ALL = '*'

export const TRANSPORTISTA_SELECT_BASE = [
  'id',
  'nombre',
  'rif',
  'telefono',
  'color',
  'color_batea',
  'vehiculo',
  'placa_chuto',
  'placa_batea',
  'activo',
  'zona_cobertura',
  'capacidad',
  'es_local',
].join(', ')

export const TRANSPORTISTA_SELECT_EXTENDED = [
  TRANSPORTISTA_SELECT_BASE,
  'tipo_relacion',
  'empleado_id',
  'fecha_inicio_relacion',
  'fecha_fin_relacion',
  'emite_comprobante',
].join(', ')

// Esquema mínimo de la migración original. Se usa durante despliegues donde
// las migraciones de clasificación/vehículo todavía no llegaron a Supabase.
export const TRANSPORTISTA_SELECT_LEGACY = [
  'id',
  'nombre',
  'rif',
  'telefono',
  'zona_cobertura',
  'tarifa_base',
  'notas',
  'activo',
  'creado_en',
  'actualizado_en',
  'creado_por',
].join(', ')

export function isMissingTransportistaColumnError(error) {
  const code = String(error?.code || '').toUpperCase()
  const message = String(error?.message || '').toLowerCase()
  return code === 'PGRST204'
    || code === '42703'
    || error?.status === 400
    || message.includes('could not find') && message.includes('column')
    || message.includes('does not exist') && message.includes('column')
    || message.includes('not found') && message.includes('column')
    || message.includes('schema cache')
}

export function normalizeTransportistaSchema(row) {
  return {
    ...row,
    es_local: row?.es_local ?? false,
    tipo_relacion: row?.tipo_relacion ?? 'proveedor',
    empleado_id: row?.empleado_id ?? null,
    fecha_inicio_relacion: row?.fecha_inicio_relacion ?? null,
    fecha_fin_relacion: row?.fecha_fin_relacion ?? null,
    emite_comprobante: row?.emite_comprobante ?? false,
  }
}
