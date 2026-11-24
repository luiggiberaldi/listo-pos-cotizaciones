# OP-2026-061 — La deuda del cliente se actualiza sola en las pantallas abiertas

**Fecha:** 2026-11-24 · **Pedido del dueño:** "¿Cómo hacemos para que, al hacer un cambio, el cliente se vea actualizado de inmediato, sin tener que recargar?"
**Viene de:** [OP-2026-060](OP-2026-060_pagos-no-registrados-propuesta.md). Después de corregir los 4 pagos, Albert y Yahveh seguían saliendo con deuda en pantalla hasta recargar la página.

## En resumen

- **Antes:** si un cambio venía de otra computadora o de una corrección hecha directo en la base, la lista de clientes seguía mostrando la deuda vieja hasta recargar. La ficha (historial de abonos y cargos) tampoco se refrescaba sola.
- **Ahora:** cuando cambia un cliente, o un abono o cargo de su cuenta, todas las pantallas abiertas se actualizan solas en 1 o 2 segundos. Al volver a la app después de un rato (otra pestaña, celular bloqueado) también se refrescan los clientes.
- Los cambios hechos **desde la app** ya se veían al instante; eso no cambió.
- **Probado** en staging: la base avisó los dos cambios. Pasan las 1.204 pruebas automáticas y la app se construye sin errores. **Publicado** en producción (ver abajo).

## Por qué pasaba (con una analogía)

La app guarda en el equipo una copia de la lista de clientes para abrir rápido. Cuando algo cambia en la base, la base manda un "aviso".

- Para los clientes, la app recibía el aviso pero solo lo marcaba como "pendiente de leer". Era como recibir un mensaje y no abrirlo hasta salir y volver a entrar.
- Para los abonos y cargos ni siquiera llegaba el aviso, porque esa tabla no estaba en la lista de avisos de la base.

## Qué se cambió

| Pieza | Cambio |
|---|---|
| Pantallas (`src/hooks/useRealtimeSync.js`) | Un aviso de cliente ahora **redibuja** la pantalla abierta. Se agregó el aviso de abonos y cargos, que actualiza la ficha y la deuda. Los avisos seguidos se juntan, con 1 segundo de espera, para no recargar a cada rato. Al volver a la app se refrescan también clientes y cuentas por cobrar |
| Base de datos | `310_realtime_cuentas_por_cobrar.sql` en producción y `309_staging_realtime_cuentas_por_cobrar.sql` en staging: la base avisa los cambios de cuentas por cobrar. Cada pantalla solo recibe lo que ya tiene permiso de ver (mismas reglas de acceso de siempre) |
| Versión de staging (`construacero-staging/`) | El mismo cambio, para que las dos versiones sigan iguales |
| Prueba automática | [`realtimeSync061.test.js`](../../src/utils/__tests__/realtimeSync061.test.js), 3 pruebas |

**Cómo deshacer:**
- Base de datos: aplicar `310_realtime_cuentas_por_cobrar_rollback.sql` (en staging, `309_staging_…_rollback.sql`).
- Código: "Instant Rollback" en Vercel.

Ninguno de los dos toca datos.

## Verificación

- **Staging:** se aplicó la actualización. Con [`probar_aviso_staging.mjs`](OP-2026-061_scripts/probar_aviso_staging.mjs) se escucharon los avisos igual que lo hace la app, y se "tocó" un movimiento y un cliente sin cambiar nada. Llegaron los dos avisos (cuentas por cobrar y clientes).
- **Código:** 120 archivos con 1.204 pruebas en verde y la construcción sin errores.
- **Producción:** la actualización quedó aplicada y la base ya avisa los cambios de clientes y de cuentas por cobrar. Los saldos no cambiaron: deudas $72.399,70 y saldos a favor $674,15. En producción no se hizo la prueba de "tocar" un registro, para no escribir nada.

## Publicación

Ver la fila del [registro](REGISTRO.md): número de solicitud de cambio y commit.

## Pendiente

- Verlo en una pantalla real: con la lista de clientes abierta en dos equipos, registrar un abono en uno y ver que el otro cambia solo en 1 o 2 segundos.
