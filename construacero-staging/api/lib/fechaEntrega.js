const FECHA_ENTREGA_CON_ZONA_HORARIA = /(?:Z|[+-]\d{2}:\d{2})$/

export function tieneZonaHoraria(value) {
  return typeof value === 'string' && FECHA_ENTREGA_CON_ZONA_HORARIA.test(value)
}
