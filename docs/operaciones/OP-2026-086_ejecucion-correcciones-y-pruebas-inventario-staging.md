# OP-2026-086 — Ejecución en staging del plan de correcciones (OP-2026-078) y del plan de pruebas (OP-2026-084)

- **Fecha de inicio:** 2026-11-25
- **Entorno:** solo **staging** (`construacero-staging/` y base de pruebas `spupqgkdsgohxxfoxydl`). Producción no se toca en este caso.
- **Carpeta de trabajo:** `construacero-op086`, rama `fix/op-086-inventario-staging`, creada desde `origin/main` (regla de OP-2026-083). **Solicitud de cambio #84.**
- **Planes que se ejecutan:** [OP-2026-078](../plans/OP-2026-078_plan-correccion-hallazgos-auditoria-inventario-staging.md) (correcciones) y [OP-2026-084](../plans/OP-2026-084_plan-testeo-completo-inventario.md) (pruebas). Aprobados por el dueño el 2026-11-25.
- **Estado:** 🟡 Correcciones aplicadas en staging y pruebas automáticas y de base de datos en verde. Faltan la revisión visual en navegador, el ensayo de vuelta atrás y el visto bueno del dueño. Producción no se tocó en este caso.

---

## En resumen

- **Respaldo de staging hecho** antes de tocar nada: las 49 tablas completas (46 558 filas) más funciones, reglas de acceso, vistas y disparadores, en `construacero-backups/staging-2026-11-25-antes-op086/`.
- **Fase 1 terminada:** el trabajo de staging que estaba guardado solo en la PC quedó sobre la versión principal, **sin perder** los arreglos publicados (cotizaciones que no se pierden, OP-069; edición del vendedor, OP-070). Pasan las 545 pruebas automáticas y el sitio compila.
- **Pruebas:** 555 pruebas automáticas, 3 corridas seguidas de 123/123 del probador completo, 17/17 pruebas extra diseñadas para romper el sistema y una restauración real completa: todo OK. Las pruebas encontraron 3 fallas más (una ya existía: el respaldo nunca guardaba comisiones), corregidas aquí.
- **Cambio frente a lo que se dijo al dueño:** no fue posible llevar "solo inventario". En `despachos.js` (el archivo del servidor que maneja los despachos), lo de inventario está entrelazado con las copias de staging de Cuentas por Cobrar (migraciones `301`–`308`), que **ya están instaladas en la base de staging** y de las que inventario depende. Se llevó todo el trabajo local de staging y queda cubierto por las pruebas del plan OP-084 (bloque 9). **Nada de esto toca producción**: producción se publica desde otra carpeta.

## Fase 1 — detalle

1. **Mezcla de tres vías:** se tomaron como punto de partida la base vieja de la carpeta local (`e78d8f6f`), el trabajo local (rama `wip/op-075-inventario-staging`, solo la carpeta `construacero-staging/`) y `origin/main`. Git conservó lo publicado y sumó lo local. Hubo 2 conflictos:
   - `construacero-staging/.gitignore`: se dejaron ambas listas.
   - `EditarItemsDespachoModal.jsx`: se mantuvo la regla del vendedor (OP-070) **y** la decisión de pagos de la edición profunda (OP-053).
2. **Archivos que la copia local borraba y que se conservan:** `edicionVendedorDespacho.js`, la migración `311_staging_vendedor_edita_despacho_pendiente.sql`, `limpiezaCotizaciones.js` y sus pruebas.
3. **Borrados locales que se mantienen:** `ClienteRow.jsx`, `CotizacionRow.jsx` y `DespachoRow.jsx` (vista de lista eliminada en OP-079), y `StockComprometidoDetalle.jsx` / `useStockComprometido.js` (ningún archivo los usa).
4. **Migraciones renumeradas** para no chocar con la `311` de OP-070:

   | Antes | Ahora |
   |---|---|
   | `310_staging_inventario_ficha_y_kardex` | `312_…` |
   | `311_staging_prestamos_reapertura_intercambios` | `313_…` |
   | `312_staging_seguridad_inventario_rpcs_y_rls` | `314_…` |
   | `313_staging_higiene_decimales_lotes` | `315_…` |

   Ya están aplicadas en la base de staging con su contenido actual; solo cambia el nombre del archivo. Los documentos anteriores (OP-075, OP-076, OP-078) conservan los números viejos.
5. **Pruebas que no estaban guardadas:** las 4 pruebas `*071.test.js` existían solo como archivos sueltos (el proyecto las ignoraba). Ahora quedan guardadas en el repositorio y apuntan a los nuevos nombres. Otras 20 pruebas sueltas de casos anteriores se copiaron solo para correrlas aquí, sin guardarlas (siguen la regla de lista permitida del proyecto).
6. **Verificación:** `vitest`, 64 archivos y 545 pruebas OK; `vite build` OK.

## Fase 2 — Puertas cerradas en staging (C1, M5)

- Migración `316_staging_cierre_rpcs_dinero.sql` (reversa `…_rollback.sql`), **aplicada en staging**.
- Ahora solo el servidor puede usar estas 7 funciones: `registrar_cargo_cxc` (las 2 versiones), `registrar_pago_comision`, `registrar_abono_cxc`, `liquidar_transportista`, `reasignar_cliente` y `calcularcomisiondespacho_238b`. La pantalla no usaba ninguna; el servidor sí usa `liquidar_transportista`, con su llave propia.
- `tester_cleanup_cotizacion` (borrador del probador interno) ya no borra cotizaciones de otra cuenta. Si la cotización no existe, no hace nada, como antes.
- **Verificado en vivo:** ninguna función que modifique datos queda abierta a usuarios sin sesión. Las que siguen abiertas tienen una razón:
  - **pantalla de ingreso (antes de iniciar sesión):** `listar_usuarios_login`, `tiene_gate_configurado`, `validar_gate_acceso`;
  - **lecturas:** `obtener_*`, `buscar_productos_hibrido`, `peso_producto_visible`;
  - **ayudantes de reglas de acceso:** `get_rol_actual`, `get_operador_id`, `current_operator_context`, `can_read_seller`;
  - `guarda_precios_ddl` es un vigilante interno de la base y no se puede llamar desde afuera.
- **Hallazgo nuevo para la Fase 5:** `obtener_stock_productos`, `obtener_productos_vendedor`, `obtener_categorias_vendedor` y `buscar_productos_hibrido` leen el catálogo con permisos de dueño y **sin filtrar por empresa**.

## Fase 5 — Cada empresa ve solo lo suyo (A4)

**Corrección a la auditoría OP-2026-076:** el hallazgo A4 estaba **exagerado**. La auditoría miró solo las reglas que dan permiso y no las reglas de bloqueo ("restrictivas") que ya existían (`dashboard_scope_*`). Revisando con el respaldo de antes del cambio, casi todas las tablas ya estaban protegidas por empresa. La fuga real en staging era:
- `inventario_movimientos` (Kardex): administración y supervisión podían leer el de otras empresas;
- 4 funciones de catálogo con permisos de dueño que no filtraban por empresa: `obtener_stock_productos`, `obtener_productos_vendedor`, `obtener_categorias_vendedor`, `buscar_productos_hibrido`;
- registros técnicos `system_logs` y `system_log_analysis`: no tienen columna de empresa y **quedan pendientes**.

En **producción** (revisión solo lectura): casi todo protegido. Quedan abiertas `despacho_devoluciones` y `despacho_devolucion_intercambios` (regla "Permitir todo…") y los registros técnicos. Detalle en INC-004.

Cambios: migración `317_staging_aislamiento_cuentas.sql` (reversa `…_rollback.sql`), **aplicada en staging**:
1. Regla de bloqueo `aislamiento_cuenta` en 29 tablas. Las tablas hijas sin columna de empresa la heredan del cliente o del despacho; `comisiones` usa su columna `cuentaid`.
2. Los usuarios sin sesión ya no pueden leer directo productos, Kardex, cobros, comisiones ni devoluciones.
3. Las 3 funciones de catálogo filtran por la empresa de quien llama.
4. `buscar_productos_hibrido` queda solo para el servidor, que siempre envía la empresa.

**Verificado en vivo** (simulando la sesión de la empresa principal): `obtener_stock_productos` devuelve 11 productos (los propios) en vez de 458, y `obtener_productos_vendedor` devuelve 11. Ninguna fila tenía la empresa vacía, así que la regla no esconde datos que se deban ver.

## Fase 4 — Facturar préstamo sin cobro doble (A2 y Decisión 1 del dueño)

- Migración `318_staging_facturar_prestamo_atomico.sql` (reversa `…_rollback.sql`), **aplicada en staging**. Función nueva `facturar_prestamo_atomico`, que solo puede usar el servidor.
- **En un solo paso, todo o nada:**
  - bloquea el préstamo;
  - valida lo pendiente;
  - calcula el **precio en dólares de la línea del despacho original**, con su descuento por porcentaje y en dólares;
  - redondea el monto a 2 decimales;
  - anota la **tasa BCV del día** y el equivalente en bolívares en la descripción del cargo;
  - crea el cargo en cuentas por cobrar con sello único;
  - actualiza el préstamo con la misma regla de estados que el resto del sistema.
  
  No mueve inventario.
- **Servidor** (`clientes.js`, `handleFacturarPrestamo`): ahora solo llama a esa función. Exige tasa del día y sello único, y traduce los errores a mensajes claros (409 si otra persona movió el préstamo).
- **Pantalla** (`FichaClienteModal.jsx`): envía la tasa del día (`useTasaCambio`) y un sello único que se reutiliza ante doble clic o corte de conexión, también al **devolver** un préstamo.
- **Prueba en la base real** (dentro de una transacción que se deshizo al final):

  | Caso | Resultado |
  |---|---|
  | Facturar 2 unidades de un préstamo de 15 | Cargo de $195,82 (2 × $97,91 del despacho DES-00665) y tasa 250,5 (≈ Bs 49 052,91) |
  | Repetir con la misma clave | Mismo cargo, 1 solo cobro |
  | Kardex | Sin cambios |
  | Pedir 99 | Rechazado: "pendiente 13" |
  | Intentar desde otra empresa | Rechazado |

- **Pruebas automáticas:** se reemplazó la prueba vieja (que validaba el cobro en pasos separados) por 3 pruebas nuevas.

## Fase 6 — Detalles (M1, M2, M3, M4, B1, B2)

| Punto | Qué cambió | Dónde | Verificación |
|---|---|---|---|
| M1 · Revertir en Kardex | Pasa de lista de **prohibidos** a lista de **permitidos**: solo ajustes manuales y conteos. Los movimientos viejos sin origen y las devoluciones ya no se pueden revertir | Migración `319_staging_kardex_revertir_lista_permitidos.sql`; pantalla `src/utils/kardexRevertible.js` (usada por `KardexModal.jsx`) | Base real (se deshizo al final): devolución vieja → rechazada; despacho → rechazado; ajuste manual → revertido una vez y el segundo intento → "ya revertido". 3 pruebas de comportamiento nuevas |
| M2 · "Sobrescribir" en el lote | **Eliminado** (Decisión 2 del dueño). La pantalla muestra "Suma al stock"; el servidor y la base rechazan cualquier otro modo | `IngresoLoteHubModal.jsx`, `inventario.js` (`handleBatchIngest`), migración `320_staging_lote_solo_suma.sql` | Aplicada en staging |
| M3 · Importador CSV | Cada fila lleva un sello calculado a partir de su contenido: reintentar el mismo archivo no duplica productos (aparecen como "ya estaba importado"). **Limitación aceptada:** sigue sin ser "todo o nada", porque el ingreso por lote no admite productos con stock 0; si se corta, queda parcial, pero reintentar es seguro | `ImportadorModal.jsx`, `idempotencyKey.js` (`claveDeterministica`) | 2 pruebas nuevas |
| M4 · Devolución parcial en la base | La base revisa:<br>• que cada fila coincida con la línea del despacho (producto y origen);<br>• que el total de cada fila sea cantidad × precio;<br>• que el total acreditado no supere la suma de las filas;<br>• que el total del intercambio cuadre | Migración `321_staging_devolucion_valida_totales.sql` | Aplicada; el probador completo la ejercita |
| B1 · Transacciones | `313_…` y los rollbacks `313_…`/`314_…` quedan dentro de `BEGIN/COMMIT`, con avisos de orden y de peligro. El rollback `315_…` dice por escrito qué no revierte | Archivos de migración | — |
| B2 · Conteo tras conflicto | Si otra persona movió el stock mientras se contaba, la ventana trae el stock actual, muestra qué cambió y deja volver a guardar sin cerrarla | `MovimientoLoteModal.jsx` | Revisión en navegador pendiente |

Pruebas automáticas: 64 archivos y 552 pruebas OK (se agregaron pruebas de comportamiento y se ajustó una prueba de texto). Compilación OK.

## Fase 3 — Respaldo completo y restauración segura (C2, A1, B3)

- **Respaldo** (`admin.js`, `handleBackup`, versión `1.2`):
  - lee cada tabla página por página (de 1000 en 1000) con orden estable, también en las tablas hijas;
  - compara lo leído con el conteo real de la base; si no cuadra, el archivo sale con `completo: false` y la lista de lo que falta;
  - la pantalla de Configuración avisa en rojo si el respaldo salió incompleto.
- **Restauración** (función nueva `restaurar_respaldo_atomico`, migración `322_staging_restaurar_respaldo_atomico.sql`, aplicada en staging):
  - un solo paso, todo o nada;
  - apaga durante la carga los disparadores propios de cada tabla (incluido el que creaba préstamos en cero); las llaves foráneas siguen activas;
  - conserva los números originales y al final avanza los contadores;
  - fuerza la empresa de quien restaura y rechaza filas de otra empresa, incluidas las tablas hijas;
  - el servidor se niega a restaurar un respaldo marcado como incompleto;
  - el aviso de confirmación explica que es todo o nada y que lo creado después del respaldo se conserva.
- **Prueba en la base real** (dentro de una transacción que se deshizo al final): se quitaron los 4 artículos y 2 préstamos de un despacho y se restauraron desde un respaldo con 2 unidades ya devueltas. Volvieron los 4 artículos y los 2 préstamos **con lo devuelto intacto** ("devuelto parcial"), y los disparadores quedaron encendidos. Restaurar ese mismo respaldo como otra empresa → **rechazado**.
- **Pruebas automáticas nuevas:**
  - respaldo de 2350 filas completo;
  - respaldo incompleto marcado como tal;
  - restauración en una sola llamada sin escrituras sueltas;
  - restauración que rechaza un respaldo incompleto o de otra empresa (409).
- **Sin verificar todavía:** restaurar un respaldo del tamaño de producción (unos 20 MB) en una sola llamada. Se probará con el respaldo completo de staging en el bloque 8 del plan de pruebas.

## Resultados de las pruebas (plan OP-2026-084)

Todo contra la **base real de staging**, con el servidor y la página corriendo en esta PC (`localhost:8789` y `localhost:5174`), versión de esta rama.

| Bloque / prueba | Resultado | Evidencia |
|---|---|---|
| Pruebas automáticas del código (nivel A) | **555/555 OK** (65 archivos) | `vitest` |
| Compilación del sitio | **OK** | `vite build` |
| Probador completo de punta a punta (RG1) | **123/123 OK en 3 corridas** (la tercera después de los últimos ajustes) | `tmp-op086/e2e-corrida1.log`, `…2.log`, `…3.log` (locales) |
| Pruebas extra de "romper el sistema" (`scripts/op084-pruebas-staging.mjs`) | **17/17 OK** | Ver detalle abajo |
| Restauración real completa (`scripts/op084-restauracion-real-staging.mjs`) | **OK** | Respaldo de 2,90 MB de la empresa de prueba, restaurado en 3,3 s. Conteos, stock total, saldos de clientes, comisiones y número máximo del Kardex quedaron idénticos; disparadores encendidos al final |
| Facturar préstamo en la base real (PR3–PR6) | **OK** | $195,82 = 2 × $97,91 a tasa 250,5; repetir = mismo cargo; pedir de más = rechazado; otra empresa = rechazado; dos a la vez = la segunda espera el candado |
| Revertir en Kardex en la base real (K1–K4) | **OK** | Devolución vieja y despacho rechazados; ajuste manual revertido una sola vez |
| Restauración de préstamos con devoluciones (A1) | **OK** | Préstamos restaurados con lo devuelto intacto; otra empresa rechazada |
| Cuadre final de datos | **OK** | 0 préstamos rotos, 0 restos de datos de prueba, 0 disparadores apagados; los 14 descuadres históricos (mayo–agosto) siguen igual, sin nuevos |

**Detalle de las 17 pruebas extra:**
- **R1** respaldo completo: el archivo coincide con la base (Kardex 2336, líneas de cotización 37, artículos de despacho 57, cuentas por cobrar 18, productos 11).
- **L4** "sobrescribir": rechazado por el servidor (HTTP 400) y por la base.
- **S2/S3** (10 pruebas): `registrar_cargo_cxc`, `registrar_pago_comision`, `facturar_prestamo_atomico`, `restaurar_respaldo_atomico` y `buscar_productos_hibrido` se rechazan sin sesión (401/404) y con sesión común (403/404).
- **S4**: ninguna de las 8 tablas críticas permite escritura directa.
- **S1**: sin sesión solo quedan las 4 funciones de ingreso y vigilancia.
- **S5**: con una sesión real de operador, 0 filas de otras empresas en 12 tablas (2556 filas propias visibles).
- **PR6**: dos facturaciones simultáneas del mismo préstamo esperan turno.

**Fallas que las pruebas encontraron y que se corrigieron en este caso:**
1. **El respaldo nunca guardaba las comisiones**, y la falla ya existía antes: pedía la columna `cuenta_id`, pero la tabla usa `cuentaid`; la base respondía error y la tabla quedaba vacía. Corregido en `admin.js`.
2. **En staging, una sesión iniciada podía escribir directo en cuentas por cobrar.** Cerrado con la migración `323_staging_cxc_sin_escritura_directa.sql` (en producción ese permiso no existe).
3. **La restauración fallaba con identificadores numéricos y con números automáticos ya existentes.** Corregido en la migración 322. En ambos casos la operación se deshizo completa, sin cambiar nada, como corresponde.

**Corrección a la revisión de producción (INC-004):** la afirmación "nadie escribe directo en las tablas" estaba mal. Con el método correcto, en producción hay permiso de escritura directa en despachos, artículos, préstamos, clientes y cotizaciones; en préstamos lo deja abierto la regla "Permitir todo…". Es la falla N30, ya registrada y abierta en producción hasta el paso de este trabajo. Corregido en INC-004 (solicitud #83).

**Advertencias del probador que no son nuevas:** "permiso denegado" al limpiar usuarios y designaciones de prueba. Ninguna migración de este caso toca los permisos de esas tablas; no afectan el resultado.

**No cubierto todavía:**
- **Revisión visual en navegador (bloque 10)** y tu visto bueno.
- **Ensayo de vuelta atrás completo** en una base desechable (sección 5 del plan).
- **Restaurar un respaldo del tamaño de producción** (solo se probó con 2,9 MB).
- **Segunda revisión independiente.**
- **Registros técnicos sin columna de empresa** (`system_logs`, `system_log_analysis`).

## Staging en internet: desactualizado (hallazgo)

- El servidor de staging publicado en Cloudflare (`construacero-staging`) **no se actualiza desde el 2026-09-07** y **no tiene secretos cargados**: `wrangler secret list` devuelve una lista vacía. Todas las pruebas de staging de estos meses, incluidas las de este caso, se hicieron con el servidor corriendo **en la PC** contra la base de staging.
- No se publicó en este caso, porque haría falta cargar la clave del servidor (`SUPABASE_SERVICE_KEY` de staging) en Cloudflare, y esa decisión le toca al dueño. La revisión visual se puede hacer en esta PC: página en `http://localhost:5174` y servidor en `:8789`.

## Pendiente

- Registros técnicos sin columna de empresa (`system_logs`, `system_log_analysis`).
- Fase 3 de OP-078 (respaldo completo y restauración segura) (seguridad, respaldo y restauración, facturar préstamo, separación entre empresas, detalles menores).
- Ejecución del plan de pruebas OP-084 y su informe.
- Publicar el servidor de staging con esta versión.
- Anotar las migraciones `301`–`315` en el registro de migraciones de la base de staging.
- Solicitud de cambio en GitHub al terminar.
