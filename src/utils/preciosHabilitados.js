// src/utils/preciosHabilitados.js
// Visibilidad de Precio 2 / Precio 3 por producto.
//
// Un precio inhabilitado (precio2_habilitado / precio3_habilitado = false) se
// trata como INEXISTENTE en toda superficie de venta (cotizaciones, venta
// rápida, inventario): no se muestra ni se ofrece como nivel de precio. El
// valor (precio_2 / precio_3) se conserva en la base y sigue visible en el
// formulario de producto, que es la superficie de gestión.
//
// Defensivo: si el flag no viene en los datos (cache antigua, campos parciales)
// se asume habilitado, que es el comportamiento histórico.

/** ¿El producto ofrece Precio 2 (Mayor)? Incluye que tenga valor cargado. */
export function precio2Visible(producto) {
  return !!producto && producto.precio2_habilitado !== false && producto.precio_2 != null
}

/** ¿El producto ofrece Precio 3 (Especial)? Incluye que tenga valor cargado. */
export function precio3Visible(producto) {
  return !!producto && producto.precio3_habilitado !== false && producto.precio_3 != null
}
