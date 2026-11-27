# OP-2026-097 — Auditoría de producción y plan de paso a producción (Inventario, "Por aprobar", Respaldo 26 tablas y Seguridad)

- **Fecha:** 2026-11-26
- **Antecedentes:** [OP-2026-095](OP-2026-095_plan-correccion-auditoria-traspaso-staging.md) (Fase 7), [OP-2026-096](../operaciones/OP-2026-096_ejecucion-plan-correccion-traspaso-staging.md), [INC-004](../incidentes/INC-004-funciones-de-dinero-abiertas-en-produccion.md)
- **Carpeta y rama usadas:** `construacero-op097` (ya eliminada tras publicar) · rama `feat/op-097-inventario-seguridad-prod` · Solicitud de cambio [#88](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/88) (unión `9a0859d0`)
- **Estado:** 🟢 **Publicado y verificado en producción el 2026-11-26 (`15/15` verificaciones en vivo OK).** Listo para el inventario físico del sábado.

---

## En resumen

- **Publicado y verificado en producción (`oyfyuszgjwcepjpngclv`) el 2026-11-26** tras tu luz verde: las 6 actualizaciones de base de datos (`313` a `318`), el servidor en Cloudflare (`7ca7c29e-4389-4378-8756-ae4f18c21908`) y la web en Vercel (`9a0859d0`) están activos y pasaron **`15/15` comprobaciones en vivo** sin alterar un solo saldo ni unidad de inventario.
- **Auditamos antes la base real de producción (`oyfyuszgjwcepjpngclv`) en modo solo lectura estricto** (sin modificar un solo dato) y encontramos **5 hallazgos clave** que hicieron imprescindible preparar migraciones hechas a la medida de producción en vez de copiar las de pruebas:
  1. Hoy producción tiene **481 productos** (25 en negativo), **97 despachos esperando aprobación** y **4 préstamos pendientes** (0 facturados, 0 devueltos).
  2. El respaldo completo de las tablas del negocio en producción pesa aproximadamente **23,8 MB en formato JSON** (en pruebas pesaba 3,1 MB), por lo que agregamos un margen de tiempo seguro (`180 segundos`) dentro de la restauración atómica.
  3. Hay **4 vistas** que dependen de las columnas de stock y cantidades (`despacho_pesos`, `despacho_items_peso`, `v_catalogo_publico`, `v_productos_vendedor`) y **8 disparadores** propios de producción (distintos a staging): todo se adaptó exactamente a producción, conservando la regla de producción de **precios 2 y 3 habilitables** (`precio2_habilitado` / `precio3_habilitado`).
  4. En producción todavía seguían abiertas **9 funciones internas de dinero/inventario**, **3 reglas amplias sin filtro de empresa** en préstamos/devoluciones, y escritura directa en `cliente_prestamos` (todo queda cerrado en la migración `317`).
  5. En producción existen **2 cuentas**: la real de Construacero (`74dd6821...`, 481 productos, 2.900 despachos, 11 usuarios) y una secundaria pequeña (`983a7922...`, 0 productos, 1 despacho, 4 usuarios); nuestras reglas las mantienen completamente separadas.
- **Paquete preparado y probado en `construacero-op097`:** **6 actualizaciones de base de datos (`313` a `318`)**, cada una con su **archivo exacto de vuelta atrás (`_rollback.sql`)** construido con las definiciones originales literales de producción, más los cambios quirúrgicos del servidor y la web. **"Facturar préstamo" queda oculto en pantalla y apagado en el servidor (HTTP 403)** hasta hablar con el cliente; **"Devolver"** queda 100 % activo.

---

## 1. Hallazgos de la auditoría de producción (solo lectura, 2026-11-26)

### 1.1 Foto operativa actual (útil para el inventario físico del sábado)

| Indicador en producción | Valor real hoy | Qué significa para el sábado |
|---|---:|---|
| Productos totales / activos | **481** / **480** | Catálogo manejable para conteo físico por pasillo o categoría. |
| Productos con stock negativo | **25** | Vienen de fallos viejos; se corrigen pasando **Conteo físico** el sábado. |
| Despachos en **"Esperando aprobación"** | **97** | **Clave:** revisar, aprobar o anular antes de contar el galpón (o apoyarse en la nueva etiqueta azul **"N por aprobar"**). |
| Préstamos activos (`pendiente`) | **4** (`DES-1648` ×1, `DES-692` ×400 en `$0`, `DES-665` ×15 y ×27) | Quedan intactos; se pueden devolver físicamente desde **Clientes → Ficha → Préstamos → Devolver**. |
| Cuentas en base de datos | **2** (`74dd6821...` real; `983a7922...` secundaria con 1 despacho) | Aisladas con políticas restrictivas y verificación previa en respaldos. |

### 1.2 Tamaño real de respaldo en producción (~23,8 MB JSON)

| Tabla | Filas hoy | Tamaño JSON estimado |
|---|---:|---:|
| `inventario_movimientos` | 8.102 | 5,48 MB |
| `notas_despacho` | 2.900 | 4,35 MB |
| `notas_despacho_items` | 6.840 | 3,92 MB |
| `cotizacion_items` | 7.771 | 3,29 MB |
| `cotizaciones` | 3.120 | 2,30 MB |
| `comisiones` | 1.816 | 2,24 MB |
| `clientes` | 1.308 | 0,87 MB |
| `cuentas_por_cobrar` | 1.067 | 0,55 MB |
| `transportistas` + `productos` + otras 11 tablas | 1.158 | 0,78 MB |
| **Total cuenta principal** | **~34.100 filas** | **~23,77 MB** |

*(Hoy el respaldo viejo de producción se corta a las 1.000 filas por tabla y omite 19 tablas. Con `OP-2026-097`, descarga las 26 tablas completas paginadas.)*

### 1.3 Brechas de seguridad confirmadas abiertas hoy en producción (se cierran en `317` y `318`)

- **Funciones abiertas a cualquiera o con sesión directa (`SECURITY DEFINER`):** `aplicar_movimiento_lote`, `actualizar_estado_despacho`, `marcar_comision_pagada`, `registrar_abono_cxc`, `registrar_cargo_cxc(uuid)`, `reasignar_cliente`, `reciclar_cotizacion`, `reciclar_despacho`, `calcularcomisiondespacho_238b` y 2 versiones antiguas de `editar_despacho_profundidad`. Confirmado en el código que **ninguna pantalla las llama directo desde el navegador**, así que cerrarlas a `service_role` tiene riesgo cero.
- **Reglas de acceso amplias (`USING (true)`):** `cliente_prestamos` (con escritura directa `INSERT/UPDATE/DELETE` aún abierta — falla **N30**), `despacho_devoluciones` y `despacho_devolucion_intercambios` (sin regla restrictiva de empresa — **INC-004**).
- **Funciones de catálogo sin filtro de empresa y abiertas a `anon`:** `obtener_stock_productos` y `obtener_categorias_vendedor`. Se cierran con `auth.role() = 'service_role' OR p.cuenta_id = (SELECT auth.uid())` y se conserva `precio2_habilitado` / `precio3_habilitado` en `obtener_productos_vendedor`.

---

## 2. Contenido del paquete listo en `construacero-op097`

### 2.1 Seis actualizaciones de base de datos (`313` a `318`) + 6 archivos de vuelta atrás

| # | Archivo de migración | Qué aplica en producción | Archivo de vuelta atrás exacto |
|---|---|---|---|
| **1** | `313_prod_inventario_ficha_conteo_kardex_y_lote.sql` | Bloquea cambiar stock desde editar producto (**N25**); crea **Conteo físico atómico** con control de cambios simultáneos; Kardex solo revierte ajustes manuales y conteos (**N26/M1**); ingreso por lote **solo suma** (elimina "sobrescribir"); impide borrar productos con historial (**N33**). | `313_prod_inventario_ficha_conteo_kardex_y_lote_rollback.sql` |
| **2** | `314_prod_decimales_4_digitos.sql` | Eleva stock y cantidades a **4 decimales** (`NUMERIC(12,4)`) recreando las 4 vistas dependientes exactas de producción. | `314_prod_decimales_4_digitos_rollback.sql` |
| **3** | `315_prod_prestamos_devoluciones_y_reapertura.sql` | Cierra **N44-INV** (no reabrir despacho con préstamo ya gestionado), **N35** (no devolución parcial sobre préstamos), valida precios y totales de intercambio en devoluciones, guarda `origen_tipo = 'devolucion'` en Kardex (**A6**) y fortalece devolución física de préstamos (`FOR UPDATE` + archivados). *No incluye facturar préstamo.* | `315_prod_prestamos_devoluciones_y_reapertura_rollback.sql` |
| **4** | `316_prod_stock_por_aprobar.sql` | Crea las funciones de aviso azul **"N por aprobar"** (4 decimales, filtradas por empresa, sin acceso anónimo). | `316_prod_stock_por_aprobar_rollback.sql` |
| **5** | `317_prod_seguridad_rpcs_rls_y_catalogo.sql` | Cierra todas las funciones abiertas de dinero/estado, limita `tester_cleanup_cotizacion`, revoca escritura directa (**N30**), añade aislamiento restrictivo a devoluciones (**INC-004**) y cierra funciones de catálogo (**A4**) conservando precios 2/3 habilitables. | `317_prod_seguridad_rpcs_rls_y_catalogo_rollback.sql` |
| **6** | `318_prod_respaldo_restauracion_atomica_26_tablas.sql` | Agrega `sync_sequences_after_restore()`, bandera transaccional `app.restaurando_respaldo` en los 8 disparadores reales de producción (sin congelar a otros usuarios) y `restaurar_respaldo_atomico` (26 tablas, cierre **C3** previo, **M3** unión de llaves, tiempo límite `180 s`). | `318_prod_respaldo_restauracion_atomica_26_tablas_rollback.sql` |

### 2.2 Cambios quirúrgicos en el servidor (`worker.js`, `api/`) y la web (`src/`)

- **Conserva intacto todo lo propio de producción** (`ImgProducto`, `precio2Visible`/`precio3Visible`, `Sin peso`, `chunkIds`, `flota-peso`, `cobranza`, `dashboard`).
- **Servidor:** ruta `POST /api/inventario/conteo` (Conteo físico), respaldo paginado `v1.3` de 26 tablas + restauración atómica exigiendo `completo === true`, rechazo de `sobrescribir` en lote, interruptor apagado (`FACTURACION_PRESTAMOS_HABILITADA = false`, HTTP 403) en facturar préstamo, y mensajes claros al editar ficha o borrar producto con historial.
- **Pantallas:**
  - **Conteo físico** disponible tanto en **Inventario → Ingreso/Egreso → Conteo físico** (por lotes, ideal para el sábado) como dentro de **Editar producto → Ajustar por conteo físico** (con stock actual bloqueado en solo lectura).
  - **Ingreso por lote** solo suma ("Suma al stock", ya no muestra "Sobre").
  - **Kardex** solo muestra el botón de revertir en ajustes manuales y conteos físicos.
  - **Aviso azul "N por aprobar"** visible en Inventario (con ventana de detalle por despacho), Venta rápida y Cotizaciones, refrescándose al crear/aprobar/editar/anular despachos.
  - **Préstamos y Devoluciones:** en la ficha del cliente solo aparece **"Devolver"** ("Facturar" oculto); en Devolución parcial se bloquean ítems de préstamo con mensaje claro; en las 4 pantallas de despacho, un despacho en `$0` / 100 % préstamo no exige método de pago.

---

## 3. Paso a paso exacto para publicar (cuando el dueño dé luz verde)

> **Ventana recomendada:** viernes por la noche (al cerrar operaciones) o sábado muy temprano **antes de iniciar el conteo físico**. Duración total estimada: **15 a 20 minutos**.

### Paso 0 — Congelar movimientos y tomar copia de seguridad oficial (5 min)
1. Avisar al equipo que durante 15 minutos no creen ni aprueben despachos.
2. Guardar respaldo completo de la base de producción en `construacero-backups/prod-pre-op097-YYYYMMDD/` (esquema + funciones + datos de las tablas clave) y anotar los números de control antes de tocar nada (`total_productos`, `SUM(stock_actual)`, `COUNT(inventario_movimientos)`, `SUM(saldo_pendiente)`).
3. Anotar la versión actual publicada del Worker de Cloudflare (`npx wrangler deployments list`) y el despliegue actual de Vercel para tener vuelta atrás en 1 clic si hiciera falta.

### Paso 1 — Aplicar migraciones `313` a `318` en producción en orden (3 min)
Ejecutar en Supabase producción (`oyfyuszgjwcepjpngclv`), una por una dentro de transacción, verificando `OK` tras cada archivo:
1. `313_prod_inventario_ficha_conteo_kardex_y_lote.sql`
2. `314_prod_decimales_4_digitos.sql`
3. `315_prod_prestamos_devoluciones_y_reapertura.sql`
4. `316_prod_stock_por_aprobar.sql`
5. `317_prod_seguridad_rpcs_rls_y_catalogo.sql`
6. `318_prod_respaldo_restauracion_atomica_26_tablas.sql`

*(Si cualquiera diera error, Postgres revierte esa migración automáticamente por `BEGIN...COMMIT`, no seguimos y aplicamos los `_rollback.sql` en orden inverso.)*

### Paso 2 — Unir solicitud de cambio y publicar servidor + web (5 min)
1. Unir la solicitud de cambio de `OP-2026-097` a `main` en GitHub.
2. Publicar el Worker de Cloudflare de producción (`npx wrangler deploy`) y confirmar despliegue verde.
3. Esperar a que Vercel termine de compilar y publicar `main` en producción (`Ready`).

### Paso 3 — Verificación en vivo en producción (5 min, solo lectura y pruebas seguras)
1. **Cuadre de datos:** verificar que `total_productos`, `SUM(stock_actual)` y `SUM(saldo_pendiente)` son idénticos al centavo/decimal respecto al Paso 0.
2. **Seguridad sin sesión:** comprobar desde internet que las RPCs cerradas (`aplicar_movimiento_lote`, `registrar_abono_cxc`, `obtener_stock_productos` sin sesión) devuelven `401`/`404` y `POST /api/clientes/prestamos/facturar` devuelve `403`.
3. **Respaldo real v1.3:** descargar un respaldo desde **Configuración → Datos** con sesión de Jefe y confirmar que llega completo (`completo: true`, 26 tablas, ~24 MB) sin cortarse por tiempo.
4. **Revisión rápida en pantalla (sin alterar datos reales):**
   - Inventario muestra las etiquetas azules **"N por aprobar"** y al editar un producto el stock está bloqueado con botón **"Ajustar por conteo físico"**.
   - **Ingreso / Egreso** muestra las 3 pestañas (`Ingreso`, `Egreso`, `Conteo físico`).
   - **Clientes → Ficha → Préstamos** muestra solo **"Devolver"** (0 botones "Facturar").
   - Venta rápida y Cotizaciones cargan sin errores en consola.

### Paso 4 — Recomendación operativa para el inventario del sábado
1. Antes de contar, revisar los **97 despachos en "Esperando aprobación"** (aprobar lo que ya salió y anular lo que ya no va).
2. Usar **Inventario → Ingreso / Egreso → Conteo físico** para ajustar los **25 productos en negativo** y cualquier diferencia del galpón (poner motivo claro, ej. `"Inventario general sábado 28-nov"`).

---

## 4. Plan de vuelta atrás (Rollback completo si algo sale mal)

Si aparece cualquier fallo inesperado después de publicar, se deshace **en orden inverso** en menos de **5 minutos** y sin perder datos:

1. **Web (Vercel):** en el panel de Vercel → *Deployments* → tocar los 3 puntos del despliegue inmediatamente anterior → **Promote to Production** (~30 segundos).
2. **Servidor (Cloudflare Worker):** ejecutar `npx wrangler rollback` (vuelve al instante a la versión anotada en el Paso 0, ~15 segundos).
3. **Base de datos (Supabase producción):** ejecutar los archivos de vuelta atrás **en orden estrictamente inverso (`318` → `313`)**:
   1. `supabase/migrations/318_prod_respaldo_restauracion_atomica_26_tablas_rollback.sql`
   2. `supabase/migrations/317_prod_seguridad_rpcs_rls_y_catalogo_rollback.sql`
   3. `supabase/migrations/316_prod_stock_por_aprobar_rollback.sql`
   4. `supabase/migrations/315_prod_prestamos_devoluciones_y_reapertura_rollback.sql`
   5. `supabase/migrations/314_prod_decimales_4_digitos_rollback.sql`
   6. `supabase/migrations/313_prod_inventario_ficha_conteo_kardex_y_lote_rollback.sql`
4. **Verificación post-rollback:** comprobar en vivo que el sitio abre normal, los saldos/stocks siguen intactos y anotar el incidente en `docs/incidentes/`.

*(Nota: si solo fallara la web o el Worker pero las migraciones de BD estuvieran sanas, basta con revertir la web o el Worker; las migraciones `313`–`318` son compatibles hacia atrás con el código anterior salvo el botón nuevo de Conteo físico.)*

---

## 5. Constancia de publicación en vivo (2026-11-26)

| Elemento | Resultado real verificado |
|---|---|
| **Copia de seguridad oficial previa** | Guardada en `construacero-backups/prod-pre-op097-20261126/` (`datos_prod_pre_op097.json` de **23,91 MB**, `schema_snapshot_pre_op097.json` y `control_pre_op097.json`). |
| **Migraciones aplicadas en producción (`oyfyuszgjwcepjpngclv`)** | **6/6 OK** en secuencia (`313` → `314` → `315` → `316` → `317` → `318`, 4,6 s total, 0 errores). |
| **Solicitud de cambio en GitHub** | [#88](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/88) unida a `main` en commit **`9a0859d0`**. |
| **Servidor (Cloudflare Worker + web compilada)** | Versión publicada: **`7ca7c29e-4389-4378-8756-ae4f18c21908`** (58 archivos estáticos nuevos). Versión anterior para vuelta atrás en 1 comando: **`27bdda35-61eb-45c4-afd9-d9571aa53201`**. |
| **Web (Vercel)** | Estado `success` (*Deployment has completed*) sobre `9a0859d0`. |
| **Verificación en vivo post-publicación** | **`15/15` OK**: `/api/ping` (`200`), `/api/rates` (`200`), `POST /api/clientes/prestamos/facturar` bloqueado (`403`), `POST /api/inventario/conteo` sin sesión bloqueado (`401`), funciones internas cerradas a anónimos (`404`/`401`), `cliente_prestamos` sin escritura directa (N30 cerrada), `despacho_devoluciones` y `despacho_devolucion_intercambios` con aislamiento restrictivo por empresa y 0 reglas `USING(true)` (INC-004 cerrada), `productos.stock_actual = numeric(12,4)`, `4/4` vistas dependientes recreadas y `0` disparadores desactivados. |
| **Cuadre exacto antes vs. después** | `total_productos`: **481 → 481** · `suma_stock`: **265.928,0000 → 265.928,0000** · `suma_saldo_clientes`: **$79.732,0300 → $79.732,0300** (diferencia `0`). |
| **Pendiente por decisión del dueño** | **1)** Confirmar con el cliente cómo quiere manejar "Facturar préstamo" antes de encender el interruptor (hoy oculto y bloqueado con HTTP 403). **2)** Opcional: probar una descarga de respaldo v1.3 desde **Configuración → Datos** con sesión de Jefe y realizar el conteo físico del sábado. |
