# Prueba manual de flota en staging (navegador) — 2026-10-28

## En resumen

- **El flujo de camiones funciona de punta a punta** en staging: chofer con camión fijo, camión que se
  autocompleta, cambio solo para un viaje, edición que no reescribe el camión, reporte por camión y por
  chofer, y PDF con el camión real.
- La prueba encontró **un error serio** (la tabla de camiones sin permisos: la lista daba error 500) y
  **cuatro errores menores**. Todos quedaron corregidos en staging, menos uno de texto y una definición que
  quedan como decisión.

## Escenario probado (cuenta de prueba `staging-e2e@listo.sys`, operador "Jefe E2E Staging")

| Paso | Resultado |
| :--- | :--- |
| Crear chofer A (local, fijo CAM-01) y chofer B (local, fijo CAM-02) desde Transportistas | ✅ Aparece el selector "Vehículo habitual asignado" al marcar "Es transportista local" |
| Venta rápida 3251 con chofer A, sin tocar el camión | ✅ Se autocompletó CAM-01; guardado `auto_habitual` |
| Venta 3252 con chofer A, camión cambiado a CAM-03 solo para ese viaje | ✅ Guardado CAM-03 `manual`; el fijo de A sigue siendo CAM-01 |
| Venta 3253 con chofer B | ✅ CAM-02 `auto_habitual` |
| Editar el 3252 cambiando solo el flete ($30 → $35) | ✅ La ventana muestra CAM-03 precargado; tras guardar sigue CAM-03 `manual` (error 2.1 corregido) |
| Aprobar 3252 y 3253, entregar 3253 | ✅ |
| Reporte → Transportistas → Cuadro 1 y 2 | ✅ CAM-03: 1 viaje $35 (chofer A); CAM-02: 1 viaje $40 (chofer B); comisión pendiente A $7, B $8 |
| Datos que imprimen guía/orden/nota | ✅ 3252 imprime CAM-03 / TST-003, no el camión fijo |

Los tres viajes de prueba (3251, 3252 y 3253) y los dos choferes quedan en staging como datos de prueba.

## Errores encontrados y corregidos

| # | Error | Gravedad | Arreglo |
| :--- | :--- | :--- | :--- |
| 1 | La tabla `vehiculos` se creó sin permisos: `/api/vehiculos/listar` respondía 500 ("permission denied") y la franja de camiones salía vacía | 🔴 | Migración `284_staging_flota_grants_vehiculos.sql` aplicada (evidencia `apply-284-flota-grants-staging-*.md`). Los permisos también se agregaron al paquete de producción `283_*_apply.sql` y a su postflight |
| 2 | Crear o editar un transportista (y las pantallas de usuarios, configuración y registros) decía "No autenticado": se buscaba la cabecera `Authorization` con mayúscula y llegaba en minúscula. Error anterior a flota, solo en staging | 🟠 | `useTransportistas.js` y `adminClient.js` aceptan ambas formas |
| 3 | Las tarjetas de camiones no se refrescaban al crear o editar un chofer | 🟡 | Se refresca la lista de camiones tras crear, editar o desactivar |
| 4 | Las tarjetas y el Cuadro 2 mostraban 55 choferes de prueba dados de baja | 🟡 | Se ocultan los inactivos (en el Cuadro 2, solo si no tienen viajes) |
| 5 | En el PDF el nombre del camión salía repetido ("CAM-01 CAM-01 NPR") | 🟡 | No se repite el código si el nombre ya lo trae |

## Pendientes (decisión del dueño)

- **Texto "Nómina externa · Carabobo"** en la tarjeta del despacho: es correcto según la regla (un chofer local
  dentro de Carabobo no cobra comisión de flete; se le paga por nómina), pero se presta a confusión. Ver la
  recomendación en el chat.
- **Confirmación de Venta rápida:** en "Transporte" muestra el vehículo escrito en la ficha del chofer, no el
  camión del viaje.
- **Dos reportes con criterios distintos:** la tabla vieja de Transportistas cuenta también los despachos sin
  aprobar (chofer A: 2 viajes, $55); los cuadros nuevos solo cuentan aprobados o entregados (1 viaje, $35),
  como fija el raíl R7.

## Actualización 2026-10-29 — texto de la tarjeta del despacho (decidido por el dueño)

- "Nómina externa · Carabobo" → **"Flota propia · Carabobo — flete por nómina"**.
- "Comisión externa: $X" → **"Flota propia · comisión del chofer: $X"**.
- Nueva línea **"Camión: CAM-03 Canter (TST-003)"** con el camión real del viaje (solo choferes locales).
- No se comprobó en pantalla porque el servidor web de staging estaba apagado. Pruebas internas (168) y armado en verde.
