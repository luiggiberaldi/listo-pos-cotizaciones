// Clases para el contenedor de un reporte: atenúa todo lo que va debajo del primer bloque
// (la tarjeta de filtros) mientras se actualizan los datos.
export const claseAtenuar = (actualizando) =>
  actualizando ? '[&>*:not(:first-child)]:opacity-50 [&>*:not(:first-child)]:pointer-events-none' : ''
