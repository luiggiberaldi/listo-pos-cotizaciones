# OP-2026-071 — Plan integral de correcciones, pruebas y re-auditoría del inventario en staging

- **Fecha:** 2026-11-24 (ejecutado 2026-11-25)
- **Estado:** ✅ Ejecutado completo en staging — ver reporte [OP-2026-075](../operaciones/OP-2026-075_correcciones-y-reauditoria-inventario-staging.md) (pendiente revisión visual en ventana Hub y aprobación para paso a producción)
- **Alcance:** **Solo staging** (la copia de pruebas en `construacero-staging/` y base `spupqgkdsgohxxfoxydl`). **Producción (`oyfyuszgjwcepjpngclv`) NO se toca** en este plan.
- **Origen:** [OP-2026-067](../operaciones/OP-2026-067_auditoria-logica-y-flujos-inventario-e2e.md) (auditoría inicial + diagrama) · [OP-2026-068](../operaciones/OP-2026-068_simulacion-fallas-inventario-staging.md) (confirmación en vivo de `N25`–`N35`) · [Registro de fallas](../operaciones/REGISTRO-FALLAS-CODIGO.md) (`46` fallas registradas).

---

## En resumen

- **Qué vamos a hacer:** tapar las **11 fallas de inventario (`N25`–`N35`: 5 graves, 4 importantes y 2 menores)** más **2 trabas propias de staging** que salieron en [OP-2026-068](../operaciones/OP-2026-068_simulacion-fallas-inventario-staging.md) (el permiso bloqueado de `revertir_movimiento_inventario_atomico` y el permiso abierto `N16`), trabajando **paso por paso en staging**.
- **Cómo trabajamos sin romper nada:** igual que un mecánico que primero revisa qué piezas tiene el carro de pruebas antes de cambiarle el motor:
  1. **Fase 0:** igualamos la copia de pruebas (`construacero-staging/`) con los archivos de inventario que ya usa producción y guardamos una copia de seguridad de las recetas actuales de la base.
  2. **Fases 1 a 4:** arreglamos las fallas en orden de riesgo (primero las 5 graves, luego blindajes y detalles). **Cada arreglo primero reproduce la falla en rojo y luego comprueba que pasa en verde.**
  3. **Fase 5:** corremos **toda la batería de pruebas** junta (pruebas automáticas de código, nuestro guion `OP-068` ahora exigiendo que todas las trampas queden bloqueadas, las `123+` pruebas automáticas de staging **dos veces seguidas**, y recorrido real en navegador con varios roles).
  4. **Fase 6:** hacemos una **re-auditoría limpia de punta a punta** sobre todos los flujos de staging para cazar si quedó algún error escondido o si algún arreglo tocó algo de más, y te entregamos el **reporte completo** (`OP-2026-072`).
- **Para arrancar sin frenos:** solo necesito que apruebes este plan y me confirmes **3 decisiones cortas de negocio** (abajo van con nuestra recomendación marcada).

---

## Decisiones de negocio (estado actual)

1. **Al editar un producto y hacer conteos físicos (`N25`) — ✅ Decidido por el dueño (2026-11-24):**
   - En la ficha general de editar producto (`ProductoForm`), `stock_actual` queda en **solo lectura** (editar precios, nombres o fotos nunca modifica ni envía existencias).
   - Justo al lado en la ficha habrá un botón aparte **"Ajustar por conteo físico"** (pide el stock exacto contado + motivo obligatorio y valida el stock real en vivo contra el servidor: si alguien vendió mientras tanto, avisa y frena en lugar de pisar la venta).
   - Además, en **Movimiento de inventario** (`MovimientoLoteModal`) se agrega la pestaña **"Conteo físico (fijar exacto)"** para ajustar varios productos en lote con la misma protección de concurrencia.
2. **Mercancía en préstamo (`N27` y `N35`) — ✅ Decidido por el dueño (2026-11-24):**
   - Todo artículo marcado como préstamo (`es_prestamo = true`) **descuenta inventario al aprobar/entregar el despacho** (igual que una venta física), **no toca inventario** si después se factura en dinero (`handleFacturarPrestamo`), **solo reingresa** por el módulo de Préstamos cuando el cliente lo devuelve físicamente, y queda **estrictamente prohibido** devolverlo por *"Devolución parcial"*.
   - *Nota histórica:* en el sistema existen `4` préstamos viejos (de mayo–julio, `#665`, `#692`, `#1648`) que ya descontaron en su momento con la regla anterior; sus devoluciones siguen funcionando normalmente.
3. **Compras / Órdenes de compra y Proveedores (`N32`) — ✅ Decidido por el dueño (2026-11-24): NO suman inventario por ahora:**
   - Respetamos al 100% que Órdenes de Compra y Proveedores solo lleven cuentas y **no muevan inventario** por ahora (las mercancías siguen entrando manualmente desde Inventario).
   - Sin tocar esa regla, en Fase 4 proponemos dejar estas **2 protecciones prácticas en Inventario y Administración** (más un aviso visual opcional si ayuda):
     1. **Respaldo completo (`admin.js`):** incluir el historial de Kardex (`inventario_movimientos`) y `cliente_prestamos` en el respaldo y restauración JSON para no perder historia ni descuadrar saldos.
     2. **Alerta anti-doble carga en Inventario:** avisar antes de guardar si ya existe un lote/movimiento reciente con exactamente el mismo motivo/guía y productos (evita cargar dos veces la misma factura).
     3. *(Opcional)* Dejar un letrero discreto en Órdenes de Compra / Proveedores recordando *"No suma inventario"* — o dejar esas dos pantallas intactas si lo prefieres.

---

## Reglas de seguridad del plan (innegociables)

1. **Entorno único de trabajo:** carpeta `construacero-staging/` (Frontend en `http://localhost:5174`, Worker local en `http://127.0.0.1:8789`) y proyecto Supabase de staging `spupqgkdsgohxxfoxydl` (aplicando SQL vía Management API con el token de `construacero-staging/.env`, patrón `construacero-staging/scripts/apply-286-flota-reporte-staging.mjs`). **Cero escrituras a producción (`oyfyuszgjwcepjpngclv`).**
2. **Cada cambio en la base de datos lleva par completo y respaldo previo:**
   - Respaldo de cuerpos vivos de funciones antes de tocarlas ("pre-imagen", lección `262→263` del runbook `deploy-staging.md`).
   - Migración `NNN_staging_<tema>.sql` + su reversa `NNN_staging_<tema>_rollback.sql` en `construacero-staging/supabase/migrations/` (numeración correlativa desde `310_staging_*` tras `309_staging_realtime_cuentas_por_cobrar.sql`).
3. **Disciplina de pruebas ("rojo → arreglo → verde → regresión"):**
   - Ninguna fase cierra hasta pasar sus pruebas nuevas, las de fases anteriores, el build sin errores y la limpieza de datos temporales (`0` filas residuales).
4. **Control de paridad para cuando toque producción:**
   - Como staging tiene envolturas `_staging` (ej. `reabrir_despacho_con_pagos_staging`, `editar_despacho_profundidad_con_cxc_staging`, `aplicar_movimiento_inventario_atomico_staging`), anotaremos en cada migración exactamente qué cambia en la función base vs la envoltura para que el futuro paquete de producción (otro caso aparte, con su propia aprobación) sea limpio.

---

## Fases de ejecución

### Fase 0 — Preparación, paridad de staging y línea base (antes de corregir)

**Por qué hace falta (analogía):** antes de arreglar un problema eléctrico, primero nos aseguramos de que el plano de la casa de pruebas coincide con la casa real. Hoy `construacero-staging/` quedó con varios archivos más viejos que producción (por ejemplo `useInventario.js` llamando directo a Supabase en lugar de pasar por el Worker, y `useDespachos.js` con restos de `stock_comprometido` que ya se retiró en el Release 17).

- **Archivos a comparar y alinear en `construacero-staging/` contra la raíz `construacero/`:**
  - `construacero-staging/src/hooks/useInventario.js` (pasar `crear/actualizar/borrar` por `/api/productos/*`, alineado al contrato `rpcProductContract.test.js`).
  - `construacero-staging/src/hooks/useDespachos.js` (limpiar referencias residuales a `stock_comprometido`, respetando los arreglos CxC propios de staging).
  - Revisar diferencias en `src/components/inventario/ProductoForm.jsx`, `KardexModal.jsx`, `IngresoLoteHubModal.jsx`, `src/components/despachos/DevolucionParcialModal.jsx`, `EditarItemsDespachoModal.jsx`, `api/handlers/inventario.js`, `api/handlers/despachos.js`, `api/handlers/clientes.js` — uniendo a mano sin pisar `donacion` ni CxC de staging.
- **Acciones:**
  1. Guardar pre-imagen SQL de todas las funciones vivas de staging que se modificarán (`pg_get_functiondef`) en `tmp/op071-staging-preimages.sql`.
  2. Correr línea base completa y guardar resultados:
     - `npm --prefix construacero-staging test` y `npm --prefix construacero-staging run build`
     - `node scripts/op068-simular-fallas-inventario-staging.mjs` (confirmando punto de partida con las fallas reproduciéndose)
     - `npm --prefix construacero-staging run test:e2e:staging` y `npm --prefix construacero-staging run monitor:kardex:staging`
- **Criterio de salida de Fase 0:** staging alineado en archivos de inventario con el comportamiento actual de producción, pre-imágenes guardadas y línea base documentada.

---

### Fase 1 — Frenar los descuadres diarios: ficha de producto y Kardex (`N25`, `N26` + bloqueo 403 en staging)

**Meta:** que editar el precio o nombre de un producto **nunca más** borre ventas/compras recientes, y que "Revertir" en el Kardex funcione **solo** para ajustes manuales reales (cerrando la puerta a revertir devoluciones, cortes o reversiones anteriores).

#### `N25` — Editar producto no pisa stock + flujo seguro para conteo físico
- **Cambios en BD (`310_staging_inventario_ficha_y_kardex.sql` + `_rollback.sql`):**
  - En `actualizar_producto_con_kardex_tenant_safe`: cambiar `p_stock_actual` para aceptar `DEFAULT NULL` e incorporar parámetro opcional `p_expected_stock_actual NUMERIC DEFAULT NULL` y `p_motivo_ajuste TEXT DEFAULT NULL`.
  - Si `p_stock_actual IS NULL`: **solo actualiza metadatos** (nombre, código, precios, costo, mínimo, categoría, foto) sin tocar `stock_actual` ni crear movimiento en Kardex.
  - Si `p_stock_actual` viene informado (solo desde botón *"Ajustar por conteo físico"* o pestaña *"Conteo físico"*): exigir `p_expected_stock_actual` y motivo obligatorio dentro de `FOR UPDATE`; si `stock_actual` real en BD difiere (`ABS(v_actual - p_expected_stock_actual) > 0.0001`), abortar con `CONFLICTO_CONCURRENCIA_STOCK` (indicando el stock real actual). En caso contrario, calcular la diferencia exacta y anotar `ajuste_inventario` en el Kardex.
  - Nueva RPC o modo en `aplicar_movimiento_inventario_atomico_staging` para **conteo físico por lote** (`[{ producto_id, stock_contado, stock_esperado }]` con `FOR UPDATE` ordenado por `producto_id`, bloqueando el lote completo si algún artículo cambió mientras contaban).
- **Cambios en Worker (`construacero-staging/api/handlers/inventario.js`):**
  - En `/api/productos/actualizar`: por defecto enviar `p_stock_actual = null`; solo aceptar ajuste de stock cuando venga `ajustarStockExplicito: true` junto con `expectedStockActual` y `motivoAjuste`.
  - En `/api/inventario/movimiento` (o ruta `/api/inventario/conteo`): soportar el modo `"Conteo físico (fijar exacto)"` validando `stock_esperado` y motivo.
- **Cambios en Frontend (`construacero-staging/src/components/inventario/ProductoForm.jsx`, `MovimientoLoteModal.jsx`, `src/hooks/useInventario.js`):**
  - En `ProductoForm`: stock como campo **solo de lectura** en edición general, acompañado del botón aparte **"Ajustar por conteo físico"** (muestra stock actual vivo, pide stock contado + motivo y envía `expectedStockActual`).
  - En `MovimientoLoteModal`: agregar tercera pestaña **"Conteo físico"** (muestra stock actual, permite ingresar cantidad contada exacta por producto, muestra la diferencia `+ / -` antes de confirmar y valida concurrencia).

#### `N26` — Kardex con `origen_tipo` real, bloqueo de reversiones indebidas y arreglo del permiso 403 en staging
- **Cambios en BD (`310_staging_inventario_ficha_y_kardex.sql`):**
  - **`GRANT EXECUTE` faltante en staging (migración 275):** otorgar `EXECUTE` de `revertir_movimiento_inventario_atomico` explícitamente a `service_role` (manteniendo revocado para `PUBLIC, anon, authenticated`).
  - Bloquear la fila original (`SELECT ... FOR UPDATE`) antes de validar si ya fue revertida (`NOT EXISTS` con `origen_tipo = 'reversion_inventario' AND origen_id = p_movimiento_id`) para impedir doble reversión por clics paralelos.
  - Endurecer la regla de elegibilidad: prohibir revertir si `motivo_tipo IN ('venta', 'devolucion', 'transferencia')` **O** si `origen_tipo IS NOT NULL AND origen_tipo NOT IN ('movimiento_inventario', 'ajuste_inventario')` (así quedan bloqueadas devoluciones de despacho, `loan_return`, cortes `transformacion_inventario`, ingresos en lote `batch_ingest`, reversiones previas `reversion_inventario` y cierres `product_delete`).
- **Cambios en Frontend (`construacero-staging/src/hooks/useMovimientosInventario.js`, `src/components/inventario/KardexModal.jsx`):**
  - En `useKardex`: agregar `origen_tipo, origen_id, origen_referencia` al `.select(...)`.
  - En `KardexModal.jsx` (`KardexRow`): corregir la condición de elegibilidad — como hoy un ajuste manual guarda `origen_tipo = 'movimiento_inventario'` (confirmado en `OP-068`), usar lista explícita: `!yaRevertida && !['venta', 'devolucion', 'transferencia'].includes(m.motivo_tipo) && (!m.origen_tipo || ['movimiento_inventario', 'ajuste_inventario'].includes(m.origen_tipo))`. Mostrar insignia visual para reversiones (`"Revertida"`) y etiqueta clara de origen.

#### Pruebas de Fase 1 (rojo → arreglo → verde)
- **Nuevas pruebas Vitest:** payload de `ProductoForm`/`useActualizarProducto` no incluye `stock_actual`; `useKardex` consulta `origen_tipo` y `KardexModal` oculta "Revertir" en devoluciones/cortes/préstamos pero lo muestra en ajustes manuales (`movimiento_inventario` / `null`).
- **Pruebas en vivo staging:**
  - Escenario `N25`: producto en `100` → salida `-10` (`90`) → editar nombre/precio → stock **sigue en `90`**.
  - Escenario `N26` + `construacero-staging/scripts/test-revertir-movimiento-staging.mjs`: `revertir_movimiento_inventario_atomico` deja de dar HTTP 403, revierte un ajuste manual en verde, rechaza segundo clic, y rechaza revertir una devolución, un `loan_return`, un corte o una reversión previa.

---

### Fase 2 — Préstamos, Devolución Parcial y Reapertura/Edición de Despachos (`N27`, `N35`, `N28`, `N31`)

**Meta:** que ningún flujo de ventas, préstamos o cambios de despacho invente o pierda unidades ni regale dinero.

#### `N27` — Préstamos descuentan al salir y se controlan al reabrir/anular
- **Cambios en BD (`311_staging_prestamos_reapertura_intercambios.sql` + `_rollback.sql`):**
  - Retirar el filtro `AND COALESCE(ndi.es_prestamo, FALSE) = FALSE` de:
    - `aprobar_despacho_inventario_atomico` (al aprobar, descuenta del almacén también los ítems prestados),
    - `confirmar_entrega_inventario_atomica` / `_staging` (en entrega directa desde `pendiente`, descuenta también préstamos),
    - `revertir_entrega_inventario_atomica` y `revertir_despacho_inventario_atomica` (al volver a `pendiente` o `anulada`, si un préstamo tiene `cantidad_devuelta > 0` o `cantidad_facturada > 0` bloquear con `PRESTAMO_YA_MOVIDO` para no duplicar reingreso; si sigue intacto, reingresa todo al stock y anula/limpia el préstamo pendiente),
    - `editar_despacho_profundidad` (si un despacho en `despachada` modifica cantidades o marca `es_prestamo`, mantiene consistencia exacta con el stock ya egresado).
  - En `handleFacturarPrestamo` (`construacero-staging/api/handlers/clientes.js`): verificar que facturar un préstamo crea el cargo CxC sin volver a restar inventario (la mercancía ya salió al aprobar).
  - *Nota operativa:* verificar en staging que si existe algún préstamo histórico previo a este cambio (`cantidad_devuelta = 0`), al devolverlo no rompa datos viejos.

#### `N35` — Bloquear devolución parcial sobre ítems prestados
- **Cambios en Frontend (`construacero-staging/src/components/despachos/DevolucionParcialModal.jsx`):**
  - Filtrar/deshabilitar líneas con `es_prestamo === true` en el selector de devolución parcial con aviso claro: *"Artículo en préstamo: devolver desde la ficha de Préstamos del cliente"*.
- **Cambios en Worker (`construacero-staging/api/handlers/despachos.js`, `handleDevolucionParcialDespacho`):**
  - Si alguna línea enviada apunta a un `notas_despacho_items` con `es_prestamo = TRUE`, devolver HTTP `400`: `"Los artículos en préstamo deben devolverse desde el módulo de Préstamos, no por Devolución parcial"`.
- **Cambios en BD (`311_staging_...sql`):**
  - En `registrar_devolucion_inventario_atomica` y `registrar_devolucion_parcial_cobro_staging` (y `devolucion_con_donacion_staging`): validar contra `notas_despacho_items` que `COALESCE(es_prestamo, FALSE) = FALSE`; de lo contrario `RAISE EXCEPTION 'ITEM_PRESTAMO_NO_DEVOLVIBLE_PARCIAL'`.

#### `N28` y `N31` — Reapertura con devoluciones, Edición profunda e Intercambios múltiples
- **Cambios en BD (`311_staging_...sql`):**
  1. **Unificar sobre-cargas (`N28`):** consolidar/eliminar las firmas huérfanas de 2 y 5 argumentos de `editar_despacho_profundidad` si no están en uso, dejando la firma canónica limpia para evitar confusión entre versiones.
  2. **Neto exacto en `revertir_despacho_inventario_atomica` (`N28`):** cuando un despacho en `despachada` pasa a `pendiente` o `anulada`, usar la **misma consulta neta** que `revertir_entrega_inventario_atomica`: sumar `ndi.cantidad - COALESCE(dev.cantidad_devuelta, 0)` para originales **y** sumar los intercambios netos por producto (`SUM(intercambio) - COALESCE(SUM(dev_intercambio), 0)`), limpiando `despacho_devoluciones` / `despacho_devolucion_intercambios` e inhabilitando `tiene_devoluciones = false` dentro de la misma transacción.
  3. **`v_mapa_viejo` exacto en `editar_despacho_profundidad` (`N28`):** cuando el despacho en `despachada` aún tiene devoluciones/intercambios vivos en el libro, calcular lo que **sigue físicamente afuera** (`original - devuelto + intercambios_netos`) en vez de tomar el bruto original, y absorber/retirar las filas del libro dentro de la misma transacción (coherente con `retirarDevolucionesAbsorbidas` y `editarItemsRetiraDevoluciones.test.js`).
  4. **Agrupación de intercambios (`N31`):** en `revertir_entrega_inventario_atomica` y `revertir_despacho_inventario_atomica`, **agrupar `despacho_devolucion_intercambios` por `producto_id` (`SUM(cantidad)`) ANTES** de restar `SUM(despacho_devoluciones.cantidad_devuelta)` (hoy resta lo devuelto a cada fila por separado). Corregir el mismo cálculo en `construacero-staging/api/handlers/despachos.js` (donde validaba solo `.find()` sobre la primera fila de intercambio).
  5. **Concurrencia al aprobar (`N31`):** mantener el bloqueo de fila `FOR UPDATE` por `producto_id` ordenado en `aprobar_despacho_inventario_atomico` (evita interbloqueos). **Respetar la regla vigente de venta anticipada** verificada en `egresoInventarioContract.test.js`, o hacer explícita la consulta de `configuracion_negocio.permitir_stock_negativo` según confirme el dueño (documentando alertas visuales claras cuando dos aprobaciones simultáneas dejen en negativo).

#### Pruebas de Fase 2 (rojo → arreglo → verde)
- Actualizar/ampliar `despachosReversionDevoluciones.test.js`, `editarItemsRetiraDevoluciones.test.js`, `despachosPartialAtomic.test.js` y contrato de préstamos.
- Correr pruebas en vivo en staging:
  - `N27`: préstamo `5` baja `50 → 45` al entregar y vuelve `45 → 50` al devolver; facturarlo deja stock en `45`.
  - `N35`: despacho mixto (`$100` pago + préstamo `4`) bloquea devolución parcial sobre el ítem prestado en UI, Worker y BD (`$0` crédito fantasma).
  - `N28`: despacho con devolución parcial + intercambio reabierto a `despachada → pendiente` devuelve exactamente `40` y `20`; edición profunda `10 → 7` tras devolver `3` deja stock exacto en `33`.
  - `N31`: 2 intercambios (`2 + 3`) + devolución `1` → al reabrir a `pendiente` devuelve exactamente `4` (`46 → 50`).

---

### Fase 3 — Blindar contra duplicados y puertas traseras (`N29`, `N30` + brechas de staging `N16`)

**Meta:** que un mal internet o doble clic nunca duplique movimientos y que nadie pueda escribir inventario saltándose al Worker.

#### `N29` — Clave única (`Idempotency-Key`) estable en las pantallas faltantes
- Verificar e igualar/agregar `idempotencyKeyRef` (misma clave por intento mientras dura la operación o modal abierto, reseteada solo al cerrar o cambiar datos) + cabecera HTTP `'Idempotency-Key'` y campo `idempotencyKey` en el body en:
  1. `construacero-staging/src/hooks/useDespachos.js` (`useActualizarEstadoDespacho` y `useDevolucionParcialDespacho`).
  2. `construacero-staging/src/components/despachos/DevolucionParcialModal.jsx` (persistir clave única mientras el modal está abierto para un envío y solo renovarla cuando cambia el envío o se completa).
  3. `construacero-staging/src/components/inventario/ModalTransformacion.jsx` (hoy no envía ninguna clave; agregar `idempotencyKeyRef`).
  4. `construacero-staging/src/components/inventario/IngresoLoteHubModal.jsx` (ya tiene `idempotencyKeyRef` en staging; asegurarse de enviar también cabecera `'Idempotency-Key'` y mantenerlo en ambos árboles).
  5. Revisar `MovimientoLoteModal.jsx` y `useMovimientosInventario.js`: la clave debe nacer en el clic del formulario/ref y **no** dentro de `mutationFn` si React Query llegara a reintentar, para que todo reintento reuse la misma clave.

#### `N30` + `N16` — Cerrar funciones heredadas y escrituras directas en tablas
- **Cambios en BD (`312_staging_seguridad_inventario_rpcs_y_rls.sql` + `_rollback.sql`):**
  1. Revocar `EXECUTE FROM PUBLIC, anon, authenticated` en **todas** las RPCs heredadas o internas de inventario/despacho en staging:
     - `aplicar_movimiento_lote`, `actualizar_estado_despacho`, `reciclar_despacho`,
     - `crear_producto_con_kardex`, `crear_producto_con_kardex_staging`,
     - `actualizar_producto_con_kardex`, `actualizar_producto_con_kardex_staging`,
     - `borrar_producto_con_kardex`, `borrar_producto_con_kardex_staging`,
     - `registrar_devolucion_inventario_atomica`, `registrar_devolucion_parcial_cobro_idempotente` (**cierra también `N16` de staging**!).
     - Garantizar `GRANT EXECUTE ... TO service_role` solo en las RPCs llamadas por el Worker.
  2. Endurecer políticas RLS en staging (`productos`, `inventario_movimientos`, `notas_despacho_items`, `cliente_prestamos`, `despacho_devoluciones`, `despacho_devolucion_intercambios`):
     - Quitar políticas viejas permisivas (`ALL {public}`, `productos_admin_*`, `movimientos_*_insert`, `Permitir todo a operadores autorizados...`).
     - Dejar **solo lectura (`SELECT`)** filtrada por `cuenta_id` y rol del operador; bloquear `INSERT / UPDATE / DELETE` directos desde cliente (`authenticated` y `anon`), pasando el 100% de mutaciones por el Worker (`service_role`).
- *Importante:* revisar antes de aplicar el paso anterior con el E2E real que ninguna pantalla de staging siga haciendo `.insert()`, `.update()` o `.delete()` directo en esas 6 tablas (después de alinear `useInventario.js` en la Fase 0).

#### Pruebas de Fase 3
- Reintento duplicado de devolución parcial (`2 + 2` con la **misma** `Idempotency-Key` simulando reintento de UI): el segundo devuelve `idempotent: true` sin mover stock ni dinero (`45 → 47` y `+$20`, nunca `49` ni `+$40`). Lo mismo para transformación y lote.
- Prueba de seguridad automatizada en staging:
  - Con `ANON_KEY` y con JWT `authenticated` (vendedor, supervisor, admin): llamadas directas a todas las RPCs revocadas devuelven error `401/403 (42501)`; `INSERT/UPDATE/DELETE` directo en `productos`, `inventario_movimientos`, `notas_despacho_items`, `cliente_prestamos` y `despacho_devoluciones` devuelve `401/403`.
  - Navegador/Worker normal con cada rol: crear/editar producto, mover inventario, aprobar/devolver/prestar siguen funcionando 100% vía Worker.

---

### Fase 4 — Higiene de catálogo, precisión decimal, respaldo completo y vigilante nocturno (`N33`, `N34`, `N32`)

**Meta:** dejar limpio el catálogo, las matemáticas a 4 decimales, los respaldos completos y un vigilante automático diario que detecte cualquier descuadre de inventario en el futuro.

#### `N33` — Protección al borrar/desactivar productos
- **Cambios en BD (`313_staging_higiene_decimales_lotes.sql` + `_rollback.sql`):**
  1. En `borrar_producto_con_kardex_tenant_safe`: antes de ejecutar `DELETE FROM public.productos`, comprobar si existen filas históricas en `notas_despacho_items`, `cotizacion_items`, `cliente_prestamos`, `despacho_devoluciones`, `despacho_devolucion_intercambios` o `inventario_movimientos` (además del stock inicial). Si tiene historial, rechazar el borrado físico (`PRODUCTO_CON_HISTORIAL_USAR_ARCHIVADO`, devolviendo indicación clara en UI/Worker para **desactivar/archivar** `activo = FALSE`). Y si realmente nunca se usó y se borra con stock negativo (`< 0`), cerrar el Kardex con **`tipo = 'ingreso'`** (no `'egreso'`) para llevar de `-X` a `0`.
  2. Permitir reingresos en `revertir_entrega_inventario_atomica`, `revertir_despacho_inventario_atomica` y `registrar_devolucion_inventario_atomica` aunque el producto tenga `activo = FALSE` (validar `IF NOT FOUND` únicamente cuando el producto no exista en la tabla, dejando el bloqueo de `activo IS NOT TRUE` solo para **salidas/ventas nuevas** en `aprobar_despacho` e intercambios).
- **Cambios en Frontend (`useInventario.js` / vista de inventario):** traducir `PRODUCTO_CON_HISTORIAL_USAR_ARCHIVADO` en un mensaje amigable que ofrezca *"Desactivar (archivar)"*.

#### `N34` — Precisión a 4 decimales, filas repetidas en Excel/lote y vigilante nocturno de inventario
- **Cambios en BD (`313_staging_higiene_decimales_lotes.sql`):**
  1. Unificar escala a `NUMERIC(12,4)` en las columnas y variables locales de `notas_despacho_items.cantidad`, `cantidad_original`, `despacho_devoluciones.cantidad_devuelta`, `despacho_devolucion_intercambios.cantidad`, y en todas las variables PL/pgSQL (`17_egreso_...`, `225_...`, `editar_despacho_profundidad`), conservando `ROUND(..., 2)` solo en totales de dinero (`USD`).
  2. En `ingresar_lote_inventario_atomico` (y en `construacero-staging/src/components/inventario/ImportadorModal.jsx`): en vez de estallar con `PRODUCTO_REPETIDO_EN_INGESTA`, **agrupar por `producto_id`** sumando `cantidad` (mostrando en `ImportadorModal` aviso claro de *"Se consolidaron X filas repetidas"* y exigiendo precios consistentes si `actualizar_costo`/precio cambia).
- **Ampliación del vigilante nocturno (`construacero-staging/scripts/monitor-kardex-staging.mjs` y `audit-kardex-staging.mjs`, más diseño espejo para `scripts/auditor-saldos-main.mjs` Sección 3 Inventario):**
  - Asegurar que verifique diariamente (solo lectura):
    1. `I1_stock_vs_kardex`: `productos.stock_actual` == último `stock_nuevo` en `inventario_movimientos`.
    2. `I2_continuidad_kardex`: cada movimiento cumple `stock_anterior +/- cantidad = stock_nuevo` y encadena con el anterior.
    3. `I3_despachos_sin_egreso`: despachos recientes en `despachada`/`entregada` tienen su `egreso_lote_id` válido y préstamos sin doble devolución.
    4. `I4_stock_negativo_nuevo`: reporte/alerta de productos que caigan en negativo o `producto_id IS NULL`.

#### `N32` — Respaldo JSON completo y alerta anti-doble carga (respetando que Compras/Proveedores no suman inventario)
- **Regla respetada:** **NO** se conecta `ordenes_compra` ni `proveedores` al inventario por decisión del dueño.
- **Cambios en Worker (`construacero-staging/api/handlers/admin.js`):**
  - Incluir `inventario_movimientos`, `inventario_operaciones`, `cliente_prestamos`, `despacho_devoluciones`, `despacho_devolucion_intercambios` en `handleBackup`, `handleRestore` y `handleResetOperacional`, respetando orden de claves foráneas y tenant.
- **Prevención de carga doble en Inventario (`IngresoLoteHubModal.jsx`, `MovimientoLoteModal.jsx`, `/api/inventario/batch-ingest`):**
  - Detectar y advertir antes de confirmar si ya existe un ingreso reciente con exactamente el mismo motivo/guía y productos para evitar cargas duplicadas de facturas (`MOV-5118/5119`).
- *(Opcional según confirme el dueño: banner discreto en `OrdenCompraView.jsx` / `ProveedoresView.jsx` indicando que no afecta stock, o dejar esas vistas intactas).*

#### Pruebas de Fase 4
- `N33`: intentar borrar producto con despacho previo → rechazado amablemente y sugiere archivar; borrar producto virgen en negativo `-5` (o simular ajuste previo al borrado) corrige signo a `'ingreso'`; desactivar producto y luego anular un despacho suyo → reingresa stock correctamente sin error `PRODUCTO_NO_DISPONIBLE`.
- `N34`: despacho con `1.1234` guarda `1.1234` íntegro (descuenta `1.1234` y deja stock exacto a 4 decimales); lote con 2 filas del mismo producto (`+5` y `+3`) consolida a `+8` exactos; `monitor:kardex:staging` pasa en verde.
- `N32`: prueba de contrato y simulación de `handleBackup` verificando presencia de `inventario_movimientos` y `cliente_prestamos` (y filtro anti-duplicado de motivo).

---

### Fase 5 — Suite completa de pruebas en staging (batería integral después de todas las correcciones)

> Nada pasa a re-auditoría sin cumplir **todos** estos chequeos en staging con Worker (`127.0.0.1:8789`) y Frontend (`localhost:5174`) compilados desde `construacero-staging/`:

1. **Pruebas automáticas de código y compilación:**
   - `npm --prefix construacero-staging test` → **100% en verde** (todas las pruebas existentes + todas las pruebas nuevas de Fases 1–4).
   - `npm --prefix construacero-staging run build` y `npm --prefix construacero-staging run lint` → **0 errores**.
2. **Simulación OP-068 invertida (verificación anti-fallas en vivo contra staging):**
   - Actualizar/crear `scripts/op071-verificar-fixes-staging.mjs` (basado en `op068-simular-fallas-inventario-staging.mjs`) donde **todos los escenarios `N25`–`N35`** ahora exigen el comportamiento **correcto** (y fallan si alguna falla reaparece).
   - Confirmar limpieza **`0` filas residuales** en todas las tablas de staging al terminar.
3. **Suite E2E completa de staging (`123+` pasos, dos corridas seguidas):**
   - `npm --prefix construacero-staging run provision:e2e:staging`
   - `npm --prefix construacero-staging run build`
   - Levantar Worker (`127.0.0.1:8789`) + Vite (`localhost:5174`) locales de `construacero-staging/`
   - Ejecutar `npm --prefix construacero-staging run test:e2e:staging` **dos veces consecutivas** (exigido por `docs/runbooks/deploy-staging.md` para detectar residuos entre corridas).
   - Ejecutar `node construacero-staging/scripts/test-revertir-movimiento-staging.mjs` + `npm --prefix construacero-staging run monitor:kardex:staging`.
4. **Pruebas en navegador real (Playwright) con sesiones reales de staging:**
   - Recorrido visual y funcional probando roles **`administracion`**, **`jefe`**, **`vendedor`** y **`logistica`** en:
     - Crear/editar producto (`ProductoForm`: verificar que no manda `stock_actual`, mensaje de error controlado si falla).
     - Historial `KardexModal`: verificar botón "Revertir" presente solo en ajustes manuales y ausente en devoluciones/cortes/préstamos; verificar etiqueta `"Revertida"`.
     - Ingreso manual, Transformación/Corte e Ingreso Masivo Excel (`ImportadorModal` con filas duplicadas).
     - Venta Rápida (`VentaRapidaView`) con ítem normal + préstamo.
     - Despacho: aprobar (`pendiente → despachada`), entregar, reabrir (`entregada → despachada`), editar en profundidad con devoluciones previas, anular, devolución parcial + intercambio + donación (y verificar que ítem préstamo aparece bloqueado en Devolución Parcial y sí funciona en Préstamos).
   - Verificar consola del navegador y red del Worker: **0 errores 500, 0 avisos rotos, 0 fallos de RLS**.

---

### Fase 6 — Re-auditoría completa de punta a punta y Reporte final (`OP-2026-072`)

**Meta:** volver a mirar todo el sistema desde cero en staging *después* de terminar las correcciones, no para suponer que quedó bien, sino buscando activamente **si aparece cualquier error nuevo o si algún flujo dejó algún cabo suelto**.

1. **Re-auditoría de código y base de datos viva en staging:**
   - Revisar línea por línea todos los archivos modificados en `construacero-staging/` (`src/`, `api/`, `supabase/migrations/310..313_staging_*`).
   - Revisar en vivo `pg_proc`, `pg_trigger` y `pg_policies` de staging (`spupqgkdsgohxxfoxydl`):
     - Confirmar que no quedaron sobrecargas duplicadas ni funciones temporales con permisos indebidos (`anon_exec`/`auth_exec`).
     - Confirmar que todos los disparadores (`triggers`) y restricciones (`constraints`) de `productos`, `inventario_movimientos`, `notas_despacho`, `notas_despacho_items`, `despacho_devoluciones`, `despacho_devolucion_intercambios`, `cliente_prestamos` y `cuentas_por_cobrar` son coherentes entre sí y no chocan con CxC, comisiones ni fletes.
     - Revisar flujos cruzados que suelen romper cosas al tocar inventario: Venta Rápida, Donaciones, Cobro a Destino (COD), Notas de reemplazo, Cotizaciones → Despachos, Comisiones por despacho editado/devuelto, y Peso/Flota.
2. **Chequeo completo de salud de datos en staging:**
   - Correr `monitor:kardex:staging` + consultas de invariantes `stock_actual vs Kardex`, `Kardex interno`, `préstamos vs despachos`, `despachos vs egresos`, y verificar `0` basura dejada por nuestras pruebas.
3. **Entrega de documentos y reporte completo (ley de `AGENTS.md`):**
   - Crear informe completo **`OP-2026-072`** en `docs/operaciones/` en español claro ("En resumen" primero) con:
     - Tabla "Antes vs Después" por cada una de las 11 fallas (`N25`–`N35`) + hallazgos de la re-auditoría.
     - Evidencia exacta de cada prueba ejecutada (Vitest, build, lint, E2E × 2, `op071-verificar-fixes-staging.mjs`, navegador real por rol, `monitor:kardex:staging`).
     - Lista exacta de qué quedaría pendiente para cuando decidas aprobar el **paso a producción** (paquete equivalente de migraciones + paridad de archivos con la raíz `construacero/`, limpieza histórica y conteo físico de arranque — siempre en un caso aparte con su propia aprobación).
   - Actualizar [Registro de fallas](file:///c:/Users/luigg/Desktop/construacero/docs/operaciones/REGISTRO-FALLAS-CODIGO.md) marcando `N25`–`N35` (y `N16` de staging) en **`🟡 arreglado en staging, falta producción`**, y actualizar [REGISTRO.md](file:///c:/Users/luigg/Desktop/construacero/docs/operaciones/REGISTRO.md).

---

## Riesgos principales y cómo se controlan

| Riesgo | Cómo puede pasar | Cómo lo controlamos antes de que pase |
|---|---|---|
| **Diferencias entre `construacero-staging/` y producción** | Al arreglar sobre archivos viejos de staging, podría quedar código distinto al real (como pasó en OP-059 con `Toast.jsx` o `_staging` wrappers). | **Fase 0** compara archivo por archivo y guarda pre-imágenes SQL vivas antes de editar nada. |
| **Cerrar RLS en Fase 3 rompe una pantalla que aún escribía directo** | Algún botón olvidado intentando hacer `UPDATE/DELETE` directo desde React hacia Supabase. | Alineación previa de hooks hacia el Worker + prueba obligatoria en navegador real con los 4 roles (`administracion`, `jefe`, `vendedor`, `logistica`) + E2E completo. |
| **Cambiar préstamos (`N27`) afecta despachos viejos** | Los `4` préstamos antiguos (mayo–julio) o despachos viejos que ya descontaron antes del 19-oct. | Verificamos en SQL histórico/staging el comportamiento al devolver préstamos creados antes del cambio vs nuevos, sin inventar ajustes falsos. |
| **Sobrecargas viejas de funciones SQL (`editar_despacho_profundidad`, etc.)** | En staging vimos 3 firmas distintas de `editar_despacho_profundidad`; editar una sin revisar las demás deja la puerta rota abierta. | Inspeccionamos `pg_proc` completo (como en el diagnóstico inicial) y limpiamos o actualizamos las sobrecargas exactas, con rollback SQL probado. |
| **Cambiar a `NUMERIC(12,4)` toca vistas o triggers dependientes** | Alterar escala de columna si alguna vista SQL depende de ella. | Revisamos `pg_depend` en staging dentro de una prueba transaccional antes de aplicar el `ALTER TABLE` definitivo en `313_staging_*`. |

---

## Qué necesito de ti para empezar

1. **Tu OK con las 2 protecciones propuestas alrededor de `N32`** (alerta anti-doble carga dentro de Inventario + respaldo completo del Kardex y préstamos; sin tocar Órdenes de Compra ni Proveedores).
2. **Tu visto bueno final para arrancar ya en staging** con todas las fases del [plan OP-2026-071](OP-2026-071_plan-correcciones-inventario-staging.md) hasta darte el reporte final de pruebas y re-auditoría. Sin tu confirmación no se modifica ningún archivo ni la base de staging.
