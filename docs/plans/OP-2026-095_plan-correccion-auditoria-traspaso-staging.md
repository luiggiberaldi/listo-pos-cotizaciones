# OP-2026-095 — Plan paso a paso para corregir los hallazgos de la auditoría OP-2026-094 y dejar staging listo para producción

- **Fecha:** 2026-11-26
- **Estado:** Propuesta pendiente de tu aprobación (no se modificó código ni bases de datos todavía).
- **Entorno de trabajo:** **solo staging** (`construacero-staging/` y base de pruebas `spupqgkdsgohxxfoxydl`). **Producción no se toca** en ninguna fase salvo en la Fase 7, que es un caso aparte y requiere tu autorización escrita.
- **Origen:** auditoría [OP-2026-094](../operaciones/OP-2026-094_auditoria-informe-traspaso-staging.md) sobre el informe de traspaso [OP-2026-093](../operaciones/OP-2026-093_informe-traspaso-inventario-prestamos-staging.md).
- **Carpeta de este documento:** `construacero-op095` (rama `docs/op-095-plan-correccion-traspaso`, local y sin subir a GitHub).

---

## En resumen

- **Objetivo:** rescatar los 3 archivos que se iban a perder, resolver los 9 choques entre las solicitudes #84 y #85, cerrar los huecos de seguridad y comisiones encontrados en la auditoría OP-2026-094, y dejarte una sola copia de pruebas funcionando para que la revises en pantalla antes de pensar en producción.
- **Cómo se organiza:** en **8 pasos claros (Fases 0 a 7)**. Primero aseguramos los archivos (Fase 0), después unimos y corregimos staging (Fases 1 a 5), luego tú lo ves en pantalla y apruebas (Fase 6), y solo al final —en un caso separado con tu permiso— se lleva limpio a producción (Fase 7).
- **Qué tienes que decidir tú antes de arrancar:** **5 decisiones cortas** al final de este documento (con nuestra recomendación en cada una). Si dices "aprueba con las recomendaciones", podemos empezar desde la Fase 0 de inmediato.

> **Glosario rápido.** *Solicitud de cambio (PR):* propuesta en GitHub para sumar cambios al proyecto principal. *Migración:* archivo con instrucciones que actualiza reglas o tablas de la base de datos. *Vuelta atrás (rollback):* archivo hermano que deshace una migración si algo sale mal. *`.gitignore`:* lista de archivos que la herramienta de versiones ignora para no subir basura ni claves. *Candado total (`ACCESS EXCLUSIVE`):* bloqueo que congela una tabla entera mientras se modifica, impidiendo incluso leerla.

---

## Mapa rápido del plan

| Fase | Qué resuelve | Hallazgos que cierra | ¿Toca producción? |
|---|---|---|---|
| **Fase 0** | Rescatar 3 archivos perdidos y ordenar solicitudes abiertas (#78, #83, #84, #94, #95) | C1, C5 | No |
| **Fase 1** | Unir bien el aviso "por aprobar" (#85) con el trabajo de inventario (#84) | C2, M1 | No |
| **Fase 2** | Blindar la restauración de respaldos y las funciones de catálogo | C3, A4, M3 | No |
| **Fase 3** | Corregir comisiones de préstamos, tasa, vencimiento y devoluciones | C4, A3, A6 (parcial), M2 | No |
| **Fase 4** | Arreglar despachos 100 % préstamo en Cotizaciones, Venta rápida y modales | A1, A2 | No |
| **Fase 5** | Limpiar documentos/registros y correr pruebas reales completas (incluye vuelta atrás y 20 MB) | A5, A6 | No |
| **Fase 6** | Tu revisión visual en pantalla (todo unido), unir solicitudes y limpiar carpetas viejas | Bloque 10 + OP-083 | No |
| **Fase 7** | Paso limpio y controlado a producción (caso aparte, solo con autorización) | Colisión 312 + INC-004 + M4 | **Sí (con permiso)** |

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
- `construacero-staging/src/hooks/useStockPorAprobar.js` (nuevo archivo propio para no chocar con el `useStockComprometido.js` eliminado en #84)
- `construacero-staging/src/hooks/useDespachos.js` (volver a avisar al navegador que refresque `['stock_por_aprobar']` al crear, aprobar, rechazar, editar o anular un despacho)
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
1. Traer la funcionalidad de #85 sobre #84 usando un hook limpio `useStockPorAprobar.js` (sin revivir el viejo `useStockComprometido.js` que #84 ya eliminó).
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
- Crear prueba real: `construacero-staging/api/handlers/__tests__/restauracionSeguridad095.test.js` (y añadir excepción en `construacero-staging/.gitignore`)

**Pasos concretos:**
1. **Escribir primero las pruebas que hoy fallan:**
   - Intentar restaurar un respaldo donde una fila de `cliente_prestamos` usa el ID de un préstamo de la Empresa A apuntando a un cliente de la Empresa B → debe rechazarse con error de empresa ajena y dejar el préstamo de la Empresa A intacto.
   - Intentar restaurar un respaldo viejo sin `completo: true` (versión `1.0` o `1.1`) → el servidor debe rechazarlo (HTTP 400).
   - Comprobar que un respaldo donde la fila 0 omite una columna opcional que sí trae la fila 1 no pierde esa columna al restaurar.
2. **En la migración `327` (base de staging):**
   - En `restaurar_respaldo_atomico`:
     - **Antes** de ejecutar el `INSERT ... ON CONFLICT DO UPDATE`, verificar que ningún `id` entrante de `cliente_prestamos`, `despacho_devoluciones` o `despacho_devolucion_intercambios` exista ya en la base perteneciendo a otro cliente/despacho de otra empresa (cierra C3).
     - Construir la lista de columnas usando la unión de llaves de **todas** las filas del arreglo JSON (`jsonb_object_keys` sobre todos los elementos), no solo `v_filas->0` (cierra M3).
     - Reemplazar `ALTER TABLE ... DISABLE TRIGGER USER` (que toma candado total `ACCESS EXCLUSIVE` sobre 15 tablas) por `PERFORM set_config('app.restaurando_respaldo', 'on', true)` dentro de la transacción, actualizando el disparador de préstamos para saltarse solo cuando esa bandera esté encendida. Así no se congela el resto del sistema.
     - Incluir en `v_orden` las tablas operativas que hoy faltan (mínimo `despacho_descuentos`, `comision_liberaciones`, `comision_designacion_diaria`, `cxc_movimientos_borrados`; más compras/proveedores/flota según **Decisión 2**).
   - En `obtener_stock_productos`, `obtener_categorias_vendedor` y `obtener_productos_vendedor`:
     - Cambiar `(auth.uid() IS NULL OR p.cuenta_id = (SELECT auth.uid()))` por `(auth.role() = 'service_role' OR p.cuenta_id = (SELECT auth.uid()))` y repetir `REVOKE ALL ... FROM PUBLIC, anon` en la misma migración (cierra A4).
3. **En `api/handlers/admin.js`:**
   - En `handleBackup`: agregar la lectura paginada de las tablas operativas faltantes (`despacho_descuentos`, `comision_liberaciones`, `comision_designacion_diaria`, `cxc_movimientos_borrados`, y las que se decidan en Decisión 2).
   - En `handleRestore`: cambiar la validación a `if (backup.completo !== true || ...)` para rechazar automáticamente respaldos viejos v1.0/v1.1 que venían cortados a 1000 filas.
4. **Aplicar migración `327` en staging** y correr las pruebas de seguridad + `op084-pruebas-staging.mjs` + `op084-restauracion-real-staging.mjs`.

**Listo cuando:**
- El intento de sobrescribir un préstamo ajeno es rechazado sin tocar la fila.
- Un respaldo v1.0/v1.1 sin `completo: true` es rechazado con HTTP 400.
- `op084-restauracion-real-staging.mjs` restaura incluyendo `despacho_descuentos` sin usar `DISABLE TRIGGER` masivo.

---

## Fase 3 — Corregir comisiones de préstamos, tasa, fecha de vencimiento y devoluciones

**Por qué es crítica:** hoy las comisiones de préstamos en staging se construyeron sobre un flujo viejo que **ya no existe** en la app (usando `cta_cobrar` y un botón "Liberar comisión CxC" eliminado en agosto 2026; hoy el sistema solo registra comisiones con estado `'generada'` para que administración sepa cuánto pagar, excluyendo ventas a crédito/CxC). Además violan la regla de clientes de EMPRESA, se pierden ante una devolución parcial o error 502, y el tope de tasa `4×` contra el despacho viejo puede bloquear cobros reales en Venezuela.

**Archivos exactos:**
- Crear: `construacero-staging/supabase/migrations/328_staging_comisiones_prestamo_y_devolucion.sql` (+ `..._rollback.sql`)
- Modificar: `construacero-staging/api/handlers/despachos.js`
- Modificar: `construacero-staging/api/handlers/clientes.js`
- Modificar (alinear con producción): `construacero-staging/api/handlers/comisiones.js` (quitar código muerto del flujo viejo `pagada`/`cta_cobrar`/`liberar-cxc` que confundió a OP-091)
- Actualizar: `construacero-staging/scripts/op091-prueba-prestamo-cobro-staging.mjs`
- Crear prueba real: `construacero-staging/api/handlers/__tests__/prestamoComisionYTasa095.test.js` (y añadir excepción en `.gitignore`)

**Pasos concretos:**
1. **En la migración `328` (base de staging):**
   - En `comision_prestamo_facturado_staging`:
     - Usar **solo `cl.vendedor_id`** (sin `COALESCE(..., nd.vendedor_id)`): si el cliente es de EMPRESA (`cl.vendedor_id IS NULL`), devuelve `aplica: false, motivo: 'cliente_empresa'` (cumple OP-2026-032).
     - **Alinear al modelo actual de comisiones (`estado = 'generada'`, `comision_retenida = 0`, sin tocar `pagadaen`/`pagadapor`):**
       - Con **"Paga ahora"**: suma la comisión a `totalcomision` y `comision_liberada`, siempre con `estado = 'generada'`.
       - Con **"A crédito"**: aplicar tu respuesta a la **Decisión 1B** (recomendado: igual que cualquier venta a crédito hoy en producción, **no** genera comisión automática en `totalcomision`; administración la considera aparte cuando el cliente pague).
     - *(Opcional según **Decisión 1A**)*: crear tabla dedicada `comision_prestamos_facturados` para que cualquier recálculo del motor `238b` vuelva a sumar automáticamente las comisiones de préstamos cobrados sin necesitar frenos provisionales.
   - En `facturar_prestamo_atomico`:
     - Al facturar **"A crédito"**, calcular y guardar `fecha_vencimiento` en el cargo de `cuentas_por_cobrar` (usando los días de crédito del cliente o la configuración del negocio, igual que en OP-011/N18).
     - Formatear el precio unitario en el texto del cargo conservando hasta 4 decimales solo si tiene más de 2 (cierra M2).
   - En `registrar_devolucion_inventario_atomica` (321):
     - Validar que `x.precio_unit_usd` no exceda el precio de la línea original del despacho (`ndi.precio_unit_usd`) con tolerancia de redondeo (`0.02`).
     - Validar que cada fila de intercambio cumpla `total_usd ≈ cantidad × precio_unit_usd`.
     - Guardar `origen_tipo = 'devolucion'`, `origen_id = p_despacho_id` y `origen_referencia = 'DES-' || v_despacho.numero` en los movimientos de Kardex nuevos, para dejar de crear filas "sin origen" (cierra A6).
2. **En `api/handlers/despachos.js` y `clientes.js`:**
   - Cambiar el freno provisional de OP-092 a **modo seguro (fail-closed)**: si al consultar `cliente_prestamos` Supabase responde error o 502, **NO borrar ni recalcular la comisión** (registrar advertencia y avisar).
   - Aplicar ese mismo freno en `handleDevolucionParcialDespacho` (línea 3399, antes de `recalcularComision238b`) y en las reasignaciones de cliente en `clientes.js` (o dejarlo resuelto de raíz si eliges la tabla dedicada en **Decisión 1A**).
   - En `handleFacturarPrestamo` (`clientes.js`): reemplazar la comparación `1/4–4×` contra el viejo `tasa_snapshot` del despacho por una comparación contra la tasa actual del sistema (`/api/rates` / rango razonable frente a la tasa vigente del día, salvo que sea tasa manual explícita dentro de un rango sano), para que la inflación de meses nunca bloquee un cobro real (cierra A3).
3. **Ampliar `scripts/op091-prueba-prestamo-cobro-staging.mjs`** con 4 casos nuevos:
   - Cliente de EMPRESA (`vendedor_id IS NULL`) → comisión `$0` (`cliente_empresa`).
   - Préstamo **"Paga ahora"** → suma a `totalcomision` y `comision_liberada`, `estado = 'generada'`, `comision_retenida = 0`.
   - Préstamo **"A crédito"** → comportamiento según **Decisión 1B** (sin crear estado viejo `cta_cobrar`).
   - Cargo **"A crédito"** → queda con `fecha_vencimiento` no nula.

**Listo cuando:**
- Todas las pruebas de `op091-prueba-prestamo-cobro-staging.mjs` y las pruebas nuevas de servidor pasan en verde contra staging, sin usar estados viejos (`cta_cobrar`/`pagada`).

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
- Crear prueba de comportamiento: `construacero-staging/src/utils/__tests__/despachoSinCobro.test.js` (y excepción en `.gitignore`)

**Pasos concretos:**
1. Crear `despachoSinCobro.js` que evalúe:
   - `sinCobro = !esCod && total <= 0.015`
   - `motivoSinCobro`: `'prestamo'` si todos los artículos tienen `es_prestamo`, `'donacion'` si hay donación/descuento 100 %, o `'sin_cobro'` en otro caso.
   - Textos claros distintos para préstamo (*"Este despacho es 100 % préstamo: no se cobra nada ahora"*) y para donación (*"Este despacho es 100 % donación: no requiere método de pago"*).
2. Usar esa función en las 4 pantallas:
   - `CotizacionesView.jsx`: desbloquear botón de crear despacho cuando `sinCobro` es verdadero y mandar pagos vacíos `[]`.
   - `VentaRapidaView.jsx`: igual en venta rápida.
   - `EditarItemsDespachoModal.jsx`: corregir también líneas 1012 y 1262 para usar `estaCuadrado` (que desaparezca el aviso "Los montos no cuadran") y mostrar el mensaje según `motivoSinCobro`.
   - `EditDespachoModal.jsx`: usar el mensaje según `motivoSinCobro`.
3. Escribir pruebas reales (ejecutando `evaluarSinCobro(...)`, no solo buscando texto) cubriendo: 100 % préstamo, 100 % donación, préstamo + flete > $0 (sí exige pago), COD con $0, y venta normal.

**Listo cuando:**
- Las 4 pantallas permiten guardar un despacho 100 % préstamo sin método de pago, no muestran avisos falsos y distinguen donación de préstamo.

---

## Fase 5 — Limpiar documentos, fortalecer pruebas y correr toda la batería en staging

**Por qué va antes de tu prueba visual:** para que llegues a revisar en pantalla solo cuando todo lo automático, la vuelta atrás y la prueba de tamaño real estén verificados al 100 %.

**Pasos concretos:**
1. **Actualizar registros y corregir contradicciones (cierra A5):**
   - `docs/operaciones/REGISTRO-FALLAS-CODIGO.md`: pasar `N36-INV` a `N43` de `🔴 abierta` a `🟡 arreglada en staging`, y registrar las nuevas fallas cerradas en OP-094/095.
   - Corregir `OP-2026-086` (limpiar la sección "Pendiente" vieja), `OP-2026-093` (aclarar `liquidar_transportista` frente a `INC-004`, aclarar `Kilo Code Review`, anotar solicitud #78) y `REGISTRO.md` (estado de OP-087 y OP-090, y "hoy: OP-2026-096").
2. **Correr la batería completa contra staging:**
   - `npx vitest run` (todas en verde, incluyendo pruebas de comportamiento nuevas).
   - `npx vite build` (sin errores).
   - `node scripts/test-e2e-staging.mjs` (123/123 × 2 corridas seguidas).
   - `node scripts/op084-pruebas-staging.mjs` (todas en verde).
   - `node scripts/op084-restauracion-real-staging.mjs` (restauración real OK).
   - `node scripts/op091-prueba-prestamo-cobro-staging.mjs` (13/13 en verde).
   - `node scripts/op087-prueba-por-aprobar-staging.mjs` (6/6 en verde).
3. **Cubrir los dos pendientes grandes del plan OP-2026-084:**
   - **Ensayo de vuelta atrás (rollbacks):** probar en una copia/rama desechable de base de datos aplicar y revertir las migraciones `312`–`328` con sus rollbacks, comprobando que todo queda limpio.
   - **Prueba de respaldo/restauración tamaño producción (~20 MB):** medir tiempo y memoria de `restaurar_respaldo_atomico` con un volumen equivalente a producción para confirmar que Cloudflare Worker no se queda sin tiempo ni memoria.

**Listo cuando:**
- 100 % de las pruebas automáticas, de base real, de vuelta atrás y de 20 MB están en verde y documentadas en un informe de cierre.

---

## Fase 6 — Tu revisión visual en pantalla, unión de solicitudes y limpieza de carpetas

**Aquí entras tú.** Arrancaremos un solo servidor local con **todo unido** (`http://localhost:5174` + `:8789`) para que pruebes todo de corrido en 15–20 minutos:

1. **Préstamos:** facturar un préstamo "A crédito" y otro "Paga ahora" (confirmar vista previa, tasa elegida, aviso de comisión, y que un cliente de EMPRESA no genere comisión).
2. **Despachos 100 % préstamo sin método de pago:** probar crear en Cotizaciones, crear en Venta rápida, y editar en DES-04967 (Editar productos y Editar despacho).
3. **Devolución parcial:** abrir DES-04938 y confirmar el mensaje claro en español.
4. **Aviso "N por aprobar":** ver la etiqueta azul en Inventario, Venta rápida y Cotizaciones, tocar el detalle, aprobar/rechazar un despacho y comprobar que el número cambia al instante.
5. **Bloque 10 del plan OP-084:** ficha de producto (stock bloqueado), conteo físico, lote (solo suma, sin "sobrescribir"), Kardex (solo ajustes manuales revertibles), respaldo y restauración en Configuración.

**Al dar tu visto bueno:**
- Unir en orden las solicitudes limpias en GitHub: **#78** → **#83** → **#84** (ya integrada con #85 y las Fases 1–5; cerrar #85 como absorbida) → **OP-094/095**.
- Limpiar las carpetas viejas que ya no hagan falta (`construacero-op078`, `construacero-op080`, `construacero-op086`, `construacero-op087`, `construacero-op094`, `construacero-op095`, y revisar `construacero-work` con los cambios de PDF de clientes).

---

## Fase 7 — Paso a producción (caso aparte, SOLO con tu autorización expresa)

> **Regla de oro:** nada de esto se ejecuta hasta terminar la Fase 6 y recibir tu permiso explícito por escrito.

1. Crear un **caso nuevo propio** en una carpeta limpia desde `origin/main` (para no arrastrar los 161 archivos mezclados de staging de #84; cierra M4).
2. **Resolver la colisión de numeración:** en producción el número `312` ya está usado por `312_cerrar_rpcs_dinero_abiertas.sql`. Las migraciones nuevas de producción arrancarán en **`313` en adelante**, limpias y en orden.
3. Incluir las brechas abiertas de producción de **`INC-004`**: cierre de `N30` (escritura directa), lectura por empresa en devoluciones (`despacho_devoluciones` y `despacho_devolucion_intercambios`), funciones extra de dinero (`registrar_abono_cxc`, `reasignar_cliente`, `calcularcomisiondespacho_238b`, verificando antes cuáles siguen abiertas), y respaldo paginado v1.2.
4. **Antes de tocar producción:** respaldo completo oficial de la base de datos de producción en `construacero-backups/` + ensayo en copia desechable.
5. **Ventana acordada:** aplicar migraciones en producción con vuelta atrás lista → publicar Worker y frontend → verificación en vivo (solo lectura + comprobación de pantallas críticas).

---

## 5 decisiones tuyas que necesito antes de empezar

| Nº | Pregunta | Mi recomendación |
|---|---|---|
| **1A** | En comisiones de préstamos facturados: ¿hacemos de una vez la **tabla propia definitiva** para que ningún recálculo borre jamás esas comisiones, o dejamos solo el **freno reforzado** en los 3 lugares (`editar-pago`, `devolución parcial`, `reasignar cliente`)? | **Hacer la tabla propia ahora en Fase 3.** Es complejidad media-baja y elimina para siempre el riesgo de que un recálculo borre una comisión de préstamo al pasar a producción. |
| **1B** | Al facturar un préstamo **"A crédito"** (como ya no existe el botón "Liberar comisión CxC" ni comisiones retenidas en pantalla): ¿**no** genera comisión automática (igual que cualquier venta a crédito en producción, y solo **"Paga ahora"** genera comisión `'generada'`), o quieres que genere comisión de inmediato aunque sea a crédito? | **No generar comisión automática en "A crédito" (solo en "Paga ahora").** Mantiene exactamente la misma regla que hoy usas en producción para todas las ventas a crédito (migración 238) y evita que aparezcan comisiones de deudas sin cobrar. |
| **2** | En el respaldo y restauración desde Configuración: además de sumar `despacho_descuentos`, `comision_liberaciones`, `comision_designacion_diaria` y `cxc_movimientos_borrados`, ¿incluimos también **proveedores, órdenes de compra, cuentas por pagar, vehículos y pagos a transportistas**? | **Sí, incluirlas**, para que el botón "Respaldo" guarde el negocio completo y no solo ventas/inventario. |
| **3** | En **DES-04938** (staging): ¿quieres que dejemos ese despacho de prueba tal cual está o que limpiemos su pago falso de `$2.640`? | **Dejarlo como está en staging** (es solo un dato de prueba) y enfocarnos en que el sistema ya no permita crear casos nuevos así. |
| **4** | ¿Me autorizas a subir a GitHub la **Fase 0** (rescatar los 3 archivos de OP-084 en #83/#84, arreglar #78 y subir OP-094 y este plan OP-095)? | **Sí, hacer Fase 0 primero** para que nada de lo que ya trabajaste corra riesgo de perderse. |

*(Pendiente de negocio para antes de Fase 7: confirmar si la segunda cuenta de producción es real o de prueba).*
