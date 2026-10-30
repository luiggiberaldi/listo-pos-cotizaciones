# Pase a producción — Flota propia y choferes locales (2026-10-30)

## En resumen

- **Todo está preparado y probado; no se ha tocado producción.** El código nuevo ya está
  copiado a la carpeta de producción y el paquete de base de datos se ensayó completo sobre
  datos reales de staging sin dejar rastro.
- **El orden es obligatorio: primero la base de datos, después el código.** Si el código se
  publica antes, crear o editar despachos fallaría en producción, porque pediría casillas
  (columnas) que todavía no existen. Es como instalar un mueble nuevo antes de hacerle espacio.
- **Hay marcha atrás para cada paso**, y el día del pase se tarda unos 20–30 minutos.

## Avance — 2026-10-30

- ✅ **Respaldo completo de producción hecho y verificado.** Está en
  `Desktop/construacero-backups/pre-flota-283-286-2026-10-30-12-14-49/` (fuera del proyecto, no
  viaja a git): 85 tablas y 65.072 filas. Se restauró en una base de prueba local y las 39 tablas
  del negocio coincidieron fila por fila (PASS). Los avisos que muestra son de piezas internas de
  Supabase (avisos en tiempo real, bóveda de secretos, búsqueda por vectores) que no existen en un
  PostgreSQL normal; esas tablas estaban vacías.
- ✅ **Revisión previa de producción (solo lectura) en verde:**
  `docs/operaciones/flota-283-286-preflight-produccion-2026-10-30-16-18-40.md`. No existe nada de
  flota todavía y no falta ninguna columna. 5 choferes locales, todos con placa (ninguno queda sin
  camión); unos 187 viajes viejos quedarán marcados como estimados (≈).
- ⚠️ **Posible chofer duplicado:** dos choferes locales (Chofer 1 y Chofer 5 en el
  informe) tienen la misma placa; compartirán un solo camión. Los nombres están en el respaldo local. Conviene desactivar uno de los dos después del pase.
- ✅ **283 y 286 aplicadas en producción** (`docs/operaciones/flota-283-286-aplicar-produccion-2026-10-30-16-20-07.md`):
  4 camiones creados, los 5 choferes locales con camión fijo, 187 viajes marcados como estimados (≈),
  ningún externo con camión propio y **huella del dinero idéntica** antes y después.
- ⚠️ **Un control de permisos no pasó:** en producción Supabase da por defecto todos los permisos de
  tabla, y la tabla `vehiculos` quedó escribible desde el navegador (solo la cuenta propia, por la
  regla de aislamiento). Riesgo bajo, pero contradice la regla "solo el servidor escribe".
  Corrección preparada (solo quita permisos): `supabase/release/main/283b_flota_permisos_vehiculos_produccion.sql`.
- ✅ **283b aplicada (autorizada por el dueño, 2026-10-30).** Verificado después: el Worker
  escribe, el navegador solo lee, el visitante sin sesión no tiene acceso; los 4 camiones intactos
  y el servidor de producción responde (ping 200). Políticas iguales a staging.
- ✅ **Corrección de datos de la carga histórica (autorizada por el dueño).** La carga tomaba la
  placa de batea como chuto cuando el chuto estaba vacío y no copiaba la placa de batea. Se
  corrigieron 3 camiones con candados (solo si seguían exactamente igual): placas de batea en su
  campo y una batea que se había perdido. Viajes de cada camión sin cambios.
- ✅ **287 aplicada (chuto opcional, al menos una placa)** y los 2 camiones que solo tenían placa
  de batea quedaron sin chuto repetido. Verificado: los 4 camiones coinciden con las fichas viejas.
  Reversa: `supabase/release/main/287_flota_placa_chuto_opcional_rollback_review.sql`.
- ⚠️ Dos fichas de chofer local son la misma persona (misma cédula y placa); comparten el camión
  correcto. Pendiente: desactivar la ficha repetida.
- ⏳ Falta: unir el PR (paso 4) para publicar la web y el Worker con el código de flota.

## Qué entra en este pase

| Parte | Qué es | Dónde |
|---|---|---|
| Base de datos (283) | Tabla de camiones, camión fijo del chofer, camión de cada viaje, carga histórica marcada como estimada (≈), bajas protegidas y reporte de flota | `supabase/release/main/283_flota_vehiculos_locales_apply.sql` |
| Base de datos (286) | Reporte detallado por camión y "viaje por viaje" | `supabase/release/main/286_flota_reporte_detallado_apply.sql` |
| Servidor (Worker) | Rutas de camiones y de reportes de flota; camión del viaje en venta rápida, cotización y despacho; días en hora de Caracas | `worker.js`, `api/handlers/*.js` |
| Pantallas | Pestañas Transportistas / Flota local, selector "Vehículo para este viaje", nueva pestaña Transportistas de Reportes con PDF resumido/detallado | `src/...` (raíz) |

**Lo que NO entra (a propósito):**

- La unificación visual de las otras pestañas de Reportes (Ventas, Vendedores, Crédito y
  Externos). Producción ya tiene su propio rediseño de Crédito (con búsqueda, páginas y alertas)
  y además oculta algunos atajos de fecha al rol administración; mezclarlos era arriesgado y no
  es parte de flota. Queda como tarea aparte.
- Un ajuste interno de inicio de sesión que solo servía a las pruebas automáticas de staging.

## Cómo se pasó el código (para revisión técnica)

La carpeta de producción (raíz) y la de staging ya eran distintas antes de este trabajo
(141 archivos de pantalla y 42 del servidor). Por eso **no se copió staging encima**: se
aplicaron solo los cambios de flota con una mezcla de tres vías:

- 14 archivos nuevos y 11 idénticos → copiados tal cual.
- 19 archivos ya distintos → mezclados; 31 choques resueltos a mano conservando siempre la
  regla de producción y sumando lo de flota. Se descartó un bloque de "reingreso de
  inventario" que producción ya tenía en su propia versión.
- Comprobaciones: la web de producción compila; **801 pruebas automáticas pasan**, incluidas
  las de flota, que ahora leen el SQL del paquete de producción.

## El día del pase — pasos

> Sugerencia: hacerlo fuera del horario de ventas (por ejemplo, temprano en la mañana).

1. **Respaldo.** En el panel de Supabase de producción, confirmar que existe un respaldo
   reciente (Database → Backups). El cambio solo *agrega* cosas; la carga histórica solo
   rellena casillas nuevas, así que la marcha atrás deja todo como estaba.
2. **Revisión previa (solo lectura):**

   ```bash
   PROD_FLOTA_CONFIRM=LEER_PREFLIGHT_PRODUCCION node scripts/apply-283-286-flota-produccion.mjs preflight
   ```

   Revisar en el informe que genera (en `docs/operaciones/`) la lista de choferes locales: los
   que salen "sin placa" quedarán sin camión y habrá que crearles uno a mano después.
3. **Aplicar a la base de datos:**

   ```bash
   PROD_FLOTA_CONFIRM=APLICAR_283_286_PRODUCCION node scripts/apply-283-286-flota-produccion.mjs aplicar
   ```

   El programa comprueba antes las huellas de los archivos (que nadie los haya cambiado), se
   detiene solo si algo no cuadra y al final compara la huella del dinero (antes = después).
   Debe terminar con **OK**.
4. **Publicar el código:** unir el PR a `main`. Vercel (web) y Cloudflare (Worker) se
   publican solos en unos 3–5 minutos.
5. **Prueba rápida en producción:** abrir Transportistas → Flota local, revisar los camiones;
   hacer una venta rápida con un chofer local y ver que sugiere su camión; abrir Reportes →
   Transportistas y descargar el PDF resumido.

## Marcha atrás

- **Si falla el paso 3:** la 283 se hace en un solo bloque; si algo falla, se deshace sola.
- **Si hay un problema después del paso 4:** primero revertir el código (deshacer la unión del
  PR) y después ejecutar `286_flota_reporte_detallado_rollback_review.sql` y luego
  `283_flota_vehiculos_locales_rollback_review.sql`. Se pierde solo la asignación de camiones;
  no se tocan ventas, despachos, pagos ni comisiones.

## Evidencia

- Ensayo completo en staging: `docs/operaciones/flota-283-286-ensayo-staging-2026-10-30-16-03-11.md`
  (OK: 6 columnas, 5 funciones, permisos cerrados al navegador, staging intacto después).
- Huellas del paquete: `supabase/release/main/283_286_flota_SHA256SUMS.txt`.

## Notas aparte

- **Clave de la cuenta de prueba de staging:** la prueba automática nocturna de GitHub
  (01:00 hora de Venezuela) vuelve a preparar esa cuenta con una clave nueva al azar. Por eso
  la clave del archivo deja de servir de un día para otro. Se arregla guardando la clave fija
  como secreto `STAGING_E2E_PASSWORD` en GitHub.
- **Modo sin conexión:** el sistema no funciona sin internet (decisión del dueño), así que el
  `descuento_usd` sin definir del guardado *offline* de `CotizacionBuilder.jsx` no afecta la operación.
