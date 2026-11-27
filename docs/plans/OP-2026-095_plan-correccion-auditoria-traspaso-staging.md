# OP-2026-095 — Plan paso a paso para corregir los hallazgos de la auditoría OP-2026-094 y dejar staging listo para producción

- **Fecha:** 2026-11-26 (actualizado con decisión del dueño: ocultar "Facturar préstamo" por ahora)
- **Estado:** Propuesta actualizada, pendiente de aprobación para arrancar (no se modificó código ni bases de datos todavía).
- **Entorno de trabajo:** **solo staging** (`construacero-staging/` y base de pruebas `spupqgkdsgohxxfoxydl`). **Producción no se toca** en ninguna fase salvo en la Fase 7, que es un caso aparte y requiere tu autorización escrita.
- **Origen:** auditoría [OP-2026-094](../operaciones/OP-2026-094_auditoria-informe-traspaso-staging.md) sobre el informe de traspaso [OP-2026-093](../operaciones/OP-2026-093_informe-traspaso-inventario-prestamos-staging.md).
- **Carpeta de este documento:** `construacero-op095` (rama `docs/op-095-plan-correccion-traspaso`, local y sin subir a GitHub).

---

## En resumen

- **Decisión clave ya incorporada (2026-11-26):** la opción de **"Facturar préstamo" queda oculta por ahora** (en pantalla solo se deja **"Devolver"**) hasta que consultes al cliente cómo quiere manejar el cobro y la comisión de préstamos. Eso simplifica mucho el plan, elimina el riesgo de chocar con las comisiones actuales (`estado = 'generada'`) y nos deja avanzar más rápido y seguro.
- **Qué SÍ hacemos en este plan:** rescatar los 3 archivos que se iban a perder, resolver los 9 choques entre las solicitudes #84 y #85, cerrar los huecos de seguridad en respaldos y catálogo, ocultar "Facturar préstamo" de forma limpia (conservando la protección `N44-INV` para devoluciones), arreglar despachos 100 % préstamo en todas las pantallas y dejarte una sola copia de pruebas lista para revisar.
- **Qué tienes que decidir tú antes de arrancar:** solo **3 confirmaciones cortas** al final del documento (con nuestra recomendación en cada una).

> **Glosario rápido.** *Solicitud de cambio (PR):* propuesta en GitHub para sumar cambios al proyecto principal. *Migración:* archivo con instrucciones que actualiza reglas o tablas de la base de datos. *Vuelta atrás (rollback):* archivo hermano que deshace una migración si algo sale mal. *`.gitignore`:* lista de archivos que la herramienta de versiones ignora para no subir basura ni claves. *Candado total (`ACCESS EXCLUSIVE`):* bloqueo que congela una tabla entera mientras se modifica, impidiendo incluso leerla.

---

## Mapa rápido del plan

| Fase | Qué resuelve | Hallazgos que cierra | ¿Toca producción? |
|---|---|---|---|
| **Fase 0** | Rescatar 3 archivos perdidos y ordenar solicitudes abiertas (#78, #83, #84, #94, #95) | C1, C5 | No |
| **Fase 1** | Unir bien el aviso "por aprobar" (#85) con el trabajo de inventario (#84) | C2, M1 | No |
| **Fase 2** | Blindar la restauración de respaldos y las funciones de catálogo | C3, A4, M3 | No |
| **Fase 3** | Ocultar "Facturar préstamo" (dejar solo "Devolver"), conservar `N44-INV`, pulir devoluciones y limpiar código viejo de comisiones en staging | C4 (pausado/desactivado), A6 (parcial) | No |
| **Fase 4** | Arreglar despachos 100 % préstamo en Cotizaciones, Venta rápida y modales (sin mencionar "Facturar") | A1, A2 | No |
| **Fase 5** | Limpiar documentos/registros y correr pruebas reales completas (incluye vuelta atrás y 20 MB) | A5, A6 | No |
| **Fase 6** | Tu revisión visual en pantalla (todo unido), unir solicitudes y limpiar carpetas viejas | Bloque 10 + OP-083 | No |
| **Fase 7** | Paso limpio y controlado a producción (caso aparte, solo con autorización, sin "Facturar préstamo") | Colisión 312 + INC-004 + M4 | **Sí (con permiso)** |

---

## Fase 0 — Rescatar archivos y poner orden en GitHub (prioridad 1)

**Por qué va primero:** hoy hay 3 archivos que solo existen en tu disco duro porque `.gitignore` los bloqueó, y una solicitud abierta olvidada (#78). Antes de tocar código o borrar carpetas hay que poner todo a salvo.

**Pasos concretos:**
1. **Rescatar el plan OP-2026-084 en la solicitud #83** (`construacero-op078`):
   - Agregar `!docs/plans/OP-2026-084_plan-testeo-completo-inventario.md` al `.gitignore` de la raíz.
   - Guardar en git `docs/plans/OP-2026-084_plan-testeo-completo-inventario.md` y actualizar #83 (previa autorización para subir a GitHub).
2. **Rescatar los dos programas de pruebas en la solicitud #84** (`construacero-op086`):
   - Agregar `!scripts/op084-pruebas-staging.mjs` y `!scripts/op084-restauracion-real-staging.mjs` a `construacero-staging/.gitignore`.
   - Guardar ambos archivos en git en la rama de #84.
3. **Resolver la solicitud olvidada #78** (`construacero-op080`, rama `docs/op-080-publicado`):
   - Revisar sus cambios contra `main` actual, resolver el conflicto en `docs/operaciones/REGISTRO.md` conservando todas las filas (OP-025, 077, 079, 080 marcados como publicados) y dejarla lista para unir (no borrar `construacero-op080` hasta que #78 quede unida).
4. **Subir OP-2026-094 y OP-2026-095** (con tu permiso) para que el historial de GitHub quede al día.

**Listo cuando:**
- `git ls-files` confirma que `OP-2026-084_plan-testeo-completo-inventario.md`, `op084-pruebas-staging.mjs` y `op084-restauracion-real-staging.mjs` están guardados y visibles en GitHub.
- La solicitud #78 ya no tiene conflictos (`MERGEABLE`).

---

## Fase 1 — Integrar "por aprobar" (#85) sobre el trabajo de inventario (#84)

**Por qué va aquí:** hoy #84 y #85 no se pueden unir sin resolver 9 conflictos, y tú necesitas probar todo junto en una sola pantalla (no arrancando dos carpetas distintas).

**Archivos exactos a trabajar** (en una rama limpia de staging sobre #84):
- `construacero-staging/src/hooks/useStockPorAprobar.js` (archivo propio para no chocar con el `useStockComprometido.js` eliminado en #84)
- `construacero-staging/src/hooks/useDespachos.js` (refrescar `['stock_por_aprobar']` al crear, aprobar, rechazar, editar o anular un despacho)
- `construacero-staging/src/components/inventario/StockPorAprobarDetalle.jsx`
- `construacero-staging/src/components/inventario/ProductoCard.jsx`
- `construacero-staging/src/components/shared/ProductCard.jsx`
- `construacero-staging/src/components/cotizaciones/CotizacionBuscador.jsx`
- `construacero-staging/src/components/cotizaciones/ProductoAutocomplete.jsx`
- `construacero-staging/src/views/InventarioView.jsx`
- `construacero-staging/src/views/VentaRapidaView.jsx`
- `construacero-staging/supabase/migrations/324_staging_stock_por_aprobar.sql` (+ rollback)
- `construacero-staging/src/utils/__tests__/op087StockPorAprobar.test.js`

**Pasos concretos:**
1. Traer la funcionalidad de #85 sobre #84 usando `useStockPorAprobar.js` (sin revivir el viejo `useStockComprometido.js` que #84 ya eliminó).
2. En `useDespachos.js`, invalidar `STOCK_POR_APROBAR_KEY` en las acciones que cambian despachos pendientes (crear, aprobar, entregar, anular, editar ítems).
3. Alinear la migración `324_staging_stock_por_aprobar.sql` a 4 decimales (`NUMERIC(12,4)`) para que coincida con la migración `315` (cierra M1), y aplicarla en staging.
4. Reemplazar la prueba rota de `op087StockPorAprobar.test.js` (que buscaba `stock - comprometido`) por pruebas de comportamiento que confirmen que "por aprobar" se muestra como aviso, nunca resta del stock y se refresca al cambiar estado.
5. Verificar compilación y pruebas: `npx vitest run`, `npx vite build` y `node scripts/op087-prueba-por-aprobar-staging.mjs`.

**Listo cuando:**
- Cero conflictos entre #84 y #85.
- `vitest`, `vite build` y `op087-prueba-por-aprobar-staging.mjs` (6/6) pasan en verde sobre la misma carpeta.

---

## Fase 2 — Blindar la restauración de respaldos y las funciones de catálogo (seguridad)

**Por qué es crítica:** cierra el hueco que permitiría a un archivo manipulado sobrescribir préstamos o devoluciones de otra empresa, evita congelar la base entera durante una restauración, impide cargar respaldos viejos recortados y cierra la condición frágil en 3 funciones de catálogo.

**Archivos exactos:**
- Crear: `construacero-staging/supabase/migrations/327_staging_seguridad_restauracion_y_catalogo.sql` (+ `..._rollback.sql`)
- Modificar: `construacero-staging/api/handlers/admin.js`
- Crear prueba real: `construacero-staging/api/handlers/__tests__/restauracionSeguridad095.test.js` (y excepción en `construacero-staging/.gitignore`)

**Pasos concretos:**
1. **Escribir primero las pruebas que hoy fallan:**
   - Intentar restaurar un respaldo donde una fila de `cliente_prestamos` usa el ID de un préstamo de la Empresa A apuntando a un cliente de la Empresa B → debe rechazarse y dejar el préstamo de la Empresa A intacto.
   - Intentar restaurar un respaldo viejo sin `completo: true` (versión `1.0` o `1.1`) → el servidor debe rechazarlo (HTTP 400).
   - Comprobar que un respaldo donde la fila 0 omite una columna opcional que sí trae la fila 1 no pierde esa columna al restaurar.
2. **En la migración `327` (base de staging):**
   - En `restaurar_respaldo_atomico`:
     - **Antes** de ejecutar el `INSERT ... ON CONFLICT DO UPDATE`, verificar que ningún `id` entrante de `cliente_prestamos`, `despacho_devoluciones` o `despacho_devolucion_intercambios` exista ya en la base perteneciendo a otra empresa (cierra C3).
     - Construir la lista de columnas usando la unión de llaves de **todas** las filas del arreglo JSON (`jsonb_object_keys`), no solo `v_filas->0` (cierra M3).
     - Reemplazar `ALTER TABLE ... DISABLE TRIGGER USER` (candado total `ACCESS EXCLUSIVE` sobre 15 tablas) por una bandera de sesión (`set_config('app.restaurando_respaldo', 'on', true)`) que el disparador de préstamos respete, para no congelar a los usuarios.
     - Incluir en `v_orden` las tablas operativas que hoy faltan (`despacho_descuentos`, `comision_liberaciones`, `comision_designacion_diaria`, `cxc_movimientos_borrados`, más compras/proveedores/flota según **Decisión 1**).
   - En `obtener_stock_productos`, `obtener_categorias_vendedor` y `obtener_productos_vendedor`:
     - Cambiar `(auth.uid() IS NULL OR p.cuenta_id = (SELECT auth.uid()))` por `(auth.role() = 'service_role' OR p.cuenta_id = (SELECT auth.uid()))` y repetir `REVOKE ALL ... FROM PUBLIC, anon` (cierra A4).
3. **En `api/handlers/admin.js`:**
   - En `handleBackup`: agregar lectura paginada de las tablas operativas faltantes.
   - En `handleRestore`: exigir `backup.completo === true` para rechazar respaldos viejos recortados a 1000 filas.
4. **Aplicar migración `327` en staging** y correr las pruebas de seguridad + `op084-pruebas-staging.mjs` + `op084-restauracion-real-staging.mjs`.

**Listo cuando:**
- El intento de sobrescribir un préstamo ajeno se rechaza sin tocar nada.
- Un respaldo v1.0/v1.1 sin `completo: true` se rechaza con HTTP 400.
- `op084-restauracion-real-staging.mjs` restaura completo sin `DISABLE TRIGGER` masivo.

---

## Fase 3 — Ocultar "Facturar préstamo" (solo "Devolver"), pulir devoluciones y limpiar comisiones viejas

**Por qué ahora es mucho más limpia:** al pausar la facturación de préstamos hasta hablar con el cliente, **no** tocamos el motor de comisiones para préstamos ni metemos reglas sin confirmar. Solo ocultamos "Facturar" de forma prolija, mantenemos el flujo de **"Devolver"** intacto y cerramos los detalles de devoluciones y código muerto.

**Archivos exactos:**
- Modificar: `construacero-staging/src/components/clientes/FichaClienteModal.jsx` (ocultar el botón y modal de "Facturar", dejando solo **"Devolver"** en la pestaña Préstamos)
- Modificar: `construacero-staging/src/components/despachos/DevolucionParcialModal.jsx` (quitar la mención a "Facturar" en el mensaje de préstamo; indicar solo *"usa 'Devolver' (la mercancía vuelve al inventario)"*)
- Modificar (según **Decisión 2**): `construacero-staging/api/handlers/clientes.js` (interruptor `FACTURACION_PRESTAMOS_HABILITADA = false` en `handleFacturarPrestamo` para devolver aviso claro `403` si alguien intenta llamarlo hasta que el cliente confirme)
- Modificar: `construacero-staging/api/handlers/comisiones.js` (quitar código muerto viejo de staging de `pagada`/`cta_cobrar`/`liberar-cxc` para alinearlo al flujo real de producción `estado = 'generada'`)
- Crear: `construacero-staging/supabase/migrations/328_staging_devolucion_origen_y_precios.sql` (+ `..._rollback.sql`)
- Actualizar pruebas: `construacero-staging/src/utils/__tests__/op088PrestamosModal.test.js`, `op089MensajeDevolucion.test.js`, `op091PrestamoCobro.test.js`

**Pasos concretos:**
1. **En `FichaClienteModal.jsx`:**
   - Ocultar el botón **"Facturar"** en las tarjetas de préstamos pendientes y el formulario de facturación mediante una bandera clara (`FACTURACION_PRESTAMOS_HABILITADA = false`), dejando únicamente el botón **"Devolver"** y el detalle de lo prestado/devuelto.
   - Asegurar que el botón "Devolver" siga usando su clave única (`Idempotency-Key`) y mostrando el aviso claro de que la mercancía vuelve al inventario sin cobrar nada.
2. **En `DevolucionParcialModal.jsx`:**
   - Ajustar el mensaje de "todo en préstamo" para que diga únicamente: *"Todos sus artículos están en préstamo y los préstamos no se devuelven desde aquí. Entra a la ficha del cliente, pestaña 'Préstamos', y usa 'Devolver' (la mercancía vuelve al inventario)."* (sin nombrar "Facturar").
3. **En `api/handlers/clientes.js` (según Decisión 2):**
   - Poner el mismo interruptor `FACTURACION_PRESTAMOS_HABILITADA = false` al inicio de `handleFacturarPrestamo` (responde `403`: *"La facturación de préstamos está deshabilitada temporalmente"*). Cuando el cliente defina las reglas, se vuelve a activar en un solo lugar.
4. **Conservar el cierre de `N44-INV`:**
   - Mantener intacto el freno en `revertir_entrega_finanzas_atomica` (de la migración `326`): si un despacho tiene préstamos **devueltos** (o facturados históricamente), sigue bloqueando revertir la entrega a cualquier estado (incluido "aprobado").
5. **En la migración `328` (devoluciones parciales, cierra A6):**
   - En `registrar_devolucion_inventario_atomica` (321):
     - Validar que `x.precio_unit_usd` no supere el precio de la línea original del despacho (`ndi.precio_unit_usd`, tolerancia `0.02`).
     - Validar que cada fila de intercambio cumpla `total_usd ≈ cantidad × precio_unit_usd`.
     - Guardar `origen_tipo = 'devolucion'`, `origen_id = p_despacho_id` y `origen_referencia = 'DES-' || v_despacho.numero` en los movimientos nuevos del Kardex para dejar de crear filas "sin origen".
6. **Limpiar `construacero-staging/api/handlers/comisiones.js`:**
   - Alinear con producción (`main`): estado único `'generada'`, sin handlers muertos de `pagada` ni `liberar-cxc` (evita confusiones futuras como la que ocurrió en OP-091).

**Listo cuando:**
- En la ficha del cliente → Préstamos solo aparece **"Devolver"** (cero botón "Facturar" y cero mensajes que lo prometan).
- Devolver un préstamo reingresa el stock correctamente y bloquea reabrir el despacho en cualquier estado (`N44-INV`).
- Las devoluciones parciales validan precios y guardan `origen_tipo = 'devolucion'` en el Kardex.

---

## Fase 4 — Corregir despachos 100 % préstamo en todas las pantallas (y distinguir donaciones)

**Por qué va aquí:** hoy puedes editar un despacho 100 % préstamo sin método de pago, pero **no puedes crearlo** desde Cotizaciones ni Venta rápida, y en "Editar productos" quedaron dos avisos viejos.

**Archivos exactos:**
- Crear ayudante compartido: `construacero-staging/src/utils/despachoSinCobro.js` (una sola regla usada por las 4 pantallas)
- Modificar:
  - `construacero-staging/src/views/CotizacionesView.jsx` (alrededor de líneas 953–1015)
  - `construacero-staging/src/views/VentaRapidaView.jsx` (alrededor de líneas 770–780 y 2625–2640)
  - `construacero-staging/src/components/despachos/EditarItemsDespachoModal.jsx` (líneas 373–385, 1012 y 1262)
  - `construacero-staging/src/components/despachos/EditDespachoModal.jsx` (líneas 280–290 y 518–523)
- Crear prueba real de comportamiento: `construacero-staging/src/utils/__tests__/despachoSinCobro.test.js` (y excepción en `.gitignore`)

**Pasos concretos:**
1. Crear `despachoSinCobro.js` que evalúe:
   - `sinCobro = !esCod && total <= 0.015`
   - `motivoSinCobro`: `'prestamo'` si todos los artículos tienen `es_prestamo`, `'donacion'` si hay donación/descuento 100 %, o `'sin_cobro'` en otro caso.
   - Textos claros sin prometer facturar préstamos:
     - Préstamo: *"Este despacho es 100 % préstamo: no se cobra nada ahora. Las devoluciones se gestionan desde la ficha del cliente → Préstamos."*
     - Donación: *"Este despacho es 100 % donación: no requiere método de pago."*
2. Aplicar la misma regla en las 4 pantallas (`CotizacionesView`, `VentaRapidaView`, `EditarItemsDespachoModal`, `EditDespachoModal`) y corregir las líneas 1012 y 1262 de `EditarItemsDespachoModal.jsx` para eliminar el aviso falso *"Los montos no cuadran con el total"*.
3. Escribir pruebas reales ejecutando `evaluarSinCobro(...)` para: 100 % préstamo, 100 % donación, préstamo + flete > $0 (sí exige pago), COD con $0 y venta normal.

**Listo cuando:**
- Las 4 pantallas dejan crear y editar despachos 100 % préstamo sin pedir método de pago, no muestran avisos falsos y distinguen donación de préstamo.

---

## Fase 5 — Limpiar documentos, fortalecer pruebas y correr toda la batería en staging

**Pasos concretos:**
1. **Actualizar registros y corregir contradicciones (cierra A5):**
   - `docs/operaciones/REGISTRO-FALLAS-CODIGO.md`: actualizar `N36-INV` a `N43` al estado real (`🟡 arreglada en staging`) y anotar las fallas nuevas cerradas en OP-094/095.
   - Corregir `OP-2026-086` (limpiar "Pendiente" viejo), `OP-2026-093` (aclarar `liquidar_transportista` frente a `INC-004`, aclarar `Kilo Code Review`, anotar #78 y anotar que "Facturar préstamo" quedó oculto por decisión del dueño) y `REGISTRO.md`.
2. **Correr la batería completa contra staging:**
   - `npx vitest run` (todas en verde, con pruebas reales de comportamiento).
   - `npx vite build` (sin errores).
   - `node scripts/test-e2e-staging.mjs` (123/123 × 2 corridas seguidas).
   - `node scripts/op084-pruebas-staging.mjs` (todas en verde).
   - `node scripts/op084-restauracion-real-staging.mjs` (restauración real OK).
   - `node scripts/op087-prueba-por-aprobar-staging.mjs` (6/6 en verde).
3. **Cubrir los dos pendientes grandes del plan OP-2026-084:**
   - **Ensayo de vuelta atrás (rollbacks):** en una copia desechable de base de datos, aplicar y revertir las migraciones nuevas con sus rollbacks.
   - **Prueba de respaldo/restauración tamaño producción (~20 MB):** medir tiempo y memoria de `restaurar_respaldo_atomico` para confirmar que Cloudflare Worker no se queda corto.

**Listo cuando:**
- 100 % de las pruebas automáticas, de base real, de vuelta atrás y de 20 MB están en verde y documentadas.

---

## Fase 6 — Tu revisión visual en pantalla, unión de solicitudes y limpieza de carpetas

Arrancaremos un solo sitio local con **todo unido** (`http://localhost:5174` + `:8789`) para que pruebes todo en 15 minutos:

1. **Préstamos (ficha del cliente):** confirmar que **solo se ve "Devolver"** (ya no aparece "Facturar") y que devolver un préstamo suma bien al inventario.
2. **Despachos 100 % préstamo sin método de pago:** probar crear en Cotizaciones, crear en Venta rápida y editar en DES-04967 (Editar productos y Editar despacho).
3. **Devolución parcial:** abrir DES-04938 y confirmar el mensaje claro (sin mencionar "Facturar").
4. **Aviso "N por aprobar":** ver la etiqueta azul en Inventario, Venta rápida y Cotizaciones, tocar el detalle, aprobar/rechazar un despacho y comprobar que el número cambia al instante.
5. **Bloque 10 del plan OP-084:** ficha de producto (stock bloqueado), conteo físico, lote (solo suma), Kardex (solo ajustes manuales revertibles), respaldo y restauración en Configuración.

**Al dar tu visto bueno:**
- Unir en orden las solicitudes limpias en GitHub: **#78** → **#83** → **#84** (ya integrada con #85 y las Fases 1–5; cerrar #85 como absorbida) → **OP-094/095**.
- Limpiar las carpetas viejas que ya no hagan falta (`construacero-op078`, `construacero-op080`, `construacero-op086`, `construacero-op087`, `construacero-op094`, `construacero-op095`, y revisar `construacero-work`).

---

## Fase 7 — Paso a producción (caso aparte, SOLO con tu autorización expresa)

> **Regla de oro:** nada de esto se ejecuta hasta terminar la Fase 6 y recibir tu permiso explícito por escrito.

1. Crear un **caso nuevo propio** en una carpeta limpia desde `origin/main` (sin arrastrar los 161 archivos mezclados de staging de #84; cierra M4).
2. **Llevar "Facturar préstamo" oculto/deshabilitado** (solo "Devolver" activo, sin llevar la lógica pausada de comisiones de préstamos facturados).
3. **Resolver la colisión de numeración:** en producción el número `312` ya es `312_cerrar_rpcs_dinero_abiertas.sql`; las migraciones nuevas de producción arrancarán en **`313` en adelante**.
4. Incluir las brechas abiertas de producción de **`INC-004`**: cierre de `N30` (escritura directa), lectura por empresa en devoluciones (`despacho_devoluciones` y `despacho_devolucion_intercambios`), funciones extra de dinero aún abiertas y respaldo paginado v1.2.
5. **Antes de tocar producción:** respaldo completo oficial de producción en `construacero-backups/` + ensayo en copia desechable.
6. **Ventana acordada:** aplicar migraciones con vuelta atrás lista → publicar Worker y frontend → verificación en vivo.

---

## Aparcado hasta consultar al cliente (fuera de este plan)

Cuando el cliente te confirme cómo quiere manejar la facturación de préstamos, se abrirá un caso nuevo pequeño y limpio para reactivarlo resolviendo exactamente:
- si facturar préstamo genera comisión solo al cobrarse ("Paga ahora") o también "A crédito" (siempre bajo el modelo actual `estado = 'generada'` y respetando "clientes de EMPRESA sin comisión");
- si se crea la tabla dedicada `comision_prestamos_facturados` para que ningún recálculo la borre;
- validación de la tasa contra la tasa vigente del día (`/api/rates`) en vez del tope `4×` contra el despacho viejo;
- guardado de `fecha_vencimiento` cuando se facture un préstamo "A crédito".

---

## 3 confirmaciones tuyas para poder arrancar

| Nº | Pregunta | Mi recomendación |
|---|---|---|
| **1** | En el respaldo y restauración desde Configuración (Fase 2): además de sumar `despacho_descuentos`, liberaciones de comisiones y movimientos borrados de CxC, ¿incluimos también **proveedores, órdenes de compra, cuentas por pagar, vehículos y pagos a transportistas**? | **Sí, incluirlas**, para que el botón "Respaldo" guarde el negocio completo. |
| **2** | Además de ocultar el botón "Facturar préstamo" en la pantalla (Fase 3), ¿ponemos un **interruptor apagado en el servidor** para que nadie pueda dispararlo por accidente hasta que el cliente confirme? | **Sí, poner el interruptor apagado también en el servidor.** Es fácil de volver a encender cuando tengas respuesta del cliente. |
| **3** | ¿Me autorizas a empezar por la **Fase 0** (rescatar los 3 archivos de OP-084 en #83/#84, arreglar el conflicto de #78 y subir OP-094 y este plan OP-095 a GitHub)? | **Sí, hacer Fase 0 primero** para dejar todo a salvo en GitHub antes de tocar código en staging. |

*(En staging dejaremos DES-04938 sin tocar por ser solo dato de prueba; y para antes de Fase 7 quedará confirmar si la segunda cuenta de producción es real o de prueba).*
