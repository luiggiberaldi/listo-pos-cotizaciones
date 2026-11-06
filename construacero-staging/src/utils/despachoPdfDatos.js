// Datos del despacho para imprimir un PDF: lo que se lee fresco de la base de datos
// se combina con lo que ya tiene la tarjeta en pantalla.
//
// Por qué existe: la tarjeta puede tener una copia vieja del despacho (edición hecha en otro
// equipo, pantalla sin refrescar). Los montos y los ids siempre salen de la lectura fresca.
// Los datos "enriquecidos" (cliente, cliente_factura, vendedor) vienen de otras consultas
// y no se pueden releer aquí; por eso se VERIFICA que sigan siendo los mismos y, si cambiaron,
// no se imprime (es mejor un aviso que un PDF con el cliente o el vendedor equivocado).

// Transportista y vehículo del viaje se releen junto con el despacho (mismas columnas que la
// lista en useDespachos.js; si allí cambian, actualizar aquí).
export const SELECT_DESPACHO_PARA_PDF = `*,
  transportista:transportistas!notas_despacho_transportista_id_fkey(id, nombre, rif, telefono, color, color_batea, vehiculo, placa_chuto, placa_batea, es_local, vehiculo_habitual_id),
  vehiculo_viaje:vehiculos!notas_despacho_vehiculo_id_fkey(id, codigo, nombre, modelo, placa, placa_batea, color_batea, capacidad_kg)`

const RELACIONES_A_VERIFICAR = [
  ['cliente_id', 'cliente', 'el cliente'],
  ['cliente_factura_id', 'cliente_factura', 'el cliente de la factura'],
  ['vendedor_id', 'vendedor', 'el vendedor'],
]

export const MENSAJE_SIN_LECTURA = 'No se pudo verificar el monto actualizado del despacho. Revisa tu conexión e intenta de nuevo.'

export function combinarDespachoFresco(tarjeta, fresco) {
  if (!fresco) throw new Error(MENSAJE_SIN_LECTURA)
  for (const [columna, clave, nombre] of RELACIONES_A_VERIFICAR) {
    const idTarjeta = tarjeta?.[clave]?.id
    const idFresco = fresco[columna]
    if (idTarjeta && idFresco && idTarjeta !== idFresco) {
      throw new Error(`Cambió ${nombre} de este despacho desde que abriste la tarjeta. Actualiza la lista e intenta de nuevo.`)
    }
  }
  return { ...tarjeta, ...fresco }
}
