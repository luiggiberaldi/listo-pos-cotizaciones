# OP-2026-088 — Arreglo: no dejaba facturar un préstamo ("No se pudo obtener la tasa BCV") y modal mejorado

**Fecha:** 2026-11-25 · **Alcance:** solo staging. Va dentro de la solicitud de cambio #84 (OP-2026-086). **No cambia producción.**
**Estado:** corregido y probado en código y base; **falta que el dueño lo vea en pantalla** (ver "Sin verificar").

## En resumen

- **Qué pasaba:** al tocar "Facturar" en un préstamo salía el aviso rojo "No se pudo obtener la tasa BCV del día". Aunque la tasa sí estaba cargada, el botón nunca funcionaba.
- **Causa (error mío en OP-2026-086):** la pantalla guarda la tasa como un paquete de datos (precio, fecha, etc.) y el código la trataba como un número suelto, así que siempre daba "no válida". Las pruebas de OP-086 llamaban al servidor directamente y no pasaban por esa pantalla, por eso no lo vieron.
- **Arreglo:** ahora se usa el precio dentro de ese paquete. Una prueba automática nueva impide que vuelva a pasar.
- **Modal mejorado:** al facturar se ve, antes de confirmar, el **precio del despacho original**, la **tasa BCV del día**, y **cuánto se sumará a la deuda** (en dólares y en bolívares). El botón dice "Facturar $X" con el monto real. Se agregaron atajos "Mitad" y "Todo", aviso en rojo si la cantidad pasa de lo pendiente, y el botón se bloquea si falta la cantidad, la tasa o el precio. Devolver explica que vuelve al inventario y no cobra nada. La tarjeta del préstamo ahora muestra el precio real del despacho (antes mostraba el precio actual del producto, que podía ser distinto).

## Cómo está hecho (detalle técnico)

- `FichaClienteModal.jsx`: `tasaDelDia = Number(tasaBcv?.precio)`; formulario con vista previa y validaciones.
- Migración `325_staging_precio_prestamo_compartido.sql` (+ rollback), **aplicada en staging**: función `precio_unitario_prestamo` con la fórmula del precio (precio del despacho × (1 − descuento) − descuento de línea), usada tanto por `facturar_prestamo_atomico` como por la vista previa (`precios_unitarios_prestamos`). Lo que se ve es lo que se cobra. Solo el servidor las puede usar.
- `api/handlers/clientes.js`: la lista de préstamos devuelve `precio_facturacion_usd` por préstamo.

## Pruebas

- `vitest`: **559/559** (incluye `op088PrestamosModal.test.js`); `vite build`: OK.
- Probador completo de staging: **123/123** (después de la migración 325); pruebas extra `op084-pruebas-staging.mjs`: **17/17**.
- La función de precio, llamada por el servidor sobre el préstamo de prueba del dueño (120 m³ de grava, $22): devuelve **$22,00**.

## Sin verificar

- **No se vio el modal nuevo con un préstamo real en pantalla:** la sesión del navegador integrado es de otra empresa de prueba (sin clientes), y el cliente del dueño solo se ve con su propio usuario. El dueño debe recargar y probar.
- Facturar un préstamo con la pantalla (clic completo) no está cubierto por una prueba automática de navegador.
