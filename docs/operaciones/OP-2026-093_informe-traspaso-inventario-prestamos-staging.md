# OP-2026-093 — Informe de traspaso: inventario, préstamos y seguridad en staging (qué se hizo y qué falta)

**Fecha:** 2026-11-25 · **Para:** otro asistente (LLM) o persona que continúe el trabajo · **Escrito por:** Claude (sesión con el dueño)
**Alcance de este informe:** todo lo hecho desde la auditoría de inventario de staging (OP-2026-075/076) hasta la facturación de préstamos (OP-2026-091/092). **Producción no se tocó, salvo el cierre urgente de dos funciones (ver sección 3).**

---

## 0. Cómo leer esto (reglas obligatorias del proyecto)

Fuente: `AGENTS.md` en la raíz del repositorio. Lo esencial:

- **El dueño NO sabe programar** ("vibe coder"). Todo lo que se le diga y todos los documentos van **en español, en lenguaje llano**, con "En resumen" primero. Explicar cualquier término técnico la primera vez.
- **Todo se documenta:** cada caso tiene número `OP-AAAA-NNN` (siguiente libre en `docs/operaciones/REGISTRO.md`) y un documento en `docs/operaciones/` (o `docs/plans/`, `docs/incidentes/`). Toda falla del código se anota en `docs/operaciones/REGISTRO-FALLAS-CODIGO.md`. Un cambio sin documento está incompleto.
- **Carpetas de trabajo (OP-2026-083):** la carpeta principal `C:\Users\luigg\Desktop\construacero` se queda en `main`, limpia. Cada caso va en su propia carpeta creada con `git worktree add ../construacero-<caso> -b <rama> origin/main`.
- **Producción (proyecto Supabase `oyfyuszgjwcepjpngclv`) está PROHIBIDA** salvo autorización expresa del dueño, caso por caso. **Staging** es `spupqgkdsgohxxfoxydl`. El código de staging vive en la subcarpeta `construacero-staging/` y se publica por separado.
- Las acciones externas (subir a GitHub, producción, secretos, publicar) requieren permiso. Las solicitudes de cambio (PR) las aprueba el dueño; no se unen solas.
- No poner contraseñas, tokens ni llaves en el chat ni en documentos. Están en archivos locales (ver sección 6).

---

## 1. Resumen ejecutivo

1. Se auditó el inventario de staging (informe OP-2026-076: **NO APTO**), se hizo un plan de correcciones (OP-078) y un plan de pruebas (OP-084), y se **ejecutaron las correcciones y pruebas en staging** (OP-086).
2. Se cerraron en **producción** dos funciones de dinero que estaban abiertas sin sesión (INC-004, OP-085) — único cambio en producción.
3. Después, trabajando sobre staging, se corrigieron cuatro cosas que el dueño encontró usando la pantalla: error de tasa al facturar préstamos (OP-088), mensaje de devolución parcial (OP-089), una auditoría del despacho DES-04938 (OP-090), y facturación de préstamos con tasa principal + pago al facturar + comisión (OP-091) y despacho 100 % préstamo sin método de pago (OP-092). También se creó el aviso de unidades "por aprobar" (OP-087).
4. **Todo está en 3 solicitudes de cambio abiertas (#83, #84, #85), sin unir, y falta que el dueño lo vea en pantalla.**

---

## 2. Mapa de casos (OP) y dónde está cada cosa

| OP | Qué es | Dónde | Estado |
|---|---|---|---|
| 075 | Correcciones de inventario en staging (trabajo guardado en rama `wip/op-075-inventario-staging`) | Rama local de otra PC | Se mezcló dentro de OP-086 (no se unió tal cual: borraba 13 archivos de main) |
| 076 | Auditoría independiente del inventario de staging | `docs/operaciones/OP-2026-076_...` (en main) | Hecho. Veredicto NO APTO (C1 funciones de dinero abiertas, C2 respaldo recortado a 1000 filas, A1–A4, M1–M5, B1–B3) |
| 078 | Plan de corrección de la auditoría (7 fases) + decisiones del dueño | `docs/plans/OP-2026-078_...` (rama `docs/op-078-estado-rama-inventario`, PR #83) | Ejecutado casi todo en OP-086 |
| 084 | Plan de pruebas completo (~120 pruebas, 10 bloques) | `docs/plans/OP-2026-084_...` (PR #83) | Bloques automáticos hechos; **bloque 10 (revisión visual) pendiente** |
| 085 / INC-004 | Cierre urgente en **producción** de `registrar_cargo_cxc` y `registrar_pago_comision` | `supabase/migrations/312_cerrar_rpcs_dinero_abiertas.sql` (+rollback), `docs/incidentes/INC-004-...` (PR #83) | **Aplicado en producción 2026-11-25**, verificado (404 sin sesión) |
| 086 | Ejecución de correcciones y pruebas en staging | `docs/operaciones/OP-2026-086_...`, rama `fix/op-086-inventario-staging`, carpeta `construacero-op086`, **PR #84** | Aplicado en staging; pruebas en verde |
| 087 | Aviso "N por aprobar" (despachos pendientes) | rama `feat/op-087-stock-por-aprobar`, carpeta `construacero-op087`, **PR #85** | Hecho y probado; **sin ver en pantalla** |
| 088 | Arreglo "No se pudo obtener la tasa BCV" al facturar préstamo + modal mejorado | dentro de PR #84 | Corregido; sin ver en pantalla con préstamo real |
| 089 | Mensaje claro cuando no se puede hacer devolución parcial | dentro de PR #84 | Hecho; sin ver en pantalla |
| 090 | Auditoría del despacho DES-04938 y qué pasa al "Reabrir despacho" | dentro de PR #84 | Hecho (solo lectura) |
| 091 | Facturar préstamo: tasa principal, "A crédito"/"Paga ahora", comisión; cierra N44-INV | dentro de PR #84 | Hecho y probado en base real; sin ver en pantalla |
| 092 | Despacho 100 % préstamo sin método de pago (Editar productos y Editar despacho) + freno de comisión | dentro de PR #84 | Hecho; sin ver en pantalla |
| 093 | Este informe | dentro de PR #84 | — |

Números de OP ya usados: hasta **093**. El siguiente libre es **OP-2026-094** (verificar siempre en `REGISTRO.md` y en las ramas abiertas por si otra sesión tomó números; ya hubo un choque con OP-077).

**Solicitudes de cambio (GitHub `luiggiberaldi/listo-pos-cotizaciones`), todas abiertas y sin unir:**
- **#83** `docs/op-078-estado-rama-inventario`: migración 312 de producción (ya aplicada) + planes OP-078/084 + INC-004 + bitácora.
- **#84** `fix/op-086-inventario-staging`: todo el trabajo de staging (OP-086, 088, 089, 090, 091, 092, 093). Migraciones 312–323, 325, 326 de staging.
- **#85** `feat/op-087-stock-por-aprobar`: aviso "por aprobar". Migración 324 de staging.
- Las tres tienen una verificación en `ACTION_REQUIRED` (pide aprobación de un flujo de GitHub) y `MERGEABLE`.
- Los archivos `.gitignore` y `REGISTRO.md` se tocaron en las tres ramas: **al unirlas habrá conflictos triviales** (líneas añadidas al final). Resolver manteniendo todas las líneas.

---

## 3. Producción: qué se hizo y qué NO

**Único cambio en producción:** migración `312_cerrar_rpcs_dinero_abiertas.sql` — quita permisos de `PUBLIC`, `anon` y `authenticated` a `registrar_cargo_cxc(uuid,uuid,numeric,text,uuid)` y `registrar_pago_comision(uuid,uuid,uuid)` y los deja solo para `service_role`. Rollback: `312_cerrar_rpcs_dinero_abiertas_rollback.sql`. Autorizado por el dueño ("Sí, ciérralas ya").

**Colisión de numeración a resolver antes de pasar a producción:** en producción el archivo `312` es el del cierre de funciones; en la rama de staging el `312` es `312_staging_inventario_ficha_y_kardex.sql`. Son archivos distintos con el mismo número. Al pasar el trabajo a producción hay que renumerar o registrar con cuidado.

**Hallazgos de producción abiertos (en `docs/incidentes/INC-004-...`), sin corregir:**
- **N30:** con una sesión iniciada se puede escribir directo en `notas_despacho`, `notas_despacho_items`, `cliente_prestamos`, `clientes`, `cotizaciones`, `cotizacion_items` (en préstamos por la regla "Permitir todo…"). En staging ya se cerró lo de `cuentas_por_cobrar` (migración 323).
- Respaldo de la app en producción recortado a 1000 filas (PostgREST `max_rows`); en staging ya se corrigió (lectura paginada + marca "incompleto").
- Reglas de lectura sin filtro de empresa en `despacho_devoluciones`, `despacho_devolucion_intercambios` y registros técnicos (`system_logs`, `system_log_analysis`, que ni tienen columna de empresa). En producción hay 2 cuentas; **pregunta abierta al dueño: ¿la segunda cuenta es real o de prueba?**
- Funciones de dinero extra (`registrar_abono_cxc`, `liquidar_transportista`, `reasignar_cliente`, `calcularcomisiondespacho_238b`) se cerraron en staging (migración 316) pero **no en producción**.

**Nada de OP-086 a OP-092 está en producción.** Pasarlo es un caso aparte que requiere autorización expresa.

---

## 4. Staging: qué se hizo (detalle)

### 4.1 OP-086 — correcciones de la auditoría (migraciones 312–323)
Migraciones de staging (todas con rollback; ya aplicadas en la base de staging):
- **312–315** (renumeradas desde 310–313 porque la 311 ya era de OP-070): ficha de producto y Kardex, préstamos/reapertura/intercambios, seguridad de RPCs y RLS de inventario, higiene de decimales y lotes.
- **316** cierre de funciones de dinero (solo `service_role`); `tester_cleanup_cotizacion` limitada a cuenta propia.
- **317** aislamiento por empresa: política RESTRICTIVA "aislamiento_cuenta" en 25 tablas (+ hijas), `REVOKE SELECT` a `anon`, funciones de catálogo y stock filtran por empresa.
- **318** `facturar_prestamo_atomico` (candado `FOR UPDATE`, idempotencia, precio del despacho original). *Reemplazada por la 326.*
- **319** Kardex: Revertir solo para motivos/orígenes de una lista permitida.
- **320** ingreso por lote **solo suma** (se eliminó "sobrescribir", decisión del dueño).
- **321** devolución parcial valida filas y totales en la base.
- **322** `restaurar_respaldo_atomico` (todo o nada; apaga disparadores propios durante la carga; conserva números; rechaza filas de otra empresa).
- **323** sin escritura directa en `cuentas_por_cobrar`.
Código: `api/handlers/{admin,clientes,inventario}.js`, `FichaClienteModal.jsx`, `IngresoLoteHubModal.jsx`, `ImportadorModal.jsx`, `KardexModal.jsx`, `MovimientoLoteModal.jsx`, `ConfiguracionView.jsx`, `src/utils/{idempotencyKey,kardexRevertible}.js`. Respaldo versión 1.2 (lee por páginas, verifica conteos, incluye comisiones que antes salían siempre vacías por una columna mal nombrada `cuentaid`).

### 4.2 OP-087 — aviso "por aprobar" (migración 324, PR #85)
Funciones `obtener_stock_por_aprobar()` y `..._detalle(producto)` (solo despachos `pendiente`, filtradas por empresa, sin acceso anónimo). Etiqueta azul "N por aprobar" en Inventario (con detalle por vendedor y despacho), Venta rápida y buscadores de cotizaciones. **Es solo aviso, no resta del stock** (decisión de diseño documentada).

### 4.3 OP-088 / 091 — facturar préstamos
- Error de OP-086: el modal trataba `tasaBcv` (un objeto) como número → siempre "tasa no válida". Corregido.
- Modal rediseñado: vista previa (precio del despacho original, tasa, monto en USD y Bs), atajos Mitad/Todo, validaciones, botón "Facturar $X".
- **Decisiones del dueño (2026-11-25):** se factura con la **tasa principal elegida en el sistema** (BCV, USDT o manual; el cargo anota cuál); por ahora el vendedor **cobra el mismo porcentaje** que en una venta normal.
- Migración **325** (`precio_unitario_prestamo` compartido por el cobro y la vista previa) y **326** (`facturar_prestamo_atomico` con parámetros `p_tasa_modo`, `p_pago_metodo`, `p_pago_referencia`; `comision_prestamo_facturado_staging`; freno N44-INV en `revertir_entrega_finanzas_atomica`; texto del cargo sin "##").
- **"A crédito"**: cargo a la cuenta; comisión queda **retenida** (`estado='cta_cobrar'`, `comision_retenida`). **"Paga ahora"**: cargo + abono en un paso; comisión **liberada**.

### 4.4 OP-089 — mensaje de devolución parcial
`DevolucionParcialModal.jsx`: el mensaje distingue "todo en préstamo", "mezcla" y "todo devuelto", sin jerga ("ajustes de devolución", "venta anulada económicamente").

### 4.5 OP-090 — auditoría del despacho DES-04938
Préstamo de 120 m³ de grava: 20 devueltos, 100 facturados ($22 c/u = $2.200). Inventario, cobro y saldo cuadran. "Reabrir despacho" se **rechaza** (`PRESTAMO_YA_TIENE_DEVOLUCIONES_O_FACTURAS`) y no cambia nada. Se halló la falla **N44-INV** (revertir a "aprobado" no revisaba préstamos y habría borrado el cobro) → cerrada en la migración 326.

### 4.6 OP-092 — despacho 100 % préstamo sin método de pago
Con total $0 y sin cobro a destino, `EditarItemsDespachoModal.jsx` y `EditDespachoModal.jsx` ya no exigen método de pago (la regla `pagoCuadrado` de `useFormasPago` exigía al menos una fila). Al guardar mandan pagos vacíos. Explicación probable (no comprobada) del pago falso de $2.640 anotado en DES-04938. **Freno provisional** en `api/handlers/despachos.js` (`editar-pago`): si el despacho tiene préstamos facturados, **no se borra ni recalcula la comisión** (antes la habría borrado y recalculado desde cero).

---

## 5. Pruebas: cómo correrlas y últimos resultados

Todo se corre desde `C:\Users\luigg\Desktop\construacero-op086\construacero-staging` (hace falta `node_modules`; la carpeta `construacero-op087` usa un acceso directo a ese `node_modules`).

| Qué | Comando | Último resultado |
|---|---|---|
| Pruebas automáticas | `npx vitest run` | **571/571** (69 archivos) |
| Compilación | `npx vite build` | OK |
| Probador completo de punta a punta (contra la base real de staging, deja y limpia sus datos) | `node scripts/test-e2e-staging.mjs` | **123/123** (varias corridas; última tras OP-092) |
| 17 pruebas "romper el sistema" (seguridad, aislamiento, respaldo, lote, candado de préstamo) | `node scripts/op084-pruebas-staging.mjs` | **17/17** |
| Restauración real de respaldo completo (2,9 MB) | `node scripts/op084-restauracion-real-staging.mjs` | OK, nada cambió |
| Préstamo: cargo con tasa principal, a crédito, paga ahora, comisión, N44 (cada prueba se deshace sola) | `node scripts/op091-prueba-prestamo-cobro-staging.mjs` | **9/9** |
| "Por aprobar" (solo lectura) | `node scripts/op087-prueba-por-aprobar-staging.mjs` (en la carpeta op087) | **6/6** |

Los guardias de esos scripts rechazan correr contra producción. Los `.test.js`/scripts nuevos están en el `.gitignore` como excepciones (el `.gitignore` ignora `*.test.js` y `scripts/*` por defecto): **al agregar pruebas hay que añadir su excepción al `.gitignore`**.

**Lecciones de las pruebas:** las pruebas que llaman al servidor directamente NO ven errores de pantalla (el error de la tasa pasó así). Las pruebas basadas en leer el código fuente son débiles; no hay pruebas de navegador (clic real) para los flujos nuevos.

---

## 6. Entorno y trucos operativos (Windows, Git Bash)

- **Carpetas:** `construacero` (main, limpia), `construacero-op078` (docs, PR #83), `construacero-op086` (PR #84), `construacero-op087` (PR #85), `construacero-op080` y `construacero-work` (viejas; **pendiente que el dueño confirme su limpieza**, OP-083).
- **Secretos (NO copiar a ningún lado):** `construacero-staging/.env` (token de la API de Supabase `SUPABASE_ACCESS_TOKEN`), `.dev.vars` (`SUPABASE_SERVICE_KEY` de staging), `.env.e2e.local` (`STAGING_E2E_EMAIL`, `STAGING_E2E_PASSWORD`, `DEV_SUPER_CODE`). La carpeta op087 tiene copias locales de esos archivos, ignoradas por git.
- **Servidores locales:** configuraciones `op086-api-staging` (Worker, puerto 8789) y `op086-web-staging` (Vite, 5174, con `--host`) en `construacero/.claude/launch.json`. La página de pruebas en 5174 corre el código de la carpeta **op086** (no incluye el aviso "por aprobar" de op087). La sesión del navegador integrado es de **otra empresa de prueba (0 clientes)**; los datos del dueño (cliente "ALEJANDRO CORTEZ (PRUEBA VD)", despachos DES-04938 y DES-04967) solo se ven con su propio usuario.
- **Consultas a la base de staging** (no versionado): `construacero-op086/tmp-op086/q.mjs <archivo.sql>` (solo lectura) y con `--escribir` (escritura, autorizada solo para staging). Para probar escrituras sin dejar datos se usan bloques `DO $$ ... RAISE EXCEPTION ... $$` que **siempre se deshacen**. La API de Supabase falla a veces con 502: reintentar. La API en modo solo-lectura no puede ejecutar funciones solo-`service_role`.
- **Trampas conocidas:** en `bash` los scripts largos con comillas mezcladas pueden fallar al analizarse; usar la herramienta de escritura de archivos y ejecutar el `.py`. Archivos `.js` bajo `"type": "module"` deben ser `.mjs`. Los archivos del repo usan CRLF (los avisos de git son normales). `cuenta_id` en `comisiones` se llama `cuentaid`; `despachoid`, `vendedorid`, `montopagado`, `creadoen` también sin guion bajo.
- **Staging en internet (Cloudflare) está desactualizado desde 2026-09-07 y sin secretos cargados** (`wrangler secret list` vacío). No se publicó: requiere que el dueño cargue el `SUPABASE_SERVICE_KEY` de staging. Por eso la revisión visual es en local.

---

## 7. Lo que FALTA (en orden de prioridad)

### A. Verificación del dueño en pantalla (nada de esto se ha visto con clic real)
1. Facturar un préstamo pendiente de staging con **"A crédito"** y con **"Paga ahora"** (ver vista previa, tasa principal, aviso de comisión).
2. "Editar productos" y "Editar despacho" en un despacho 100 % préstamo (DES-04967): debe dejar guardar sin método de pago.
3. Mensaje de devolución parcial en DES-04938.
4. Aviso "N por aprobar" (hay que arrancar la página desde la carpeta **op087** o unir antes la #85 a #84).
5. Bloque 10 completo del plan OP-084 (ficha de producto, conteo físico, lote sin "sobrescribir", Kardex, devolución parcial, préstamos, respaldo/restauración, mensajes de error).
Un asistente debería **pedir al dueño** que pruebe o crear un préstamo pendiente de prueba; no puede hacer clic en los datos del dueño.

### B. Decisiones del dueño pendientes
- Aprobar/unir **#83, #84, #85** (con conflictos triviales en `.gitignore` y `REGISTRO.md`).
- Despacho DES-04938: el pago de **$2.640** anotado (aunque era préstamo y nunca se cobró) sigue sin corregir; cargo viejo con "##" y comisión en cero.
- **Comisión retenida de préstamos a crédito:** hoy la libera administración a mano (botón "Liberar comisión CxC"). ¿Se quiere automática al pagar el cliente? Tampoco se aplicó el reparto "designado del día" (split) a esta comisión.
- **Tasa:** el servidor no puede saber qué tasa eligió el usuario (vive en el navegador); solo rechaza una tasa fuera de 1/4–4 veces la del despacho. ¿Se quiere validación más fuerte?
- Confirmar supuestos de negocio de OP-084: despacho sin stock sigue **solo avisando**; supervisor puede hacer lotes (que solo suman); monto en dólares del préstamo a 2 decimales.
- Si la segunda cuenta de producción es real o de prueba.
- Limpieza de la carpeta principal (OP-083): PDF de prueba, `tmp`, carpetas `construacero-op080` y `construacero-work`.

### C. Trabajo técnico pendiente
1. **Arreglo definitivo de la comisión de préstamos facturados:** tabla propia por cada facturación (monto, cobrado/retenido, despacho) y re-aplicarla tras cualquier recálculo; que "Liberar comisión CxC" las marque liberadas; decidir qué hacer si la comisión ya se pagó al vendedor (el borrado/recálculo de `editar-pago` hoy no distingue). Complejidad media-baja; el dueño decidió **dejar el freno provisional por ahora** y retomarlo al pasar a producción.
2. **Ensayo de vuelta atrás** (sección 5 del plan OP-084) en una base desechable: aplicar y deshacer 312–326 con sus rollbacks.
3. **Restaurar un respaldo del tamaño de producción** (~20 MB; solo se probó 2,9 MB).
4. **Segunda revisión independiente** (sección 8 del plan OP-084), idealmente con otro modelo, antes de producción.
5. **Pruebas de navegador (clic real)** para facturar préstamo, editar despacho y "por aprobar".
6. Revisar que **la creación del despacho** (cotización → despacho) con todo en préstamo no pida método de pago.
7. Registros técnicos sin columna de empresa (`system_logs`, `system_log_analysis`): no se pueden separar por empresa todavía.
8. Descuadres históricos de inventario (14, mayo–agosto) y ~3400 movimientos viejos sin origen: caso aparte, no se tocaron.
9. Falla abierta fuera de este alcance en el registro: N30 y las demás de producción (sección 3).
10. Cargos viejos de préstamos (como el de DES-04938) conservan texto con "##" y comisión en cero; no se corrigió hacia atrás.

### D. Paso a producción (caso aparte, requiere autorización expresa del dueño)
Orden sugerido: (1) resolver colisión de numeración de migraciones; (2) respaldo completo de producción con el método nuevo; (3) aplicar en una copia/rama de base de datos y probar; (4) aplicar migraciones en producción con ventana acordada; (5) publicar el Worker y el frontend; (6) verificar con las mismas pruebas (solo lectura donde se pueda). Incluir N30 y el resto de INC-004. **No hacerlo sin la autorización escrita del dueño y sin el rollback listo.**

---

## 8. Pasos recomendados para quien continúe

1. Leer `AGENTS.md`, este informe, `docs/operaciones/REGISTRO.md` y los informes OP-086, OP-091, OP-092 y OP-090.
2. Pedir al dueño la verificación en pantalla (sección 7A) y sus decisiones (7B). No avanzar a producción sin ella.
3. Si se retoma código: trabajar en una carpeta de trabajo propia desde `origin/main` (o continuar en `construacero-op086` para lo de la #84), crear el siguiente `OP-2026-094`, documentar en español llano, agregar excepciones al `.gitignore` para pruebas nuevas, correr `vitest`, `vite build`, el probador de 123 pasos y los scripts `op084`/`op091`.
4. Cada vez que se termine algo: actualizar `REGISTRO.md`, anotar fallas en `REGISTRO-FALLAS-CODIGO.md`, hacer commit con atribución y empujar la rama; no unir solicitudes sin el dueño.

## 9. Fallas del código registradas en este trabajo
`N36–N43` (auditoría de inventario, sufijo `-INV`) y `N44-INV` (revertir a "aprobado" sin revisar préstamos): ver `docs/operaciones/REGISTRO-FALLAS-CODIGO.md`. Estado: arregladas en staging, **ninguna en producción**.
