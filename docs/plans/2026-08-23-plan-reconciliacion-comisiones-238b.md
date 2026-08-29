# Plan de reconciliacion historica de comisiones 238b

Fecha de preparacion: 2026-08-23
Proyecto objetivo: principal (`oyfyuszgjwcepjpngclv`)
Estado: PREPARADO / NO-GO

## Alcance

Este plan cubre la transicion de las filas legacy de `public.comisiones` a la politica acordada:

- `totalcomision` solo usa la porcion no-CxC.
- En un pago mixto, solo se computan los metodos distintos de CxC.
- CxC no se suma a la comision; `Comision CxC` sigue siendo un ajuste manual administrativo.
- Donacion y prestamo como metodo de pago quedan separados como `comision_pago_excluida`.
- Productos `es_prestamo` y productos cuyo nombre inicia con `Corte` quedan separados como `comision_otras_exclusiones`.
- La salida historica propuesta queda en estado `generada`, sin reactivar el ciclo pagar/pendiente.

No incluye borrado de columnas legacy, borrado de comisiones, cambios de inventario, cambios de CxC ni revocacion de grants.

## Evidencia disponible

El dry-run reproducible de staging ya confirmó 703 filas legacy en la cuenta `74dd6821-963d-406e-8621-47352e0df27e`, con 703 despachos y correlativos únicos, 0 duplicados, 701 `high_confidence` y 2 `manual_review`. La evidencia completa está en `tmp/238b-staging/238b-historical-dry-run-staging.json` y su reporte en `docs/plans/2026-08-23-238b-historical-dry-run-staging.md`.

El conteo histórico del principal no se sustituye por el staging. Antes de cualquier cambio en el principal todavía debe generarse un baseline reproducible con timestamp, hash del archivo, `project_ref`, cuenta y backup fresco verificable.

### Auditoria de contrato 238c (READ ONLY) - 2026-08-23

Se ejecuto `238c_contract_audit_readonly.sql` contra el principal en transaccion `READ ONLY` con `ROLLBACK` para confirmar precondiciones. Resultado (evidencia en `tmp/preflight-238c-contract-audit-2026-08-23.json` y `docs/plans/2026-08-23-auditoria-contrato-238c-readonly.md`):

- 725 comisiones; estados `cta_cobrar` y `pendiente`; cero duplicados por `despachoid`.
- No existen las columnas de evidencia 238b en `comisiones` (`detalle_extras`, `comision_cxc_excluida`, `comision_pago_excluida`, `comision_otras_exclusiones`, `fraccion_no_cxc`, `calculo_version`, `politica_comision`, `fuente_calculo`, `calculo_evidencia`); `pagadapor` sí existe como campo legacy y se conserva solo para snapshot y rollback.
- No existe indice unico sobre `comisiones.despachoid`; `comisiones_pkey` es el unico indice.
- No existen `comision_238b_batches` ni `comision_238b_batch_rows`.
- Las RPC `calcularcomisiondespacho(uuid)`, `calcular_comision_despacho(uuid)` y `marcar_comision_pagada(uuid)` conservan `EXECUTE` para `anon`, `authenticated` y `service_role`.

Estos bloqueos hacen que los SQL 238/238b no sean instalables ni aplicables contra el principal sin un tramo de contrato previo, por lo que el estado permanece `NO-GO`.

## Artefactos

1. `supabase/release/main/238a_contract_neutral_review.sql`
   - Instala únicamente columnas de evidencia, tablas de batch/snapshot e índice único por `despachoid`.
   - No agrega `pagadapor`, no cambia estados y no actualiza filas históricas.
   - Conserva `REVIEW_ONLY`.

2. `supabase/release/main/238a_contract_neutral_rollback_review.sql`
   - Revierte solo objetos creados por 238a según el marcador de ownership.
   - Se bloquea si existen batches, snapshots o evidencia utilizada posteriormente.
   - Conserva `REVIEW_ONLY`.

3. `supabase/release/main/238b_comisiones_guardrails_review.sql`
   - Define la politica futura, normalizacion de metodos, desglose de items y tablas de batch.
   - Conserva el gate `REVIEW_ONLY`.
   - No debe ejecutarse directamente.

4. `supabase/release/main/238b_historical_dry_run_readonly.sql`
   - Ejecuta una consulta `REPEATABLE READ, READ ONLY`.
   - Devuelve una fila por comision/despacho.
   - Incluye correlativo, vendedor, monto legacy, monto propuesto, split de pago, exclusiones, metadata anterior y evidencia por item.
   - Marca `manual_review`, `high_confidence` o `high_confidence_excluded_payment`.
   - Termina en `ROLLBACK` y no modifica datos.

5. `supabase/release/main/238b_historical_apply_review.sql`
   - Define registro de snapshot, aprobacion, apply atomico e idempotencia por `apply_key`.
   - Rechaza propuestas obsoletas comparando estado, montos y metadata de calculo.
   - Bloquea lotes con filas `manual_review`.
   - Conserva rollback separado.
   - Mantiene `REVIEW_ONLY`.

6. `supabase/release/main/238b_cutover_legacy_rpc_review.sql`
   - Conserva temporalmente la firma `calcularcomisiondespacho(UUID)`.
   - Solo se aplicaria despues de probar la funcion 238b y el Worker en staging.
   - Mantiene `REVIEW_ONLY`.

7. `supabase/release/main/238c_contract_audit_readonly.sql`
   - Auditoria de contrato exclusivamente `READ ONLY` (RR, ROLLBACK) que compara el catalogo real con las precondiciones de 238/238b.
   - No contiene DDL, DML, GRANT, REVOKE ni NOTIFY.

8. `scripts/validate-238b-review-package.mjs`
   - Validador local sin red ni credenciales.
   - Comprueba gates, modo read-only, funciones, rollback, idempotencia y ausencia de `DROP TABLE public.comisiones`.

## Orden de ejecucion futura

### Fase 0: congelar y respaldar

1. Congelar escrituras de comisiones durante la ventana.
2. Crear backup fresco del principal mediante el mecanismo aprobado.
3. Verificar que el backup corresponda al proyecto/ref correcto, fecha y hora.
4. Restaurar o clonar el backup en un entorno disposable.
5. No continuar si el restore no abre o si no coincide el conteo de tablas principales.

### Fase 1: baseline read-only

Capturar en el disposable y luego repetir en staging:

- Conteo de comisiones por `cuentaid` y `estado`.
- Suma de `totalcomision`, `comisioncabilla`, `comisionotros` y columnas legacy.
- Conteo de despachos unicos y duplicados.
- Conteo por vendedor y por correlativo.
- Conteo de despachos con snapshot en `notas_despacho_items`.
- Conteo de despachos que requieren fallback a `cotizacion_items`.
- Conteo de pagos CxC totales, mixtos, no-CxC, donacion y prestamo.
- Catalogo de funciones, triggers, constraints, indices y grants relacionados.

Guardar el resultado fuera de la BD con timestamp, hash y `project_ref`.

### Fase 2: instalar contratos en disposable

1. Copiar los SQL 238a/238b a una base restaurada desechable.
2. Retirar `REVIEW_ONLY` solo en memoria del runner, nunca del archivo fuente.
3. Ejecutar primero 238a neutral; validar columnas, tablas, índice y marcador.
4. Ensayar el rollback 238a sin filas de batch ni evidencia usada; restaurar 238a y continuar.
5. Ejecutar después los guardrails 238b y luego apply-review.
4. Confirmar que las funciones compilan y que PostgREST recarga el schema.
5. Probar llamadas de lectura y permisos con roles `anon`, `authenticated` y `service_role`.
6. Confirmar que la instalacion no cambie filas de `public.comisiones`.

Si la version PostgreSQL del disposable no soporta alguna funcion usada por el paquete, abortar y adaptar el SQL al contrato real antes de continuar.

### Fase 3: matriz mutable aislada

Crear datos sinteticos en una cuenta disposable y probar, al menos:

| Caso | Resultado esperado |
|---|---|
| Pago 100% no-CxC | `fraccion_no_cxc = 1`; toda la comision elegible entra |
| Pago 100% CxC | `fraccion_no_cxc = 0`; `totalcomision = 0`; CxC no se convierte en comision |
| Pago mixto con montos | Solo la fraccion no-CxC escala cabilla, otros y extras |
| Pago mixto sin montos | Si no se puede inferir el split, `manual_review`; no aplicar |
| Donacion/prestamo como metodo | `comision_pago_excluida` documentada; total generado cero o excluido segun regla probada |
| Item `es_prestamo` | No entra en bases; evidencia por item explica la exclusion |
| Item `Corte` | No entra en bases; no se confunde con categoria cabilla |
| Vendedor sin comision | `manual_review` historico o no se genera futuro |
| Despacho sin snapshot | `manual_review`; no promover automaticamente |
| Vendedor distinto al dueño del cliente | `manual_review`; no aplicar |
| `montopagado`, `pagadaen` o `pagadapor` existentes | `manual_review`; no sobrescribir pagos legacy |
| Repetir `apply_key` | Respuesta idempotente, sin segunda mutacion |
| `apply_key` diferente | Error y sin mutacion |
| Cambio posterior al snapshot | Error `COMISION_APPLY_BLOQUEADO_POR_CAMBIO_POSTERIOR` |
| Rollback sin cambios posteriores | Restaura snapshot exacto |
| Rollback despues de cambio externo | Bloquea rollback y conserva evidencia |

### Fase 4: dry-run de staging

Estado: `PASS READ ONLY`.

1. `batch_key` generado por cuenta: `e567b3f3-83c2-4798-a784-cac9bace6df2`.
2. 703/703 filas legacy devueltas; 703 despachos y correlativos únicos; 0 duplicados.
3. JSON y SQL adaptado guardados fuera de la base.
4. Clasificación: 701 `high_confidence`, 2 `manual_review`.
5. La diferencia legacy/propuesta y el residual están documentados por vendedor y correlativo.
6. PDFs general/individual detallado y resumido: 17/17 pruebas focalizadas PASS.
7. No existe autorización para aplicar mientras el residual posterior a CxC sea `$3,202.76` y existan filas manuales.

### Fase 5: snapshot y apply controlado

1. Registrar propuestas y baseline usando `registrar_propuestas_comisiones_238b`.
2. Confirmar `snapshot_rows`, `manual_review_rows` y `business_rows_mutated = false`.
3. No aprobar un batch que tenga filas manuales.
4. Aprobar el lote completo de alta confianza con responsable y hora.
5. Ejecutar `aplicar_reconciliacion_comisiones_238b` con `apply_key` nueva.
6. Verificar que cada fila aplicada conserve `batch_key`, evidencia y metadata 238b.
7. Si falla una fila, abortar toda la transaccion y no continuar parcialmente.

### Fase 6: postflight y rollback ensayado

Comparar antes/despues:

- Conteo de comisiones y despachos unicos.
- Suma de comision por vendedor.
- Suma de `comision_cxc_excluida`, `comision_pago_excluida` y `comision_otras_exclusiones`.
- `totalcomision = comisioncabilla + comisionotros + extras` por fila.
- `totalcomision` nunca incluye la porcion CxC.
- No aparecen estados de pago nuevos.
- No cambia stock, CxC, despachos ni auditoria no relacionada.

Ensayar rollback con `rollback_key` nueva. Confirmar que el segundo llamado con la misma llave sea idempotente y que una llave distinta sea rechazada.

## Gated promotion

Solo despues de que disposable y staging pasen:

1. Validar el mapa de escrituras del Worker.
2. Desplegar el commit exacto probado.
3. Ejecutar smoke autenticado de pantalla, API y cuatro PDFs.
4. Repetir baseline read-only en principal.
5. Tomar backup fresco inmediatamente antes del cambio.
6. Aplicar guardrails futuros.
7. Ejecutar un lote historico pequeño, aprobado y reversible.
8. Postflight.
9. Ampliar por batches solo si no hay diferencias.
10. Aplicar el cutover legacy al final.

## Criterios de abortar

- Backup no verificable.
- `project_ref` o `cuenta_id` incorrectos.
- Baseline no reproducible.
- Diferencia de conteo de despachos unicos.
- Cualquier fallback no clasificado como manual.
- Cualquier vendedor mismatch.
- Cualquier monto pagado legacy presente en un lote promovido.
- Error de compilacion PostgreSQL.
- Cambio de filas fuera del batch.
- Rollback que no pueda demostrar restauracion exacta.

## Estado actual

`NO-GO PARA HISTORICOS / STAGING PASS EN LECTURA`.

`238a` y `238b` fueron instalados y probados en staging; el dry-run histórico se ejecutó en `REPEATABLE READ, READ ONLY` con `ROLLBACK` por cuenta. La evidencia cubre 703/703 filas, 703 despachos únicos, 701 `high_confidence`, 2 `manual_review`, 0 batches y 0 mutaciones.

La propuesta baja de `$14,415.07` a `$8,188.22`: `$3,024.09` están identificados como CxC y `$3,202.76` son residual de recálculo posterior a CxC. El histórico completo no puede aplicarse hasta conciliar ese residual por correlativo y resolver los casos 760 y 1232. El principal no fue tocado, no se retiró `REVIEW_ONLY` de los SQL fuente y no existe batch histórico aprobado.

Evidencia: `docs/plans/2026-08-23-238b-historical-dry-run-staging.md` y `tmp/238b-staging/238b-historical-dry-run-staging.json`.

## Actualización 2026-08-24

El dry-run fresco del principal reemplazó la fotografía anterior de 725 filas: ahora existen `729` comisiones, total legacy `$14,586.18`, `728` propuestas `high_confidence` por `$8,359.33` y `1` `manual_review` (despacho `760`, 100% CxC). CxC identificada: `$3,024.08`; residual posterior a CxC: `$3,202.77`. No se aplicó ningún histórico.

El contrato histórico fue alineado para incluir `old_pagadapor` y `proposed_pagadapor` en el snapshot del principal, y el rollback quedó incluido en el mismo contrato. En staging se validó el flujo completo con 4 filas: registro, aprobación, apply, idempotencia, rollback e invariantes de montos; el principal permaneció intacto.

Evidencia de staging: `docs/plans/2026-08-24-staging-238b-contract-test.md` y `tmp/238b-staging/238b-historical-contract-staging-v4-2026-08-24T14-26-11-333Z.json`.

Estado: `NO-GO PARA HISTORICO PRINCIPAL`; el batch completo debe regenerarse desde esta evidencia fresca, conservar fuera el despacho 760 y aprobarse explícitamente antes de cualquier mutación.
