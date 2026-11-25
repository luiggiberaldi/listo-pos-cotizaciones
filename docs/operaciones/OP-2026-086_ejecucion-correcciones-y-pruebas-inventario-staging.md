# OP-2026-086 — Ejecución en staging del plan de correcciones (OP-2026-078) y del plan de pruebas (OP-2026-084)

- **Fecha de inicio:** 2026-11-25
- **Entorno:** solo **staging** (`construacero-staging/` y base de pruebas `spupqgkdsgohxxfoxydl`). Producción no se toca en este caso.
- **Carpeta de trabajo:** `construacero-op086`, rama `fix/op-086-inventario-staging`, creada desde `origin/main` (regla de OP-2026-083).
- **Planes que se ejecutan:** [OP-2026-078](../plans/OP-2026-078_plan-correccion-hallazgos-auditoria-inventario-staging.md) (correcciones) y [OP-2026-084](../plans/OP-2026-084_plan-testeo-completo-inventario.md) (pruebas). Aprobados por el dueño el 2026-11-25.
- **Estado:** 🔧 En ejecución. Fases 1, 2, 4, 5 y 6 terminadas; falta la Fase 3 (respaldo/restauración) y correr el plan de pruebas.

---

## En resumen

- **Respaldo de staging hecho** antes de tocar nada: las 49 tablas completas (46 558 filas) más funciones, reglas de acceso, vistas y disparadores, en `construacero-backups/staging-2026-11-25-antes-op086/`.
- **Fase 1 terminada:** el trabajo de staging que estaba guardado solo en la PC quedó sobre la versión principal, **sin perder** los arreglos publicados (cotizaciones que no se pierden, OP-069; edición del vendedor, OP-070). Pasan las 545 pruebas automáticas y el sitio compila.
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

## Pendiente

- Registros técnicos sin columna de empresa (`system_logs`, `system_log_analysis`).
- Fase 3 de OP-078 (respaldo completo y restauración segura) (seguridad, respaldo y restauración, facturar préstamo, separación entre empresas, detalles menores).
- Ejecución del plan de pruebas OP-084 y su informe.
- Publicar el servidor de staging con esta versión.
- Anotar las migraciones `301`–`315` en el registro de migraciones de la base de staging.
- Solicitud de cambio en GitHub al terminar.
