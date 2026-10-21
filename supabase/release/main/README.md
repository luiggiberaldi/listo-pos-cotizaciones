# Paquete de promoción Kardex — proyecto principal

**Estado:** artefactos revisables; no ejecutados remotamente.

Este directorio contiene únicamente SQL preparado para revisión del proyecto principal. No se deben copiar secretos, dumps, UUID/batches de staging ni guardas exclusivas del proyecto staging.

## Bloqueo de historial remoto

La auditoría read-only observó una sola fila en `supabase_migrations.schema_migrations` (`001`), aunque el esquema remoto ya contiene objetos avanzados. Por esta razón queda prohibido usar todavía:

```bash
supabase db push
supabase db reset
supabase migration repair
```

Primero debe decidirse si el esquema se administra como restore/manual schema o si se reconstruirá formalmente el historial. El paquete debe aplicarse desde una ventana autorizada, con backup verificable y un procedimiento de rollback probado.

## Archivos y orden lógico

1. `00_preflight_readonly.sql` — inventaría historial, tablas, columnas, tenant, RLS y RPCs. Es el único archivo que debe poder ejecutarse durante el preflight porque solo contiene `SELECT`.
2. `01_kardex_provenance.sql` — agrega metadata de origen/idempotencia, tablas de operaciones/reconciliación y helpers de reserva. No cambia cantidades históricas.
3. `02_inventory_atomic_operations.sql` — instala ingreso/egreso por lote, transformación, devolución física de préstamo e ingreso masivo.
4. `03_return_finance_atomic.sql` — instala el ajuste financiero neutral de devolución, usando las columnas reales v2 de comisiones y base de artículos neta.
5. `04_idempotency_wrappers.sql` — publica wrappers neutrales para entrega física, entrega financiera, devolución parcial idempotente con cotización de reemplazo transaccional y reversión, adaptando las firmas reales 223–226/232.
6. `05_inventory_guardrails_and_reconciliation.sql` — publica fachadas tenant-safe de productos/limpieza y reconciliación histórica reversible por batch, con snapshots y rollback protegido.
7. `06_security_grants_review.sql` — propuesta bloqueada para retirar mutaciones directas de tablas/RPC históricas después del cutover del Worker.
8. `07_provenance_backfill.sql` — **no incluido todavía**: debe prepararse solo después de aprobar el snapshot de metadata y el dry-run de datos del principal.

Los archivos `01`–`05` contienen deliberadamente un `DO` que lanza `REVIEW_ONLY`. El gate debe eliminarse de forma explícita y revisada antes de una ejecución autorizada; nunca se debe comentar globalmente ni saltarse el orden.

## Contratos neutrales preparados

- `enriquecer_proveniencia_kardex`
- `reservar_operacion_inventario`, `guardar_operacion_inventario`, `etiquetar_lote_inventario`
- `aplicar_movimiento_inventario_atomico`, `transformar_inventario_atomico`, `devolver_prestamo_inventario_atomico`, `ingresar_lote_inventario_atomico`
- `ajustar_finanzas_devolucion_neta`
- `confirmar_entrega_inventario_idempotente`, `confirmar_entrega_finanzas_idempotente`, `registrar_devolucion_parcial_idempotente`, `revertir_entrega_finanzas_idempotente`, `revertir_entrega_inventario_idempotente`
- `crear_producto_con_kardex_tenant_safe`, `actualizar_producto_con_kardex_tenant_safe`, `borrar_producto_con_kardex_tenant_safe`, `limpiar_inventario_atomico`
- `reconciliar_kardex`, `revertir_reconciliacion_kardex`

## Reglas de promoción

- `cuenta_id` es el tenant; `usuario_id` es el operador. No son intercambiables.
- Toda función `SECURITY DEFINER` debe conservar `search_path = public`, validar tenant y limitar el actor.
- El Worker debe ser el único consumidor de las RPC nuevas; no otorgar ejecución directa a `anon`/`authenticated`.
- Toda mutación de stock debe bloquear productos en orden determinista y escribir producto + Kardex en la misma transacción.
- Una `idempotency_key` solo puede repetirse dentro del mismo tenant y tipo de operación; cambiar el tipo debe fallar.
- La reconciliación histórica requiere auditoría read-only fresca, propuestas versionadas, revisión humana, snapshot, batch UUID nuevo y rollback ensayado.
- El rollback debe bloquear cambios de catálogo, movimientos posteriores y batches parciales; nunca debe modificar `productos.stock_actual`.
- El backfill de provenance es una ventana separada: no debe mezclarse con la publicación de guardrails.
- Antes de portar UI/E2E, el merge de Worker debe sustituir cada `PATCH stock_actual`, `POST inventario_movimientos` y RPC histórica por una fachada aprobada.

## Política de `idempotency_key` obligatoria (decidida 2026-08-20)

Toda mutación de inventario/finanzas del Worker es obligatoriamente idempotente. La política se aplica en dos capas (defensa en profundidad):

1. **SQL (autoritativo):** toda fachada neutral mutante rechaza `p_idempotency_key IS NULL` con el código `IDEMPOTENCY_KEY_OBLIGATORIA` **antes** de reservar la operación. `reservar_operacion_inventario` también rechaza `NULL` (antes lo ignoraba devolviendo `existente:false`). Para reconciliación, `p_batch_key`/`p_rollback_key` son la clave idempotente y ya son obligatorios.
2. **Worker (fast-fail):** el handler JS debe generar `crypto.randomUUID()` y pasarla siempre; si falta, debe abortar antes de la llamada RPC. Este contrato se aplicará al portar `inventario.js`/`despachos.js`/`clientes.js`.
3. **Helpers internos:** `guardar_operacion_inventario`/`etiquetar_lote_inventario` siguen siendo no-op sobre `NULL` porque solo corren después de una reserva válida; no son puntos de entrada.
4. **Columna ≠ parámetro:** el trigger `enriquecer_proveniencia_kardex` sigue completando la columna `inventario_movimientos.idempotency_key` con `lote_id` para filas legacy insertadas fuera del Worker. Eso es identidad sintética de proveniencia, no idempotencia de cliente, y no exime al Worker de enviar clave.

Se conserva `DEFAULT NULL` en la firma de `pg_proc` para no alterar el contrato de tipos ni los `GRANT`; la guarda lo vuelve obligatorio en runtime.

## Bitácora ordenada

El estado de fases, bloqueos y siguiente paso único se mantiene en:

```text
docs/plans/2026-08-20-estado-promocion-kardex-principal.md
```

## Resultado de la auditoría de contratos

La auditoría read-only del 2026-08-20 está documentada en:

```text
docs/plans/2026-08-20-auditoria-contratos-rpc-principal-readonly.md
```

Confirmó que las firmas históricas llamadas por `04_idempotency_wrappers.sql` coinciden con `pg_proc` y que los nombres neutrales no colisionan. Sin embargo, las RPC históricas y las tablas base conservan grants amplios para `anon`/`authenticated`; la fase propuesta para revisarlo está en `06_security_grants_review.sql`. El rediseño del rollback de `05` quedó documentado en `docs/plans/2026-08-20-rollback-reconciliacion-guardas.md` y permanece sin ejecución remota.

## Plan de pruebas mutables aisladas

La matriz detallada para probar rollback, idempotencia, aislamiento tenant, atomicidad y grants está en:

```text
docs/plans/2026-08-20-plan-pruebas-mutables-aisladas-kardex.md
```

El plan define un entorno desechable, fixtures sintéticos, snapshots con checksum, casos positivos/negativos, pruebas concurrentes, criterios de limpieza y gates de NO-GO. Su preparación no ejecutó ninguna operación remota mutable y no autoriza todavía a retirar `REVIEW_ONLY`.

## Runner local de fixtures y baseline

La preparación local está documentada en:

```text
docs/plans/2026-08-20-runner-fixtures-baseline-kardex.md
```

El runner reusable es:

```text
scripts/prepare-kardex-isolated-run.mjs
```

Comandos:

```bash
npm run prepare:kardex:isolated -- --plan
# prepara UUID/filas sintéticas en tmp; no abre conexión

# Solo con un entorno desechable autorizado:
KARDEX_ISOLATED_DATABASE_URL=...
KARDEX_ISOLATED_PROJECT_REF=...
KARDEX_ISOLATED_ENVIRONMENT=disposable
KARDEX_ISOLATED_CONFIRM=DISPOSABLE_READ_ONLY
npm run prepare:kardex:isolated -- --baseline
```

`--baseline` usa una transacción `REPEATABLE READ, READ ONLY`, captura contratos/conteos/RLS/triggers/grants y hace rollback de la lectura. El runner bloquea flags de ejecución mutable y no contiene un camino para aplicar fixtures.

## Gate siguiente

La primera entrega ya tiene preparado el contrato `confirmar_entrega_finanzas_idempotente`: inventario, estado, CxC y comisión quedan en la misma transacción, con replay guardado en `inventario_operaciones`. La cotización de reemplazo queda ligada al mismo `idempotency_key` de `registrar_devolucion_parcial_idempotente`; sus cabecera/ítems se crean dentro de la transacción de devolución, por lo que un fallo no deja una cotización huérfana y un replay devuelve el mismo UUID.

Quedan como gates antes de ejecutar o desplegar: (1) validar las firmas/columnas del snapshot disposable, (2) ejecutar tests mutables únicamente en esa base aislada, (3) revisar la semántica financiera de la primera entrega con datos representativos y (4) aprobar el retiro de `REVIEW_ONLY` y los grants. Todavía no se debe ejecutar SQL mutable ni desplegar.

## Propuesta de release 14 — RPC financieras COD (REVIEW ONLY)

Artefactos preparados, **no aplicados**. Paquete de revisión independiente, decisiones pendientes y formato de aprobación: [cod-release-14-review-packet.md](../../docs/runbooks/cod-release-14-review-packet.md).

Comandos locales disponibles (no conectan a Supabase): `npm run test:cod`, `npm run test:cod:browser` y `npm run verify:cod:release-local`.

- `14_cod_preflight_readonly.sql` valida de forma read-only las dependencias COD, el historial remoto y la presencia de RPCs.
- `14_cod_financial_rpcs_review.sql` propone las RPC `resumen_financiero_despacho` y `registrar_pago_externo_cobro_idempotente` consumidas por `api/handlers/cod.js`.
- `14_cod_postflight_readonly.sql` comprueba contratos, grants mínimos y la actualización independiente de `forma_pago` / `forma_pago_cliente`.
- `14_cod_rollback_review.sql` elimina únicamente las RPC de release 14 si pertenecen a este paquete; conserva la tabla de idempotencia y no borra asientos ni auditoría.

La conciliación construye cada JSON de pago a partir de su propia fuente, exige un único COD y monto nominal coincidente en las dos, y falla cerrado si las fuentes no son coherentes. Para cada abono `Efectivo Bs` acepta monto Bs + tasa seleccionada al confirmar, valida/congela el equivalente USD y retiene monto Bs, tasa, fuente y fecha en el snapshot del pago; cada parcial mantiene su conversión fija. La reparación manual `regularizar_cod_efectivo_atomico_staging` y su endpoint no se promueven: son staging-only y necesitan contrato, autorización y release aparte. El gate `REVIEW_ONLY` permanece deliberadamente activo. Dada la deriva conocida del historial de migraciones, **no usar `supabase db push/reset/migration repair`** para aplicar este paquete. Antes de quitar el gate: cotejar el contrato con un preflight principal fresco, verificar backup/restauración, resolver el método manual de aplicación, ejecutar los casos positivos/negativos y reintentos en BD desechable y completar revisión contable/seguridad. No se verificó esquema vivo ni SHA desplegado al preparar estos artefactos.

## Release 2026-08-28 — Cobro de la diferencia en devolución parcial (Opción A)

Paquete aditivo publicado en `supabase/release/principal/02_devolucion_cobro_diferencia.sql` (con rollback en `02_devolucion_cobro_diferencia_rollback.sql`) y espejo para staging en `construacero-staging/supabase/migrations/252_staging_devolucion_cobro_diferencia.sql`.

- **Sobrecarga aditiva**: `registrar_devolucion_parcial_idempotente` gana una firma de 14 parámetros (`p_pagos_diferencia JSONB DEFAULT NULL`). La firma de 13 parámetros queda intacta; el Worker existente no cambia de contrato.
- **Helpers nuevos**: `validar_pagos_diferencia_devolucion` (validación temprana, no consume la clave idempotente) y `registrar_cobro_diferencia_devolucion` (inserta un abono por pago cobrado dentro de la misma transacción y recalcula saldos del cliente).
- **Replay-safe**: en replay la sobrecarga devuelve el resultado guardado sin re-insertar abonos.
- **Grants**: solo `service_role`; el Worker sigue siendo el único consumidor.
- **Rollback**: `DROP FUNCTION` de la sobrecarga y helpers; no requiere restore ni toca datos.
- En staging la misma pieza sobrecarga `registrar_devolucion_parcial_finanzas_atomica_staging` (migración 252, sin gate por convención de ese proyecto).

## Release 2026-10-19 — Egreso de inventario al aprobar (fin del stock comprometido)

Paquete en `supabase/release/main/17_egreso_inventario_aprobacion_apply.sql`, con backfill `17_egreso_inventario_backfill.sql`, verificación read-only `17_egreso_inventario_postflight_readonly.sql`, rollback `17_egreso_inventario_rollback_review.sql` y pre-imágenes en `17_backup_cuerpos/`. Plan y criterios de aceptación: `docs/plans/2026-10-19-plan-egreso-inventario-al-aprobar-despacho.md`.

- **Nuevo modelo**: el egreso de inventario ocurre al APROBAR el despacho (descuento + kardex atómicos); la ENTREGA ya no mueve inventario.
- **RPCs reemplazadas**: `aprobar_despacho_inventario_atomico` (v3), `confirmar_entrega_inventario_atomica`, `revertir_entrega_inventario_atomica` y `editar_despacho_profundidad` (3 sobrecargas). La edición en pendiente sigue sin escribir kardex; la edición de un despacho ya egresado escribe kardex por diferencia.
- **Reversión**: `despachada → pendiente/anulada` reingresa stock con kardex de reversa y exige re-aprobación posterior.
- **Backfill**: registra el egreso de despachos ya entregados sin kardex de salida; idempotente y verificado contra checksum.
- **Worker**: `api/handlers/despachos.js` consume las RPC v3 y devuelve `alertas_stock` en aprobar/entregar.
- **Frontend**: fin del stock comprometido (se eliminan `useStockComprometido`, `StockComprometidoDetalle` y `useReporteInventario`), badges de bajo stock/cero y avisos al aprobar/entregar.
- **Rollback**: restaura los cuerpos previos desde `17_backup_cuerpos/*.live.sql` (generar ANTES del apply con `pg_get_functiondef`); los egresos ya registrados no se revierten automáticamente.
- **Pruebas**: contrato en `src/utils/__tests__/egresoInventarioContract.test.js`; e2e staging `228_e2e_devolucion_staging.sql` adaptado al nuevo modelo.

## Release 2026-10-20 — Cobro COD en pedidos de pago mixto (PREPARADO, sin aplicar)

Artefactos preparados y probados, **no aplicados a producción**. Plan, criterios de éxito y ventana: `docs/plans/2026-10-20-plan-cod-pagos-multiples-e2e.md`.

- **Problema que resuelve**: los pedidos "parte a crédito + parte COD" (ej. #4099) no podían cobrar su porción COD (`manual_review` / `LEDGER_AMBIGUO`); los operadores terminaban registrando el cobro a nivel de cuenta (caso #3879).
- **Artefactos**: `19_cod_mixto_review.sql` (con gate `REVIEW_ONLY`), `19_cod_mixto_apply.sql` (copia sin gate para la ventana), `19_cod_preflight_readonly.sql`, `19_cod_postflight_readonly.sql` y `19_cod_rollback_review.sql`.
- **Atribución determinista**: abonos marcados `metodo_pago='cod'` (flujo atómico) aplican a la porción COD; abonos comunes (flujo CxC/legados) aplican primero a la porción a crédito y solo el desborde pasa al COD. Con un solo cargo (100% COD) la fórmula es **idéntica al release 14** (regresión probada por snapshots).
- **Guardas nuevas**: `COD_CONCILIACION_ATRIBUCION_AMBIGUA` (desborde sin marca con deuda abierta, caso #3064) y `COD_CONCILIACION_FLAG_SIN_SOPORTE` (marca de pagado sin movimientos que la respalden, casos #3879/#2185). `LEDGER_AMBIGUO` solo rechaza COD declarado sin cargo.
- **Intacto**: política de un centavo, idempotencia, doble JSON `forma_pago`/`forma_pago_cliente`, etiqueta `metodo_pago='cod'` en abonos del flujo atómico, grants solo `service_role` y la tranca de comisiones v4 (comisión nace al saldar la porción COD).
- **Frontend/Worker**: `ConciliarCodModal.jsx` muestra las dos porciones ("se cobra aquí" / "se cobra en CxC") y el motivo concreto de cada revisión; `api/handlers/cod.js` devuelve los códigos nuevos como error de negocio 400.
- **Pruebas**: arnés `scripts/test-cod-mixto-release-local.mjs` (ruta real v14→v18 en PostgreSQL desechable: regresión 100% COD idéntica + matriz de 10 casos + rollback restaurado, PASS exit 0); suite vitest 559/559; espejo puro `estadoCodDerivadoV2` en `scripts/lib/invariantes.mjs`.
- **Rollback**: `19_cod_rollback_review.sql` restaura los cuerpos byte-idénticos del release 14 (más `OR REPLACE` para escribirlos sobre los existentes), sus COMMENTs y grants; no borra asientos, marcas ni registros de idempotencia.