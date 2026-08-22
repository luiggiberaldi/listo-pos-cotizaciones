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
