# OP-2026-076 — Auditoría independiente de las correcciones de inventario en staging (contraste con OP-2026-075)

- **Fecha:** 2026-11-25
- **Tipo:** Revisión de solo lectura. **No se cambió código, no se aplicó ninguna migración y no se escribió nada en ninguna base de datos.**
- **Alcance:** solo `construacero-staging/` y la base de pruebas `spupqgkdsgohxxfoxydl`. **Producción (`oyfyuszgjwcepjpngclv`) no se leyó ni se tocó.**
- **Cómo se consultó staging:** con el token de staging del archivo `.env` (autorizado por el dueño en el chat), mediante consultas que solo leen (`SELECT`), a través de un script local que rechaza cualquier instrucción de escritura (`scratch/audit076/q.mjs`).
- **Documento contrastado:** [OP-2026-075](OP-2026-075_correcciones-y-reauditoria-inventario-staging.md) · plan [OP-2026-071](../plans/OP-2026-071_plan-correcciones-inventario-staging.md)

---

## En resumen

- **Veredicto: NO APTO para producción todavía.** El arreglo principal de inventario (préstamos, devoluciones parciales, conteo físico, ficha que ya no pisa el stock) está bien hecho en la base de datos. Pero hay **2 problemas críticos y 4 altos** que el informe OP-075 no vio o afirmó como resueltos.
- **Lo más grave:**
  1. En staging hay **funciones que mueven dinero abiertas a cualquiera** (incluso sin iniciar sesión): crear cargos de deuda a un cliente, marcar comisiones como pagadas y liquidar transportistas. El informe dice "0 puertas abiertas", pero solo revisó las de inventario.
  2. El **respaldo (backup) sale incompleto en silencio**: el servidor de datos entrega máximo 1000 filas por consulta y el respaldo no pide "la página siguiente". Staging tiene 6002 movimientos de Kardex, 5614 líneas de cotización y 21 440 registros de auditoría: el archivo de respaldo guarda solo 1000 de cada uno y dice que todo salió bien.
- **Qué hacer antes de producción:** cerrar esas funciones, hacer que el respaldo pida todas las páginas, arreglar la restauración de préstamos, volver atómica la "facturación de préstamo" y, sobre todo, **juntar este trabajo con la versión principal** (hoy está sin guardar en el historial, en una rama vieja que va 62 cambios atrás y le falta el arreglo OP-070 de vendedores).

---

## 1. Veredicto técnico

**NO APTO — REQUIERE FIXES ANTES DE PRODUCCIÓN**

## 2. Matriz de verificación por falla

| Falla/Regla | Estado verificado en código | Evidencia (archivo:línea) | Discrepancia o riesgo |
|---|---|---|---|
| N16 | Cerrada para `registrar_devolucion_parcial_cobro_idempotente` | `312_…sql` (lista `v_solo_service`) | Otras funciones de dinero siguen abiertas a `anon` (ver C1) |
| N25 | Correcta en BD y Worker | `310_…sql:86-91`, `inventario.js:1302`, `useInventario.js:340-343` | El lote en modo "sobrescribir" pisa stock sin guarda optimista y lo permite a supervisor (M2) |
| N26 | Parcial | `310_…sql:441-451`, `KardexModal.jsx:73-76` | Es lista negra, no lista blanca: 619 movimientos viejos sin origen son revertibles, incluidas 26 devoluciones (M1) |
| N27 | Correcta | `311_…sql:17-39`, `311_…sql:175-178`, `clientes.js:925-984` (no mueve stock) | `handleFacturarPrestamo` no es atómico ni idempotente (A2) |
| N28 | Correcta | `311_…sql:41-103`, `313_…sql:250-380` | Sin hallazgos en el cálculo neto |
| N29 | Correcta en lo esencial | `idempotencyKey.js:14-43`, `useDespachos.js:384-407`, `DevolucionParcialModal.jsx:553-557` | Importador CSV no es atómico y puede duplicar al reintentar (M3) |
| N30 | Parcial | `312_…sql` (DO $$ … v_solo_service) | Quedan funciones abiertas (C1) y lecturas entre empresas (A4) |
| N31 | Correcta | `311_…sql:1274-1337`, `despachos.js:2600-2657` | — |
| N32 | **No cumple** | `admin.js:293`, `admin.js:470-531` | Respaldo truncado a 1000 filas (C2); restauración rompe préstamos (A1). Proveedores/OC: 0 rutas a stock (cumple) |
| N33 | Correcta | `313_…sql:68-108`, `313_…sql:1164-1166` | — |
| N34 | Correcta en BD | Columnas `12,4` verificadas en vivo; `313_…sql` (consolidación) | Importador CSV parcial (M3) |
| N35 | Correcta en UI, Worker y BD | `despachos.js:2683-2689`, `313_…sql:1021-1031` | La BD salta validaciones si `producto_id` es nulo (M4, defensa en profundidad) |
| Release 17 | Correcta | `311_…sql:268-275` (descuenta al pasar a `despachada`) | — |
| OP-2026-070 | **Correcta en BD, ausente en el Worker de este árbol** | `313_…sql:84-91` vs `despachos.js:2102-2104` | El Worker local bloquea al vendedor (403); el código de OP-070 está en `origin/main` y aquí no (A3) |

## 3. Hallazgos por severidad

### CRÍTICO

| Severidad | Archivo:línea | Qué falla | Escenario concreto | Fix recomendado |
|---|---|---|---|---|
| CRÍTICO | Base staging (verificado en vivo: `has_function_privilege('anon', …) = true`); ausentes de `312_…sql` | `registrar_cargo_cxc(uuid,uuid,numeric,text,uuid)`, `registrar_pago_comision(uuid,uuid,uuid)` y `liquidar_transportista(…)` son de "permisos de dueño", ejecutables por `anon` y `authenticated`, **sin revisar quién llama** | Con la llave pública de la web (va dentro de la app), cualquiera puede llamar `/rest/v1/rpc/registrar_cargo_cxc` y sumar deuda a un cliente cuyo identificador conozca (un vendedor los ve). **NO VERIFICADO EN RUNTIME** (no se ejecutó por ser escritura). En producción: **no revisado** (fuera de alcance) | `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role` y guarda de rol en el cuerpo. Revisar lo mismo en producción antes del paso |
| CRÍTICO | `admin.js:293` y `admin.js:307-308` | El respaldo pide `limit=100000`, pero el servidor de datos de staging tiene tope de **1000 filas** (verificado: `max_rows = 1000`). No pagina ni cuenta | Respaldo de staging hoy: Kardex 1000 de 6002 (los más viejos), líneas de cotización 1000 de 5614, auditoría 1000 de 21 440. El archivo dice `version 1.1` sin advertencia | Paginar con `Range`/`offset` hasta agotar y comparar contra `Prefer: count=exact`; si no cuadra, marcar el respaldo como incompleto |

### ALTO

| Severidad | Archivo:línea | Qué falla | Escenario concreto | Fix recomendado |
|---|---|---|---|---|
| ALTO | `admin.js:470-531` + disparador `trg_sincronizar_prestamos_items` (en vivo) + índice `uq_cliente_prestamos_item` | Al restaurar, insertar `notas_despacho_items` crea automáticamente préstamos nuevos (en cero); luego el préstamo del respaldo choca con el índice único y ese lote falla | Un préstamo con 3 devueltas y 2 facturadas vuelve como "pendiente 0/0": el cliente "debe" mercancía ya devuelta o cobrada. Además la restauración no es atómica (devuelve `200` con `ok:false`), pisa `stock_actual` sin Kardex y, al usar `merge-duplicates` por `id` forzando `cuenta_id = user.id` (`admin.js:516`), puede adueñarse de filas de otra cuenta si el JSON trae sus ids | Restaurar dentro de una función de BD en una sola transacción, desactivando el disparador de préstamos durante la carga y rechazando ids de otra cuenta |
| ALTO | `clientes.js:925-984` | Facturar préstamo: lee, cobra (POST CxC) y luego actualiza el préstamo (PATCH) sin candado, sin transacción y sin clave de idempotencia | Doble clic o reintento de red = **doble cargo** en CxC con un solo `cantidad_facturada`. Si el PATCH falla tras el POST queda deuda sin préstamo actualizado. Con devolución parcial + facturación parcial deja estado `pendiente` en vez de `devuelto_parcial` | Mover a una RPC con `FOR UPDATE` sobre `cliente_prestamos`, idempotencia y cálculo de estado igual a `sincronizar_prestamos_despacho` |
| ALTO | Repositorio: rama `fix/op-025-busqueda-sin-limites`, 259 archivos sin commit; `origin/main` va 62 commits adelante | OP-075 no está en ninguna solicitud de cambio. `origin/main` ya tiene `311_staging_vendedor_edita_despacho_pendiente.sql` (mismo número 311) y `construacero-staging/src/utils/edicionVendedorDespacho.js`, que aquí no existe. Las migraciones 310–313 tampoco quedaron registradas en `supabase_migrations.schema_migrations` (en vivo solo hay 3 filas) | Si se publica el Worker de este árbol en staging, el vendedor vuelve a recibir 403 al editar su despacho pendiente (`despachos.js:2102-2104`): **se pierde OP-070**. Al unir con main habrá choque de numeración y conflictos | Rebasar sobre `origin/main`, renumerar 310–313 tras la 311 existente, volver a correr pruebas y E2E, y abrir solicitud de cambio |
| ALTO | Políticas en vivo de staging: `nd_items_vendedor_read`, `productos_admin_select`, `despachos_admin_select`, `movimientos_admin_select`, `despachos_logistica_select` | La 312 añadió lecturas filtradas por cuenta, pero dejó las viejas, que **se suman** y no filtran por cuenta | Un usuario activo de la cuenta B lee los artículos de despacho de las cuentas A, C y D (`nd_items_vendedor_read` solo exige "ser usuario activo de alguna cuenta"); un administrador de B lee productos, despachos y Kardex de todas. Staging tiene 4 cuentas | Eliminar o reescribir esas políticas añadiendo `cuenta_id = auth.uid()` |

### MEDIO

| Severidad | Archivo:línea | Qué falla | Escenario concreto | Fix recomendado |
|---|---|---|---|---|
| MEDIO | `310_…sql:441-451`, `KardexModal.jsx:74` | Reversión con lista negra; movimientos sin `origen_tipo` se pueden revertir | En vivo: 619 movimientos sin origen revertibles (26 devoluciones de venta, 88 compras). Revertir una devolución vieja deja el stock mal y contradice N26 | Lista blanca (`ajuste_inventario`, `conteo_fisico`, `movimiento_inventario`, manuales) y bloquear `motivo_tipo = 'devolucion'` |
| MEDIO | `313_…sql` (`ingresar_lote_inventario_atomico`, modo `sobrescribir`), `IngresoLoteHubModal.jsx:885`, `inventario.js:1559` | "Sobrescribir" fija el stock al número tecleado sin comprobar si cambió mientras tanto; también lo puede hacer `supervisor`, que no tiene permiso de conteo (`310_…sql:185`) | Se carga un Excel preparado en la mañana; a mediodía hubo ventas; "sobrescribir" borra esas salidas. Es exactamente el problema N25 por otra puerta | Quitar "sobrescribir" del lote o exigir `stock_esperado` como en el conteo y limitarlo a administración/jefe |
| MEDIO | `ImportadorModal.jsx:191-203`, `useInventario.js:306-311` | El CSV crea los productos uno por uno; si falla a la mitad queda parcial y reintentar genera claves nuevas | Productos sin código se duplican al reintentar una importación que se cortó | Enviar el CSV al lote atómico (`batch-ingest`) |
| MEDIO | `313_…sql:1033` y `313_…sql:1261` | La función de devolución confía en el total enviado y salta validaciones si `producto_id` es nulo u `origen` no es inventario/intercambio, pero igual registra la devolución | Hoy solo la llama el Worker, que recalcula todo (`despachos.js:2632-2732`). Si otra ruta interna la usa mal, puede rebajar el neto del despacho sin reingresar stock | Recalcular el total dentro de la BD y rechazar filas inconsistentes |
| MEDIO | Función `tester_cleanup_cotizacion` (cuerpo en `312_…sql`), en vivo ejecutable por `authenticated` | Borra cotización, despachos, CxC y préstamos por id sin filtrar la cuenta | Un supervisor de otra cuenta que conozca el id borra datos ajenos | Filtrar por `cuenta_id = auth.uid()` o dejarla solo a `service_role` |

### BAJO

| Severidad | Archivo:línea | Qué falla | Escenario concreto | Fix recomendado |
|---|---|---|---|---|
| BAJO | `311_…sql` (sin `BEGIN;`/`COMMIT;` de archivo), `311_…_rollback.sql`, `312_…_rollback.sql` | Si se ejecutan como script y algo falla a la mitad, queda medio aplicado | Rollback de emergencia que deja funciones nuevas y viejas mezcladas | Envolver en `BEGIN; … COMMIT;` |
| BAJO | `MovimientoLoteModal.jsx:150-155` | El conteo usa el stock de la pantalla; tras un 409 no se refresca solo | El operador repite el 409 hasta cerrar y reabrir | Refrescar el catálogo tras 409 |
| BAJO | `admin.js:494-496` | La restauración descarta `numero` de cotizaciones | En una base nueva las cotizaciones cambian de número frente a los PDF ya entregados | Restaurar con `OVERRIDING SYSTEM VALUE` desde una función de BD |
| BAJO | Datos en vivo | 14 productos con stock distinto del último Kardex (todos de mayo–agosto 2026, p. ej. `TUB1403010` 60 vs 30) | Ya conocido en OP-075; no es nuevo | Reconciliar con proceso aparte |

## 4. Auditoría de rollbacks (`310`–`313`)

- **Orden obligatorio:** `313 → 312 → 311 → 310`. En otro orden, 311 borra funciones que las versiones de 313 siguen llamando.
- **310 rollback:** tiene transacción. Borra las funciones de conteo y el índice anti-doble-reverso. Es seguro **solo si también se vuelve el Worker atrás** (si no, "Conteo físico" da error 500).
- **311 rollback:** **sin transacción**. Devuelve la lógica vieja de préstamos (que no reingresaba préstamos al reabrir), así que los despachos hechos con la lógica nueva quedarían descuadrados al reabrirlos. Conserva OP-070. Úsese solo en emergencia y sin despachos con préstamo de por medio.
- **312 rollback:** **peligroso**. Vuelve a dar escritura directa a `authenticated` y crea políticas `USING (true)` que abren préstamos y devoluciones a todas las cuentas. No restaura permisos de funciones (eso está bien). Sin transacción.
- **313 rollback:** tiene transacción, pero **es incompleto**: solo devuelve `borrar_producto_con_kardex_tenant_safe` e `ingresar_lote_inventario_atomico`; no devuelve los tipos de columna (intencional, porque bajar a 2 decimales perdería datos) ni las 5 funciones de N33 (`devolver_prestamo…`, `revertir_despacho…`, `revertir_entrega…`, `editar_despacho_profundidad`, `registrar_devolucion…`). Debe decirse por escrito.
- **Vistas en 313:** columnas, lógica y permisos coinciden en vivo (`despacho_items_peso`/`despacho_pesos` con `security_invoker=true` solo para `authenticated`/`service_role`; `v_catalogo_publico` con `anon`; `v_productos_vendedor` sin `anon`).

## 5. Qué afirma OP-075 y no es exacto

| Afirmación en OP-075 | Lo que se encontró |
|---|---|
| "0 funciones mutadoras abiertas a `anon`/`authenticated`" (línea 70) | Falso fuera de inventario: 3 funciones de dinero abiertas a `anon` (C1) |
| "Lectura filtrada a su propia cuenta" (línea 35) | Siguen políticas viejas que leen entre cuentas (A4) |
| Respaldo `version 1.1` "incluye todas las tablas" (línea 71) | Incluye las tablas, pero solo 1000 filas de cada una (C2) |
| "Solo permite revertir ajustes manuales y conteos físicos" (línea 29/66) | Lista negra; 619 movimientos viejos sin origen siguen revertibles (M1) |
| "Se igualó staging con OP-2026-070" (línea 12) | La BD sí; el Worker de este árbol no (A3) |
| Pruebas `*071.test.js` | En su mayoría comprueban que ciertos textos aparezcan en el código o simulan la BD con respuestas fijas; no detectan C1, C2, A1, A2 ni A4 |

## 6. Puntos clave para el dueño

- **Lo sólido:** préstamos, devoluciones parciales, reaperturas, conteo físico y "editar ficha no toca stock" quedaron bien hechos en la base de datos de pruebas.
- **Riesgo de dinero:** en la copia de pruebas hay "puertas" que permiten crear deudas o marcar comisiones pagadas sin pasar por el sistema. Hay que cerrarlas y revisar que producción no tenga las mismas.
- **Riesgo de respaldo:** el respaldo que descargas hoy guarda solo una parte de los datos y no avisa. Restaurarlo además puede borrar el avance de los préstamos.
- **Riesgo de cobro doble:** facturar un préstamo con doble clic o mala conexión puede cobrarle dos veces al cliente.
- **Antes de producción:** juntar este trabajo con la versión principal (hoy no está guardado y le falta el arreglo de vendedores), corregir lo anterior y volver a probar.

## Pendiente / no verificado

- No se ejecutaron escrituras: los riesgos C1, A1 y A2 están confirmados leyendo el código y los permisos en vivo, **no probados en vivo**.
- Producción no se revisó; hay que confirmar allí (solo lectura) si existen C1 y A4.
- No se revisó qué versión del Worker está publicada hoy en staging.
